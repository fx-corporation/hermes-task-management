import { invalidRequest } from "../errors/invalid-request.ts";
import type { TaskStatus } from "../domain/task-status.ts";
import { isWahaLid } from "../platforms/waha/waha-adapter.ts";

export function requiredDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 20_000
  ) {
    throw invalidRequest(
      '"description" must be a non-empty string of at most 20000 characters.',
    );
  }
  return value;
}

export function validatePhoneNumber(value: unknown): string {
  if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) {
    throw invalidRequest(
      '"conversationId" must use canonical international format: + followed by 8 to 15 digits.',
    );
  }
  return value;
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (
    value === "ACTIVE" ||
    value === "WAITING_EXTERNAL_REPLY" ||
    value === "COMPLETED" ||
    value === "CANCELLED"
  );
}

export function validateConversationId(
  value: unknown,
  platform?: string,
): string {
  if (platform === "waha" || (!platform && isWahaLid(value))) {
    if (!isWahaLid(value) || value.length > 200)
      throw invalidRequest(
        'WAHA "conversationId" must be a numeric identifier ending in @lid.',
      );
    return value;
  }
  return validatePhoneNumber(value);
}
