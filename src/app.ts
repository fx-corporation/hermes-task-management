import express, { type Express, type Request, type ErrorRequestHandler } from "express";
import {
  PLATFORM,
  type TaskStatus,
} from "./domain.ts";
import {
  InMemoryHermesAdapter,
  StubPlatformAdapter,
  exactKeys,
  isRecord,
  requiredString,
  type HermesDeliveryAdapter,
  type PlatformAdapter,
} from "./adapters.ts";
import { WahaPlatformAdapter } from "./waha-adapter.ts";
import { ApiError, invalidRequest } from "./errors.ts";
import { InMemoryStore } from "./store.ts";
import { TaskService } from "./task-service.ts";

export interface ApplicationOptions {
  apiToken: string;
  webhookToken: string;
  store?: InMemoryStore;
  platform?: PlatformAdapter;
  hermes?: HermesDeliveryAdapter;
}

export interface Application {
  app: Express;
  service: TaskService;
  store: InMemoryStore;
  platform: PlatformAdapter;
  hermes: HermesDeliveryAdapter;
}

export function createApplication(options: ApplicationOptions): Application {
  const store = options.store ?? new InMemoryStore();
  const platform = options.platform ?? new StubPlatformAdapter(store);
  const hermes = options.hermes ?? new InMemoryHermesAdapter();
  const service = new TaskService(store, platform, hermes);
  const app = express();
  app.disable("x-powered-by");
  app.enable("strict routing");
  app.enable("case sensitive routing");

  app.use((request, response, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    const context = { requestId, method: request.method, url: `${request.protocol}://${request.get("host")}${request.originalUrl}` };
    console.log("HTTP request", { ...context, timestamp: new Date().toISOString() });
    const send = response.send.bind(response);
    let body: unknown;
    response.send = (value) => { body = value; return send(value); };
    response.on("finish", () => {
      console.log("HTTP response", {
        ...context, timestamp: new Date().toISOString(), status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt), body,
      });
    });
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ success: true, status: "ok" });
  });

  // Keep the exact bytes for WAHA's HMAC, including whitespace; do not inflate bodies.
  const rawBody = express.raw({ type: () => true, limit: "1mb", inflate: false });
  if (platform instanceof WahaPlatformAdapter) {
    app.post("/webhooks/waha", rawBody, async (request, response) => {
      const body = await platform.readWebhook(request, options.webhookToken);
      response.json({ success: true, ...await service.receiveInbound(body) });
    });
  }

  app.use((request, _response, next) => {
    const isWebhook = request.path === `/webhooks/${platform.platform}`;
    authorize(request, isWebhook ? options.webhookToken : options.apiToken, isWebhook);
    next();
  });
  app.use(rawBody);
  app.post("/tasks", async (request, response) => {
    const body = await readObject(request);
    exactKeys(body, ["hermesSessionId", "platform", "conversationId", "title"]);
    const task = service.createTask({
      hermesSessionId: requiredString(body.hermesSessionId, "hermesSessionId", 200),
      platform: requiredString(body.platform, "platform", 100),
      conversationId: validatePhoneNumber(body.conversationId),
      title: requiredString(body.title, "title", 300),
    });
    return response.status(201).json({ success: true, task });
  });

  app.get("/tasks", async (request, response) => {
    const url = new URL(request.originalUrl, "http://localhost");
    const statusValue = url.searchParams.get("status") ?? undefined;
    if (statusValue && !isTaskStatus(statusValue)) throw invalidRequest('"status" must be a supported task status.');
    const statusFilter: TaskStatus | undefined = statusValue && isTaskStatus(statusValue)
      ? statusValue
      : undefined;
    const platformValue = url.searchParams.get("platform") ?? undefined;
    if (platformValue && platformValue !== platform.platform) {
      throw new ApiError(400, "PLATFORM_NOT_SUPPORTED", "The requested platform is not configured.");
    }
    const conversationId = url.searchParams.has("conversationId")
      ? validatePhoneNumber(url.searchParams.get("conversationId"))
      : undefined;
    const hermesSessionId = url.searchParams.has("hermesSessionId")
      ? requiredString(url.searchParams.get("hermesSessionId"), "hermesSessionId", 200)
      : undefined;
    return response.json({
      success: true,
      tasks: service.listTasks({ status: statusFilter, platform: platformValue, conversationId, hermesSessionId }),
    });
  });

  app.get("/tasks/:taskId", async (request, response) => {
    const taskId = request.params.taskId as string;
    return response.json({ success: true, task: service.getTask(taskId) });
  });

  app.post("/tasks/:taskId/send", async (request, response) => {
    const taskId = request.params.taskId as string;
    const body = await readObject(request);
    exactKeys(body, ["message"]);
    const task = await service.sendMessage(taskId, requiredString(body.message, "message"));
    return response.json({ success: true, taskId, status: task.status });
  });

  app.post("/tasks/:taskId/complete", async (request, response) => {
    const taskId = request.params.taskId as string;
    const body = await readObject(request);
    exactKeys(body, ["result"]);
    const task = service.completeTask(taskId, requiredString(body.result, "result"));
    return response.json({ success: true, taskId, status: task.status });
  });

  app.post("/tasks/:taskId/cancel", async (request, response) => {
    const taskId = request.params.taskId as string;
    const body = await readObject(request, true);
    exactKeys(body, [], ["reason"]);
    const reason = body.reason === undefined ? null : requiredString(body.reason, "reason");
    const task = service.cancelTask(taskId, reason);
    return response.json({ success: true, taskId, status: task.status });
  });

  app.get("/conversations", async (request, response) => {
    const url = new URL(request.originalUrl, "http://localhost");
    const platformValue = url.searchParams.get("platform");
    if (platformValue && platformValue !== platform.platform) {
      throw new ApiError(400, "PLATFORM_NOT_SUPPORTED", "The requested platform is not configured.");
    }
    const search = url.searchParams.get("search") ?? undefined;
    return response.json({ success: true, conversations: await platform.listConversations(search) });
  });

  app.get("/conversations/:conversationId/actions", async (request, response) => {
    const url = new URL(request.originalUrl, "http://localhost");
    const conversationId = validatePhoneNumber(request.params.conversationId);
    const platformValue = url.searchParams.get("platform") ?? platform.platform;
    if (platformValue !== platform.platform) {
      throw new ApiError(400, "PLATFORM_NOT_SUPPORTED", "The requested platform is not configured.");
    }
    if (!store.getConversation(platform.platform, conversationId)) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "The requested conversation does not exist.");
    }
    return response.json({
      success: true,
      platform: platform.platform,
      conversationId,
      actions: store.getConversationActions(platform.platform, conversationId),
    });
  });

  if (platform.platform === "stub") {
    app.post("/stub/conversations", async (request, response) => {
      const body = await readObject(request);
      exactKeys(body, ["conversationId", "displayName"]);
      const conversationId = validatePhoneNumber(body.conversationId);
      const displayName = requiredString(body.displayName, "displayName", 200);
      if (store.getConversation(platform.platform, conversationId)) {
        throw new ApiError(409, "CONVERSATION_ALREADY_EXISTS", "A contact with this conversation identifier already exists.");
      }
      const conversation = { platform: PLATFORM, conversationId, displayName };
      store.addConversation(conversation);
      return response.status(201).json({ success: true, conversation });
    });

    app.post("/stub/conversations/:conversationId/reply", async (request, response) => {
      const conversationId = validatePhoneNumber(request.params.conversationId);
      if (!store.getConversation(platform.platform, conversationId)) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "The requested conversation does not exist.");
      }
      const body = await readObject(request);
      exactKeys(body, ["message"], ["externalMessageId"]);
      const message = requiredString(body.message, "message");
      const externalMessageId = body.externalMessageId === undefined
        ? `stub_${crypto.randomUUID()}`
        : requiredString(body.externalMessageId, "externalMessageId", 300);
      const outcome = await service.receiveInbound({ conversationId, externalMessageId, message });
      return response.json({ success: true, ...outcome });
    });

    app.post("/webhooks/stub", async (request, response) => {
      const body = await readObject(request);
      exactKeys(body, ["conversationId", "externalMessageId", "message"]);
      validatePhoneNumber(body.conversationId);
      requiredString(body.externalMessageId, "externalMessageId", 300);
      requiredString(body.message, "message");
      const outcome = await service.receiveInbound(body);
      return response.json({ success: true, ...outcome });
    });
  }

  app.use(() => {
    throw new ApiError(404, "NOT_FOUND", "The requested endpoint does not exist.");
  });
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    let apiError = error instanceof ApiError ? error : undefined;
    if (error instanceof URIError) apiError = invalidRequest("The URL contains invalid percent encoding.");
    if (isRecord(error) && error.type === "entity.too.large") {
      apiError = new ApiError(413, "INVALID_REQUEST", "Request body exceeds the 1 MB limit.");
    }
    if (isRecord(error) && error.type === "encoding.unsupported") {
      apiError = new ApiError(415, "INVALID_REQUEST", "Compressed request bodies are not supported.");
    }
    response.status(apiError?.status ?? 500).json({
      success: false,
      error: apiError
        ? { code: apiError.code, message: apiError.message, ...(apiError.details ?? {}) }
        : { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  };
  app.use(handleError);
  return { app, service, store, platform, hermes };
}

function authorize(request: Request, token: string, webhook: boolean): void {
  const authorization = request.get("authorization");
  if (authorization !== `Bearer ${token}`) {
    throw new ApiError(
      401,
      webhook ? "WEBHOOK_AUTHENTICATION_FAILED" : "UNAUTHORIZED",
      "A valid bearer token is required.",
    );
  }
}

async function readObject(request: Request, allowEmpty = false): Promise<Record<string, unknown>> {
  const contentType = request.get("content-type") ?? "";
  if (allowEmpty && (!Buffer.isBuffer(request.body) || request.body.length === 0)) return {};
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalidRequest("Content-Type must be application/json.");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "");
  } catch {
    throw invalidRequest("Request body must contain valid JSON.");
  }
  if (allowEmpty && isRecord(value) && Object.keys(value).length === 0) return value;
  if (!isRecord(value)) throw invalidRequest("Request body must be a JSON object.");
  return value;
}

function validatePhoneNumber(value: unknown): string {
  if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) {
    throw invalidRequest('"conversationId" must use canonical international format: + followed by 8 to 15 digits.');
  }
  return value;
}

function isTaskStatus(value: string): value is TaskStatus {
  return value === "ACTIVE" || value === "WAITING_EXTERNAL_REPLY" || value === "COMPLETED" || value === "CANCELLED";
}
