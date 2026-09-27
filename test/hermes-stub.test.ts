import { expect, test } from "bun:test";
import { startHermesStub } from "../src/hermes-stub/server.ts";
import { HttpHermesAdapter } from "../src/task-tracker/http-hermes-adapter.ts";

test("stub accepts adapter delivery and logs every request, including rejected and replayed requests", async () => {
  const logs: Record<string, unknown>[] = [];
  const server = startHermesStub({ port: 0, log: request => logs.push(request) });
  try {
    const adapter = new HttpHermesAdapter({ baseUrl: server.url.toString(), apiKey: "development" });
    const delivery = {
      sessionId: "session", taskId: "task", platform: "stub" as const, externalMessageId: "message",
      senderDisplayName: "Contact", content: "Confirmed", envelope: "untrusted external content: Confirmed", deliveredAt: new Date().toISOString(),
    };
    await adapter.deliver(delivery);
    await adapter.deliver(delivery);
    expect(logs).toHaveLength(2);
    expect(logs[0]!.method).toBe("POST");
    expect((logs[0]!.headers as Record<string, string>).authorization).toBe("Bearer development");
    expect(JSON.parse(logs[0]!.body as string)).toEqual({ message: delivery.envelope });
    expect(logs[1]!.body).toBe(logs[0]!.body);
    const headers = logs[0]!.headers as Record<string, string>;
    const replay = await fetch(new URL("api/sessions/session/chat", server.url), { method: "POST", headers, body: logs[0]!.body as string });
    const secondReplay = await fetch(new URL("api/sessions/session/chat", server.url), { method: "POST", headers, body: logs[0]!.body as string });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect((await replay.json()).session_id).toBe((await secondReplay.json()).session_id);
    const conflict = await fetch(new URL("api/sessions/session/chat", server.url), { method: "POST", headers, body: JSON.stringify({ message: "different" }) });
    expect(conflict.status).toBe(409);
    expect((await fetch(new URL("health", server.url))).status).toBe(200);
    expect((await fetch(new URL("missing", server.url), { method: "PUT", body: "debug body" })).status).toBe(404);
    expect((await fetch(new URL("api/sessions/session/chat", server.url), { method: "POST", body: "bad JSON" })).status).toBe(400);
    expect((await fetch(new URL("api/sessions/session/chat", server.url), { method: "POST", body: "{}" })).status).toBe(400);
    expect(logs).toHaveLength(9);
    expect(logs[6]).toMatchObject({ method: "PUT", body: "debug body" });
    expect(logs[7]!.body).toBe("bad JSON");
  } finally { await server.stop(true); }
});
