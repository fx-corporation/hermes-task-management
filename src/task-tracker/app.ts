import express, { type Express, type Request, type Response as ExpressResponse, type ErrorRequestHandler } from "express";
import {
  PLATFORM,
  type TaskStatus,
  type Platform,
} from "./domain.ts";
import {
  PlatformAdapterRegistry,
  StubPlatformAdapter,
  exactKeys,
  isRecord,
  requiredString,
  type HermesDeliveryAdapter,
  type PlatformAdapter,
} from "./adapters.ts";
import { HttpHermesAdapter, hermesFromEnvironment, type HttpHermesAdapterOptions } from "./http-hermes-adapter.ts";
import { WahaPlatformAdapter, isWahaLid } from "./waha-adapter.ts";
import { ApiError, invalidRequest } from "./errors.ts";
import { InMemoryStore } from "./store.ts";
import { TaskService } from "./task-service.ts";
import { HttpTaskClassifier, UnavailableTaskClassifier, type TaskClassifier } from "./task-classifier.ts";

export interface ApplicationOptions {
  apiToken: string;
  webhookToken: string;
  store?: InMemoryStore;
  platform?: PlatformAdapter;
  platforms?: PlatformAdapter[];
  defaultPlatform?: Platform;
  webhookTokens?: Partial<Record<Platform, string>>;
  hermes?: HermesDeliveryAdapter;
  hermesOptions?: HttpHermesAdapterOptions;
  taskClassifier?: TaskClassifier;
  taskTrackerUrl?: string;
  taskClassifierModel?: string;
  taskClassifierThreshold?: number;
}

export interface Application {
  app: Express;
  service: TaskService;
  store: InMemoryStore;
  platforms: PlatformAdapterRegistry;
  hermes: HermesDeliveryAdapter;
  classifier: TaskClassifier;
}

export function createApplication(options: ApplicationOptions): Application {
  const store = options.store ?? new InMemoryStore();
  const overrides = new Map((options.platforms ?? []).map(adapter => [adapter.platform, adapter]));
  console.log("App starting with options:", options);
  if (options.platform) overrides.set(options.platform.platform, options.platform);
  const platforms = new PlatformAdapterRegistry([
    overrides.get("stub") ?? new StubPlatformAdapter(store),
    overrides.get("waha") ?? new WahaPlatformAdapter(store, { baseUrl: "http://localhost:3000", apiKey: "" }),
  ]);
  const defaultPlatform = options.defaultPlatform ?? options.platform?.platform ?? "stub";
  const webhookToken = (platform: Platform) => options.webhookTokens?.[platform] ?? options.webhookToken;
  const hermesEnvironment = process.env;
  const hermesOptions = options.hermesOptions ?? {
    baseUrl: hermesEnvironment.HERMES_BASE_URL ?? "http://127.0.0.1:8643",
    apiKey: hermesEnvironment.HERMES_API_KEY ?? "",
    timeoutMs: hermesEnvironment.HERMES_TIMEOUT_MS === undefined ? 120_000 : Number(hermesEnvironment.HERMES_TIMEOUT_MS.trim() || NaN),
    maxRetries: hermesEnvironment.HERMES_MAX_RETRIES === undefined ? 3 : Number(hermesEnvironment.HERMES_MAX_RETRIES.trim() || NaN),
  };
  const hermes = options.hermes ?? (options.hermesOptions ? new HttpHermesAdapter(options.hermesOptions) : hermesFromEnvironment(process.env));
  const classifier = options.taskClassifier ?? (hermesOptions.apiKey.trim()
    ? new HttpTaskClassifier({
      ...hermesOptions,
      store,
      classifierBaseUrl: hermesEnvironment.TASK_CLASSIFIER_BASE_URL ?? hermesOptions.baseUrl,
      classifierApiKey: hermesEnvironment.TASK_CLASSIFIER_API_KEY ?? (hermesEnvironment.TASK_CLASSIFIER_BASE_URL ? "ollama" : hermesOptions.apiKey),
      trackerUrl: options.taskTrackerUrl ?? hermesEnvironment.TASK_TRACKER_BASE_URL ?? "http://127.0.0.1:9005",
      model: options.taskClassifierModel ?? hermesEnvironment.TASK_CLASSIFIER_MODEL ?? (hermesEnvironment.TASK_CLASSIFIER_BASE_URL ? "gemma4:e4b" : "hermes-agent"),
      threshold: options.taskClassifierThreshold ?? (hermesEnvironment.TASK_CLASSIFIER_THRESHOLD === undefined
        ? 0.8 : Number(hermesEnvironment.TASK_CLASSIFIER_THRESHOLD.trim() || NaN)),
    })
    : new UnavailableTaskClassifier(store));
  const service = new TaskService(store, platforms, hermes, classifier);
  const respondToInbound = async (platform: string, payload: unknown, response: ExpressResponse) => {
    try {
      return response.json({ success: true, ...await service.receiveInbound(platform, payload) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 502 && isRecord(error.details)) {
        return response.status(error.status).json({
          success: false,
          ...error.details,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  };
  const app = express();
  app.disable("x-powered-by");
  app.enable("strict routing");
  app.enable("case sensitive routing");

  app.use((request, response, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    const context = { requestId, method: request.method, url: `${request.protocol}://${request.get("host")}${request.originalUrl}` };
    response.locals.requestContext = context;
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
  app.use("/webhooks", rawBody, (request, response, next) => {
    const raw = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* Log malformed bodies as received. */ }
    console.log("HTTP webhook payload", {
      ...response.locals.requestContext,
      timestamp: new Date().toISOString(),
      payload,
    });
    next();
  });
  const waha = platforms.get("waha");
  if (waha instanceof WahaPlatformAdapter) {
    app.post("/webhooks/waha", async (request, response) => {
      const body = await waha.readWebhook(request, webhookToken("waha"));
      return respondToInbound("waha", body, response);
    });
  }

  app.use((request, _response, next) => {
    const isWebhook = request.path === "/webhooks/stub";
    authorize(request, isWebhook ? webhookToken("stub") : options.apiToken, isWebhook);
    next();
  });
  app.use(rawBody);
  app.post("/tasks", async (request, response) => {
    const body = await readObject(request);
    exactKeys(body, ["hermesSessionId", "platform", "conversationId", "description"]);
    const platform = platforms.get(requiredString(body.platform, "platform", 100));
    const task = service.createTask({
      hermesSessionId: requiredString(body.hermesSessionId, "hermesSessionId", 200),
      platform: platform.platform,
      conversationId: validateConversationId(body.conversationId, platform.platform),
      description: requiredDescription(body.description),
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
    if (platformValue) platforms.get(platformValue);
    const conversationId = url.searchParams.has("conversationId")
      ? validateConversationId(url.searchParams.get("conversationId"), platformValue)
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

  app.post("/tasks/selection", async (request, response) => {
    const body = await readObject(request);
    exactKeys(body, ["webhookMessage", "platform", "conversationId", "taskIds"]);
    const platform = platforms.get(requiredString(body.platform, "platform", 100));
    const conversationId = validateConversationId(body.conversationId, platform.platform);
    if (!Array.isArray(body.taskIds) || body.taskIds.length === 0 ||
        body.taskIds.some(id => typeof id !== "string" || !id.trim() || id.length > 200) ||
        new Set(body.taskIds).size !== body.taskIds.length) {
      throw invalidRequest('"taskIds" must be a non-empty array of unique task IDs.');
    }
    const result = await service.selectTasks({
      webhookMessage: requiredString(body.webhookMessage, "webhookMessage"),
      platform: platform.platform,
      conversationId,
      taskIds: body.taskIds as string[],
    });
    return response.status(result.failed ? 502 : 200).json({
      success: !result.failed,
      eventId: result.eventId,
      taskIds: result.taskIds,
      routingOutcome: result.routingOutcome,
      deliveries: result.deliveries,
      ...(result.failed ? { error: { code: "HERMES_DELIVERY_FAILED", message: "One or more Hermes deliveries failed." } } : {}),
    });
  });

  app.post("/tasks/:taskId", async (request, response) => {
    const taskId = request.params.taskId as string;
    const body = await readObject(request);
    exactKeys(body, ["platform", "conversationId", "message", "description"]);
    const platform = platforms.get(requiredString(body.platform, "platform", 100));
    const task = await service.sendMessage(taskId, {
      platform: platform.platform,
      conversationId: validateConversationId(body.conversationId, platform.platform),
      message: requiredString(body.message, "message"),
      description: requiredDescription(body.description),
    });
    return response.json({ success: true, taskId, status: task.status, description: task.description });
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
    const platform = platforms.get(platformValue ?? defaultPlatform);
    const search = url.searchParams.get("search") ?? undefined;
    return response.json({ success: true, conversations: await platform.listConversations(search) });
  });

  app.get("/conversations/:conversationId/actions", async (request, response) => {
    const url = new URL(request.originalUrl, "http://localhost");
    const platformValue = url.searchParams.get("platform") ?? defaultPlatform;
    const platform = platforms.get(platformValue);
    const conversationId = validateConversationId(request.params.conversationId, platform.platform);
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

  {
    const platform = platforms.get("stub");
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
      return respondToInbound("stub", { conversationId, externalMessageId, message }, response);
    });

    app.post("/webhooks/stub", async (request, response) => {
      const body = await readObject(request);
      exactKeys(body, ["conversationId", "externalMessageId", "message"]);
      validatePhoneNumber(body.conversationId);
      requiredString(body.externalMessageId, "externalMessageId", 300);
      requiredString(body.message, "message");
      return respondToInbound("stub", body, response);
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
  return { app, service, store, platforms, hermes, classifier };
}

function requiredDescription(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 20_000) {
    throw invalidRequest('"description" must be a non-empty string of at most 20000 characters.');
  }
  return value;
}

function authorize(request: Request, token: string, webhook: boolean): void {
  const authorization = request.get("authorization");
  if (!token || authorization !== `Bearer ${token}`) {
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

function validateConversationId(value: unknown, platform?: string): string {
  if (platform === "waha" || (!platform && isWahaLid(value))) {
    if (!isWahaLid(value) || value.length > 200) throw invalidRequest('WAHA "conversationId" must be a numeric identifier ending in @lid.');
    return value;
  }
  return validatePhoneNumber(value);
}
