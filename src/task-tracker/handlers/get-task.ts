import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import type { TaskService } from "../services/task-service.ts";

export function getTaskHandler(
  service: TaskService,
): Handler<ApplicationEnv, "/tasks/:taskId"> {
  return async (context) => {
    const taskId = context.req.param("taskId");
    return context.json({ success: true, task: await service.getTask(taskId) });
  };
}
