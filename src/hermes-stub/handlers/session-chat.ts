import type { Handler } from "hono";
import { receivedMessage } from "../events.ts";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function sessionChatHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/api/sessions/:sessionId/chat"> {
  return (context) => {
    const request = context.req.raw;
    const body = context.get("body");
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return context.json({ error: "Invalid JSON" }, 400);
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("input" in payload) ||
      typeof payload.input !== "string" ||
      !payload.input.trim()
    ) {
      return context.json({ error: "input is a required string" }, 400);
    }
    decodeURIComponent(context.req.path);
    const sessionId = context.req.param("sessionId");
    const requestKey = request.headers.get("idempotency-key");
    const key = requestKey ? `${sessionId}:${requestKey}` : null;
    const previous = key ? state.chats.get(key) : undefined;
    if (previous && previous.body !== body) {
      return context.json({ error: { code: "idempotency_key_conflict" } }, 409);
    }
    const completion = previous?.completion ?? {
      object: "hermes.session.chat.completion",
      session_id: sessionId,
      message: {
        role: "assistant",
        content: "Reply received by Hermes development stub.",
      },
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    if (!previous) state.broadcast(receivedMessage(sessionId, payload.input));
    if (key && !previous) state.chats.set(key, { body, completion });
    if (previous) context.header("Idempotency-Replayed", "true");
    return context.json(completion);
  };
}
