import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../../errors/api-error.ts";
import type { Conversation } from "../../domain/conversation.ts";
import { invalidRequest } from "../../errors/invalid-request.ts";
import type { InboundMessage } from "../../domain/inbound-message.ts";
import type { MessagingTask } from "../../domain/messaging-task.ts";
import { type PlatformAdapter } from "../platform-adapter.ts";
import type { Store } from "../../storage/store.ts";
import { isRecord, requiredString } from "../../validation.ts";

import type { WahaOptions } from "./waha-options.ts";

export function isWahaLid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*@lid$/.test(value);
}

export class WahaPlatformAdapter implements PlatformAdapter {
  readonly platform = "waha" as const;
  readonly session: string;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;
  private readonly lidsByPhone = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly options: WahaOptions,
  ) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "WAHA_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.",
      );
    }
    this.baseUrl = url.toString().replace(/\/$/, "");
    this.session = requiredString(
      options.session ?? "default",
      "WAHA_SESSION",
      200,
    );
    this.http = options.fetch ?? fetch;
  }

  async listConversations(search?: string): Promise<Conversation[]> {
    const contacts = await this.call(
      `/api/contacts/all?session=${encodeURIComponent(this.session)}`,
    );
    if (!Array.isArray(contacts)) throw this.providerError();
    const conversations = new Map<string, Conversation>(
      (await this.store.listConversations(this.platform))
        .map((c) => [c.conversationId, c]),
    );
    for (const contact of contacts) {
      if (
        !isRecord(contact) ||
        contact.isMe === true ||
        contact.isGroup === true ||
        contact.isBlocked === true
      )
        continue;
      let conversationId = isWahaLid(contact.id)
        ? contact.id
        : isWahaLid(contact.lid)
          ? contact.lid
          : null;
      if (
        !conversationId &&
        typeof contact.id === "string" &&
        /^[1-9]\d*@(c\.us|s\.whatsapp\.net)$/.test(contact.id)
      ) {
        const mapping = await this.call(
          `/api/${encodeURIComponent(this.session)}/lids/pn/${encodeURIComponent(contact.id)}`,
        );
        if (isRecord(mapping) && isWahaLid(mapping.lid))
          conversationId = mapping.lid;
      }
      if (!conversationId) continue;
      if (typeof contact.id === "string")
        this.lidsByPhone.set(contact.id, conversationId);
      const name = [contact.name, contact.pushname, contact.shortName].find(
        (value) => typeof value === "string" && value.trim(),
      );
      const conversation: Conversation = {
        platform: this.platform,
        conversationId,
        displayName: typeof name === "string" ? name.trim() : conversationId,
      };
      await this.store.addConversation(conversation);
      conversations.set(conversationId, conversation);
    }
    const query = search?.trim().toLocaleLowerCase();
    return [...conversations.values()]
      .filter(
        (contact) =>
          !query ||
          `${contact.displayName} ${contact.conversationId}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async sendMessage(
    task: MessagingTask,
    message: string,
  ): Promise<{ acceptedAt: string }> {
    if (task.platform !== this.platform || !isWahaLid(task.conversationId)) {
      throw new ApiError(
        502,
        "MESSAGE_SEND_FAILED",
        "The task has an invalid WAHA destination.",
      );
    }
    await this.call(
      "/api/sendText",
      {
        method: "POST",
        body: JSON.stringify({
          session: this.session,
          chatId: task.conversationId,
          text: message,
        }),
      },
      "MESSAGE_SEND_FAILED",
    );
    return { acceptedAt: new Date().toISOString() };
  }

  async normalizeInbound(body: unknown): Promise<InboundMessage | null> {
    if (!isRecord(body))
      throw invalidRequest("The webhook body must be a JSON object.");
    requiredString(body.event, "event", 200);
    requiredString(body.session, "session", 200);
    if (
      body.session !== this.session ||
      !["message", "message.any"].includes(body.event as string)
    )
      return null;
    if (!isRecord(body.payload))
      throw invalidRequest("WAHA message payload must be an object.");
    const payload = body.payload;
    if (typeof payload.fromMe !== "boolean")
      throw invalidRequest("WAHA fromMe must be a boolean.");
    if (payload.fromMe) return null;
    const conversationId = isWahaLid(payload.from)
      ? payload.from
      : typeof payload.from === "string"
        ? this.lidsByPhone.get(payload.from)
        : undefined;
    if (
      !conversationId ||
      typeof payload.body !== "string" ||
      !payload.body.trim()
    )
      return null;
    const externalMessageId = requiredString(payload.id, "payload.id", 500);
    const content = requiredString(payload.body, "payload.body");
    if (
      typeof payload.timestamp !== "number" ||
      !Number.isFinite(payload.timestamp) ||
      payload.timestamp < 0
    ) {
      throw invalidRequest(
        "WAHA payload.timestamp must be a Unix timestamp in seconds.",
      );
    }
    const date = new Date(payload.timestamp * 1000);
    if (Number.isNaN(date.getTime()))
      throw invalidRequest(
        "WAHA payload.timestamp is outside the supported range.",
      );
    return {
      platform: this.platform,
      conversationId,
      externalMessageId,
      senderId: payload.from as string,
      senderDisplayName: conversationId,
      content,
      timestamp: date.toISOString(),
    };
  }

  async prepareInbound(message: InboundMessage): Promise<void> {
    const conversation = await this.store.getConversation(this.platform, message.conversationId);
    message.senderDisplayName = conversation?.displayName ?? message.conversationId;
    await this.store.addConversation({
      platform: this.platform,
      conversationId: message.conversationId,
      displayName: message.senderDisplayName,
    });
  }

  async readWebhook(
    request: Request,
    raw: Buffer,
    bearerToken: string,
  ): Promise<Record<string, unknown>> {
    if (this.options.hmacKey) {
      const signature = request.headers.get("x-webhook-hmac") ?? "";
      const expected = createHmac("sha512", this.options.hmacKey)
        .update(raw)
        .digest();
      if (
        request.headers.get("x-webhook-hmac-algorithm") !== "sha512" ||
        !/^[a-f\d]{128}$/i.test(signature) ||
        !timingSafeEqual(expected, Buffer.from(signature, "hex"))
      )
        this.authError();
    } else if (
      !bearerToken ||
      request.headers.get("authorization") !== `Bearer ${bearerToken}`
    )
      this.authError();
    if (
      !(request.headers.get("content-type") ?? "")
        .toLowerCase()
        .includes("application/json")
    ) {
      throw invalidRequest("Content-Type must be application/json.");
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw invalidRequest("Request body must contain valid JSON.");
    }
    if (!isRecord(body))
      throw invalidRequest("The webhook body must be a JSON object.");
    return body;
  }

  private authError(): never {
    throw new ApiError(
      401,
      "WEBHOOK_AUTHENTICATION_FAILED",
      "Valid WAHA webhook authentication is required.",
    );
  }

  private providerError(code = "WAHA_REQUEST_FAILED"): ApiError {
    return new ApiError(502, code, "The WAHA request failed.");
  }

  private async call(
    path: string,
    init: RequestInit = {},
    code = "WAHA_REQUEST_FAILED",
  ): Promise<unknown> {
    if (!this.options.apiKey.trim())
      throw new ApiError(
        503,
        "WAHA_NOT_CONFIGURED",
        "Set WAHA_API_KEY to use the WAHA adapter.",
      );
    try {
      const response = await this.http(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "X-Api-Key": this.options.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) throw this.providerError(code);
      return await response.json();
    } catch {
      throw this.providerError(code);
    }
  }
}

export type { WahaOptions } from "./waha-options.ts";
