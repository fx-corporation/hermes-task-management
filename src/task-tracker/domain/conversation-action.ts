import type { ActionType } from "./action-type.ts";
import type { Platform } from "./platform.ts";

export interface ConversationAction {
  id: string;
  sequence: number;
  timestamp: string;
  type: ActionType;
  platform: Platform;
  conversationId: string;
  taskId?: string;
  taskIds?: string[];
  hermesSessionId?: string;
  externalMessageId?: string;
  message: string;
  outcome: string;
  envelope?: string;
}
