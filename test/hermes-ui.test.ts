import { expect, test } from "bun:test";
import { createApplication } from "../src/task-tracker/app.ts";
import { InMemoryStore } from "../src/task-tracker/store.ts";
import { WahaPlatformAdapter } from "../src/task-tracker/waha-adapter.ts";
import { HttpHermesAdapter } from "../src/task-tracker/http-hermes-adapter.ts";
import { startHermesStub } from "../src/hermes-stub/server.ts";

test("UI API creates, sends through WAHA, displays authenticated webhook replies, completes and cancels", async () => {
  const store = new InMemoryStore(false);
  const sends: unknown[] = [];
  const platform = new WahaPlatformAdapter(store, { baseUrl: "http://waha", apiKey: "waha-key", fetch: (async (url, init) => {
    if (String(url).includes("sendText")) { sends.push(JSON.parse(init!.body as string)); return Response.json({ id: "sent" }); }
    return Response.json([{ id: "12025550101@lid", name: "Dental" }]);
  }) as typeof fetch });
  let stubUrl = "";
  const app = createApplication({ apiToken: "api-secret", webhookToken: "hook-secret", store, platform, hermes: {
    async deliver(delivery) { await new HttpHermesAdapter({ baseUrl: stubUrl, apiKey: "dev" }).deliver(delivery); },
  } });
  const tracker = app.app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => tracker.once("listening", resolve));
  const address = tracker.address();
  if (!address || typeof address === "string") throw Error("Missing address");
  const logs: Record<string, unknown>[] = [];
  const stub = startHermesStub({ port: 0, taskTrackerUrl: `http://127.0.0.1:${address.port}`, taskTrackerToken: "api-secret", log: r => logs.push(r) });
  stubUrl = stub.url.toString();
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(new URL(path, stub.url), { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  try {
    const page = await (await fetch(stub.url)).text();
    expect(page).toContain('id="root"');
    const scriptPath = page.match(/src="([^"]+\.js)"/)?.[1];
    expect(scriptPath).toBeDefined();
    const script = await fetch(new URL(scriptPath!, stub.url));
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("Reply inbox");
    expect(page).not.toContain("api-secret");
    expect((await call("api/tracker/conversations?platform=waha")).data.conversations).toHaveLength(1);
    const task = (await call("api/tracker/tasks", { platform: "waha", conversationId: "12025550101@lid", hermesSessionId: "ui-session", description: "Book a dental appointment; waiting to ask about availability." })).data.task;
    expect((await call(`api/tracker/tasks/${task.id}`, { platform: "waha", conversationId: task.conversationId, message: "Available?", description: "Book a dental appointment; asked about availability." })).status).toBe(200);
    expect(sends).toEqual([{ session: "default", chatId: "12025550101@lid", text: "Available?" }]);
    const event = { event: "message", session: "default", payload: { id: "reply", from: "12025550101@lid", fromMe: false, body: "Confirmed <script>alert(1)</script>", timestamp: 1750000000 } };
    expect((await call("webhooks/waha", event)).status).toBe(401);
    expect((await call("api/events")).data.events.filter((e: any) => e.direction === "received")).toHaveLength(0);
    const streamAbort = new AbortController();
    const stream = await fetch(new URL("api/events/stream", stub.url), { signal: streamAbort.signal });
    const reader = stream.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: snapshot");
      // WAHA talks directly to task tracker: only the Hermes callback reaches the UI.
      const webhook = () => fetch(`http://127.0.0.1:${address.port}/webhooks/waha`, { method: "POST", headers: { authorization: "Bearer hook-secret", "content-type": "application/json" }, body: JSON.stringify(event) });
      expect((await (await webhook()).json()).outcome).toBe("DELIVERED");
      const pushed = new TextDecoder().decode((await reader.read()).value);
      expect(pushed).toContain("event: message");
      expect(pushed).toContain("Confirmed <script>alert(1)</script>");
      expect((await (await webhook()).json()).duplicate).toBe(true);
    } finally { streamAbort.abort(); await reader.cancel().catch(() => {}); }
    const inbox = (await call("api/events")).data.events.filter((e: any) => e.direction === "received");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].message).toContain(`A new external message has been received for delegated messaging task ${task.id}.`);
    expect(inbox[0].message).toContain(`<external-message>\n${event.payload.body}\n</external-message>`);
    expect(inbox[0].message).toContain("Continue the existing delegated task");
    expect((await call("api/tracker/tasks")).data.tasks[0].status).toBe("ACTIVE");
    expect(inbox[0].sessionId).toBe("ui-session");
    expect(inbox[0].taskId).toBe(task.id);
    const reconnect = new AbortController();
    const replayStream = await fetch(new URL("api/events/stream", stub.url), { signal: reconnect.signal });
    const replayReader = replayStream.body!.getReader();
    try {
      const snapshot = new TextDecoder().decode((await replayReader.read()).value);
      expect(snapshot).toContain("Available?");
      expect(snapshot).toContain("Confirmed <script>alert(1)</script>");
    } finally { reconnect.abort(); await replayReader.cancel().catch(() => {}); }
    expect((await call("api/tracker/conversations/12025550101%40lid/actions?platform=waha")).status).toBe(404);
    expect((await call(`api/tracker/tasks/${task.id}/complete`, { result: "Booked" })).data.status).toBe("COMPLETED");
    const next = (await call("api/tracker/tasks", { platform: "waha", conversationId: "12025550101@lid", hermesSessionId: "ui-session", description: "Follow up next week." })).data.task;
    expect((await call(`api/tracker/tasks/${next.id}/cancel`, { reason: "Changed plans" })).data.status).toBe("CANCELLED");
    expect(logs.some(r => String(r.url).endsWith("/api/sessions/ui-session/chat"))).toBe(true);
  } finally {
    await stub.stop(true);
    await new Promise<void>((resolve, reject) => tracker.close(e => e ? reject(e) : resolve()));
  }
});
