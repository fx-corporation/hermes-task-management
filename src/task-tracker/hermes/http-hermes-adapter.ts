import { createHash } from "node:crypto";
import type { HermesDeliveryAdapter } from "./hermes-delivery-adapter.ts";
import type { HermesDelivery } from "./hermes-delivery.ts";

import type { HttpHermesAdapterOptions } from "./http-hermes-adapter-options.ts";

export class HttpHermesAdapter implements HermesDeliveryAdapter {
  private readonly endpoint: string;
  private readonly maxRetries: number;
  private readonly http: typeof fetch;

  constructor(private readonly options: HttpHermesAdapterOptions) {
    const url = new URL(
      options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "HERMES_BASE_URL must be an HTTP(S) URL without embedded credentials.",
      );
    }
    if (!options.apiKey.trim()) throw new Error("HERMES_API_KEY is required.");
    this.endpoint = new URL("api/sessions/", url).toString();
    this.maxRetries = options.maxRetries ?? 3;
    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new Error("HERMES_MAX_RETRIES must be a non-negative integer.");
    }
    for (const value of [
      options.timeoutMs ?? 120_000,
      options.retryDelayMs ?? 1_000,
    ]) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(
          "Hermes timeout and retry delay must be positive integers.",
        );
    }
    this.http = options.fetch ?? fetch;
  }

  async deliver(delivery: HermesDelivery): Promise<void> {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          delivery.sessionId,
          delivery.taskId,
          delivery.platform,
          delivery.externalMessageId,
        ]),
      )
      .digest("hex");
    // Keep the body and key identical across retries, including ambiguous timeouts.
    const endpoint = `${this.endpoint}${encodeURIComponent(delivery.sessionId)}/chat`;
    const body = JSON.stringify({ input: delivery.envelope });
    for (let attempt = 0; ; attempt++) {
      let retryable = true;
      try {
        const response = await this.http(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
          redirect: "error",
        });
        retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            `Hermes rejected delivery (HTTP ${response.status}).`,
          );
        }
        const result = (await response.json()) as {
          session_id?: unknown;
          message?: { role?: unknown; content?: unknown };
        };
        if (
          typeof result.session_id !== "string" ||
          result.message?.role !== "assistant" ||
          typeof result.message.content !== "string"
        ) {
          throw new Error(
            "Hermes returned an invalid session chat completion.",
          );
        }
        return;
      } catch (error) {
        if (!retryable || attempt >= this.maxRetries) throw error;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            (this.options.retryDelayMs ?? 1_000) * 2 ** Math.min(attempt, 5),
          ),
        );
      }
    }
  }
}

export function hermesFromEnvironment(
  environment: NodeJS.ProcessEnv,
): HttpHermesAdapter {
  return new HttpHermesAdapter({
    baseUrl: environment.HERMES_BASE_URL ?? "http://127.0.0.1:8643",
    apiKey: environment.HERMES_API_KEY ?? "",
    timeoutMs:
      environment.HERMES_TIMEOUT_MS === undefined
        ? 120_000
        : Number(environment.HERMES_TIMEOUT_MS.trim() || NaN),
    maxRetries:
      environment.HERMES_MAX_RETRIES === undefined
        ? 3
        : Number(environment.HERMES_MAX_RETRIES.trim() || NaN),
  });
}

export type { HttpHermesAdapterOptions } from "./http-hermes-adapter-options.ts";
