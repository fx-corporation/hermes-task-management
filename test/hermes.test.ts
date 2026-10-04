import { describe, expect, test } from "bun:test";
import { HttpHermesAdapter, hermesFromEnvironment } from "../src/task-tracker/http-hermes-adapter.ts";
import { createApplication } from "../src/task-tracker/app.ts";
import type { HermesDelivery } from "../src/task-tracker/domain.ts";

const delivery: HermesDelivery = {
  sessionId: "existing-session", taskId: "task-1", platform: "waha",
  externalMessageId: "reply-1", senderDisplayName: "Contact", content: "Confirmed",
  envelope: "untrusted external content: Confirmed", deliveredAt: "2026-09-27T00:00:00Z",
};
function setup(results: (number | Error)[], maxRetries?: number) {
  const calls: RequestInit[] = [];
  const adapter = new HttpHermesAdapter({
    baseUrl: "http://hermes:8642", apiKey: "secret", maxRetries, retryDelayMs: 1,
    fetch: (async (url, init) => {
      expect(String(url)).toBe("http://hermes:8642/api/sessions/existing-session/chat");
      calls.push(init!);
      const result = results.shift() ?? 200;
      if (result instanceof Error) throw result;
      return Response.json(result === 200 ? { session_id: "existing-session", message: { role: "assistant", content: "Received" } } : { error: "unavailable" }, { status: result });
    }) as typeof fetch,
  });
  return { adapter, calls };
}

describe("Hermes HTTP delivery", () => {
  test("sends session history continuation and an authenticated envelope with a stable retry key", async () => {
    const { adapter, calls } = setup([200]);
    await adapter.deliver(delivery);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ input: delivery.envelope });
    expect(new Headers(calls[0]!.headers).get("authorization")).toBe("Bearer secret");
    expect(new Headers(calls[0]!.headers).get("idempotency-key")).toHaveLength(64);
  });
  test("retries network and server failures with identical body and key", async () => {
    const { adapter, calls } = setup([new TypeError("offline"), 503, 429, 200]);
    await adapter.deliver(delivery);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.body).toBe(calls[0]!.body);
      expect(new Headers(call.headers).get("idempotency-key")).toBe(new Headers(calls[0]!.headers).get("idempotency-key"));
    }
  });
  test("exhausts default three retries and honors zero and custom limits", async () => {
    for (const [limit, count] of [[undefined, 4], [0, 1], [1, 2]] as const) {
      const { adapter, calls } = setup([503, 503, 503, 503], limit);
      await expect(adapter.deliver(delivery)).rejects.toThrow("HTTP 503");
      expect(calls).toHaveLength(count);
    }
  });
  test("does not retry permanent errors", async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const { adapter, calls } = setup([status]);
      await expect(adapter.deliver(delivery)).rejects.toThrow(`HTTP ${status}`);
      expect(calls).toHaveLength(1);
    }
  });
  test("retries timed out requests", async () => {
    let attempts = 0;
    const adapter = new HttpHermesAdapter({
      baseUrl: "http://hermes:8642", apiKey: "secret", timeoutMs: 5, retryDelayMs: 1, maxRetries: 1,
      fetch: (async (_url, init) => {
        attempts++;
        await new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
        });
        return Response.json({ session_id: "session", message: { role: "assistant", content: "" } });
      }) as typeof fetch,
    });
    await expect(adapter.deliver(delivery)).rejects.toThrow();
    expect(attempts).toBe(2);
  });
  test("defaults to HttpHermesAdapter and delivers an inbound reply through a real HTTP server", async () => {
    const received: unknown[] = [];
    const server = Bun.serve({ port: 0, async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/sessions/existing-session/chat");
      expect(request.headers.get("authorization")).toBe("Bearer secret");
      received.push(await request.json());
      return Response.json({ session_id: "existing-session", message: { role: "assistant", content: "Received" } });
    } });
    try {
      const app = createApplication({ apiToken: "api", webhookToken: "hook", hermesOptions: { baseUrl: server.url.toString(), apiKey: "secret" } });
      expect(app.hermes).toBeInstanceOf(HttpHermesAdapter);
      const task = app.service.createTask({ platform: "stub", conversationId: "+12025550101", hermesSessionId: "existing-session", description: "Book" });
      await app.service.sendMessage(task.id, { platform: "stub", conversationId: task.conversationId, message: "Available?", description: "Book an appointment. Latest state: waiting for availability." });
      expect(await app.service.receiveInbound("stub", { conversationId: task.conversationId, externalMessageId: "reply", message: "Confirmed" })).toMatchObject({ outcome: "DELIVERED" });
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ input: expect.stringContaining("untrusted external content") });
      expect(task.status).toBe("ACTIVE");
    } finally { await server.stop(true); }
  });
  test("rejects malformed session chat completions", async () => {
    for (const response of [{ run_id: "old-run" }, { session_id: "session" }, { session_id: "session", message: { role: "user", content: "Reply" } }]) {
      const adapter = new HttpHermesAdapter({ baseUrl: "http://hermes", apiKey: "secret", fetch: (async (_url: string | URL | Request, _init?: RequestInit) => Response.json(response)) as typeof fetch });
      await expect(adapter.deliver(delivery)).rejects.toThrow("invalid session chat completion");
    }
  });
  test("validates environment configuration", () => {
    expect(() => hermesFromEnvironment({})).toThrow("HERMES_API_KEY");
    for (const value of ["", "-1", "1.5", "abc", "Infinity"]) {
      expect(() => hermesFromEnvironment({ HERMES_API_KEY: "secret", HERMES_MAX_RETRIES: value })).toThrow("HERMES_MAX_RETRIES");
    }
    for (const value of ["", "0", "-1", "abc"]) {
      expect(() => hermesFromEnvironment({ HERMES_API_KEY: "secret", HERMES_TIMEOUT_MS: value })).toThrow("timeout");
    }
    expect(hermesFromEnvironment({ HERMES_API_KEY: "secret", HERMES_MAX_RETRIES: "0" })).toBeInstanceOf(HttpHermesAdapter);
  });
  test("records failed delivery without activating the task or repeating duplicate events", async () => {
    const { adapter, calls } = setup([503, 503], 1);
    const app = createApplication({ apiToken: "api", webhookToken: "hook", hermes: adapter });
    const task = app.service.createTask({ platform: "stub", conversationId: "+12025550101", hermesSessionId: "existing-session", description: "Book" });
    await app.service.sendMessage(task.id, { platform: "stub", conversationId: task.conversationId, message: "Available?", description: "Book an appointment." });
    const payload = { conversationId: task.conversationId, externalMessageId: "reply", message: "Confirmed" };
    await expect(app.service.receiveInbound("stub", payload)).rejects.toThrow("Hermes delivery failed");
    expect(task.status).toBe("WAITING_EXTERNAL_REPLY");
    expect(await app.service.receiveInbound("stub", payload)).toMatchObject({ outcome: "DELIVERY_FAILED", duplicate: true });
    expect(calls).toHaveLength(2);
    expect(app.store.getConversationActions("stub", task.conversationId).map(a => a.type)).not.toContain("HERMES_DELIVERED");
  });
});
