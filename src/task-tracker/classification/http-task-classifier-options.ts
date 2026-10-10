import type { Store } from "../storage/store.ts";

export interface HttpTaskClassifierOptions {
  baseUrl: string;
  apiKey: string;
  classifierBaseUrl?: string;
  classifierApiKey?: string;
  trackerUrl: string;
  store: Store;
  model?: string;
  threshold?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
