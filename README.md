# Hermes Task Management API

A small Express 5 API written in TypeScript for managing one delegated messaging task per contact. The server runs on Bun with Express routing and middleware, an in-memory task registry, a registry containing both stub and WAHA messaging adapters, and an HTTP Hermes session receiver. Stub tasks send no external messages; WAHA tasks send real WhatsApp messages.

## Requirements and start

Install [Bun](https://bun.sh/docs/installation), then install dependencies and set the local bearer tokens:

```sh
bun install
export MESSAGING_TASK_API_TOKEN='local-api-secret'
export STUB_WEBHOOK_TOKEN='local-webhook-secret'
export HERMES_BASE_URL='http://127.0.0.1:8643'
export HERMES_API_KEY='hermes-stub-development-key'
bun run dev
```

Run `bun run dev:hermes-stub` in a separate terminal before starting the app. The stub is a standalone service on `127.0.0.1:8643`; set `HERMES_STUB_PORT` and `HERMES_STUB_HOST` to change its bind address. `bun run dev` starts only the task tracker, using the configured Hermes URL and key. To use a real gateway, set those variables to its URL and credentials.

The stub logs every request (method, URL, headers, and complete body), including health checks, rejected requests, and retries. Session chat requests receive HTTP 200 with a simulated assistant response. The development stub caches repeated idempotency keys per session. It performs no agent reasoning and stores idempotency records only in memory.

The server listens on `http://127.0.0.1:9005`. Set `PORT` to change the port. Bun's `--watch` mode restarts the server during development. Run `bun run build` to bundle the Express server into `dist/server.js`, then `bun dist/server.js` to run the bundle. Run `bun run typecheck` and `bun run test` to check the implementation.

`GET /health` is public. Every other endpoint uses `Authorization: Bearer …`; task, contact, and simulation endpoints require `MESSAGING_TASK_API_TOKEN`, and `POST /webhooks/stub` requires the separate `STUB_WEBHOOK_TOKEN`.

## Walkthrough

The server starts with two fictional contacts: Example Dental (`+12025550101`) and Sample Plumbing (`+12025550102`). Stub contacts use canonical phone numbers (`+` followed by 8–15 digits). WAHA contacts use numeric LIDs ending in `@lid`. Encode `+` as `%2B` when it appears in a URL path.

```sh
API=http://127.0.0.1:9005
AUTH="Authorization: Bearer $MESSAGING_TASK_API_TOKEN"

# Find a contact.
curl -H "$AUTH" "$API/conversations?platform=stub&search=dental"

# Create a task with the existing Hermes session to receive replies.
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

# Inspect sent messages, received replies, and the Hermes delivery envelope.
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

Responses use `{ "success": true, ... }`; failures use `{ "success": false, "error": { "code": "...", "message": "..." } }`. Task statuses are `ACTIVE`, `WAITING_EXTERNAL_REPLY`, `COMPLETED`, and `CANCELLED`. Only one open task can own a platform/contact pair. A delivered external reply changes a waiting task back to `ACTIVE`; closed tasks do not receive later replies. Repeated webhook IDs return the original event outcome without duplicating actions or delivery.

## V1 boundary

All state, including contacts added at runtime, tasks, actions, and deduplication keys, is held in memory and disappears on restart. The running server sends replies to Hermes over HTTP. Programmatic `createApplication` calls also default to `HttpHermesAdapter`, using the Hermes environment variables. Supply `hermesOptions` for explicit HTTP configuration or `hermes` to inject an adapter for tests.

## Docker

The [task tracker Dockerfile](src/task-tracker/Dockerfile) uses the [official Bun image](https://bun.sh/guides/ecosystem/docker), runs typechecking and tests during the build, and bundles the server into a runtime image that runs as the `bun` user.

Set `MESSAGING_TASK_API_TOKEN` and `STUB_WEBHOOK_TOKEN` in the root `.env` file or export them in your shell, then start the app and its standalone Hermes stub:

```sh
docker compose up -d --build task-tracker
curl http://127.0.0.1:9005/health
```

Compose builds the stub from [its Dockerfile](src/hermes-stub/Dockerfile), waits for its health check, and connects the task tracker to `http://hermes-stub:8643` by default. View all stub requests with `docker compose logs -f hermes-stub`. Set `HERMES_BASE_URL` and `HERMES_API_KEY` in the root `.env` to target a real Hermes gateway instead.

Run `docker compose up -d --build` to start the app, Hermes stub, and existing WAHA service. WAHA uses its own `.waha/.env` configuration. The app defaults to stub mode. To connect it to WAHA, use the configuration below. Container restarts discard its in-memory state.

Inside Docker, the app listens on `0.0.0.0:9005`; Compose publishes it on host port 9005. The Hermes stub is published on loopback port 8643. For local startup, `HOST` can override the default `127.0.0.1` bind address.

## WAHA adapter

Configure WAHA with these variables in the root `.env` file (or export them for local startup):

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
  "url": "http://task-tracker:9005/webhooks/waha",
  "events": ["message"],
  "hmac": { "key": "your-webhook-secret" }
}
```

Use a URL reachable from WAHA when running outside Compose. The adapter verifies `X-Webhook-Hmac` using SHA-512 over the exact request body, following the [WAHA events documentation](https://waha.devlike.pro/docs/how-to/events/). Alternatively, omit `WAHA_WEBHOOK_HMAC_KEY`, set `WAHA_WEBHOOK_TOKEN`, and configure WAHA's `customHeaders` to send `Authorization: Bearer your-webhook-token`. When HMAC is configured, a valid signature is required.

Call `GET /conversations?platform=waha` to discover contacts before creating tasks. Use `platform: "waha"` and the discovered `conversationId` ending in `@lid` when creating a task; the existing send, complete, cancel, and actions endpoints work with WAHA. The adapter retrieves [WAHA contacts](https://waha.devlike.pro/docs/how-to/contacts/) and sends messages through [POST /api/sendText](https://waha.devlike.pro/docs/how-to/send-messages/).

Inbound `message` and `message.any` events share deduplication by provider message ID. Outgoing messages, other sessions, groups, unmapped phone identifiers, empty text, and unrelated events return `IGNORED_EVENT`. WAHA tasks are keyed by LID and sent directly using that LID; media downloads and group messaging are not implemented. Incoming text or media captions use the normal task reply flow. Stub simulation endpoints remain available alongside WAHA.

Contacts, task state, message history, and deduplication remain in memory. A successful send means WAHA accepted the API request; it does not confirm WhatsApp delivery. Provider requests time out after 15 seconds and are not automatically retried, since retrying a send may duplicate a message.

## Request logs

Every request logs its method, full URL, timestamp, and generated request ID to the console as soon as it arrives. A matching response log includes the status, elapsed milliseconds, and response body, including authentication and validation failures. Webhook requests also produce an `HTTP webhook payload` log with the same request ID and the received JSON payload before authentication and event filtering; malformed JSON is logged as raw text.

Rebuild the app and follow its logs to check webhook arrivals:

```sh
docker compose up -d --build task-tracker
docker compose logs -f task-tracker
```

## Hermes delivery

Enable the [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) and set `HERMES_API_KEY` to its `API_SERVER_KEY`. `HttpHermesAdapter` sends authenticated HTTP requests to the session-chat endpoint. `HERMES_BASE_URL` defaults to the local stub at `http://127.0.0.1:8643`; set it to `http://127.0.0.1:8642` for a local real Hermes gateway. In Docker, use `http://host.docker.internal:8642` for a host gateway reachable from the container. Compose sets it to `http://hermes-stub:8643` for the standalone stub. Server startup requires the key.

Replies are normalized by their receiving platform adapter. The tracker finds the open task by `(platform, conversationId)`, reads its `hermesSessionId`, and sends `POST /api/sessions/{id}/chat` with `{ "message": "<untrusted-content envelope>" }`. The ID is URL-encoded. Use an existing Hermes session; unknown sessions fail with HTTP 404. Session chat runs a synchronous agent turn using existing history. `DELIVERED` and `HERMES_DELIVERED` are recorded after a valid session chat completion, not after creating an asynchronous run.

`HERMES_MAX_RETRIES` is a non-negative integer, default `3`: one initial attempt plus up to three retries. Set `0` to disable retries. Network errors, request timeouts, HTTP 408/429, and HTTP 5xx are retried with delays of 1, 2, and 4 seconds by default. Other HTTP errors fail immediately. Set `HERMES_TIMEOUT_MS` to a positive integer (default `120000`) for each synchronous chat request. Every attempt uses the same idempotency key and payload; the development stub deduplicates it, but native Hermes session chat does not document the Runs API idempotency guarantee. A retry after an ambiguous failure or timeout may repeat the agent turn. Exhausted deliveries return HTTP 502 and record `DELIVERY_FAILED`; the task remains waiting. Duplicate webhooks retain the recorded outcome and do not start a fresh retry cycle. There is no persistent background retry queue.

## Source layout

`src/task-tracker/` contains the task management API, storage, and messaging adapters. `src/hermes-stub/` contains the standalone development Hermes service. Each service has its own Dockerfile; Compose runs them separately using the repository root as build context.

## Hermes stub UI

Open `http://localhost:8643` after `docker compose up -d --build`. Configure `WAHA_API_KEY` and webhook credentials in `.env`, then pair the WAHA session. Point its webhook to `http://task-tracker:9005/webhooks/waha`. The task tracker finds the task for that platform/contact and delivers the reply to the stub's `/api/sessions/{id}/chat` endpoint. This callback records the message and pushes it to the React UI over `/api/events/stream` (Server-Sent Events). The UI never fetches conversation history from the task tracker. The existing stub `/webhooks/waha` relay remains available, but reply display depends on the task tracker's callback, so only replies delivered to a bound Hermes session appear.

Choose WhatsApp, refresh contacts, enter a title and session ID, and create a task. Select a task to send a message through the task tracker and WAHA. Successful sends and callback replies form the conversation shown in the UI; callbacks also appear in the reply inbox. Tasks load once when the UI opens. Successful create/send/complete/cancel actions and live reply callbacks update task state locally. Use Refresh tasks to request a manual reload; there is no task-list polling. Complete with a result, or cancel with an optional reason. The local messaging stub supports the existing simulation API and delivers callbacks through the same path. Message snapshots on SSE connection/reconnection restore the stub's in-memory history; idempotent callbacks appear once.


For separate local processes, configure `TASK_TRACKER_BASE_URL` (default `http://127.0.0.1:9005`) and `MESSAGING_TASK_API_TOKEN` for the Hermes stub. Compose supplies the internal tracker URL and loads the token from `.env`. The token stays on the server. The UI is a local development console without its own login. Inbox and run state disappear on restart; a live paired WAHA session is required for real WhatsApp messages.

## Frontend development

The Hermes stub UI uses React with TypeScript and Vite. Components and styles live in `src/hermes-stub/frontend/`; the HTTP API remains in `src/hermes-stub/server.ts`. `bun run build:hermes-ui` builds browser assets into `dist/hermes-stub/ui`. The standalone stub serves those assets and logs asset requests alongside API requests. Its Docker image includes the built UI.

`bun run dev:hermes-stub` builds the UI and starts the stub API on port 8643. For frontend hot reload, also run `bun run dev:hermes-ui` and open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api` to the stub on `HERMES_STUB_PORT` (default 8643), so tracker credentials stay server-side. Rebuild the UI to update the version served on port 8643. `HERMES_STUB_UI_DIR` can override the asset directory.

`bun run test` builds the UI before running API and React interaction tests. If invoking `bun test` directly, first run `bun run build:hermes-ui`.

## Platform registration

Both built-in adapters (`stub` and `waha`) are always registered. Choose `platform` on task creation, contact discovery, and action history. Sends use the task's platform; `/webhooks/stub` and `/webhooks/waha` normalize and route independently. Each platform/contact identifier can have one open task, bound to its own Hermes session. Message IDs and history are isolated by platform.

`MESSAGING_PLATFORM` now only chooses the default for contact/history queries that omit `platform`; it does not disable other adapters. WAHA requires `WAHA_API_KEY` for discovery and sending; without it, those operations return `503 WAHA_NOT_CONFIGURED`. Configure `STUB_WEBHOOK_TOKEN` for stub webhooks and either `WAHA_WEBHOOK_TOKEN` or `WAHA_WEBHOOK_HMAC_KEY` for WAHA webhooks. Missing webhook credentials never authorize an empty bearer token. Programmatic applications can supply adapters through `platforms` and per-platform tokens through `webhookTokens`.

## WAHA conversation identifiers

WAHA uses LIDs such as `123456789@lid` as `conversationId` for task creation, task filters, action history, sends, and inbound reply lookup. Contact discovery accepts native LID contacts and maps phone-based contacts using WAHA's [phone-to-LID endpoint](https://waha.devlike.pro/docs/how-to/contacts/#get-lid-by-phone-number). Unmapped contacts are skipped. Incoming LID messages also register the contact for subsequent discovery. Phone-addressed replies can use a mapping already obtained during discovery; no LID-to-phone lookup is needed.

Stub tasks retain their existing phone-number identifiers. Recreate any existing WAHA tasks using the contact's LID. `WAHA_SESSION` must still match the webhook session exactly.
