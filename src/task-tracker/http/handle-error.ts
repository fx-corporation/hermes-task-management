import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";
import { invalidRequest } from "../errors/invalid-request.ts";

export const handleError: ErrorHandler<ApplicationEnv> = (error, context) => {
  let apiError = error instanceof ApiError ? error : undefined;
  if (error instanceof URIError)
    apiError = invalidRequest("The URL contains invalid percent encoding.");
  return context.json(
    {
      success: false,
      error: apiError
        ? {
            code: apiError.code,
            message: apiError.message,
            ...(apiError.details ?? {}),
          }
        : { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    },
    (apiError?.status ?? 500) as ContentfulStatusCode,
  );
};
