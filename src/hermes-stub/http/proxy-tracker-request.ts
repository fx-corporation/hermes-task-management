import type { Context } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function proxyTrackerRequest(
  context: Context<HermesStubEnv>,
  state: HermesStubState,
  target: string,
) {
  // The bounded upstream timeout governs proxy requests.
  context.env.server?.timeout(context.req.raw, 0);
  const query = new URL(context.req.url).search;
  return state.proxy(target + query, context.req.raw, context.get("body"));
}
