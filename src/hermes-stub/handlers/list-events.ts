import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function listEventsHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/events"> {
  return (context) => {
    return context.json({ events: state.events });
  };
}
