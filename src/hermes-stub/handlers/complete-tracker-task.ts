import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { proxyTrackerRequest } from "../http/proxy-tracker-request.ts";
import type { HermesStubState } from "../stub-state.ts";

export function completeTrackerTaskHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/tracker/tasks/:taskId/complete"> {
  return async (context) => {
    const response = await proxyTrackerRequest(
      context,
      state,
      context.req.path.slice("/api/tracker".length),
    );
    return response;
  };
}
