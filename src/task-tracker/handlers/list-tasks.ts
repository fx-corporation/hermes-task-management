import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { invalidRequest } from "../errors/invalid-request.ts";
import { isTaskStatus, validateConversationId } from "../http/validation.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { TaskService } from "../services/task-service.ts";
import type { TaskStatus } from "../domain/task-status.ts";
import { requiredString } from "../validation.ts";

export function listTasksHandler(
  service: TaskService,
  platforms: PlatformAdapterRegistry,
): Handler<ApplicationEnv> {
  return async (context) => {
    const url = new URL(context.req.url);
    const statusValue = url.searchParams.get("status") ?? undefined;
    if (statusValue && !isTaskStatus(statusValue))
      throw invalidRequest('"status" must be a supported task status.');
    const statusFilter: TaskStatus | undefined =
      statusValue && isTaskStatus(statusValue) ? statusValue : undefined;
    const platformValue = url.searchParams.get("platform") ?? undefined;
    if (platformValue) platforms.get(platformValue);
    const conversationId = url.searchParams.has("conversationId")
      ? validateConversationId(
          url.searchParams.get("conversationId"),
          platformValue,
        )
      : undefined;
    const hermesSessionId = url.searchParams.has("hermesSessionId")
      ? requiredString(
          url.searchParams.get("hermesSessionId"),
          "hermesSessionId",
          200,
        )
      : undefined;
    return context.json({
      success: true,
      tasks: service.listTasks({
        status: statusFilter,
        platform: platformValue,
        conversationId,
        hermesSessionId,
      }),
    });
  };
}
