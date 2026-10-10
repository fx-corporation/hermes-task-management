import { ApiError } from "../../errors/api-error.ts";
import { type Conversation } from "../../domain/conversation.ts";
import { invalidRequest } from "../../errors/invalid-request.ts";
import { type InboundMessage } from "../../domain/inbound-message.ts";
import { type MessagingTask } from "../../domain/messaging-task.ts";
import type { PlatformAdapter } from "../platform-adapter.ts";
import { PLATFORM } from "../../domain/platform.ts";
import type { Store } from "../../storage/store.ts";
import { isRecord, requiredString } from "../../validation.ts";

export class StubPlatformAdapter implements PlatformAdapter {
  readonly platform = PLATFORM;

  constructor(private readonly store: Store) {}

  async listConversations(search?: string): Promise<Conversation[]> {
    const normalized = search?.trim().toLocaleLowerCase();
    return (await this.store.listConversations(this.platform))
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
    if (!await this.store.getConversation(task.platform, task.conversationId)) {
      throw new ApiError(
        502,
        "MESSAGE_SEND_FAILED",
        "The stub platform no longer has this conversation.",
      );
    }
    return { acceptedAt: new Date().toISOString() };
  }

  async normalizeInbound(payload: unknown): Promise<InboundMessage> {
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
    return {
      platform: PLATFORM,
      conversationId,
      externalMessageId,
      senderId: conversationId,
      senderDisplayName: conversationId,
      content,
      timestamp: new Date().toISOString(),
    };
  }

  async prepareInbound(message: InboundMessage): Promise<void> {
    const conversation = await this.store.getConversation(PLATFORM, message.conversationId);
    if (!conversation)
      throw new ApiError(
        404,
        "CONVERSATION_NOT_FOUND",
        "The requested conversation does not exist.",
      );

    message.senderDisplayName = conversation.displayName;
  }
}
