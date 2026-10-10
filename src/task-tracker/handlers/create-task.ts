import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import {
  requiredDescription,
  validateConversationId,
} from "../http/validation.ts";
import type { PlatformAdapterRegistry } from "../platforms/platform-adapter-registry.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function createTaskHandler(
  service: TaskService,
  platforms: PlatformAdapterRegistry,
): Handler<ApplicationEnv> {
  return async (context) => {
    const body = await readObject(context);
    exactKeys(body, [
      "hermesSessionId",
      "platform",
      "conversationId",
      "description",
    ]);
    const platform = platforms.get(
      requiredString(body.platform, "platform", 100),
    );
    const task = await service.createTask({
      hermesSessionId: requiredString(
        body.hermesSessionId,
        "hermesSessionId",
        200,
      ),
      platform: platform.platform,
      conversationId: validateConversationId(
        body.conversationId,
        platform.platform,
      ),
      description: requiredDescription(body.description),
    });
    return context.json({ success: true, task }, 201);
  };
}
