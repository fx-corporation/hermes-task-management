import { HttpTaskClassifier } from "./http-task-classifier.ts";
import type { Store } from "../storage/store.ts";

export function taskClassifierFromEnvironment(
  environment: NodeJS.ProcessEnv,
  store: Store,
): HttpTaskClassifier {
  return new HttpTaskClassifier({
    baseUrl: environment.HERMES_BASE_URL ?? "http://127.0.0.1:8643",
    apiKey: environment.HERMES_API_KEY ?? "",
    classifierBaseUrl:
      environment.TASK_CLASSIFIER_BASE_URL ??
      environment.HERMES_BASE_URL ??
      "http://127.0.0.1:8643",
    classifierApiKey:
      environment.TASK_CLASSIFIER_API_KEY ??
      (environment.TASK_CLASSIFIER_BASE_URL
        ? "ollama"
        : (environment.HERMES_API_KEY ?? "")),
    trackerUrl: environment.TASK_TRACKER_BASE_URL ?? "http://127.0.0.1:9005",
    store,
    model:
      environment.TASK_CLASSIFIER_MODEL ??
      (environment.TASK_CLASSIFIER_BASE_URL ? "gemma4:e4b" : "hermes-agent"),
    threshold:
      environment.TASK_CLASSIFIER_THRESHOLD === undefined
        ? 0.8
        : Number(environment.TASK_CLASSIFIER_THRESHOLD.trim() || NaN),
    timeoutMs:
      environment.HERMES_TIMEOUT_MS === undefined
        ? 120_000
        : Number(environment.HERMES_TIMEOUT_MS.trim() || NaN),
  });
}
