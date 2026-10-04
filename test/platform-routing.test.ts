import { expect, test } from "bun:test";
import { InMemoryHermesAdapter } from "../src/task-tracker/adapters.ts";
import { createApplication } from "../src/task-tracker/app.ts";
import { InMemoryStore } from "../src/task-tracker/store.ts";
import { WahaPlatformAdapter } from "../src/task-tracker/waha-adapter.ts";
import { HttpHermesAdapter } from "../src/task-tracker/http-hermes-adapter.ts";
import { startHermesStub } from "../src/hermes-stub/server.ts";
import { fetchApplication } from "./helpers.ts";

const contact = "+12025550101";
test("routes identical contacts and message IDs independently across registered platforms to their Hermes sessions", async () => {
  const logs: Record<string, unknown>[] = [];
  const hermes = startHermesStub({ port: 0, log: r => logs.push(r) });
  const sends: unknown[] = [];
  const store = new InMemoryStore();
  const waha = new WahaPlatformAdapter(store, { baseUrl: "http://waha", apiKey: "provider", fetch: (async (url, init) => {
    if (String(url).includes("sendText")) { sends.push(JSON.parse(init!.body as string)); return Response.json({ id: "sent" }); }
    return Response.json([{ id: "12025550101@lid", name: "WhatsApp Dental" }]);
  }) as typeof fetch });
  const app = createApplication({ apiToken: "api", webhookToken: "unused", webhookTokens: { stub: "stub-hook", waha: "waha-hook" }, store, platforms: [waha], hermes: new HttpHermesAdapter({ baseUrl: hermes.url.toString(), apiKey: "hermes" }) });
  const call = async (path: string, body?: unknown, token = "api") => {
    const response = await fetchApplication(app, new Request(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() as any };
  };
  try {
    expect(app.platforms.get("stub").platform).toBe("stub");
    expect(app.platforms.get("waha")).toBe(waha);
    await call("/conversations?platform=waha");
    const stubContacts = (await call("/conversations?platform=stub")).body.conversations;
    expect(stubContacts).toHaveLength(2);
    expect(stubContacts.every((c: { platform: string }) => c.platform === "stub")).toBe(true);
    const tasks = [];
    for (const platform of ["stub", "waha"]) {
      const session = platform === "stub" ? "stub/session?one" : "waha-session";
      const task = (await call("/tasks", { platform, conversationId: platform === "waha" ? "12025550101@lid" : contact, hermesSessionId: session, description: platform })).body.task;
      tasks.push(task);
      expect((await call(`/tasks/${task.id}`, { platform, conversationId: task.conversationId, message: `Hello ${platform}`, description: `Latest ${platform} state` })).status).toBe(200);
    }
    expect(sends).toHaveLength(1);
    const stubReply = { conversationId: contact, externalMessageId: "shared-id", message: "Stub reply" };
    const wahaReply = { event: "message", session: "default", payload: { id: "shared-id", from: "12025550101@lid", fromMe: false, body: "WAHA reply", timestamp: 1750000000 } };
    expect((await call("/webhooks/stub", stubReply, "waha-hook")).status).toBe(401);
    expect((await call("/webhooks/waha", wahaReply, "stub-hook")).status).toBe(401);
    expect((await call("/webhooks/stub", stubReply, "stub-hook")).body.taskIds).toEqual([tasks[0].id]);
    expect((await call("/webhooks/waha", wahaReply, "waha-hook")).body.taskIds).toEqual([tasks[1].id]);
    expect((await call("/webhooks/waha", wahaReply, "waha-hook")).body.duplicate).toBe(true);
    expect(logs).toHaveLength(2);
    expect(logs.map(r => new URL(r.url as string).pathname)).toEqual(["/api/sessions/stub%2Fsession%3Fone/chat", "/api/sessions/waha-session/chat"]);
    expect(JSON.parse(logs[0]!.body as string).input).toContain("Stub reply");
    expect(JSON.parse(logs[1]!.body as string).input).toContain("WAHA reply");
    for (const platform of ["stub", "waha"]) {
      expect((await call(`/tasks?platform=${platform}`)).body.tasks).toHaveLength(1);
      const actions = (await call(`/conversations/${platform === "waha" ? "12025550101%40lid" : "%2B12025550101"}/actions?platform=${platform}`)).body.actions;
      expect(actions).toHaveLength(3);
      expect(actions.every((a: { platform: string }) => a.platform === platform)).toBe(true);
    }
    await call(`/tasks/${tasks[1].id}/complete`, { result: "Done" });
    const late = await call("/webhooks/waha", { ...wahaReply, payload: { ...wahaReply.payload, id: "late" } }, "waha-hook");
    expect(late.body.outcome).toBe("IGNORED_NO_ACTIVE_TASK");
    expect(logs).toHaveLength(2);
  } finally { await hermes.stop(true); }
});

test("unconfigured WAHA remains registered and cannot leak stub contacts or accept empty webhook credentials", async () => {
  const app = createApplication({ apiToken: "api", webhookToken: "", webhookTokens: { stub: "", waha: "" }, hermes: new InMemoryHermesAdapter() });
  const request = (path: string, token: string) => fetchApplication(app, new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }));
  expect(app.platforms.get("waha").platform).toBe("waha");
  expect((await request("/conversations?platform=waha", "api")).status).toBe(503);
  const emptyWebhook = await fetchApplication(app, new Request("http://localhost/webhooks/stub", { method: "POST", headers: { authorization: "Bearer " } }));
  expect(emptyWebhook.status).toBe(401);
  const unknown = await request("/conversations?platform=other", "api");
  expect(unknown.status).toBe(400);
});
