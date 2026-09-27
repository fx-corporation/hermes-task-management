export interface MessageEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  sender: string;
  message: string;
  timestamp: string;
  direction: "sent" | "received";
}

/** Decode the task tracker's envelope; arbitrary chat text remains intact. */
export function receivedMessage(sessionId: string, envelope: string): MessageEvent {
  const start = envelope.indexOf("<external-message>\n");
  const end = envelope.lastIndexOf("\n</external-message>\n\nContinue the existing delegated task");
  const header = start < 0 ? "" : envelope.slice(0, start);
  return {
    id: crypto.randomUUID(), sessionId,
    taskId: header.match(/^A new external message has been received for delegated messaging task (\S+)\.\n/)?.[1],
    sender: header.match(/\nSender: ([^\n]+)/)?.[1] ?? "Task tracker",
    message: start >= 0 && end > start ? envelope.slice(start + "<external-message>\n".length, end) : envelope,
    timestamp: new Date().toISOString(), direction: "received",
  };
}
