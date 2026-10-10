import type { Conversation } from "../domain/conversation.ts";
import type { InboundMessage } from "../domain/inbound-message.ts";
import type { MessagingTask } from "../domain/messaging-task.ts";
import type { Platform } from "../domain/platform.ts";

export interface PlatformAdapter {
  readonly platform: Platform;
  listConversations(search?: string): Conversation[] | Promise<Conversation[]>;
  sendMessage(
    task: MessagingTask,
    message: string,
  ): Promise<{ acceptedAt: string }>;
  normalizeInbound(payload: unknown): InboundMessage | null | Promise<InboundMessage | null>;
  prepareInbound?(message: InboundMessage): Promise<void>;
}
