import { Hono } from "hono";
import { assetHandler } from "./handlers/asset.ts";
import { cancelTrackerTaskHandler } from "./handlers/cancel-tracker-task.ts";
import { chatCompletionsHandler } from "./handlers/chat-completions.ts";
import { completeTrackerTaskHandler } from "./handlers/complete-tracker-task.ts";
import { createSessionHandler } from "./handlers/create-session.ts";
import { createTrackerTaskHandler } from "./handlers/create-tracker-task.ts";
import { healthHandler } from "./handlers/health.ts";
import { indexHandler } from "./handlers/index.ts";
import { listEventsHandler } from "./handlers/list-events.ts";
import { listTrackerConversationsHandler } from "./handlers/list-tracker-conversations.ts";
import { listTrackerTasksHandler } from "./handlers/list-tracker-tasks.ts";
import { selectTrackerTasksHandler } from "./handlers/select-tracker-tasks.ts";
import { sendTrackerTaskMessageHandler } from "./handlers/send-tracker-task-message.ts";
import { sessionChatHandler } from "./handlers/session-chat.ts";
import { streamEventsHandler } from "./handlers/stream-events.ts";
import { wahaWebhookHandler } from "./handlers/waha-webhook.ts";
import type { HermesStubEnv } from "./hermes-stub-env.ts";
import type { HermesStubOptions } from "./hermes-stub-options.ts";
import { logRequest } from "./http/log-request.ts";
import { createStubState } from "./stub-state.ts";

export type { HermesStubOptions } from "./hermes-stub-options.ts";

/** Development receiver: delivers session callbacks to the UI without agent reasoning. */
export function createHermesStubApplication(options: HermesStubOptions = {}) {
  const app = new Hono<HermesStubEnv>({ strict: true });
  const state = createStubState(options);
  const log =
    options.log ?? ((request) => console.log("Hermes stub request", request));
  app.use(logRequest(log));
  app.get("/", indexHandler(state));
  app.get("/assets/*", assetHandler(state));
  app.get("/api/events", listEventsHandler(state));
  app.get("/api/events/stream", streamEventsHandler(state));
  app.get("/api/tracker/tasks", listTrackerTasksHandler(state));
  app.get("/api/tracker/conversations", listTrackerConversationsHandler(state));
  app.post("/api/tracker/tasks", createTrackerTaskHandler(state));
  app.post("/api/tracker/tasks/selection", selectTrackerTasksHandler(state));
  app.post("/api/tracker/tasks/:taskId", sendTrackerTaskMessageHandler(state));
  app.post(
    "/api/tracker/tasks/:taskId/complete",
    completeTrackerTaskHandler(state),
  );
  app.post(
    "/api/tracker/tasks/:taskId/cancel",
    cancelTrackerTaskHandler(state),
  );
  app.post("/webhooks/waha", wahaWebhookHandler(state));
  app.get("/health", healthHandler());
  app.post("/api/sessions", createSessionHandler());
  app.post("/v1/chat/completions", chatCompletionsHandler(state));
  app.post("/api/sessions/:sessionId/chat", sessionChatHandler(state));
  app.notFound((context) => context.json({ error: "Not found" }, 404));
  app.onError((error, context) => {
    if (error instanceof URIError)
      return context.json({ error: "Invalid URL encoding" }, 400);
    console.error("Hermes stub error", error);
    return context.json({ error: "An unexpected error occurred." }, 500);
  });
  return app;
}

export function startHermesStub(options: HermesStubOptions = {}) {
  const app = createHermesStubApplication(options);
  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 8643,
    fetch: (request, server) => app.fetch(request, { server }),
  });
}

if (import.meta.main) {
  const server = startHermesStub({
    port: Number(process.env.HERMES_STUB_PORT ?? 8643),
    hostname: process.env.HERMES_STUB_HOST ?? "127.0.0.1",
    taskTrackerUrl: process.env.TASK_TRACKER_BASE_URL,
    taskTrackerToken: process.env.MESSAGING_TASK_API_TOKEN,
  });
  console.log(`Hermes stub listening at ${server.url}`);
  const stop = () => {
    void server.stop(true);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
