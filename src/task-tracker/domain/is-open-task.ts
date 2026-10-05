import type { TaskStatus } from "./task-status.ts";

export function isOpenTask(status: TaskStatus): boolean {
  return status === "ACTIVE" || status === "WAITING_EXTERNAL_REPLY";
}
