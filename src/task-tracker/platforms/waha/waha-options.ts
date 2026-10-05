export interface WahaOptions {
  baseUrl: string;
  apiKey: string;
  session?: string;
  hmacKey?: string;
  fetch?: typeof fetch;
}
