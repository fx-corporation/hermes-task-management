import type { Application } from "../src/task-tracker/app.ts";

// Exercise Hono directly with the same Fetch requests used by the Bun server.
export async function fetchApplication(application: Application, request: Request): Promise<Response> {
  return application.app.fetch(request);
}
