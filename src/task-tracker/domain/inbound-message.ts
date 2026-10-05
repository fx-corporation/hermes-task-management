import type { Platform } from "./platform.ts";

export interface InboundMessage {
  platform: Platform;
  conversationId: string;
  externalMessageId: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  timestamp: string;
}
