import { createApplication } from "./app.ts";
import { hermesFromEnvironment } from "./hermes/http-hermes-adapter.ts";
import { InMemoryStore } from "./storage/store.ts";
import { StubPlatformAdapter } from "./platforms/stub/stub-platform-adapter.ts";
import { taskClassifierFromEnvironment } from "./classification/task-classifier-from-environment.ts";
import { WahaPlatformAdapter } from "./platforms/waha/waha-adapter.ts";

export function startServer(environment: NodeJS.ProcessEnv = process.env) {
  const apiToken = environment.MESSAGING_TASK_API_TOKEN;
  const defaultPlatform = environment.MESSAGING_PLATFORM ?? "stub";
  if (defaultPlatform !== "stub" && defaultPlatform !== "waha")
    throw new Error("MESSAGING_PLATFORM must be stub or waha.");
  if (!apiToken)
    throw new Error("Set MESSAGING_TASK_API_TOKEN before starting the server.");
  const parsedPort = Number(environment.PORT ?? "9005");
  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65_535) {
    throw new Error("PORT must be an integer from 0 to 65535.");
  }

  const store = new InMemoryStore();
  const waha = new WahaPlatformAdapter(store, {
    baseUrl: environment.WAHA_BASE_URL ?? "http://localhost:3000",
    apiKey: environment.WAHA_API_KEY ?? "",
    session: environment.WAHA_SESSION,
    hmacKey: environment.WAHA_WEBHOOK_HMAC_KEY,
  });
  const app = createApplication({
    apiToken,
    webhookToken: "",
    store,
    platforms: [new StubPlatformAdapter(store), waha],
    defaultPlatform,
    webhookTokens: {
      stub: environment.STUB_WEBHOOK_TOKEN ?? "",
      waha: environment.WAHA_WEBHOOK_TOKEN ?? "",
    },
    hermes: hermesFromEnvironment(environment),
    taskClassifier: taskClassifierFromEnvironment(environment, store),
  });
  const server = Bun.serve({
    port: parsedPort,
    hostname: environment.HOST ?? "127.0.0.1",
    fetch: app.app.fetch,
    idleTimeout: 0, // Hermes turns use bounded adapter timeouts and may exceed Bun's idle timeout.
  });
  return { server, app };
}

if (import.meta.main) {
  const { server } = startServer();
  console.log(`Hermes Task Management API listening at ${server.url}`);
  const stop = () => {
    void server.stop(true);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
