import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";

export function createSessionHandler(): Handler<
  HermesStubEnv,
  "/api/sessions"
> {
  return (context) => {
    const sessionId = `stub-owner-${crypto.randomUUID()}`;
    return context.json({ id: sessionId }, 201);
  };
}
