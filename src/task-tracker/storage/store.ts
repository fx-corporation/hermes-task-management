import { type ConversationAction } from "../domain/conversation-action.ts";
import { type Conversation } from "../domain/conversation.ts";
import { type InboundEvent } from "../domain/inbound-event.ts";
import { type MessagingTask } from "../domain/messaging-task.ts";
import { type Platform } from "../domain/platform.ts";

export interface Store {
  setup(): Promise<void>;
  close(): Promise<void>;
  addConversation(conversation: Conversation): Promise<void>;
  getConversation(
    platform: Platform,
    conversationId: string,
  ): Promise<Conversation | undefined>;
  listConversations(platform?: Platform): Promise<Conversation[]>;
  saveTask(task: MessagingTask): Promise<void>;
  getTask(taskId: string): Promise<MessagingTask | undefined>;
  getTasks(): Promise<MessagingTask[]>;
  getOpenTasks(platform: Platform, conversationId: string): Promise<MessagingTask[]>;
  saveInboundEvent(event: InboundEvent): Promise<void>;
  getInboundEvent(deduplicationKey: string): Promise<InboundEvent | undefined>;
  reserveAction(
    action: Omit<ConversationAction, "id" | "sequence" | "timestamp">,
  ): Promise<ConversationAction>;
  saveAction(action: ConversationAction): Promise<void>;
  getConversationActions(
    platform: Platform,
    conversationId: string,
  ): Promise<ConversationAction[]>;
}
