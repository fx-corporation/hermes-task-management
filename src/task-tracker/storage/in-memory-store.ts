import { type ConversationAction } from "../domain/conversation-action.ts";
import { conversationKey } from "../domain/conversation-key.ts";
import { type Conversation } from "../domain/conversation.ts";
import { type InboundEvent } from "../domain/inbound-event.ts";
import { type MessagingTask } from "../domain/messaging-task.ts";
import { type Platform } from "../domain/platform.ts";
import type { Store } from "./store.ts";

export class InMemoryStore implements Store {
  readonly conversations = new Map<string, Conversation>();
  readonly tasks = new Map<string, MessagingTask>();
  readonly inboundEvents = new Map<string, InboundEvent>();
  readonly actionsByConversation = new Map<string, ConversationAction[]>();
  private nextActionSequence = 1;
  private initialized = false;

  constructor(private readonly seed = true) {
    void this.setup();
  }

  async setup(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (this.seed) {
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

  async close(): Promise<void> {}

  async addConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(
      conversationKey(conversation.platform, conversation.conversationId),
      conversation,
    );
  }

  async getConversation(
    platform: Platform,
    conversationId: string,
  ): Promise<Conversation | undefined> {
    return this.conversations.get(conversationKey(platform, conversationId));
  }

  async listConversations(platform?: Platform): Promise<Conversation[]> {
    return [...this.conversations.values()].filter(
      (conversation) => !platform || conversation.platform === platform,
    );
  }

  async saveTask(task: MessagingTask): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async getTask(taskId: string): Promise<MessagingTask | undefined> {
    return this.tasks.get(taskId);
  }

  async getTasks(): Promise<MessagingTask[]> {
    return [...this.tasks.values()];
  }

  async getOpenTasks(platform: Platform, conversationId: string): Promise<MessagingTask[]> {
    return [...this.tasks.values()].filter(
      (task) =>
        task.platform === platform &&
        task.conversationId === conversationId &&
        (task.status === "ACTIVE" || task.status === "WAITING_EXTERNAL_REPLY"),
    );
  }

  async saveInboundEvent(event: InboundEvent): Promise<void> {
    this.inboundEvents.set(event.deduplicationKey, event);
  }

  async getInboundEvent(deduplicationKey: string): Promise<InboundEvent | undefined> {
    return this.inboundEvents.get(deduplicationKey);
  }

  async reserveAction(
    action: Omit<ConversationAction, "id" | "sequence" | "timestamp">,
  ): Promise<ConversationAction> {
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

  async saveAction(action: ConversationAction): Promise<void> {
    const key = conversationKey(action.platform, action.conversationId);
    const history = this.actionsByConversation.get(key) ?? [];
    const existingIndex = history.findIndex(({ id }) => id === action.id);
    if (existingIndex === -1) history.push(action);
    else history[existingIndex] = action;
    history.sort((a, b) => a.sequence - b.sequence);
    this.actionsByConversation.set(key, history);
  }

  async getConversationActions(
    platform: Platform,
    conversationId: string,
  ): Promise<ConversationAction[]> {
    return [
      ...(this.actionsByConversation.get(
        conversationKey(platform, conversationId),
      ) ?? []),
    ];
  }
}
