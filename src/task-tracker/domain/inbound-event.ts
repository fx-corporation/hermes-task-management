import type { EventOutcome } from "./event-outcome.ts";
import type { InboundMessage } from "./inbound-message.ts";
import type { RoutingOutcome } from "./routing-outcome.ts";

export interface InboundEvent {
  id: string;
  deduplicationKey: string;
  message: InboundMessage;
  taskIds: string[];
  actionId: string;
  outcome: EventOutcome;
  routingOutcome: RoutingOutcome;
  ownerSessionId?: string;
}
