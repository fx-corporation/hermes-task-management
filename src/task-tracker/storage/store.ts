import { type ConversationAction } from "../domain/conversation-action.ts";
import { conversationKey } from "../domain/conversation-key.ts";
import { type Conversation } from "../domain/conversation.ts";
import { type InboundEvent } from "../domain/inbound-event.ts";
import { type MessagingTask } from "../domain/messaging-task.ts";
import { type Platform } from "../domain/platform.ts";

export class InMemoryStore {
  readonly conversations = new Map<string, Conversation>();
  readonly tasks = new Map<string, MessagingTask>();
  readonly inboundEvents = new Map<string, InboundEvent>();
  readonly actionsByConversation = new Map<string, ConversationAction[]>();
  private nextActionSequence = 1;

  constructor(seed = true) {
    if (seed) {
      this.addConversation({
        platform: "stub",
        conversationId: "+12025550101",
        displayName: "Example Dental",
      });
      this.addConversation({
        platform: "stub",
        conversationId: "+12025550102",
        displayName: "Sample Plumbing",
      });
    }
  }

  addConversation(conversation: Conversation): void {
    this.conversations.set(
      conversationKey(conversation.platform, conversation.conversationId),
      conversation,
    );
  }

  getConversation(
    platform: Platform,
    conversationId: string,
  ): Conversation | undefined {
    return this.conversations.get(conversationKey(platform, conversationId));
  }

  getOpenTasks(platform: Platform, conversationId: string): MessagingTask[] {
    return [...this.tasks.values()].filter(
      (task) =>
        task.platform === platform &&
        task.conversationId === conversationId &&
        (task.status === "ACTIVE" || task.status === "WAITING_EXTERNAL_REPLY"),
    );
  }

  reserveAction(
    action: Omit<ConversationAction, "id" | "sequence" | "timestamp">,
  ): ConversationAction {
    const complete: ConversationAction = {
      ...action,
      id: `action_${crypto.randomUUID()}`,
      sequence: this.nextActionSequence++,
      timestamp: new Date().toISOString(),
    };
    const key = conversationKey(action.platform, action.conversationId);
    const history = this.actionsByConversation.get(key) ?? [];
    history.push(complete);
    this.actionsByConversation.set(key, history);
    return complete;
  }

  getConversationActions(
    platform: Platform,
    conversationId: string,
  ): ConversationAction[] {
    return [
      ...(this.actionsByConversation.get(
        conversationKey(platform, conversationId),
      ) ?? []),
    ];
  }
}
