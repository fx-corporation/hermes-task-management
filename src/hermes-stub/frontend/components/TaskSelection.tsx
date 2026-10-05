import type { FormEvent } from "react";
import { useState } from "react";
import type { Platform } from "../../../task-tracker/domain/platform.ts";
import { api } from "../api.ts";
import type { RunAction } from "../run-action.ts";
import { trackerUrl } from "../tracker-url.ts";

export function TaskSelection({
  busy,
  run,
}: {
  busy: boolean;
  run: RunAction;
}) {
  const [platform, setPlatform] = useState<Platform>("waha");
  const [conversationId, setConversationId] = useState("");
  const [webhookMessage, setWebhookMessage] = useState("");
  const [taskIds, setTaskIds] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setConfirmation("");
    void run(async () => {
      const normalizedConversationId = conversationId.trim();
      const normalizedTaskIds = taskIds
        .split(/[\n,]/)
        .map((id) => id.trim())
        .filter(Boolean);
      if (!normalizedConversationId)
        throw new Error("Conversation ID is required.");
      if (!webhookMessage.trim())
        throw new Error("Original webhook message is required.");
      if (normalizedTaskIds.length === 0)
        throw new Error("At least one task ID is required.");
      if (new Set(normalizedTaskIds).size !== normalizedTaskIds.length)
        throw new Error("Task IDs must be unique.");
      await api(`${trackerUrl}/tasks/selection`, {
        webhookMessage,
        platform,
        conversationId: normalizedConversationId,
        taskIds: normalizedTaskIds,
      });
      setPlatform("waha");
      setConversationId("");
      setWebhookMessage("");
      setTaskIds("");
      setConfirmation(`Selection sent for ${normalizedTaskIds.join(", ")}.`);
    });
  };
  const clearConfirmation = () => setConfirmation("");
  return (
    <section>
      <h2>Task selection</h2>
      <p>
        Copy the platform, conversation ID, webhook message, and task IDs from
        the Hermes owner-review prompt.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label htmlFor="selection-platform">Platform</label>
          <select
            id="selection-platform"
            required
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value as Platform);
              clearConfirmation();
            }}
          >
            <option value="waha">WhatsApp (WAHA)</option>
            <option value="stub">Local messaging stub</option>
          </select>
          <label htmlFor="selection-conversation-id">Conversation ID</label>
          <input
            id="selection-conversation-id"
            required
            maxLength={200}
            value={conversationId}
            onChange={(e) => {
              setConversationId(e.target.value);
              clearConfirmation();
            }}
          />
          <label htmlFor="selection-webhook-message">
            Original webhook message
          </label>
          <textarea
            id="selection-webhook-message"
            required
            maxLength={20000}
            rows={4}
            value={webhookMessage}
            onChange={(e) => {
              setWebhookMessage(e.target.value);
              clearConfirmation();
            }}
          />
          <label htmlFor="selection-task-ids">Selected task IDs</label>
          <textarea
            id="selection-task-ids"
            required
            maxLength={20000}
            rows={4}
            placeholder="One ID per line or comma-separated"
            value={taskIds}
            onChange={(e) => {
              setTaskIds(e.target.value);
              clearConfirmation();
            }}
          />
          <button>Send task selection</button>
          {confirmation && (
            <p role="status" className="success">
              {confirmation}
            </p>
          )}
        </fieldset>
      </form>
    </section>
  );
}
