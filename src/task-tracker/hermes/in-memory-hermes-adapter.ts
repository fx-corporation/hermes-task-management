import type { HermesDeliveryAdapter } from "./hermes-delivery-adapter.ts";
import { type HermesDelivery } from "./hermes-delivery.ts";

export class InMemoryHermesAdapter implements HermesDeliveryAdapter {
  readonly deliveries: HermesDelivery[] = [];

  async deliver(delivery: HermesDelivery): Promise<void> {
    this.deliveries.push(delivery);
  }
}
