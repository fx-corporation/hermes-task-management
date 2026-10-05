import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";

const rejectLargeBody = () => {
  throw new ApiError(
    413,
    "INVALID_REQUEST",
    "Request body exceeds the 1 MB limit.",
  );
};
const limitBody = bodyLimit({ maxSize: 1024 * 1024, onError: rejectLargeBody });
// Cache exact bytes for WAHA's HMAC and reject compressed bodies before parsing.
export const rawBody: MiddlewareHandler<ApplicationEnv> = async (
  context,
  next,
) => {
  if (context.get("rawBody") !== undefined) {
    await next();
    return;
  }
  const encoding = context.req.header("content-encoding")?.toLowerCase();
  if (encoding && encoding !== "identity") {
    throw new ApiError(
      415,
      "INVALID_REQUEST",
      "Compressed request bodies are not supported.",
    );
  }
  await limitBody(context, async () => {
    const raw = Buffer.from(await context.req.arrayBuffer());
    if (raw.length > 1024 * 1024) rejectLargeBody();
    context.set("rawBody", raw);
    await next();
  });
};
