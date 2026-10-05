import { ApiError } from "../errors/api-error.ts";

export function authorize(
  request: Request,
  token: string,
  webhook: boolean,
): void {
  const authorization = request.headers.get("authorization");
  if (!token || authorization !== `Bearer ${token}`) {
    throw new ApiError(
      401,
      webhook ? "WEBHOOK_AUTHENTICATION_FAILED" : "UNAUTHORIZED",
      "A valid bearer token is required.",
    );
  }
}
