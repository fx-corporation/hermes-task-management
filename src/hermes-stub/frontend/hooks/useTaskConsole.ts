import { useEffect, useRef, useState } from "react";
import type { MessagingTask } from "../../../task-tracker/domain/messaging-task.ts";
import type { MessageEvent } from "../../events.ts";
import { api } from "../api.ts";
import type { RunAction } from "../run-action.ts";
import { trackerUrl } from "../tracker-url.ts";

export function useTaskConsole() {
  const [tasks, setTasks] = useState<MessagingTask[]>([]);
  const [events, setEvents] = useState<MessageEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const task = tasks.find((t) => t.id === selected);
  const refresh = async (signal?: AbortSignal) => {
    const list = await api<{ tasks: MessagingTask[] }>(
      `${trackerUrl}/tasks`,
      undefined,
      signal,
    );
    setTasks(list.tasks);
  };
  const run: RunAction = async (work) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((e) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load tasks.");
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.addEventListener("snapshot", (event) =>
      setEvents(JSON.parse((event as globalThis.MessageEvent).data)),
    );
    source.addEventListener("message", (event) => {
      const incoming = JSON.parse(
        (event as globalThis.MessageEvent).data,
      ) as MessageEvent;
      setEvents((previous) =>
        previous.some((e) => e.id === incoming.id)
          ? previous
          : [...previous, incoming],
      );
      if (incoming.direction === "received") {
        setTasks((previous) =>
          previous.map((task) =>
            task.status === "WAITING_EXTERNAL_REPLY" &&
            (incoming.taskId
              ? task.id === incoming.taskId
              : task.hermesSessionId === incoming.sessionId)
              ? { ...task, status: "ACTIVE" }
              : task,
          ),
        );
      }
    });
    return () => source.close();
  }, []);
  const conversation = task
    ? events.filter(
        (e) =>
          e.taskId === task.id ||
          (!e.taskId && e.sessionId === task.hermesSessionId),
      )
    : [];

  const addTask = (created: MessagingTask) => {
    setTasks((previous) => [created, ...previous]);
    setSelected(created.id);
  };
  const updateTask = (patch: Partial<MessagingTask>) => {
    if (!task) return;
    setTasks((previous) =>
      previous.map((existing) =>
        existing.id === task.id ? { ...existing, ...patch } : existing,
      ),
    );
  };
  return {
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
  };
}
