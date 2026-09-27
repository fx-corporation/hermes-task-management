export const PLATFORM = "stub" as const;

export type Platform = typeof PLATFORM | "waha";

export type TaskStatus =
  | "ACTIVE"
  | "WAITING_EXTERNAL_REPLY"
  | "COMPLETED"
  | "CANCELLED";

export interface Conversation {
  platform: Platform;
  conversationId: string;
  displayName: string;
}

export interface MessagingTask {
  id: string;
  title: string;
  platform: Platform;
  conversationId: string;
  hermesSessionId: string;
  status: TaskStatus;
  result: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ActionType = "MESSAGE_SENT" | "WEBHOOK_RECEIVED" | "HERMES_DELIVERED";

export type EventOutcome =
  | "PENDING_HERMES"
  | "DELIVERED"
  | "IGNORED_NO_ACTIVE_TASK"
  | "IGNORED_TASK_CLOSED"
  | "DELIVERY_FAILED";

export interface ConversationAction {
  id: string;
  sequence: number;
  timestamp: string;
  type: ActionType;
  platform: Platform;
  conversationId: string;
  taskId?: string;
  hermesSessionId?: string;
  externalMessageId?: string;
  message: string;
  outcome: string;
  envelope?: string;
}

export interface InboundMessage {
  platform: Platform;
  conversationId: string;
  externalMessageId: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  timestamp: string;
}

export interface InboundEvent {
  id: string;
  deduplicationKey: string;
  message: InboundMessage;
  taskId: string | null;
  actionId: string;
  outcome: EventOutcome;
}

export interface HermesDelivery {
  sessionId: string;
  taskId: string;
  platform: Platform;
  senderDisplayName: string;
  externalMessageId: string;
  content: string;
  envelope: string;
  deliveredAt: string;
}

export function isOpenTask(status: TaskStatus): boolean {
  return status === "ACTIVE" || status === "WAITING_EXTERNAL_REPLY";
}

export function conversationKey(platform: Platform, conversationId: string): string {
  return `${platform}\u0000${conversationId}`;
}
