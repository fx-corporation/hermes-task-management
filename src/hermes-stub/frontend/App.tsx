import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Conversation, MessagingTask, Platform, TaskStatus } from "../../task-tracker/domain.ts";
import { api } from "./api.ts";

import type { MessageEvent } from "../events.ts";
type RunAction = (work: () => Promise<void>) => Promise<void>;
const tracker = "/api/tracker";

function Message({ metadata, children }: { metadata: string; children: ReactNode }) {
  return <div className="message"><div className="meta">{metadata}</div>{children}</div>;
}

function NewTask({ busy, run, onCreated }: { busy: boolean; run: RunAction; onCreated: (task: MessagingTask) => void }) {
  const [platform, setPlatform] = useState<Platform>("waha");
  const [contacts, setContacts] = useState<Conversation[]>([]);
  const [contact, setContact] = useState("");
  const [title, setTitle] = useState("");
  const [session, setSession] = useState(() => `stub-session-${crypto.randomUUID()}`);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setContacts([]); setContact("");
    api<{ conversations: Conversation[] }>(`${tracker}/conversations?platform=${platform}`, undefined, controller.signal)
      .then(data => { setContacts(data.conversations); setContact(data.conversations[0]?.conversationId ?? ""); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [platform, revision]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { task } = await api<{ task: MessagingTask }>(`${tracker}/tasks`, { platform, conversationId: contact, title, hermesSessionId: session });
      setTitle(""); onCreated(task);
    });
  };
  return <section><h2>New task</h2><form onSubmit={submit}><fieldset disabled={busy}>
    <label htmlFor="platform">Messaging platform</label><select id="platform" value={platform} onChange={e => setPlatform(e.target.value as Platform)}><option value="waha">WhatsApp (WAHA)</option><option value="stub">Local messaging stub</option></select>
    <label htmlFor="contact">Contact</label><select id="contact" required value={contact} onChange={e => setContact(e.target.value)} disabled={loading}><option value="">{loading ? "Loading contacts…" : "Choose a contact"}</option>{contacts.map(c => <option key={c.conversationId} value={c.conversationId}>{c.displayName} ({c.conversationId})</option>)}</select>
    <button type="button" className="secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh contacts</button>
    {error && <p role="alert" className="error">{error}</p>}
    <label htmlFor="title">Task title</label><input id="title" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} />
    <label htmlFor="session">Hermes session</label><input id="session" required maxLength={200} value={session} onChange={e => setSession(e.target.value)} />
    <button disabled={loading || !contact}>Create task</button>
  </fieldset></form></section>;
}

function TaskControls({ task, busy, run, onUpdated }: { task: MessagingTask; busy: boolean; run: RunAction; onUpdated: (patch: Partial<MessagingTask>) => void }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent, endpoint: string, body: unknown, clear: () => void) => {
    event.preventDefault();
    void run(async () => {
      const response = await api<{ status: TaskStatus }>(`${tracker}/tasks/${encodeURIComponent(task.id)}/${endpoint}`, body);
      onUpdated({ status: response.status, ...(endpoint === "complete" ? { result } : endpoint === "cancel" ? { cancelReason: reason || null } : {}) });
      clear();
    });
  };
  return <fieldset disabled={busy}>
    <form onSubmit={e => submit(e, "send", { message }, () => setMessage(""))}><label htmlFor="message">Message</label><textarea id="message" required maxLength={4000} rows={3} value={message} onChange={e => setMessage(e.target.value)} /><button>Send message</button></form>
    <form onSubmit={e => submit(e, "complete", { result }, () => setResult(""))}><label htmlFor="result">Completion result</label><textarea id="result" required maxLength={4000} rows={2} value={result} onChange={e => setResult(e.target.value)} /><button>Complete task</button></form>
    <form onSubmit={e => submit(e, "cancel", reason ? { reason } : {}, () => setReason(""))}><label htmlFor="reason">Cancellation reason (optional)</label><input id="reason" maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /><button className="danger">Cancel task</button></form>
  </fieldset>;
}

export function App() {
  const [tasks, setTasks] = useState<MessagingTask[]>([]);
  const [events, setEvents] = useState<MessageEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const task = tasks.find(t => t.id === selected);
  const refresh = async (signal?: AbortSignal) => {
    const list = await api<{ tasks: MessagingTask[] }>(`${tracker}/tasks`, undefined, signal);
    setTasks(list.tasks);
  };
  const run: RunAction = async work => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load tasks.");
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.addEventListener("snapshot", event => setEvents(JSON.parse((event as globalThis.MessageEvent).data)));
    source.addEventListener("message", event => {
      const incoming = JSON.parse((event as globalThis.MessageEvent).data) as MessageEvent;
      setEvents(previous => previous.some(e => e.id === incoming.id) ? previous : [...previous, incoming]);
      if (incoming.direction === "received") {
        setTasks(previous => previous.map(task =>
          task.status === "WAITING_EXTERNAL_REPLY" && (incoming.taskId ? task.id === incoming.taskId : task.hermesSessionId === incoming.sessionId)
            ? { ...task, status: "ACTIVE" } : task));
      }
    });
    return () => source.close();
  }, []);
  const conversation = task ? events.filter(e => e.taskId === task.id || (!e.taskId && e.sessionId === task.hermesSessionId)) : [];
  return <><h1>Hermes task console</h1><p>Create tasks, message WhatsApp contacts, and follow their replies.</p><div className="error" role="status" aria-live="polite">{error}</div>
    <main><div><NewTask busy={busy} run={run} onCreated={t => { setTasks(old => [t, ...old]); setSelected(t.id); }} />
      <section><h2>Tasks</h2><button disabled={busy} className="secondary" onClick={() => void run(refresh)}>Refresh tasks</button>{tasks.length === 0 && <p className="empty">No tasks yet.</p>}{tasks.map(t => <button key={t.id} disabled={busy} className={`task ${selected === t.id ? "selected" : ""}`} onClick={() => setSelected(t.id)}>{t.title} · {t.status}</button>)}</section></div>
      <div><section><h2>{task?.title ?? "Select a task"}</h2>{task && <><p className="badge">{task.status} · {task.conversationId}</p>{!["COMPLETED", "CANCELLED"].includes(task.status) && <TaskControls key={task.id} task={task} busy={busy} run={run} onUpdated={patch => setTasks(previous => previous.map(t => t.id === task.id ? { ...t, ...patch } : t))} />}{task.result && <p>Result: {task.result}</p>}{task.cancelReason && <p>Cancelled: {task.cancelReason}</p>}</>}<h3>Conversation</h3>{conversation.map(e => <Message key={e.id} metadata={`${e.direction === "sent" ? "Sent" : "Received"} · ${new Date(e.timestamp).toLocaleString()}`}>{e.message}</Message>)}{conversation.length === 0 && <p className="empty">No messages yet.</p>}</section>
      <section><h2>Reply inbox</h2><p>Replies arrive live from the task tracker.</p>{events.filter(e => e.direction === "received").slice().reverse().map(e => <Message key={e.id} metadata={`${e.sender} · ${new Date(e.timestamp).toLocaleString()}`}>{e.message}</Message>)}{!events.some(e => e.direction === "received") && <p className="empty">Waiting for replies.</p>}</section></div>
    </main></>;
}
