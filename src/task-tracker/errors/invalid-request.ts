import { ApiError } from "./api-error.ts";
export { ApiError } from "./api-error.ts";

export function invalidRequest(message: string): ApiError {
  return new ApiError(400, "INVALID_REQUEST", message);
}
