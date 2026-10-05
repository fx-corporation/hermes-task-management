import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function completeTaskHandler(
  service: TaskService,
): Handler<ApplicationEnv, "/tasks/:taskId/complete"> {
  return async (context) => {
    const taskId = context.req.param("taskId");
    const body = await readObject(context);
    exactKeys(body, ["result"]);
    const task = service.completeTask(
      taskId,
      requiredString(body.result, "result"),
    );
    return context.json({ success: true, taskId, status: task.status });
  };
}
