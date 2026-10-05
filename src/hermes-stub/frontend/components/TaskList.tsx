import type { MessagingTask } from "../../../task-tracker/domain/messaging-task.ts";

export function TaskList({
  tasks,
  selected,
  busy,
  onSelect,
  onRefresh,
}: {
  tasks: MessagingTask[];
  selected: string | null;
  busy: boolean;
  onSelect: (taskId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section>
      <h2>Tasks</h2>
      <button disabled={busy} className="secondary" onClick={onRefresh}>
        Refresh tasks
      </button>
      {tasks.length === 0 && <p className="empty">No tasks yet.</p>}
      {tasks.map((task) => (
        <button
          key={task.id}
          disabled={busy}
          className={`task ${selected === task.id ? "selected" : ""}`}
          onClick={() => onSelect(task.id)}
        >
          {task.description.slice(0, 120)}
          {task.description.length > 120 ? "…" : ""} · {task.status}
        </button>
      ))}
    </section>
  );
}
