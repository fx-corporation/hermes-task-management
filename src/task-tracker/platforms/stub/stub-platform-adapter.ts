import { ApiError } from "../../errors/api-error.ts";
import { type Conversation } from "../../domain/conversation.ts";
import { invalidRequest } from "../../errors/invalid-request.ts";
import { type InboundMessage } from "../../domain/inbound-message.ts";
import { type MessagingTask } from "../../domain/messaging-task.ts";
import type { PlatformAdapter } from "../platform-adapter.ts";
import { PLATFORM } from "../../domain/platform.ts";
import { InMemoryStore } from "../../storage/store.ts";
import { isRecord, requiredString } from "../../validation.ts";

export class StubPlatformAdapter implements PlatformAdapter {
  readonly platform = PLATFORM;

  constructor(private readonly store: InMemoryStore) {}

  listConversations(search?: string): Conversation[] {
    const normalized = search?.trim().toLocaleLowerCase();
    return [...this.store.conversations.values()]
      .filter((conversation) => {
        if (conversation.platform !== this.platform) return false;
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
      throw new ApiError(
        502,
        "MESSAGE_SEND_FAILED",
        "The stub platform no longer has this conversation.",
      );
    }
    return { acceptedAt: new Date().toISOString() };
  }

  normalizeInbound(payload: unknown): InboundMessage {
    if (!isRecord(payload))
      throw invalidRequest("The webhook body must be a JSON object.");
    const conversationId = requiredString(
      payload.conversationId,
      "conversationId",
    );
    const externalMessageId = requiredString(
      payload.externalMessageId,
      "externalMessageId",
    );
    const content = requiredString(payload.message, "message");
    const conversation = this.store.getConversation(PLATFORM, conversationId);
    if (!conversation)
      throw new ApiError(
        404,
        "CONVERSATION_NOT_FOUND",
        "The requested conversation does not exist.",
      );

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
