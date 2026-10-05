import type { Hono } from "hono";
import type { ApplicationEnv } from "./application-env.ts";
import type { HermesDeliveryAdapter } from "../hermes/hermes-delivery-adapter.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { InMemoryStore } from "../storage/store.ts";
import type { TaskClassifier } from "../classification/task-classifier.ts";
import type { TaskService } from "../services/task-service.ts";

export interface Application {
  app: Hono<ApplicationEnv>;
  service: TaskService;
  store: InMemoryStore;
  platforms: PlatformAdapterRegistry;
  hermes: HermesDeliveryAdapter;
  classifier: TaskClassifier;
}
