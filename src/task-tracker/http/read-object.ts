import type { Context } from "hono";
import type { ApplicationEnv } from "../application/application-env.ts";
import { invalidRequest } from "../errors/invalid-request.ts";
import { isRecord } from "../validation.ts";

export async function readObject(
  context: Context<ApplicationEnv>,
  allowEmpty = false,
): Promise<Record<string, unknown>> {
  const contentType = context.req.header("content-type") ?? "";
  const raw = context.get("rawBody");
  if (allowEmpty && raw.length === 0) return {};
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalidRequest("Content-Type must be application/json.");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalidRequest("Request body must contain valid JSON.");
  }
  if (allowEmpty && isRecord(value) && Object.keys(value).length === 0)
    return value;
  if (!isRecord(value))
    throw invalidRequest("Request body must be a JSON object.");
  return value;
}
