import { fetchApplication } from "./helpers.ts";
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApplication } from "../src/app.ts";
import { InMemoryHermesAdapter } from "../src/adapters.ts";
import { InMemoryStore } from "../src/store.ts";
import { WahaPlatformAdapter } from "../src/waha-adapter.ts";

function setup(hmacKey?: string, failSend = false) {
  const store = new InMemoryStore(false);
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("sendText")) return Response.json({ id: "sent" }, { status: failSend ? 500 : 200 });
    return Response.json([
      { id: "12025550101@c.us", name: "Dental" },
      { id: "12025550102@c.us", isMe: true },
      { id: "12345678@g.us", isGroup: true },
    ]);
  }) as typeof fetch;
  const platform = new WahaPlatformAdapter(store, { baseUrl: "http://waha:3000", apiKey: "secret", session: "default", hmacKey, fetch: http });
  const app = createApplication({ apiToken: "api", webhookToken: "hook", store, platform });
  const request = (path: string, body?: unknown, token = "api") => fetchApplication(app, new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { app, platform, calls, request };
}
const event = {
  event: "message", session: "default", timestamp: 1741249702485,
  payload: { id: "provider-message", from: "12025550101@c.us", fromMe: false, body: "Confirmed", timestamp: 1667561485 },
};

describe("WAHA adapter", () => {
  test("discovers contacts, sends to the task destination, and deduplicates replies", async () => {
    const { app, request, calls } = setup();
    const contacts = await (await request("/conversations?platform=waha&search=dental")).json() as any;
    expect(contacts.conversations).toEqual([{ platform: "waha", conversationId: "+12025550101", displayName: "Dental" }]);
    expect(new Headers(calls[0]!.init!.headers).get("x-api-key")).toBe("secret");
    const created = await request("/tasks", { platform: "waha", conversationId: "+12025550101", hermesSessionId: "hermes", title: "Book" });
    expect(created.status).toBe(201);
    const { task } = await created.json() as any;
    expect((await request(`/tasks/${task.id}/send`, { message: "Available?" })).status).toBe(200);
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ session: "default", chatId: "12025550101@c.us", text: "Available?" });
    const reply = await (await request("/webhooks/waha", event, "hook")).json() as any;
    expect(reply.outcome).toBe("DELIVERED");
    const retry = await (await request("/webhooks/waha", { ...event, event: "message.any" }, "hook")).json() as any;
    expect(retry.duplicate).toBe(true);
    const deliveries = (app.hermes as InMemoryHermesAdapter).deliveries;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.envelope).toContain("Platform: WAHA");
    expect(app.store.inboundEvents.values().next().value!.message.timestamp).toBe("2022-11-04T11:31:25.000Z");
    expect((await request("/conversations/%2B12025550101/actions?platform=waha")).status).toBe(200);
    expect((await request("/conversations?platform=stub")).status).toBe(400);
    expect((await request("/stub/conversations", { conversationId: "+12025550103", displayName: "Fake" })).status).toBe(404);
  });

  test("ignores unrelated sessions, outgoing, group, LID, and non-text events", async () => {
    const { app, request } = setup();
    for (const body of [
      { ...event, event: "session.status" }, { ...event, session: "other" },
      { ...event, payload: { ...event.payload, fromMe: true } },
      { ...event, payload: { ...event.payload, from: "12345678@g.us" } },
      { ...event, payload: { ...event.payload, from: "12345678@lid" } },
      { ...event, payload: { ...event.payload, body: "" } },
    ]) {
      expect((await (await request("/webhooks/waha", body, "hook")).json() as any).outcome).toBe("IGNORED_EVENT");
    }
    expect(app.store.inboundEvents.size).toBe(0);
    expect((await request("/webhooks/waha", event, "api")).status).toBe(401);
    expect((await request("/webhooks/waha", { ...event, payload: { ...event.payload, timestamp: "bad" } }, "hook")).status).toBe(400);
  });

  test("verifies SHA-512 HMAC over the exact raw body", async () => {
    const { app } = setup("hmac-secret");
    const raw = JSON.stringify(event, null, 2);
    const signed = (body: string, signature: string) => fetchApplication(app, new Request("http://localhost/webhooks/waha", {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-webhook-hmac-algorithm": "sha512", "x-webhook-hmac": signature },
    }));
    const signature = createHmac("sha512", "hmac-secret").update(raw).digest("hex");
    expect((await signed(raw, signature)).status).toBe(200);
    expect((await signed(`${raw} `, signature)).status).toBe(401);
    expect((await signed(raw, "bad")).status).toBe(401);
  });

  test("provider send failure leaves the task active without recording a send", async () => {
    const { app, request } = setup(undefined, true);
    await request("/conversations?platform=waha");
    const { task } = await (await request("/tasks", { platform: "waha", conversationId: "+12025550101", hermesSessionId: "hermes", title: "Book" })).json() as any;
    const response = await request(`/tasks/${task.id}/send`, { message: "Hello" });
    expect(response.status).toBe(502);
    expect((await response.json() as any).error.code).toBe("MESSAGE_SEND_FAILED");
    expect(app.service.getTask(task.id).status).toBe("ACTIVE");
    expect(app.store.getConversationActions("waha", task.conversationId)).toHaveLength(0);
  });
});
