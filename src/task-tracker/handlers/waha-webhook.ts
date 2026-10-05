import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { respondToInbound } from "../http/respond-to-inbound.ts";
import type { TaskService } from "../services/task-service.ts";
import type { WahaPlatformAdapter } from "../platforms/waha/waha-adapter.ts";

export function wahaWebhookHandler(
  service: TaskService,
  waha: WahaPlatformAdapter,
  token: string,
): Handler<ApplicationEnv> {
  return async (context) => {
    const body = await waha.readWebhook(
      context.req.raw,
      context.get("rawBody"),
      token,
    );
    return respondToInbound(service, "waha", body, context);
  };
}
