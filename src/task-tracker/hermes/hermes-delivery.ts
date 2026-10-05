import type { Platform } from "../domain/platform.ts";

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
