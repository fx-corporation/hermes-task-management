import type { Platform } from "../domain/platform.ts";

export interface ClassifyInput {
  webhookMessage: string;
  platform: Platform;
  conversationId: string;
}
