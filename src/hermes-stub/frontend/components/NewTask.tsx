import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { Conversation } from "../../../task-tracker/domain/conversation.ts";
import type { MessagingTask } from "../../../task-tracker/domain/messaging-task.ts";
import type { Platform } from "../../../task-tracker/domain/platform.ts";
import { api } from "../api.ts";
import type { RunAction } from "../run-action.ts";
import { trackerUrl } from "../tracker-url.ts";

export function NewTask({
  busy,
  run,
  onCreated,
}: {
  busy: boolean;
  run: RunAction;
  onCreated: (task: MessagingTask) => void;
}) {
  const [platform, setPlatform] = useState<Platform>("waha");
  const [contacts, setContacts] = useState<Conversation[]>([]);
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [session, setSession] = useState(
    () => `stub-session-${crypto.randomUUID()}`,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setContacts([]);
    setContact("");
    api<{ conversations: Conversation[] }>(
      `${trackerUrl}/conversations?platform=${platform}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        setContacts(data.conversations);
        setContact(data.conversations[0]?.conversationId ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [platform, revision]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { task } = await api<{ task: MessagingTask }>(
        `${trackerUrl}/tasks`,
        {
          platform,
          conversationId: contact,
          description,
          hermesSessionId: session,
        },
      );
      setDescription("");
      onCreated(task);
    });
  };
  return (
    <section>
      <h2>New task</h2>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label htmlFor="platform">Messaging platform</label>
          <select
            id="platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            <option value="waha">WhatsApp (WAHA)</option>
            <option value="stub">Local messaging stub</option>
          </select>
          <label htmlFor="contact">Contact</label>
          <select
            id="contact"
            required
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            disabled={loading}
          >
            <option value="">
              {loading ? "Loading contacts…" : "Choose a contact"}
            </option>
            {contacts.map((c) => (
              <option key={c.conversationId} value={c.conversationId}>
                {c.displayName} ({c.conversationId})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh contacts
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <label htmlFor="description">Task description</label>
          <textarea
            id="description"
            required
            maxLength={20000}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label htmlFor="session">Hermes session</label>
          <input
            id="session"
            required
            maxLength={200}
            value={session}
            onChange={(e) => setSession(e.target.value)}
          />
          <button disabled={loading || !contact}>Create task</button>
        </fieldset>
      </form>
    </section>
  );
}
