import type { MiddlewareHandler } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";

export const logRequest: MiddlewareHandler<ApplicationEnv> = async (
  context,
  next,
) => {
  const startedAt = performance.now();
  const requestContext = {
    requestId: crypto.randomUUID(),
    method: context.req.method,
    url: context.req.url,
  };
  context.set("requestContext", requestContext);
  console.log("HTTP request", {
    ...requestContext,
    timestamp: new Date().toISOString(),
  });
  await next();
  console.log("HTTP response", {
    ...requestContext,
    timestamp: new Date().toISOString(),
    status: context.res.status,
    durationMs: Math.round(performance.now() - startedAt),
    body: await context.res.clone().text(),
  });
};
