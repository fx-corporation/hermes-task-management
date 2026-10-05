import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { readObject } from "../http/read-object.ts";
import type { TaskService } from "../services/task-service.ts";
import { exactKeys, requiredString } from "../validation.ts";

export function cancelTaskHandler(
  service: TaskService,
): Handler<ApplicationEnv, "/tasks/:taskId/cancel"> {
  return async (context) => {
    const taskId = context.req.param("taskId");
    const body = await readObject(context, true);
    exactKeys(body, [], ["reason"]);
    const reason =
      body.reason === undefined ? null : requiredString(body.reason, "reason");
    const task = service.cancelTask(taskId, reason);
    return context.json({ success: true, taskId, status: task.status });
  };
}
