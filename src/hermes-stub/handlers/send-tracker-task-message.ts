import type { Handler } from "hono";
import type { MessagingTask } from "../../task-tracker/domain/messaging-task.ts";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { proxyTrackerRequest } from "../http/proxy-tracker-request.ts";
import type { HermesStubState } from "../stub-state.ts";

export function sendTrackerTaskMessageHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/tracker/tasks/:taskId"> {
  return async (context) => {
    const response = await proxyTrackerRequest(
      context,
      state,
      context.req.path.slice("/api/tracker".length),
    );
    if (response.ok) {
      const result = await response.clone().json();
      const taskId = decodeURIComponent(
        context.req.path.slice("/api/tracker/tasks/".length),
      );
      const task = state.tasks.get(taskId);
      if (task) {
        if (typeof result.status === "string")
          task.status = result.status as MessagingTask["status"];
        if (typeof result.description === "string")
          task.description = result.description;
        state.broadcast({
          id: crypto.randomUUID(),
          sessionId: task.hermesSessionId,
          taskId: task.id,
          sender: "You",
          message: JSON.parse(context.get("body")).message,
          timestamp: new Date().toISOString(),
          direction: "sent",
        });
      }
    }
    return response;
  };
}
