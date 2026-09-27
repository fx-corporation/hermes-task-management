import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isRecord, requiredString, type PlatformAdapter } from "./adapters.ts";
import type { Conversation, InboundMessage, MessagingTask } from "./domain.ts";
import { ApiError, invalidRequest } from "./errors.ts";
import { InMemoryStore } from "./store.ts";

export interface WahaOptions {
  baseUrl: string;
  apiKey: string;
  session?: string;
  hmacKey?: string;
  fetch?: typeof fetch;
}

// The task API supports direct contacts identified by canonical phone numbers.
function phoneFromChatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^([1-9]\d{7,14})@(c\.us|s\.whatsapp\.net)$/);
  return match ? `+${match[1]}` : null;
}

export class WahaPlatformAdapter implements PlatformAdapter {
  readonly platform = "waha" as const;
  readonly session: string;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;
  private readonly chatIds = new Map<string, string>();

  constructor(private readonly store: InMemoryStore, private readonly options: WahaOptions) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("WAHA_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.");
    }
    if (!options.apiKey.trim()) throw new Error("WAHA_API_KEY is required.");
    this.baseUrl = url.toString().replace(/\/$/, "");
    this.session = requiredString(options.session ?? "default", "WAHA_SESSION", 200);
    this.http = options.fetch ?? fetch;
  }

  async listConversations(search?: string): Promise<Conversation[]> {
    const contacts = await this.call(`/api/contacts/all?session=${encodeURIComponent(this.session)}`);
    if (!Array.isArray(contacts)) throw this.providerError();
    const conversations: Conversation[] = [];
    for (const contact of contacts) {
      if (!isRecord(contact) || contact.isMe === true || contact.isGroup === true || contact.isBlocked === true) continue;
      const conversationId = phoneFromChatId(contact.id);
      if (!conversationId) continue;
      const name = [contact.name, contact.pushname, contact.shortName].find(value => typeof value === "string" && value.trim());
      const conversation: Conversation = { platform: this.platform, conversationId, displayName: typeof name === "string" ? name.trim() : conversationId };
      this.store.addConversation(conversation);
      this.chatIds.set(conversationId, contact.id as string);
      conversations.push(conversation);
    }
    const query = search?.trim().toLocaleLowerCase();
    return conversations.filter(contact => !query || `${contact.displayName} ${contact.conversationId}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async sendMessage(task: MessagingTask, message: string): Promise<{ acceptedAt: string }> {
    if (task.platform !== this.platform || !/^\+[1-9]\d{7,14}$/.test(task.conversationId)) {
      throw new ApiError(502, "MESSAGE_SEND_FAILED", "The task has an invalid WAHA destination.");
    }
    await this.call("/api/sendText", {
      method: "POST",
      body: JSON.stringify({ session: this.session, chatId: this.chatIds.get(task.conversationId) ?? `${task.conversationId.slice(1)}@c.us`, text: message }),
    }, "MESSAGE_SEND_FAILED");
    return { acceptedAt: new Date().toISOString() };
  }

  normalizeInbound(body: unknown): InboundMessage | null {
    if (!isRecord(body)) throw invalidRequest("The webhook body must be a JSON object.");
    requiredString(body.event, "event", 200);
    requiredString(body.session, "session", 200);
    if (body.session !== this.session || !["message", "message.any"].includes(body.event as string)) return null;
    if (!isRecord(body.payload)) throw invalidRequest("WAHA message payload must be an object.");
    const payload = body.payload;
    if (typeof payload.fromMe !== "boolean") throw invalidRequest("WAHA fromMe must be a boolean.");
    if (payload.fromMe) return null;
    const conversationId = phoneFromChatId(payload.from);
    if (!conversationId || typeof payload.body !== "string" || !payload.body.trim()) return null;
    const externalMessageId = requiredString(payload.id, "payload.id", 500);
    const content = requiredString(payload.body, "payload.body");
    if (typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp) || payload.timestamp < 0) {
      throw invalidRequest("WAHA payload.timestamp must be a Unix timestamp in seconds.");
    }
    const date = new Date(payload.timestamp * 1000);
    if (Number.isNaN(date.getTime())) throw invalidRequest("WAHA payload.timestamp is outside the supported range.");
    const senderDisplayName = this.store.getConversation(this.platform, conversationId)?.displayName ?? conversationId;
    this.store.addConversation({ platform: this.platform, conversationId, displayName: senderDisplayName });
    this.chatIds.set(conversationId, payload.from as string);
    return { platform: this.platform, conversationId, externalMessageId, senderId: payload.from as string, senderDisplayName, content, timestamp: date.toISOString() };
  }

  async readWebhook(request: Request, bearerToken: string): Promise<Record<string, unknown>> {
    const raw: Buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (this.options.hmacKey) {
      const signature = request.get("x-webhook-hmac") ?? "";
      const expected = createHmac("sha512", this.options.hmacKey).update(raw).digest();
      if (request.get("x-webhook-hmac-algorithm") !== "sha512" || !/^[a-f\d]{128}$/i.test(signature) ||
          !timingSafeEqual(expected, Buffer.from(signature, "hex"))) this.authError();
    } else if (request.get("authorization") !== `Bearer ${bearerToken}`) this.authError();
    if (!(request.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw invalidRequest("Content-Type must be application/json.");
    }
    let body: unknown;
    try { body = JSON.parse(raw.toString("utf8")); } catch { throw invalidRequest("Request body must contain valid JSON."); }
    if (!isRecord(body)) throw invalidRequest("The webhook body must be a JSON object.");
    return body;
  }

  private authError(): never {
    throw new ApiError(401, "WEBHOOK_AUTHENTICATION_FAILED", "Valid WAHA webhook authentication is required.");
  }

  private providerError(code = "WAHA_REQUEST_FAILED"): ApiError {
    return new ApiError(502, code, "The WAHA request failed.");
  }

  private async call(path: string, init: RequestInit = {}, code = "WAHA_REQUEST_FAILED"): Promise<unknown> {
    try {
      const response = await this.http(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "X-Api-Key": this.options.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) throw this.providerError(code);
      return await response.json();
    } catch { throw this.providerError(code); }
  }
}
