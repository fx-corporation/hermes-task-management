import type { FormEvent } from "react";
import { useState } from "react";
import type { MessagingTask } from "../../../task-tracker/domain/messaging-task.ts";
import type { TaskStatus } from "../../../task-tracker/domain/task-status.ts";
import { api } from "../api.ts";
import type { RunAction } from "../run-action.ts";
import { trackerUrl } from "../tracker-url.ts";

export function TaskControls({
  task,
  busy,
  run,
  onUpdated,
}: {
  task: MessagingTask;
  busy: boolean;
  run: RunAction;
  onUpdated: (patch: Partial<MessagingTask>) => void;
}) {
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState(task.description);
  const [result, setResult] = useState("");
  const [reason, setReason] = useState("");
  const submit = (
    event: FormEvent,
    endpoint: string,
    body: unknown,
    clear: () => void,
  ) => {
    event.preventDefault();
    void run(async () => {
      const response = await api<{ status: TaskStatus }>(
        `${trackerUrl}/tasks/${encodeURIComponent(task.id)}/${endpoint}`,
        body,
      );
      onUpdated({
        status: response.status,
        ...(endpoint === "complete"
          ? { result }
          : endpoint === "cancel"
            ? { cancelReason: reason || null }
            : {}),
      });
      clear();
    });
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const response = await api<{ status: TaskStatus; description: string }>(
        `${trackerUrl}/tasks/${encodeURIComponent(task.id)}`,
        {
          platform: task.platform,
          conversationId: task.conversationId,
          message,
          description,
        },
      );
      onUpdated({ status: response.status, description: response.description });
      setMessage("");
    });
  };
  return (
    <fieldset disabled={busy}>
      <form onSubmit={send}>
        <label htmlFor="updated-description">Current task description</label>
        <textarea
          id="updated-description"
          required
          maxLength={20000}
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          required
          maxLength={4000}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button>Send message</button>
      </form>
      <form
        onSubmit={(e) => submit(e, "complete", { result }, () => setResult(""))}
      >
        <label htmlFor="result">Completion result</label>
        <textarea
          id="result"
          required
          maxLength={4000}
          rows={2}
          value={result}
          onChange={(e) => setResult(e.target.value)}
        />
        <button>Complete task</button>
      </form>
      <form
        onSubmit={(e) =>
          submit(e, "cancel", reason ? { reason } : {}, () => setReason(""))
        }
      >
        <label htmlFor="reason">Cancellation reason (optional)</label>
        <input
          id="reason"
          maxLength={4000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="danger">Cancel task</button>
      </form>
    </fieldset>
  );
}
