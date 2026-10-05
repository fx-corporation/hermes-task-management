import { invalidRequest } from "./errors/invalid-request.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(
  value: unknown,
  field: string,
  maxLength = 4_000,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw invalidRequest(
      `"${field}" must be a non-empty string of at most ${maxLength} characters.`,
    );
  }
  return value.trim();
}

export function exactKeys(
  body: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  for (const key of required) {
    if (!(key in body))
      throw invalidRequest(`Missing required field "${key}".`);
  }
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw invalidRequest(
      `Unexpected field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    );
  }
}
