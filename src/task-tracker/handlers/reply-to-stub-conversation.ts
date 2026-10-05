import type { Handler } from "hono";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import { respondToInbound } from "../http/respond-to-inbound.ts";
import { validatePhoneNumber } from "../http/validation.ts";
import { PLATFORM } from "../domain/platform.ts";
import type { InMemoryStore } from "../storage/store.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function replyToStubConversationHandler(
  service: TaskService,
  store: InMemoryStore,
): Handler<ApplicationEnv, "/stub/conversations/:conversationId/reply"> {
  return async (context) => {
    const conversationId = validatePhoneNumber(
      context.req.param("conversationId"),
    );
    if (!store.getConversation(PLATFORM, conversationId)) {
      throw new ApiError(
        404,
        "CONVERSATION_NOT_FOUND",
        "The requested conversation does not exist.",
      );
    }
    const body = await readObject(context);
    exactKeys(body, ["message"], ["externalMessageId"]);
    const message = requiredString(body.message, "message");
    const externalMessageId =
      body.externalMessageId === undefined
        ? `stub_${crypto.randomUUID()}`
        : requiredString(body.externalMessageId, "externalMessageId", 300);
    return respondToInbound(
      service,
      "stub",
      { conversationId, externalMessageId, message },
      context,
    );
  };
}
