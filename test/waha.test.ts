import { fetchApplication } from "./helpers.ts";
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApplication } from "../src/task-tracker/app.ts";
import { InMemoryHermesAdapter } from "../src/task-tracker/adapters.ts";
import { InMemoryStore } from "../src/task-tracker/store.ts";
import { WahaPlatformAdapter } from "../src/task-tracker/waha-adapter.ts";

function setup(hmacKey?: string, failSend = false) {
  const store = new InMemoryStore(false);
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("sendText")) return Response.json({ id: "sent" }, { status: failSend ? 500 : 200 });
    return Response.json([
      { id: "12025550101@lid", name: "Dental" },
      { id: "12025550102@c.us", isMe: true },
      { id: "12345678@g.us", isGroup: true },
    ]);
  }) as typeof fetch;
  const platform = new WahaPlatformAdapter(store, { baseUrl: "http://waha:3000", apiKey: "secret", session: "default", hmacKey, fetch: http });
  const app = createApplication({ apiToken: "api", webhookToken: "hook", store, platform, hermes: new InMemoryHermesAdapter() });
  const request = (path: string, body?: unknown, token = "api") => fetchApplication(app, new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { app, platform, calls, request };
}
const event = {
  event: "message", session: "default", timestamp: 1741249702485,
  payload: { id: "provider-message", from: "12025550101@lid", fromMe: false, body: "Confirmed", timestamp: 1667561485 },
};

describe("WAHA adapter", () => {
  test("discovers contacts, sends to the task destination, and deduplicates replies", async () => {
    const { app, request, calls } = setup();
    const contacts = await (await request("/conversations?platform=waha&search=dental")).json() as any;
    expect(contacts.conversations).toEqual([{ platform: "waha", conversationId: "12025550101@lid", displayName: "Dental" }]);
    expect(new Headers(calls[0]!.init!.headers).get("x-api-key")).toBe("secret");
    const created = await request("/tasks", { platform: "waha", conversationId: "12025550101@lid", hermesSessionId: "hermes", title: "Book" });
    expect(created.status).toBe(201);
    const { task } = await created.json() as any;
    expect((await request(`/tasks/${task.id}/send`, { message: "Available?" })).status).toBe(200);
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({ session: "default", chatId: "12025550101@lid", text: "Available?" });
    const reply = await (await request("/webhooks/waha", event, "hook")).json() as any;
    expect(reply.outcome).toBe("DELIVERED");
    const retry = await (await request("/webhooks/waha", { ...event, event: "message.any" }, "hook")).json() as any;
    expect(retry.duplicate).toBe(true);
    const deliveries = (app.hermes as InMemoryHermesAdapter).deliveries;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.envelope).toContain("Platform: WAHA");
    expect(app.store.inboundEvents.values().next().value!.message.timestamp).toBe("2022-11-04T11:31:25.000Z");
    expect((await request("/conversations/12025550101%40lid/actions?platform=waha")).status).toBe(200);
    expect((await request("/conversations?platform=stub")).status).toBe(200);
    expect((await request("/stub/conversations", { conversationId: "+12025550103", displayName: "Fake" })).status).toBe(201);
  });

  test("ignores unrelated sessions, outgoing, group, unmapped phone, and non-text events", async () => {
    const { app, request } = setup();
    for (const body of [
      { ...event, event: "session.status" }, { ...event, session: "other" },
      { ...event, payload: { ...event.payload, fromMe: true } },
      { ...event, payload: { ...event.payload, from: "12345678@g.us" } },
      { ...event, payload: { ...event.payload, from: "12345678@c.us" } },
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
    const { task } = await (await request("/tasks", { platform: "waha", conversationId: "12025550101@lid", hermesSessionId: "hermes", title: "Book" })).json() as any;
    const response = await request(`/tasks/${task.id}/send`, { message: "Hello" });
    expect(response.status).toBe(502);
    expect((await response.json() as any).error.code).toBe("MESSAGE_SEND_FAILED");
    expect(app.service.getTask(task.id).status).toBe("ACTIVE");
    expect(app.store.getConversationActions("waha", task.conversationId)).toHaveLength(0);
  });
});

test("discovers phone-addressed contacts as LIDs and sends directly to the LID", async () => {
  const store = new InMemoryStore(false);
  const calls: string[] = [];
  const adapter = new WahaPlatformAdapter(store, { baseUrl: "http://waha", apiKey: "secret", session: "test-session", fetch: (async (url, init) => {
    const path = String(url); calls.push(path);
    if (path.includes("contacts/all")) return Response.json([{ id: "12025550101@c.us", name: "Dental" }, { id: "12025550102@c.us", name: "Unmapped" }]);
    if (path.includes("12025550101%40c.us")) return Response.json({ lid: "999111222@lid", pn: "12025550101@c.us" });
    if (path.includes("12025550102%40c.us")) return Response.json({ lid: null });
    if (path.endsWith("sendText")) { expect(JSON.parse(init!.body as string).chatId).toBe("999111222@lid"); return Response.json({ id: "sent" }); }
    throw Error("Unexpected WAHA call");
  }) as typeof fetch });
  expect(await adapter.listConversations()).toEqual([{ platform: "waha", conversationId: "999111222@lid", displayName: "Dental" }]);
  expect(calls[1]).toContain("/api/test-session/lids/pn/12025550101%40c.us");
  const app = createApplication({ apiToken: "api", webhookToken: "hook", store, platforms: [adapter], hermes: new InMemoryHermesAdapter() });
  const task = app.service.createTask({ platform: "waha", conversationId: "999111222@lid", hermesSessionId: "session", title: "Book" });
  await app.service.sendMessage(task.id, "Hello");
  const reply = await app.service.receiveInbound("waha", { ...event, session: "test-session", payload: { ...event.payload, from: "999111222@lid" } });
  expect(reply.outcome).toBe("DELIVERED");
  expect(reply.taskId).toBe(task.id);
});

test("WAHA API requires LIDs for task creation, filters, and action history", async () => {
  const { request } = setup();
  await request("/conversations?platform=waha");
  for (const conversationId of ["+12025550101", "12025550101@c.us", "123@g.us", "abc@lid"]) {
    expect((await request("/tasks", { platform: "waha", conversationId, hermesSessionId: "s", title: "Test" })).status).toBe(400);
  }
  const created = await (await request("/tasks", { platform: "waha", conversationId: "12025550101@lid", hermesSessionId: "s", title: "Test" })).json() as any;
  expect(created.task.conversationId).toBe("12025550101@lid");
  const filtered = await (await request("/tasks?platform=waha&conversationId=12025550101%40lid")).json() as any;
  expect(filtered.tasks).toHaveLength(1);
  expect((await request("/conversations/12025550101%40lid/actions?platform=waha")).status).toBe(200);
  expect((await request("/conversations/%2B12025550101/actions?platform=waha")).status).toBe(400);
});
