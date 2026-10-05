import type { MessageEvent } from "../../events.ts";
import { Message } from "./Message.tsx";

export function ReplyInbox({ events }: { events: MessageEvent[] }) {
  const replies = events
    .filter((event) => event.direction === "received")
    .slice()
    .reverse();
  return (
    <section>
      <h2>Reply inbox</h2>
      <p>Replies arrive live from the task tracker.</p>
      {replies.map((event) => (
        <Message
          key={event.id}
          metadata={`${event.sender} · ${new Date(event.timestamp).toLocaleString()}`}
        >
          {event.message}
        </Message>
      ))}
      {replies.length === 0 && <p className="empty">Waiting for replies.</p>}
    </section>
  );
}
