import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function streamEventsHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/events/stream"> {
  return (context) => {
    const request = context.req.raw;
    context.env.server?.timeout(request, 0);
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let heartbeat: ReturnType<typeof setInterval>;
    const cleanup = () => {
      clearInterval(heartbeat);
      state.clients.delete(controller);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        state.clients.add(controller);
        controller.enqueue(
          state.encoder.encode(
            `event: snapshot\ndata: ${JSON.stringify(state.events)}\n\n`,
          ),
        );
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(state.encoder.encode(": keepalive\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);
        request.signal.addEventListener(
          "abort",
          () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          },
          { once: true },
        );
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  };
}
