import { receivedMessage, type MessageEvent } from "./events.ts";
import type { MessagingTask } from "../task-tracker/domain.ts";
import { resolve, sep } from "node:path";

/** Development receiver: delivers session callbacks to the UI without agent reasoning. */
export function startHermesStub(options: {
  port?: number;
  hostname?: string;
  uiDir?: string;
  taskTrackerUrl?: string;
  taskTrackerToken?: string;
  log?: (request: Record<string, unknown>) => void;
} = {}) {
  const uiDir = resolve(options.uiDir ?? process.env.HERMES_STUB_UI_DIR ?? "dist/hermes-stub/ui");
  const events: MessageEvent[] = [];
  const tasks = new Map<string, MessagingTask>();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const broadcast = (event: MessageEvent) => {
    events.push(event);
    const chunk = encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    for (const client of clients) {
      try { client.enqueue(chunk); } catch { clients.delete(client); }
    }
  };
  const tracker = options.taskTrackerUrl ?? "http://127.0.0.1:9005";
  const proxy = async (path: string, request: Request, body: string, webhook = false) => {
    const headers = webhook ? new Headers(request.headers) : new Headers();
    headers.delete("host");
    headers.delete("content-length");
    if (!webhook) {
      headers.set("authorization", `Bearer ${options.taskTrackerToken ?? ""}`);
      headers.set("content-type", "application/json");
    }
    try {
      const upstream = await fetch(new URL(path, tracker), {
        method: request.method, headers,
        body: request.method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(webhook ? 600_000 : 30_000), redirect: "error",
      });
      return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
    } catch {
      return Response.json({ error: { message: "Task tracker is unavailable." } }, { status: 502 });
    }
  };
  const chats = new Map<string, { body: string; completion: object }>();
  const log = options.log ?? (request => console.log("Hermes stub request", request));
  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 8643,
    async fetch(request, server) {
      const body = await request.text();
      log({
        timestamp: new Date().toISOString(),
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body,
      });
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === "GET" && (path === "/" || path.startsWith("/assets/"))) {
        let filePath: string;
        try { filePath = resolve(uiDir, path === "/" ? "index.html" : `.${decodeURIComponent(path)}`); }
        catch { return Response.json({ error: "Invalid asset path" }, { status: 400 }); }
        if (!filePath.startsWith(uiDir + sep)) return Response.json({ error: "Not found" }, { status: 404 });
        const file = Bun.file(filePath);
        if (!await file.exists()) return Response.json({ error: "UI assets missing. Run bun run build:hermes-ui." }, { status: 404 });
        return new Response(file);
      }
      if (request.method === "GET" && path === "/api/events") return Response.json({ events });
      if (request.method === "GET" && path === "/api/events/stream") {
        server.timeout(request, 0);
        let controller: ReadableStreamDefaultController<Uint8Array>;
        let heartbeat: ReturnType<typeof setInterval>;
        const cleanup = () => { clearInterval(heartbeat); clients.delete(controller); };
        const stream = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value; clients.add(controller);
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(events)}\n\n`));
            heartbeat = setInterval(() => {
              try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { cleanup(); }
            }, 15_000);
            request.signal.addEventListener("abort", () => { cleanup(); try { controller.close(); } catch {} }, { once: true });
          },
          cancel() { cleanup(); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } });
      }
      if (path.startsWith("/api/tracker/")) {
        server.timeout(request, 0); // The bounded upstream timeout governs proxy requests.
        const target = path.slice("/api/tracker".length);
        const allowed = request.method === "GET"
          ? /^\/(tasks|conversations)$/.test(target)
          : request.method === "POST" && (target === "/tasks" || /^\/tasks\/[^/]+\/(send|complete|cancel)$/.test(target));
        if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
        const response = await proxy(target + url.search, request, body);
        if (response.ok) {
          const result = await response.clone().json();
          if (target === "/tasks") {
            for (const task of result.tasks ?? (result.task ? [result.task] : [])) tasks.set(task.id, task);
          }
          const send = target.match(/^\/tasks\/([^/]+)\/send$/);
          if (send) {
            const task = tasks.get(decodeURIComponent(send[1]!));
            if (task) broadcast({ id: crypto.randomUUID(), sessionId: task.hermesSessionId, taskId: task.id, sender: "You", message: JSON.parse(body).message, timestamp: new Date().toISOString(), direction: "sent" });
          }
        }
        return response;
      }
      if (request.method === "POST" && path === "/webhooks/waha") {
        server.timeout(request, 0); // Synchronous Hermes turns may exceed Bun's idle timeout.
        // Forward exact bytes and authentication so task tracker remains the validator.
        return proxy("/webhooks/waha", request, body, true);
      }
      if (request.method === "GET" && path === "/health") {
        return Response.json({ status: "ok", service: "hermes-stub" });
      }
      const chat = path.match(/^\/api\/sessions\/([^/]+)\/chat$/);
      if (request.method !== "POST" || !chat) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      let payload: unknown;
      try { payload = JSON.parse(body); } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (!payload || typeof payload !== "object" ||
          !("message" in payload) || typeof payload.message !== "string" || !payload.message.trim()) {
        return Response.json({ error: "message is a required string" }, { status: 400 });
      }
      const sessionId = decodeURIComponent(chat[1]!);
      const requestKey = request.headers.get("idempotency-key");
      const key = requestKey ? `${sessionId}:${requestKey}` : null;
      const previous = key ? chats.get(key) : undefined;
      if (previous && previous.body !== body) {
        return Response.json({ error: { code: "idempotency_key_conflict" } }, { status: 409 });
      }
      const completion = previous?.completion ?? {
        object: "hermes.session.chat.completion",
        session_id: sessionId,
        message: { role: "assistant", content: "Reply received by Hermes development stub." },
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };
      if (!previous) broadcast(receivedMessage(sessionId, payload.message));
      if (key && !previous) chats.set(key, { body, completion });
      return Response.json(completion, {
        status: 200,
        headers: previous ? { "Idempotency-Replayed": "true" } : undefined,
      });
    },
  });
}

if (import.meta.main) {
  const server = startHermesStub({ port: Number(process.env.HERMES_STUB_PORT ?? 8643), hostname: process.env.HERMES_STUB_HOST ?? "127.0.0.1", taskTrackerUrl: process.env.TASK_TRACKER_BASE_URL, taskTrackerToken: process.env.MESSAGING_TASK_API_TOKEN });
  console.log(`Hermes stub listening at ${server.url}`);
  const stop = () => { void server.stop(true); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
