import type { Handler } from "hono";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";
import { validateConversationId } from "../http/validation.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { Platform } from "../domain/platform.ts";
import type { InMemoryStore } from "../storage/store.ts";

export function listConversationActionsHandler(
  store: InMemoryStore,
  platforms: PlatformAdapterRegistry,
  defaultPlatform: Platform,
): Handler<ApplicationEnv, "/conversations/:conversationId/actions"> {
  return async (context) => {
    const url = new URL(context.req.url);
    const platformValue = url.searchParams.get("platform") ?? defaultPlatform;
    const platform = platforms.get(platformValue);
    const conversationId = validateConversationId(
      context.req.param("conversationId"),
      platform.platform,
    );
    if (!store.getConversation(platform.platform, conversationId)) {
      throw new ApiError(
        404,
        "CONVERSATION_NOT_FOUND",
        "The requested conversation does not exist.",
      );
    }
    return context.json({
      success: true,
      platform: platform.platform,
      conversationId,
      actions: store.getConversationActions(platform.platform, conversationId),
    });
  };
}
