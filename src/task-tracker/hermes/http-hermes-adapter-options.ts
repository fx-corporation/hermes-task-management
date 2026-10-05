export interface HttpHermesAdapterOptions {
  baseUrl: string;
  apiKey: string;
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}
