import type { Handler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";

export function healthHandler(): Handler<ApplicationEnv> {
  return (context) => context.json({ success: true, status: "ok" });
}
