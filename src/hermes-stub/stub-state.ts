import { resolve } from "node:path";
import type { MessagingTask } from "../task-tracker/domain/messaging-task.ts";
import type { MessageEvent } from "./events.ts";
import type { HermesStubOptions } from "./hermes-stub-options.ts";
import { scoringFixturesFromEnvironment } from "./scoring-fixtures.ts";

export type HermesStubState = ReturnType<typeof createStubState>;

export function createStubState(options: HermesStubOptions) {
  const uiDir = resolve(
    options.uiDir ?? process.env.HERMES_STUB_UI_DIR ?? "dist/hermes-stub/ui",
  );
  const events: MessageEvent[] = [];
  const tasks = new Map<string, MessagingTask>();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const broadcast = (event: MessageEvent) => {
    events.push(event);
    const chunk = encoder.encode(
      `event: message\ndata: ${JSON.stringify(event)}\n\n`,
    );
    for (const client of clients) {
      try {
        client.enqueue(chunk);
      } catch {
        clients.delete(client);
      }
    }
  };
  const tracker = options.taskTrackerUrl ?? "http://127.0.0.1:9005";
  const proxy = async (
    path: string,
    request: Request,
    body: string,
    webhook = false,
  ) => {
    const headers = webhook ? new Headers(request.headers) : new Headers();
    headers.delete("host");
    headers.delete("content-length");
    if (!webhook) {
      headers.set("authorization", `Bearer ${options.taskTrackerToken ?? ""}`);
      headers.set("content-type", "application/json");
    }
    try {
      const upstream = await fetch(new URL(path, tracker), {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(webhook ? 600_000 : 30_000),
        redirect: "error",
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return Response.json(
        { error: { message: "Task tracker is unavailable." } },
        { status: 502 },
      );
    }
  };
  const chats = new Map<string, { body: string; completion: object }>();
  const scoringFixtures = [
    ...(options.scoringFixtures ?? scoringFixturesFromEnvironment()),
  ];

  return {
    uiDir,
    events,
    tasks,
    clients,
    encoder,
    broadcast,
    proxy,
    chats,
    scoringFixtures,
  };
}
