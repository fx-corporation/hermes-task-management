import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import { respondToInbound } from "../http/respond-to-inbound.ts";
import { validatePhoneNumber } from "../http/validation.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function stubWebhookHandler(
  service: TaskService,
): Handler<ApplicationEnv> {
  return async (context) => {
    const body = await readObject(context);
    exactKeys(body, ["conversationId", "externalMessageId", "message"]);
    validatePhoneNumber(body.conversationId);
    requiredString(body.externalMessageId, "externalMessageId", 300);
    requiredString(body.message, "message");
    return respondToInbound(service, "stub", body, context);
  };
}
