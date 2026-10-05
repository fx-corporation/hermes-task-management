import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { Platform } from "../domain/platform.ts";

export function listConversationsHandler(
  platforms: PlatformAdapterRegistry,
  defaultPlatform: Platform,
): Handler<ApplicationEnv> {
  return async (context) => {
    const url = new URL(context.req.url);
    const platformValue = url.searchParams.get("platform");
    const platform = platforms.get(platformValue ?? defaultPlatform);
    const search = url.searchParams.get("search") ?? undefined;
    return context.json({
      success: true,
      conversations: await platform.listConversations(search),
    });
  };
}
