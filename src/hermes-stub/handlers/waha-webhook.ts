import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function wahaWebhookHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/webhooks/waha"> {
  return (context) => {
    const request = context.req.raw;
    context.env.server?.timeout(request, 0); // Synchronous Hermes turns may exceed Bun's idle timeout.
    // Forward exact bytes and authentication so task tracker remains the validator.
    return state.proxy("/webhooks/waha", request, context.get("body"), true);
  };
}
