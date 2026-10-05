import type { Handler } from "hono";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import { validatePhoneNumber } from "../http/validation.ts";
import { PLATFORM } from "../domain/platform.ts";
import type { InMemoryStore } from "../storage/store.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function createStubConversationHandler(
  store: InMemoryStore,
): Handler<ApplicationEnv> {
  return async (context) => {
    const body = await readObject(context);
    exactKeys(body, ["conversationId", "displayName"]);
    const conversationId = validatePhoneNumber(body.conversationId);
    const displayName = requiredString(body.displayName, "displayName", 200);
    if (store.getConversation(PLATFORM, conversationId)) {
      throw new ApiError(
        409,
        "CONVERSATION_ALREADY_EXISTS",
        "A contact with this conversation identifier already exists.",
      );
    }
    const conversation = { platform: PLATFORM, conversationId, displayName };
    store.addConversation(conversation);
    return context.json({ success: true, conversation }, 201);
  };
}
