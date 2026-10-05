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

export function sendTaskMessageHandler(
  service: TaskService,
  platforms: PlatformAdapterRegistry,
): Handler<ApplicationEnv, "/tasks/:taskId"> {
  return async (context) => {
    const taskId = context.req.param("taskId");
    const body = await readObject(context);
    exactKeys(body, ["platform", "conversationId", "message", "description"]);
    const platform = platforms.get(
      requiredString(body.platform, "platform", 100),
    );
    const task = await service.sendMessage(taskId, {
      platform: platform.platform,
      conversationId: validateConversationId(
        body.conversationId,
        platform.platform,
      ),
      message: requiredString(body.message, "message"),
      description: requiredDescription(body.description),
    });
    return context.json({
      success: true,
      taskId,
      status: task.status,
      description: task.description,
    });
  };
}
