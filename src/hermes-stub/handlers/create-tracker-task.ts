import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { proxyTrackerRequest } from "../http/proxy-tracker-request.ts";
import type { HermesStubState } from "../stub-state.ts";

export function createTrackerTaskHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/tracker/tasks"> {
  return async (context) => {
    const response = await proxyTrackerRequest(context, state, "/tasks");
    if (response.ok) {
      const result = await response.clone().json();
      for (const task of result.tasks ?? (result.task ? [result.task] : []))
        state.tasks.set(task.id, task);
    }
    return response;
  };
}
