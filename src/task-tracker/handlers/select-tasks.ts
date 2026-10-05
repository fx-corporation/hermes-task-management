import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { invalidRequest } from "../errors/invalid-request.ts";
import { readObject } from "../http/read-object.ts";
import { validateConversationId } from "../http/validation.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function selectTasksHandler(
  service: TaskService,
  platforms: PlatformAdapterRegistry,
): Handler<ApplicationEnv> {
  return async (context) => {
    const body = await readObject(context);
    exactKeys(body, [
      "webhookMessage",
      "platform",
      "conversationId",
      "taskIds",
    ]);
    const platform = platforms.get(
      requiredString(body.platform, "platform", 100),
    );
    const conversationId = validateConversationId(
      body.conversationId,
      platform.platform,
    );
    if (
      !Array.isArray(body.taskIds) ||
      body.taskIds.length === 0 ||
      body.taskIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 200,
      ) ||
      new Set(body.taskIds).size !== body.taskIds.length
    ) {
      throw invalidRequest(
        '"taskIds" must be a non-empty array of unique task IDs.',
      );
    }
    const result = await service.selectTasks({
      webhookMessage: requiredString(body.webhookMessage, "webhookMessage"),
      platform: platform.platform,
      conversationId,
      taskIds: body.taskIds as string[],
    });
    return context.json(
      {
        success: !result.failed,
        eventId: result.eventId,
        taskIds: result.taskIds,
        routingOutcome: result.routingOutcome,
        deliveries: result.deliveries,
        ...(result.failed
          ? {
              error: {
                code: "HERMES_DELIVERY_FAILED",
                message: "One or more Hermes deliveries failed.",
              },
            }
          : {}),
      },
      result.failed ? 502 : 200,
    );
  };
}
