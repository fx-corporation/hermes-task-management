import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import { proxyTrackerRequest } from "../http/proxy-tracker-request.ts";
import type { HermesStubState } from "../stub-state.ts";

export function selectTrackerTasksHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/tracker/tasks/selection"> {
  return async (context) => {
    const response = await proxyTrackerRequest(
      context,
      state,
      "/tasks/selection",
    );
    return response;
  };
}
