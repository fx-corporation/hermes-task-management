import {
  conversationKey,
  type Conversation,
  type ConversationAction,
  type InboundEvent,
  type MessagingTask,
  type Platform,
} from "./domain.ts";

export class InMemoryStore {
  readonly conversations = new Map<string, Conversation>();
  readonly tasks = new Map<string, MessagingTask>();
  readonly activeTaskByConversation = new Map<string, string>();
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

  getConversation(platform: Platform, conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationKey(platform, conversationId));
  }

  getActiveTask(platform: Platform, conversationId: string): MessagingTask | undefined {
    const id = this.activeTaskByConversation.get(conversationKey(platform, conversationId));
    return id ? this.tasks.get(id) : undefined;
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

  getConversationActions(platform: Platform, conversationId: string): ConversationAction[] {
    return [...(this.actionsByConversation.get(conversationKey(platform, conversationId)) ?? [])];
  }
}
