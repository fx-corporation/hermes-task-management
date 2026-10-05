import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../errors/api-error.ts";
import type { ApplicationEnv } from "../application/application-env.ts";
import type { TaskService } from "../services/task-service.ts";
import { isRecord } from "../validation.ts";

export async function respondToInbound(
  service: TaskService,
  platform: string,
  payload: unknown,
  context: Context<ApplicationEnv>,
) {
  try {
    return context.json({
      success: true,
      ...(await service.receiveInbound(platform, payload)),
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 502 &&
      isRecord(error.details)
    ) {
      return context.json(
        {
          success: false,
          ...error.details,
          error: { code: error.code, message: error.message },
        },
        error.status as ContentfulStatusCode,
      );
    }
    throw error;
  }
}
