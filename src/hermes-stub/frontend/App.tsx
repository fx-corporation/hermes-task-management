import { NewTask } from "./components/NewTask.tsx";
import { ReplyInbox } from "./components/ReplyInbox.tsx";
import { TaskDetails } from "./components/TaskDetails.tsx";
import { TaskList } from "./components/TaskList.tsx";
import { TaskSelection } from "./components/TaskSelection.tsx";
import { useTaskConsole } from "./hooks/useTaskConsole.ts";

export function App() {
  const {
    tasks,
    events,
    selected,
    setSelected,
    task,
    conversation,
    busy,
    error,
    run,
    refresh,
    addTask,
    updateTask,
  } = useTaskConsole();
  return (
    <>
      <h1>Hermes task console</h1>
      <p>Create tasks, message WhatsApp contacts, and follow their replies.</p>
      <div className="error" role="status" aria-live="polite">
        {error}
      </div>
      <main>
        <div>
          <NewTask busy={busy} run={run} onCreated={addTask} />
          <TaskList
            tasks={tasks}
            selected={selected}
            busy={busy}
            onSelect={setSelected}
            onRefresh={() => void run(refresh)}
          />
        </div>
        <div>
          <TaskDetails
            task={task}
            conversation={conversation}
            busy={busy}
            run={run}
            onUpdated={updateTask}
          />
          <TaskSelection busy={busy} run={run} />
          <ReplyInbox events={events} />
        </div>
      </main>
    </>
  );
}
