import type { MessagingTask } from "../../../task-tracker/domain/messaging-task.ts";
import type { MessageEvent } from "../../events.ts";
import type { RunAction } from "../run-action.ts";
import { Message } from "./Message.tsx";
import { TaskControls } from "./TaskControls.tsx";

export function TaskDetails({
  task,
  conversation,
  busy,
  run,
  onUpdated,
}: {
  task?: MessagingTask;
  conversation: MessageEvent[];
  busy: boolean;
  run: RunAction;
  onUpdated: (patch: Partial<MessagingTask>) => void;
}) {
  return (
    <section>
      <h2>{task?.description ?? "Select a task"}</h2>
      {task && (
        <>
          <p className="badge">
            {task.status} · {task.conversationId}
          </p>
          {!["COMPLETED", "CANCELLED"].includes(task.status) && (
            <TaskControls
              key={task.id}
              task={task}
              busy={busy}
              run={run}
              onUpdated={onUpdated}
            />
          )}
          {task.result && <p>Result: {task.result}</p>}
          {task.cancelReason && <p>Cancelled: {task.cancelReason}</p>}
        </>
      )}
      <h3>Conversation</h3>
      {conversation.map((event) => (
        <Message
          key={event.id}
          metadata={`${event.direction === "sent" ? "Sent" : "Received"} · ${new Date(event.timestamp).toLocaleString()}`}
        >
          {event.message}
        </Message>
      ))}
      {conversation.length === 0 && <p className="empty">No messages yet.</p>}
    </section>
  );
}
