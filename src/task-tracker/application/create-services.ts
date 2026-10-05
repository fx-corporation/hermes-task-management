import type { ApplicationOptions } from "./application-options.ts";
import {
  HttpHermesAdapter,
  hermesFromEnvironment,
} from "../hermes/http-hermes-adapter.ts";
import { HttpTaskClassifier } from "../classification/http-task-classifier.ts";
import { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import { InMemoryStore } from "../storage/store.ts";
import { StubPlatformAdapter } from "../platforms/stub/stub-platform-adapter.ts";
import { TaskService } from "../services/task-service.ts";
import { UnavailableTaskClassifier } from "../classification/unavailable-task-classifier.ts";
import { WahaPlatformAdapter } from "../platforms/waha/waha-adapter.ts";

export function createServices(options: ApplicationOptions) {
  const store = options.store ?? new InMemoryStore();
  const overrides = new Map(
    (options.platforms ?? []).map((adapter) => [adapter.platform, adapter]),
  );
  console.log("App starting with options:", options);
  if (options.platform)
    overrides.set(options.platform.platform, options.platform);
  const platforms = new PlatformAdapterRegistry([
    overrides.get("stub") ?? new StubPlatformAdapter(store),
    overrides.get("waha") ??
      new WahaPlatformAdapter(store, {
        baseUrl: "http://localhost:3000",
        apiKey: "",
      }),
  ]);
  const defaultPlatform =
    options.defaultPlatform ?? options.platform?.platform ?? "stub";
  const hermesEnvironment = process.env;
  const hermesOptions = options.hermesOptions ?? {
    baseUrl: hermesEnvironment.HERMES_BASE_URL ?? "http://127.0.0.1:8643",
    apiKey: hermesEnvironment.HERMES_API_KEY ?? "",
    timeoutMs:
      hermesEnvironment.HERMES_TIMEOUT_MS === undefined
        ? 120_000
        : Number(hermesEnvironment.HERMES_TIMEOUT_MS.trim() || NaN),
    maxRetries:
      hermesEnvironment.HERMES_MAX_RETRIES === undefined
        ? 3
        : Number(hermesEnvironment.HERMES_MAX_RETRIES.trim() || NaN),
  };
  const hermes =
    options.hermes ??
    (options.hermesOptions
      ? new HttpHermesAdapter(options.hermesOptions)
      : hermesFromEnvironment(process.env));
  const classifier =
    options.taskClassifier ??
    (hermesOptions.apiKey.trim()
      ? new HttpTaskClassifier({
          ...hermesOptions,
          store,
          classifierBaseUrl:
            hermesEnvironment.TASK_CLASSIFIER_BASE_URL ?? hermesOptions.baseUrl,
          classifierApiKey:
            hermesEnvironment.TASK_CLASSIFIER_API_KEY ??
            (hermesEnvironment.TASK_CLASSIFIER_BASE_URL
              ? "ollama"
              : hermesOptions.apiKey),
          trackerUrl:
            options.taskTrackerUrl ??
            hermesEnvironment.TASK_TRACKER_BASE_URL ??
            "http://127.0.0.1:9005",
          model:
            options.taskClassifierModel ??
            hermesEnvironment.TASK_CLASSIFIER_MODEL ??
            (hermesEnvironment.TASK_CLASSIFIER_BASE_URL
              ? "gemma4:e4b"
              : "hermes-agent"),
          threshold:
            options.taskClassifierThreshold ??
            (hermesEnvironment.TASK_CLASSIFIER_THRESHOLD === undefined
              ? 0.8
              : Number(
                  hermesEnvironment.TASK_CLASSIFIER_THRESHOLD.trim() || NaN,
                )),
        })
      : new UnavailableTaskClassifier(store));
  const service = new TaskService(store, platforms, hermes, classifier);
  return { service, store, platforms, hermes, classifier, defaultPlatform };
}
