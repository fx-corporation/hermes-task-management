import type { Platform } from "./platform.ts";
import type { TaskStatus } from "./task-status.ts";

export interface MessagingTask {
  id: string;
  description: string;
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
