import type { MiddlewareHandler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubOptions } from "../hermes-stub-options.ts";

export function logRequest(
  log: NonNullable<HermesStubOptions["log"]>,
): MiddlewareHandler<HermesStubEnv> {
  return async (context, next) => {
    const body = await context.req.text();
    context.set("body", body);
    log({
      timestamp: new Date().toISOString(),
      method: context.req.method,
      url: context.req.url,
      headers: Object.fromEntries(context.req.raw.headers.entries()),
      body,
    });
    // Preserve the stub's GET/POST contract and avoid allocating SSE clients for HEAD.
    if (context.req.method === "HEAD")
      return context.json({ error: "Not found" }, 404);
    await next();
  };
}
