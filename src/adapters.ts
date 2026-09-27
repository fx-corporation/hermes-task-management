import {
  PLATFORM,
  type Conversation,
  type HermesDelivery,
  type InboundMessage,
  type MessagingTask,
  type Platform,
} from "./domain.ts";
import { ApiError, invalidRequest } from "./errors.ts";
import { InMemoryStore } from "./store.ts";

export interface PlatformAdapter {
  readonly platform: Platform;
  listConversations(search?: string): Conversation[] | Promise<Conversation[]>;
  sendMessage(task: MessagingTask, message: string): Promise<{ acceptedAt: string }>;
  normalizeInbound(payload: unknown): InboundMessage | null;
}

export interface HermesDeliveryAdapter {
  deliver(delivery: HermesDelivery): Promise<void>;
}

export class StubPlatformAdapter implements PlatformAdapter {
  readonly platform = PLATFORM;

  constructor(private readonly store: InMemoryStore) {}

  listConversations(search?: string): Conversation[] {
    const normalized = search?.trim().toLocaleLowerCase();
    return [...this.store.conversations.values()]
      .filter((conversation) => {
        if (!normalized) return true;
        return `${conversation.displayName} ${conversation.conversationId}`
          .toLocaleLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async sendMessage(
    task: MessagingTask,
    _message: string,
  ): Promise<{ acceptedAt: string }> {
    if (!this.store.getConversation(task.platform, task.conversationId)) {
      throw new ApiError(502, "MESSAGE_SEND_FAILED", "The stub platform no longer has this conversation.");
    }
    return { acceptedAt: new Date().toISOString() };
  }

  normalizeInbound(payload: unknown): InboundMessage {
    if (!isRecord(payload)) throw invalidRequest("The webhook body must be a JSON object.");
    const conversationId = requiredString(payload.conversationId, "conversationId");
    const externalMessageId = requiredString(payload.externalMessageId, "externalMessageId");
    const content = requiredString(payload.message, "message");
    const conversation = this.store.getConversation(PLATFORM, conversationId);
    if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "The requested conversation does not exist.");

    return {
      platform: PLATFORM,
      conversationId,
      externalMessageId,
      senderId: conversationId,
      senderDisplayName: conversation.displayName,
      content,
      timestamp: new Date().toISOString(),
    };
  }
}

export class InMemoryHermesAdapter implements HermesDeliveryAdapter {
  readonly deliveries: HermesDelivery[] = [];

  async deliver(delivery: HermesDelivery): Promise<void> {
    this.deliveries.push(delivery);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(
  value: unknown,
  field: string,
  maxLength = 4_000,
): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw invalidRequest(`"${field}" must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

export function exactKeys(
  body: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  for (const key of required) {
    if (!(key in body)) throw invalidRequest(`Missing required field "${key}".`);
  }
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw invalidRequest(`Unexpected field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`);
  }
}
