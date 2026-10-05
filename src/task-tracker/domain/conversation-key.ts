import type { Platform } from "./platform.ts";

export function conversationKey(
  platform: Platform,
  conversationId: string,
): string {
  return `${platform}\u0000${conversationId}`;
}
