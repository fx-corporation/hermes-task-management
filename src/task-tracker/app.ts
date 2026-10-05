import { Hono } from "hono";
import type { ApplicationEnv } from "./application/application-env.ts";
import type { ApplicationOptions } from "./application/application-options.ts";
import type { Application } from "./application/application.ts";
import { createServices } from "./application/create-services.ts";
import type { Platform } from "./domain/platform.ts";
import { ApiError } from "./errors/api-error.ts";
import { cancelTaskHandler } from "./handlers/cancel-task.ts";
import { completeTaskHandler } from "./handlers/complete-task.ts";
import { createStubConversationHandler } from "./handlers/create-stub-conversation.ts";
import { createTaskHandler } from "./handlers/create-task.ts";
import { getTaskHandler } from "./handlers/get-task.ts";
import { healthHandler } from "./handlers/health.ts";
import { listConversationActionsHandler } from "./handlers/list-conversation-actions.ts";
import { listConversationsHandler } from "./handlers/list-conversations.ts";
import { listTasksHandler } from "./handlers/list-tasks.ts";
import { replyToStubConversationHandler } from "./handlers/reply-to-stub-conversation.ts";
import { selectTasksHandler } from "./handlers/select-tasks.ts";
import { sendTaskMessageHandler } from "./handlers/send-task-message.ts";
import { stubWebhookHandler } from "./handlers/stub-webhook.ts";
import { wahaWebhookHandler } from "./handlers/waha-webhook.ts";
import { authorize } from "./http/authorize.ts";
import { handleError } from "./http/handle-error.ts";
import { logRequest } from "./http/log-request.ts";
import { logWebhook } from "./http/log-webhook.ts";
import { rawBody } from "./http/raw-body.ts";
import { WahaPlatformAdapter } from "./platforms/waha/waha-adapter.ts";

export function createApplication(options: ApplicationOptions): Application {
  const { service, store, platforms, hermes, classifier, defaultPlatform } =
    createServices(options);
  const webhookToken = (platform: Platform) =>
    options.webhookTokens?.[platform] ?? options.webhookToken;
  const app = new Hono<ApplicationEnv>({ strict: true });

  app.use(logRequest);

  app.get("/health", healthHandler());

  app.use("/webhooks/*", rawBody, logWebhook);
  const waha = platforms.get("waha");
  if (waha instanceof WahaPlatformAdapter) {
    app.post(
      "/webhooks/waha",
      wahaWebhookHandler(service, waha, webhookToken("waha")),
    );
  }

  app.use(async (context, next) => {
    const isWebhook = context.req.path === "/webhooks/stub";
    authorize(
      context.req.raw,
      isWebhook ? webhookToken("stub") : options.apiToken,
      isWebhook,
    );
    await next();
  });
  app.use(rawBody);
  app.use(async (context, next) => {
    // Hono tolerates malformed parameter escapes; retain the API's explicit 400.
    decodeURIComponent(context.req.path);
    await next();
  });
  app.post("/tasks", createTaskHandler(service, platforms));

  app.get("/tasks", listTasksHandler(service, platforms));

  app.get("/tasks/:taskId", getTaskHandler(service));

  app.post("/tasks/selection", selectTasksHandler(service, platforms));

  app.post("/tasks/:taskId", sendTaskMessageHandler(service, platforms));

  app.post("/tasks/:taskId/complete", completeTaskHandler(service));

  app.post("/tasks/:taskId/cancel", cancelTaskHandler(service));

  app.get(
    "/conversations",
    listConversationsHandler(platforms, defaultPlatform),
  );

  app.get(
    "/conversations/:conversationId/actions",
    listConversationActionsHandler(store, platforms, defaultPlatform),
  );

  app.post("/stub/conversations", createStubConversationHandler(store));
  app.post(
    "/stub/conversations/:conversationId/reply",
    replyToStubConversationHandler(service, store),
  );
  app.post("/webhooks/stub", stubWebhookHandler(service));

  app.notFound(() => {
    throw new ApiError(
      404,
      "NOT_FOUND",
      "The requested endpoint does not exist.",
    );
  });
  app.onError(handleError);
  return { app, service, store, platforms, hermes, classifier };
}

export type { ApplicationOptions } from "./application/application-options.ts";

export type { Application } from "./application/application.ts";
