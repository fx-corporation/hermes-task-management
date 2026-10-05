import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";

export function healthHandler(): Handler<HermesStubEnv, "/health"> {
  return (context) => {
    return context.json({ status: "ok", service: "hermes-stub" });
  };
}
