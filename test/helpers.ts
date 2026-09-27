import supertest from "supertest";
import type { Application } from "../src/app.ts";

// Exercise Express over HTTP while keeping the Web Response assertions shared by the tests.
export async function fetchApplication(application: Application, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const client = supertest(application.app);
  const method = request.method.toLowerCase() as "get" | "post";
  let pending = client[method](`${url.pathname}${url.search}`);
  request.headers.forEach((value, name) => { pending = pending.set(name, value); });
  if (request.body !== null) pending = pending.send(await request.text());
  const result = await pending;
  return new Response(request.method === "HEAD" ? null : result.text, {
    status: result.status,
    headers: { "content-type": result.headers["content-type"] ?? "application/json" },
  });
}
