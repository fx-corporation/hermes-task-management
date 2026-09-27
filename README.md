# Hermes Task Management API

A small Express 5 API written in TypeScript for managing one delegated messaging task per contact. The server runs on Bun with Express routing and middleware, an in-memory task registry, a selectable stub or WAHA messaging platform, and a simulated Hermes session receiver. Stub mode sends no external messages; WAHA mode sends real WhatsApp messages.

## Requirements and start

Install [Bun](https://bun.sh/docs/installation), then install dependencies and set two local bearer tokens:

```sh
bun install
export MESSAGING_TASK_API_TOKEN='local-api-secret'
export STUB_WEBHOOK_TOKEN='local-webhook-secret'
bun run dev
```

The server listens on `http://127.0.0.1:9005`. Set `PORT` to change the port. Bun's `--watch` mode restarts the server during development. Run `bun run build` to bundle the Express server into `dist/server.js`, then `bun dist/server.js` to run the bundle. Run `bun run typecheck` and `bun test` to check the implementation.

`GET /health` is public. Every other endpoint uses `Authorization: Bearer …`; task, contact, and simulation endpoints require `MESSAGING_TASK_API_TOKEN`, and `POST /webhooks/stub` requires the separate `STUB_WEBHOOK_TOKEN`.

## Walkthrough

The server starts with two fictional contacts: Example Dental (`+12025550101`) and Sample Plumbing (`+12025550102`). Phone numbers use canonical `+` followed by 8–15 digits. Encode `+` as `%2B` when it appears in a URL path.

```sh
API=http://127.0.0.1:9005
AUTH="Authorization: Bearer $MESSAGING_TASK_API_TOKEN"

# Find a contact.
curl -H "$AUTH" "$API/conversations?platform=stub&search=dental"

# Create a task with the exact Hermes session to receive simulated replies.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"hermesSessionId":"session_demo_1","platform":"stub","conversationId":"+12025550101","title":"Book a dental appointment"}' \
  "$API/tasks"

# Use the returned task ID to send a message. The destination comes from that task.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"message":"Do you have an appointment Tuesday at 3:30 PM?"}' \
  "$API/tasks/TASK_ID/send"

# Simulate an external contact reply; externalMessageId is generated when omitted.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"message":"Tuesday at 3:30 PM is available."}' \
  "$API/stub/conversations/%2B12025550101/reply"

# Inspect sent messages, received replies, and the simulated Hermes delivery envelope.
curl -H "$AUTH" "$API/conversations/%2B12025550101/actions?platform=stub"

# Finish the task using the returned task ID.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"result":"Appointment confirmed for Tuesday at 3:30 PM."}' \
  "$API/tasks/TASK_ID/complete"
```

For a provider-style webhook, use `STUB_WEBHOOK_TOKEN` and include a unique provider ID:

```sh
curl -X POST -H "Authorization: Bearer $STUB_WEBHOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"+12025550101","externalMessageId":"provider-event-123","message":"Confirmed."}' \
  "$API/webhooks/stub"
```

## Endpoints

- `GET /conversations?platform=stub&search=...` lists contacts by name or number.
- `POST /stub/conversations` accepts `{ "conversationId": "+12025550103", "displayName": "Example Contact" }` to add a contact.
- `POST /tasks` accepts `hermesSessionId`, `platform`, `conversationId`, and `title`.
- `GET /tasks` supports `status`, `platform`, `conversationId`, and `hermesSessionId` filters; `GET /tasks/{taskId}` gets one task.
- `POST /tasks/{taskId}/send` accepts only `{ "message": "..." }`.
- `POST /tasks/{taskId}/complete` accepts `{ "result": "..." }`; `POST /tasks/{taskId}/cancel` accepts an optional `{ "reason": "..." }`.
- `POST /stub/conversations/{conversationId}/reply` accepts `{ "message": "...", "externalMessageId": "optional-id" }`.
- `POST /webhooks/stub` accepts `{ "conversationId": "...", "externalMessageId": "...", "message": "..." }`.
- `GET /conversations/{conversationId}/actions?platform=stub` lists chronological conversation actions.

Request bodies are limited to 1 MB; compressed request bodies are unsupported so WAHA signatures are checked against the exact received bytes.

Responses use `{ "success": true, ... }`; failures use `{ "success": false, "error": { "code": "...", "message": "..." } }`. Task statuses are `ACTIVE`, `WAITING_EXTERNAL_REPLY`, `COMPLETED`, and `CANCELLED`. Only one open task can own a platform/contact pair. A delivered simulated external reply changes a waiting task back to `ACTIVE`; closed tasks do not receive later replies. Repeated webhook IDs return the original event outcome without duplicating actions or delivery.

## V1 boundary

All state, including contacts added at runtime, tasks, actions, and deduplication keys, is held in memory and disappears on restart. The Hermes adapter only records the explicit session ID and an envelope that marks external text as untrusted; it does not call Hermes or perform reasoning. See [plan.md](plan.md) for production requirements and deferred work.

## Docker

The [Dockerfile](Dockerfile) uses the [official Bun image](https://bun.sh/guides/ecosystem/docker), runs typechecking and tests during the build, and bundles the server into a runtime image that runs as the `bun` user.

Set `MESSAGING_TASK_API_TOKEN` and `STUB_WEBHOOK_TOKEN` in the root `.env` file or export them in your shell, then start the app:

```sh
docker compose up -d --build hermes-task-management
curl http://127.0.0.1:9005/health
```

Run `docker compose up -d --build` to start both the app and the existing WAHA service. WAHA uses its own `.waha/.env` configuration. The app defaults to stub mode. To connect it to WAHA, use the configuration below. Container restarts discard its in-memory state.

Inside Docker, the app listens on `0.0.0.0:9005`; Compose publishes it on host loopback only. For local startup, `HOST` can override the default `127.0.0.1` bind address.

## WAHA adapter

Enable WAHA with these variables in the root `.env` file (or export them for local startup):

```sh
MESSAGING_PLATFORM=waha
MESSAGING_TASK_API_TOKEN=your-api-secret
WAHA_BASE_URL=http://localhost:3000
WAHA_API_KEY=your-waha-api-key
WAHA_SESSION=default
WAHA_WEBHOOK_HMAC_KEY=your-webhook-secret
```

In Docker, set `WAHA_BASE_URL=http://waha:3000`. `WAHA_API_KEY` must match the API key configured in WAHA's own `.waha/.env`. Start both services with `docker compose up -d --build`. Pair and start the selected WhatsApp session through WAHA's dashboard.

Configure that session's webhook in WAHA with this entry under `config.webhooks` (preserve its other settings):

```json
{
  "url": "http://hermes-task-management:9005/webhooks/waha",
  "events": ["message"],
  "hmac": { "key": "your-webhook-secret" }
}
```

Use a URL reachable from WAHA when running outside Compose. The adapter verifies `X-Webhook-Hmac` using SHA-512 over the exact request body, following the [WAHA events documentation](https://waha.devlike.pro/docs/how-to/events/). Alternatively, omit `WAHA_WEBHOOK_HMAC_KEY`, set `WAHA_WEBHOOK_TOKEN`, and configure WAHA's `customHeaders` to send `Authorization: Bearer your-webhook-token`. When HMAC is configured, a valid signature is required.

Call `GET /conversations?platform=waha` to discover contacts before creating tasks. Use `platform: "waha"` and a discovered canonical phone number when creating a task; the existing send, complete, cancel, and actions endpoints work with WAHA. The adapter retrieves [WAHA contacts](https://waha.devlike.pro/docs/how-to/contacts/) and sends messages through [POST /api/sendText](https://waha.devlike.pro/docs/how-to/send-messages/).

Inbound `message` and `message.any` events share deduplication by provider message ID. Outgoing messages, other sessions, groups, unresolvable `@lid` identifiers, empty text, and unrelated events return `IGNORED_EVENT`. Only direct phone-number contacts are supported; media downloads and group messaging are not implemented. Incoming text or media captions use the normal task reply flow. Stub simulation endpoints are unavailable in WAHA mode.

Contacts, task state, message history, and deduplication remain in memory. Hermes delivery remains simulated. A successful send means WAHA accepted the API request; it does not confirm WhatsApp delivery. Provider requests time out after 15 seconds and are not automatically retried, since retrying a send may duplicate a message.

## Request logs

Every request logs its method, full URL, timestamp, and generated request ID to the console as soon as it arrives. A matching response log includes the status, elapsed milliseconds, and response body, including authentication and validation failures.

Rebuild the app and follow its logs to check webhook arrivals:

```sh
docker compose up -d --build hermes-task-management
docker compose logs -f hermes-task-management
```
