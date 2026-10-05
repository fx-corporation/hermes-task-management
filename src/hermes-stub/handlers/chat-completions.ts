import type { Handler } from "hono";
import type { HermesStubEnv } from "../hermes-stub-env.ts";
import type { HermesStubState } from "../stub-state.ts";

export function chatCompletionsHandler(
  state: HermesStubState,
): Handler<HermesStubEnv, "/v1/chat/completions"> {
  return (context) => {
    const body = context.get("body");
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return context.json({ error: "Invalid JSON" }, 400);
    }
    const messages =
      payload &&
      typeof payload === "object" &&
      "messages" in payload &&
      Array.isArray(payload.messages)
        ? (payload.messages as { role?: unknown; content?: unknown }[])
        : [];
    const userContent = messages.find(
      (message) => message.role === "user",
    )?.content;
    let candidates: { taskId: string }[] = [];
    if (typeof userContent === "string") {
      try {
        const input = JSON.parse(userContent) as { candidates?: unknown };
        if (Array.isArray(input.candidates))
          candidates = input.candidates.filter(
            (item): item is { taskId: string } =>
              !!item &&
              typeof item === "object" &&
              "taskId" in item &&
              typeof item.taskId === "string",
          );
      } catch {
        /* Malformed model input receives the configured/default fixture. */
      }
    }
    const fixture = state.scoringFixtures.shift() ?? {
      scores: candidates.map((candidate) => ({
        taskId: candidate.taskId,
        confidence: 0.5,
      })),
    };
    return context.json({
      choices: [
        { message: { role: "assistant", content: JSON.stringify(fixture) } },
      ],
    });
  };
}
