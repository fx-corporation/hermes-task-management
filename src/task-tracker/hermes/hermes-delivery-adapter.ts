import type { HermesDelivery } from "./hermes-delivery.ts";

export interface HermesDeliveryAdapter {
  deliver(delivery: HermesDelivery): Promise<void>;
}
