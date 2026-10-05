import type { Platform } from "./platform.ts";

export interface Conversation {
  platform: Platform;
  conversationId: string;
  displayName: string;
}
