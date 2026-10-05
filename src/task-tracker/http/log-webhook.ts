import type { MiddlewareHandler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";

export const logWebhook: MiddlewareHandler<ApplicationEnv> = async (
  context,
  next,
) => {
  const raw = context.get("rawBody").toString("utf8");
  let payload: unknown = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* Log malformed bodies as received. */
  }
  console.log("HTTP webhook payload", {
    ...context.get("requestContext"),
    timestamp: new Date().toISOString(),
    payload,
  });
  await next();
};
