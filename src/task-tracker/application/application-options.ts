import type { HermesDeliveryAdapter } from "../hermes/hermes-delivery-adapter.ts";
import type { HttpHermesAdapterOptions } from "../hermes/http-hermes-adapter-options.ts";
import type { PlatformAdapter } from "../platforms/platform-adapter.ts";
import type { Platform } from "../domain/platform.ts";
import type { InMemoryStore } from "../storage/store.ts";
import type { TaskClassifier } from "../classification/task-classifier.ts";

export interface ApplicationOptions {
  apiToken: string;
  webhookToken: string;
  store?: InMemoryStore;
  platform?: PlatformAdapter;
  platforms?: PlatformAdapter[];
  defaultPlatform?: Platform;
  webhookTokens?: Partial<Record<Platform, string>>;
  hermes?: HermesDeliveryAdapter;
  hermesOptions?: HttpHermesAdapterOptions;
  taskClassifier?: TaskClassifier;
  taskTrackerUrl?: string;
  taskClassifierModel?: string;
  taskClassifierThreshold?: number;
}
