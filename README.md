# Hermes Task Management API

A small [Hono](https://hono.dev/) API written in TypeScript for managing multiple delegated messaging tasks per platform/contact pair. The server runs on Bun with Hono routing and middleware, an in-memory task registry, a registry containing both stub and WAHA messaging adapters, Ollama classification, and HTTP Hermes delivery. Each task has a Hermes-maintained description with its context and latest state. Stub tasks send no external messages; WAHA tasks send real WhatsApp messages.

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

Run `bun run dev:hermes-stub` in a separate terminal before starting the app. The stub uses Hono routing and is a standalone service on `127.0.0.1:8643`; set `HERMES_STUB_PORT` and `HERMES_STUB_HOST` to change its bind address. `bun run dev` starts only the task tracker, using the configured Hermes URL and key. To use a real gateway, set those variables to its URL and credentials.

The stub logs every request (method, URL, headers, and complete body), including health checks, rejected requests, and retries. Session chat requests receive HTTP 200 with a simulated assistant response. The development stub caches repeated idempotency keys per session. It performs no agent reasoning and stores idempotency records only in memory.

For multiple open tasks on one contact, the task tracker scores candidates through the OpenAI-compatible chat-completions API. Compose connects this classifier to the local Ollama ROCm service with `TASK_CLASSIFIER_MODEL` defaulting to `gemma4:e4b`; pull the model once after starting Compose. `TASK_CLASSIFIER_THRESHOLD` defaults to `0.80`. A single confident match receives the reply directly; multiple matches, no confident match, or a model error starts an owner review session in Hermes.

The server listens on `http://127.0.0.1:9005`. Set `PORT` to change the port. Bun's `--watch` mode restarts the server during development. Run `bun run build` to bundle the Hono server into `dist/server.js`, then `bun dist/server.js` to run the bundle. Run `bun run typecheck` and `bun run test` to check the implementation.

Programmatic callers can pass Web `Request` objects to `createApplication(options).app.fetch(request)` or `createHermesStubApplication(options).fetch(request)`. `startServer()` and `startHermesStub()` use `Bun.serve`; their server instances expose `url` and `stop()` for address discovery and shutdown.

`GET /health` is public. Every other endpoint uses `Authorization: Bearer …`; task, contact, and simulation endpoints require `MESSAGING_TASK_API_TOKEN`, and `POST /webhooks/stub` requires the separate `STUB_WEBHOOK_TOKEN`.

## Source layout

Task-tracker definitions use one file per class or interface and are grouped by responsibility:

| Folder under `src/task-tracker/` | Contents |
| --- | --- |
| `domain/` | Tasks, conversations, inbound events, statuses, and domain helpers |
| `platforms/` | Messaging adapter interface and registry; implementations in `stub/` and `waha/` |
| `hermes/` | Hermes delivery types and HTTP/in-memory delivery adapters |
| `classification/` | Reply-routing classifiers, their inputs/options, and environment configuration |
| `services/` | Task lifecycle, inbound routing, and delivery results |
| `storage/` | In-memory conversations, tasks, events, and action history |
| `application/` | Application types, options, and service construction |
| `handlers/` | One handler file per HTTP endpoint |
| `http/` | Authentication, body parsing, validation, logging, and error responses |
| `errors/` | API error class and invalid-request helper |

`app.ts` wires routes and middleware; `server.ts` starts the service. Root export files such as `domain.ts`, `adapters.ts`, and `store.ts` preserve existing import paths.

## Walkthrough

The server starts with two fictional contacts: Example Dental (`+12025550101`) and Sample Plumbing (`+12025550102`). Stub contacts use canonical phone numbers (`+` followed by 8–15 digits). WAHA contacts use numeric LIDs ending in `@lid`. Encode `+` as `%2B` when it appears in a URL path.

```sh
API=http://127.0.0.1:9005
AUTH="Authorization: Bearer $MESSAGING_TASK_API_TOKEN"

# Find a contact.
curl -H "$AUTH" "$API/conversations?platform=stub&search=dental"

# Create a task with its context and latest state.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"hermesSessionId":"session_demo_1","platform":"stub","conversationId":"+12025550101","description":"Arrange a dental appointment. Latest state: no date confirmed."}' \
  "$API/tasks"

# Use the returned task ID to send a message and replace the latest task description.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"platform":"stub","conversationId":"+12025550101","message":"Do you have an appointment Tuesday at 3:30 PM?","description":"Arrange a dental appointment. Latest state: asked about Tuesday at 3:30 PM."}' \
  "$API/tasks/TASK_ID"

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

When Hermes asks the owner to choose task targets, it calls the tracker with the supplied reply and selected IDs:

```sh
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"webhookMessage":"Tuesday at 3 PM is available.","platform":"stub","conversationId":"+12025550101","taskIds":["TASK_ID_1","TASK_ID_2"]}' \
  "$API/tasks/selection"
```

## Endpoints

- `GET /conversations?platform=stub&search=...` lists contacts by name or number.
- `POST /stub/conversations` accepts `{ "conversationId": "+12025550103", "displayName": "Example Contact" }` to add a contact.
- `POST /tasks` accepts `hermesSessionId`, `platform`, `conversationId`, and a required `description` of up to 20,000 characters. Multiple open tasks can use the same platform/contact pair.
- `GET /tasks` supports `status`, `platform`, `conversationId`, and `hermesSessionId` filters; `GET /tasks/{taskId}` gets one task.
- `POST /tasks/{taskId}` accepts `platform`, `conversationId`, `message`, and `description`; it verifies the destination, stores the replacement description, and sends the message.
- `POST /tasks/selection` accepts `webhookMessage`, `platform`, `conversationId`, and a non-empty array of unique `taskIds`. It validates every selected task before delivering to any of them and reports an outcome for each delivery. The owner-review session uses this endpoint as its callback.
- `POST /tasks/{taskId}/complete` accepts `{ "result": "..." }`; `POST /tasks/{taskId}/cancel` accepts an optional `{ "reason": "..." }`.
- `POST /stub/conversations/{conversationId}/reply` accepts `{ "message": "...", "externalMessageId": "optional-id" }`.
- `POST /webhooks/stub` accepts `{ "conversationId": "...", "externalMessageId": "...", "message": "..." }`.
- `GET /conversations/{conversationId}/actions?platform=stub` lists chronological conversation actions.

Request bodies are limited to 1 MB; compressed request bodies are unsupported so WAHA signatures are checked against the exact received bytes.

Responses use `{ "success": true, ... }`; failures use `{ "success": false, "error": { "code": "...", "message": "..." } }`. Task statuses are `ACTIVE`, `WAITING_EXTERNAL_REPLY`, `COMPLETED`, and `CANCELLED`. Both `ACTIVE` and `WAITING_EXTERNAL_REPLY` tasks are reply-routing candidates. A delivered external reply changes a waiting task back to `ACTIVE`; closing one task leaves the others open. Webhook responses include `taskIds` and `routingOutcome`, plus `ownerSessionId` when Hermes asks the owner to choose. Repeated provider webhook IDs return the original outcome without repeating classification, owner prompting, or delivery.

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

Run `docker compose up -d --build` to start the app, Hermes stub, WAHA, and Ollama ROCm. Pull the configured classifier model once with `docker compose exec ollama ollama pull gemma4:e4b`; if you change `TASK_CLASSIFIER_MODEL`, pull that model instead. WAHA uses its own `.waha/.env` configuration. The app defaults to stub mode. To connect it to WAHA, use the configuration below. Container restarts discard its in-memory state.

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

Replies are normalized by their receiving platform adapter. For one open task, the tracker sends the reply directly to that task's `hermesSessionId` through `POST /api/sessions/{id}/chat` with `{ "input": "<untrusted-content envelope>" }`. The ID is URL-encoded. Use an existing Hermes session; unknown sessions fail with HTTP 404. Session chat runs a synchronous agent turn using existing history. `DELIVERED` and `HERMES_DELIVERED` are recorded after a valid session chat completion, not after creating an asynchronous run.

When multiple tasks are open for the platform/contact pair, the tracker calls the classifier's OpenAI-compatible `POST /v1/chat/completions` endpoint with the webhook text and each task ID and description. Compose sets `TASK_CLASSIFIER_BASE_URL` to `http://ollama:11434/v1`, `TASK_CLASSIFIER_API_KEY` to Ollama's ignored local API key value, and `TASK_CLASSIFIER_MODEL` to `gemma4:e4b` by default. The classifier returns one independent confidence score per task. Scores at or above the configured threshold are matches: one match is delivered directly; multiple matches go to owner review. If no score meets the threshold or scoring fails, all open task IDs go to owner review. The task context and external text are provided separately from the classifier instructions and are treated as untrusted data.

Owner review creates an empty Hermes session using `POST /api/sessions`, then sends a prompt using `{ "input": "..." }` to that session's chat endpoint. The prompt includes the contact, webhook text, candidate descriptions, and exact JSON callback body for `POST /tasks/selection`. Configure `TASK_TRACKER_BASE_URL` so it resolves from Hermes; Compose sets it to `http://task-tracker:9005`. The tracker bearer token must be available to Hermes through its environment and is never included in the prompt. `TASK_CLASSIFIER_MODEL` defaults to `gemma4:e4b` in Compose, and `TASK_CLASSIFIER_THRESHOLD` defaults to `0.80` and accepts values from 0 to 1.

The selection callback bypasses classification and delivers the supplied reply to every selected open task for that platform/contact, in per-session order. It attempts every delivery and returns individual outcomes; HTTP 502 indicates one or more failed deliveries while retaining successful delivery records. Each callback request gets a new generated message ID. Repeated callbacks can deliver again because there is no idempotency header or event ID that can identify a particular original webhook record.

`HERMES_MAX_RETRIES` is a non-negative integer, default `3`: one initial attempt plus up to three retries. Set `0` to disable retries. Network errors, request timeouts, HTTP 408/429, and HTTP 5xx are retried with delays of 1, 2, and 4 seconds by default. Other HTTP errors fail immediately. Set `HERMES_TIMEOUT_MS` to a positive integer (default `120000`) for each synchronous chat request. Every attempt uses the same idempotency key and payload; the development stub deduplicates it, but native Hermes session chat does not document the Runs API idempotency guarantee. A retry after an ambiguous failure or timeout may repeat the agent turn. Exhausted deliveries return HTTP 502 and record `DELIVERY_FAILED`; the task remains waiting. Duplicate webhooks retain the recorded outcome and do not start a fresh retry cycle. There is no persistent background retry queue.

## Source layout

`src/task-tracker/` contains the task management API, storage, and messaging adapters. `src/hermes-stub/` contains the standalone development Hermes service. Each service has its own Dockerfile; Compose runs them separately using the repository root as build context.

## Hermes stub UI

Open `http://localhost:8643` after `docker compose up -d --build`. Configure `WAHA_API_KEY` and webhook credentials in `.env`, then pair the WAHA session. Point its webhook to `http://task-tracker:9005/webhooks/waha`. The task tracker finds the task for that platform/contact and delivers the reply to the stub's `/api/sessions/{id}/chat` endpoint. This callback records the message and pushes it to the React UI over `/api/events/stream` (Server-Sent Events). The UI never fetches conversation history from the task tracker. The existing stub `/webhooks/waha` relay remains available, but reply display depends on the task tracker's callback, so only replies delivered to a bound Hermes session appear.

Choose WhatsApp, refresh contacts, enter a task description and Hermes session ID, and create a task. Edit the description as the task state changes. Select a task to send a message through the task tracker and WAHA. Successful sends and callback replies form the conversation shown in the UI; callbacks also appear in the reply inbox. Tasks load once when the UI opens. Successful create/send/complete/cancel actions and live reply callbacks update task state locally. Use Refresh tasks to request a manual reload; there is no task-list polling. Complete with a result, or cancel with an optional reason. The local messaging stub supports the task API, empty Hermes session creation, `{ "input": "..." }` session turns, and configurable score fixtures through `HERMES_STUB_SCORING_FIXTURES` (a JSON array of `{ "scores": [...] }` results). It remains a development simulator. Message snapshots on SSE connection/reconnection restore the stub's in-memory history; idempotent task reply callbacks appear once.

When task-tracker asks Hermes for owner selection, use the **Task selection** form in the UI. Copy the platform, conversation ID, original webhook message, and the candidate task IDs from the owner-review prompt. Enter task IDs one per line or separated by commas and submit; the stub backend forwards the exact selection request to task-tracker with its configured server-side bearer token.


For separate local processes, configure `TASK_TRACKER_BASE_URL` (default `http://127.0.0.1:9005`) and `MESSAGING_TASK_API_TOKEN` for the Hermes stub. Compose supplies the internal tracker URL and loads the token from `.env`. The token stays on the server. The UI is a local development console without its own login. Inbox and run state disappear on restart; a live paired WAHA session is required for real WhatsApp messages.

## Frontend development

The Hermes stub UI uses React with TypeScript and Vite. Components and styles live in `src/hermes-stub/frontend/`; the HTTP API remains in `src/hermes-stub/server.ts`. `bun run build:hermes-ui` builds browser assets into `dist/hermes-stub/ui`. The standalone stub serves those assets and logs asset requests alongside API requests. Its Docker image includes the built UI.

`bun run dev:hermes-stub` builds the UI and starts the stub API on port 8643. For frontend hot reload, also run `bun run dev:hermes-ui` and open the Vite URL (normally `http://localhost:5173`). Vite proxies `/api` to the stub on `HERMES_STUB_PORT` (default 8643), so tracker credentials stay server-side. Rebuild the UI to update the version served on port 8643. `HERMES_STUB_UI_DIR` can override the asset directory.

`bun run test` builds the UI before running API and React interaction tests. If invoking `bun test` directly, first run `bun run build:hermes-ui`.

## Platform registration

Both built-in adapters (`stub` and `waha`) are always registered. Choose `platform` on task creation, contact discovery, and action history. Sends use the task's platform; `/webhooks/stub` and `/webhooks/waha` normalize and route independently. Each open task is bound to its own Hermes session; multiple open tasks can share a platform/contact. Message IDs and history are isolated by platform.

`MESSAGING_PLATFORM` now only chooses the default for contact/history queries that omit `platform`; it does not disable other adapters. WAHA requires `WAHA_API_KEY` for discovery and sending; without it, those operations return `503 WAHA_NOT_CONFIGURED`. Configure `STUB_WEBHOOK_TOKEN` for stub webhooks and either `WAHA_WEBHOOK_TOKEN` or `WAHA_WEBHOOK_HMAC_KEY` for WAHA webhooks. Missing webhook credentials never authorize an empty bearer token. Programmatic applications can supply adapters through `platforms` and per-platform tokens through `webhookTokens`.

## WAHA conversation identifiers

WAHA uses LIDs such as `123456789@lid` as `conversationId` for task creation, task filters, action history, sends, and inbound reply lookup. Contact discovery accepts native LID contacts and maps phone-based contacts using WAHA's [phone-to-LID endpoint](https://waha.devlike.pro/docs/how-to/contacts/#get-lid-by-phone-number). Unmapped contacts are skipped. Incoming LID messages also register the contact for subsequent discovery. Phone-addressed replies can use a mapping already obtained during discovery; no LID-to-phone lookup is needed.

Stub tasks retain their existing phone-number identifiers. Recreate any existing WAHA tasks using the contact's LID. `WAHA_SESSION` must still match the webhook session exactly.
