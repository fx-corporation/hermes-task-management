# Changelog

This file records changes made by AI agents and the reasons for those changes.
Existing work has been backfilled based on the repository contents and the
user's confirmation of AI authorship. Backfill dates indicate when the work
was recorded, not its original implementation date. Each entry must accompany
the changes it describes in the same commit.
Repository-wide instructions are in [AGENTS.md](AGENTS.md).

## Unreleased

### 2026-09-27 — Use LIDs as WAHA conversation identifiers

- **Agent:** Codex
- **Changes:** Updated `src/task-tracker/waha-adapter.ts` to discover LID
  contacts, resolve phone contacts with WAHA's phone-to-LID endpoint, send to
  LIDs directly, and bind incoming LID replies without converting to phones.
  Updated `src/task-tracker/app.ts` with platform-specific conversation validation for tasks,
  filters, and action history. Updated WAHA, routing, UI API, and React fixtures;
  added mapping and identifier validation coverage in `test/waha.test.ts`.
  Documented identifier formats and task recreation in `README.md`, and aligned
  its Docker commands/webhook URLs with the current `task-tracker` service.
- **Why:** Incoming WhatsApp replies use LID sender IDs, which must match the
  identifier stored on the task instead of being ignored or resolved to phones.
- **Validation:** Typecheck, all 35 tests, UI/tracker builds, both Docker image
  builds, Compose configuration validation, and `git diff --check` passed. Tests
  cover native LID replies through Hermes/UI delivery, phone-to-LID discovery,
  direct LID sends, API validation/filtering, and platform isolation. Live WAHA
  was not tested. Existing phone-based WAHA tasks must be recreated using LIDs;
  webhook session matching remains required. Before committing the combined
  pending changes, reran `bun run typecheck`, `bun test` (35 passed, zero
  failed), `bun run build`, `bun run build:hermes-ui`, and staged whitespace
  checks; all passed. Docker checks above were recorded by earlier work and
  were not rerun during commit preparation.

### 2026-09-27 — Log received task-tracker webhook payloads

- **Agent:** Codex
- **Changes:** Added payload logging after raw-body parsing in
  `src/task-tracker/app.ts` for `/webhooks/*`, before authentication and event
  filtering. Logs include the request ID, method, URL, timestamp, and parsed
  payload; malformed JSON remains visible as raw text. Exact body bytes remain
  available for WAHA HMAC validation. Documented logging in `README.md`.
- **Why:** Make incoming webhook content visible when diagnosing ignored events.
- **Validation:** Typecheck, all 33 tests, UI/tracker builds, and
  `git diff --check` passed. Inspected test output to confirm payload logs
  share the response request ID and precede rejected webhook responses. Existing
  WAHA signature and event-filter tests passed with raw-body logging enabled.

### 2026-09-27 — Default task-tracker applications to HTTP Hermes delivery

- **Agent:** Codex
- **Changes:** Updated `src/task-tracker/app.ts` to default to
  `HttpHermesAdapter` with environment configuration or explicit `hermesOptions`.
  Removed its automatic in-memory receiver. Updated API/WAHA/routing unit test
  fixtures to inject their in-memory receiver explicitly and changed the real
  HTTP test in `test/hermes.test.ts` to exercise the default adapter. Updated
  `README.md` to document the application factory's HTTP configuration.
- **Why:** Ensure task-tracker delivers replies over HTTP regardless of whether
  it is created through server startup or the programmatic application factory.
- **Validation:** `bun run typecheck`, all 33 tests, UI/tracker builds, and
  `git diff --check` passed. The HTTP integration test creates an application
  without an injected Hermes adapter, confirms `HttpHermesAdapter` is selected,
  and verifies an inbound reply reaches the session-chat HTTP endpoint.

### 2026-09-27 — Expose the HTTP Hermes session adapter explicitly

- **Agent:** Codex
- **Changes:** Moved `src/task-tracker/hermes-adapter.ts` to
  `src/task-tracker/http-hermes-adapter.ts` and renamed the implementation and
  options to `HttpHermesAdapter` and `HttpHermesAdapterOptions`. Updated the
  server and integration tests to use that adapter. Its environment factory
  now defaults to the local Hermes stub on port 8643; Compose continues to
  address `http://hermes-stub:8643`. Updated `README.md` and added a server
  startup assertion verifying the concrete HTTP adapter.
- **Why:** Make the requested adapter explicit and ensure task replies use
  authenticated HTTP delivery to the stub's native session-chat endpoint.
- **Validation:** `bun run typecheck`, all 33 tests, UI/tracker builds, and
  `git diff --check` passed. Integration tests verify real HTTP requests to the
  stub session-chat route, session/contact routing, retries, and UI callback
  delivery. The startup test confirms the server uses `HttpHermesAdapter`.

### 2026-09-27 — Remove task-list polling from the UI

- **Agent:** Codex
- **Changes:** Updated `src/hermes-stub/frontend/App.tsx` to load tasks once,
  retain manual refresh, and update task statuses from action responses and
  received reply events. Removed the periodic task refresh and post-action
  task-list requests. Updated `test/hermes-react.test.ts` to check callback
  status changes and the absence of extra list requests, and `README.md` to
  describe the event-driven behavior.
- **Why:** Avoid polling the task tracker for task lists when actions and reply
  callbacks already provide the state changes needed by the UI.
- **Validation:** Typecheck, all 33 tests, UI/tracker builds, stub Docker
  image build, and `git diff --check` passed. React interaction tests verified
  successful sends, reply callback reactivation, completion, cancellation, and
  one initial task-list request with no post-action list fetches. Reviewed the
  frontend to confirm no polling interval remains.

### 2026-09-27 — Push callback messages from the Hermes stub to the UI

- **Agent:** Codex
- **Changes:** Added `src/hermes-stub/events.ts` to represent messages and extract
  reply text/task metadata from tracker envelopes. `server.ts` now stores and
  broadcasts session-chat callbacks and successful UI sends through an SSE
  stream with reconnect snapshots, heartbeats, and disconnect cleanup. Removed
  raw WAHA webhook inbox writes and the conversation-history proxy route.
  Updated `frontend/App.tsx` to use EventSource and local message history instead
  of querying tracker actions or polling messages. Updated UI/API and React
  interaction tests and `README.md` for direct WAHA-to-tracker webhook delivery.
- **Why:** The task tracker already forwards replies to the bound Hermes session;
  that callback should supply UI messages without querying tracker message history.
- **Validation:** Typecheck, all 33 tests, UI/tracker builds, both Docker image
  builds, Compose configuration validation, and `git diff --check` passed. Tests
  verify direct WAHA-to-tracker delivery reaches the UI stream via session chat,
  reconnect snapshots include sends and replies, duplicate callbacks are omitted,
  React renders live messages safely, and message-history queries are absent.
  An isolated container check verified callback-to-SSE delivery; the temporary
  container was removed. Messages and callback deduplication remain in memory.

### 2026-09-27 — Route registered platform replies to Hermes session chat

- **Agent:** Codex
- **Changes:** Added `PlatformAdapterRegistry` in `src/task-tracker/adapters.ts`;
  `app.ts`, `server.ts`, and `task-service.ts` now register stub and WAHA together,
  choose adapters per task/webhook, and isolate webhook credentials by platform.
  Stub contact discovery excludes WAHA contacts. `waha-adapter.ts` exposes a clear
  unavailable response when credentials are missing and rejects empty webhook
  credentials. `hermes-adapter.ts` now sends the reply envelope as `message` to
  `POST /api/sessions/{id}/chat`, validates session chat responses, retains bounded
  retries, and supports `HERMES_TIMEOUT_MS` (default 120000). Updated the Hermes
  stub to simulate session chat, extended its webhook relay timeout, and disabled
  request idle timeouts while the bounded upstream proxy request is active. Updated
  API, adapter, and UI integration tests; added `test/platform-routing.test.ts`
  for simultaneous platform/contact routing, independent authentication and
  deduplication, encoded session IDs, and closed-task replies. Added invalid
  session-chat completion checks in `test/hermes.test.ts`. Updated `README.md`
  with registry, session endpoint, timeout, and retry semantics.
- **Why:** Support all built-in adapters at once and deliver each contact reply
  to the Hermes conversation bound to that platform's active task, using the
  requested native session endpoint rather than asynchronous run creation.
- **Validation:** `bun run typecheck`, all 33 tests, UI and tracker builds,
  both Docker image builds, Compose configuration validation, and
  `git diff --check` passed. An isolated container check confirmed stub task
  delivery while WAHA is the default, via the native session-chat path.
  Temporary containers/network were removed. No live Hermes or WhatsApp
  gateway was used; tests use HTTP fixtures. Hermes session-chat source/docs
  do not promise Runs API idempotency; an ambiguous retry can repeat a turn.

### 2026-09-27 — Replace inline stub UI with React and Vite

- **Agent:** Codex
- **Changes:** Replaced `src/hermes-stub/ui.ts` with React components, a typed
  API client, CSS, and an HTML entry in `src/hermes-stub/frontend/`. Added
  `src/hermes-stub/vite.config.ts`, built asset serving in the stub server,
  React/Vite and UI test dependencies in `package.json` and `bun.lock`, JSX
  typechecking in `tsconfig.json`, UI build/dev scripts, and Docker asset builds
  in both service Dockerfiles. Documented frontend development in `README.md`.
  Updated `test/hermes-ui.test.ts` for built assets
  and added `test/hermes-react.test.ts` for user interactions and safe rendering.
- **Why:** Use a maintained UI framework with component state, controlled
  forms, effect cleanup, and a separate frontend build while keeping the task,
  messaging, webhook, and request logging behavior.
- **Validation:** Typecheck, all 30 tests, UI and tracker builds, both Docker
  image builds, Compose configuration validation, and `git diff --check` passed.
  React interaction tests cover creating, sending, completing, cancelling, and
  rendering webhook text safely. An isolated stub container served HTML,
  JavaScript, and CSS with correct content types and logged asset requests.
  Browser rendering was not checked because Chrome is unavailable; component
  tests use Happy DOM. Temporary verification containers were removed.

### 2026-09-27 — Add a task console to the Hermes stub

- **Agent:** Codex
- **Changes:** Added `src/hermes-stub/ui.ts` with contacts, task creation,
  task selection, sending, completion, cancellation, conversation history,
  and a polling WAHA reply inbox. Extended `src/hermes-stub/server.ts` with
  a restricted tracker API proxy and webhook relay preserving authentication;
  accepted incoming replies are deduplicated in memory. Added stub tracker URL
  and token configuration in `docker-compose.yaml`, documented the UI and
  webhook route in `README.md`, and added `test/hermes-ui.test.ts`.
- **Why:** Exercise delegated WhatsApp tasks through a simple development
  interface and display replies while retaining tracker authentication and
  task lifecycle handling. Render external messages as text in the browser.
- **Validation:** Typecheck, all 29 tests, task tracker build, stub Docker
  image build, UI JavaScript syntax, Compose configuration validation, and
  `git diff --check` passed. HTTP integration covers task creation, WAHA send,
  rejected and accepted webhooks, replay deduplication, history, completion,
  and cancellation. Browser interaction verification was unavailable because
  Chrome is not installed. Real WhatsApp delivery requires a paired WAHA
  session; integration tests use mocked WAHA HTTP responses.

### 2026-09-27 — Run Hermes stub as a standalone Compose service

- **Agent:** Codex
- **Changes:** Moved the root Dockerfile to `src/task-tracker/Dockerfile` and
  updated Compose and `.github/workflows/publish-docker-image.yaml` build paths.
  Added `src/hermes-stub/Dockerfile` with a standalone bundled runtime and health
  check. Added the `hermes-stub` Compose service, dependency health gating, and
  configurable task tracker connection defaults. Added configurable stub host
  binding in `src/hermes-stub/server.ts`. Removed `src/dev.ts`; `package.json`
  now starts only the task tracker with `dev`. Updated `README.md` for separate
  local processes, Docker usage, connection settings, and request logs.
- **Why:** Run each app independently and keep its Dockerfile with its source,
  while connecting development task deliveries to the stub over HTTP.
- **Validation:** Typecheck, all 28 tests, app build, Compose configuration
  validation, both Docker image builds, and `git diff --check` passed. An isolated
  Docker network smoke check verified container-to-container task reply delivery,
  stub request logs, and healthy stub status; temporary containers and network
  were removed. Existing services were not changed.

### 2026-09-27 — Group application sources by service

- **Agent:** Codex
- **Changes:** Moved the task API and adapters into `src/task-tracker/` and
  the development Hermes receiver into `src/hermes-stub/server.ts`. Updated
  `src/dev.ts`, `package.json`, and imports across `test/*.ts` to the new paths.
  Documented the source layout in `README.md`. The shared development launcher
  remains at `src/dev.ts`; the production bundle remains `dist/server.js`.
- **Why:** Group each application's implementation in its own directory as
  requested, retaining the existing startup and build behavior.
- **Validation:** `bun run typecheck`, `bun test` (28 passed, zero failed),
  `bun run build`, and `git diff --check` passed. Combined development startup,
  health response, and shutdown passed. Checked for stale source path references
  outside historical changelog entries; none remain.

### 2026-09-27 — Run a logging Hermes stub during development

- **Agent:** Codex
- **Changes:** Added `src/hermes-stub.ts`, a loopback HTTP receiver that logs
  every request and accepts session runs with idempotency replay support.
  Added `src/dev.ts` to start the app and stub together, supplying the stub URL
  and development key. Updated `package.json` development commands and
  `README.md` with combined, standalone, and real-gateway development usage.
  Added `test/hermes-stub.test.ts` for HTTP delivery, logging, and replay behavior.
- **Why:** Keep development reply delivery working without a live Hermes
  gateway, with all incoming stub requests visible for debugging.
- **Validation:** `bun run typecheck`, `bun test` (28 passed, zero failed),
  `bun run build`, and `git diff --check` passed. A combined development
  startup smoke check delivered a task reply through the stub, verified request
  logging, and exited cleanly. Stub runs simulate acceptance and do not
  execute agents; idempotency state is in memory.

### 2026-09-27 — Deliver adapter replies to Hermes over HTTP

- **Agent:** Codex
- **Changes:** Added `src/hermes-adapter.ts` with authenticated session-aware
  Runs API delivery, stable idempotency keys, request timeouts, exponential
  retry delays, and configuration validation. Wired `src/server.ts` to the
  HTTP adapter using `HERMES_BASE_URL`, required `HERMES_API_KEY`, and
  `HERMES_MAX_RETRIES` (default three retries after the initial attempt).
  Updated delivery errors in `src/task-service.ts`, server test configuration
  in `test/api.test.ts`, and added `test/hermes.test.ts`. Updated `README.md`
  with setup, Docker connectivity, retry semantics, and asynchronous acceptance.
- **Why:** Incoming adapter replies previously only reached an in-memory
  receiver. Real Hermes runs resume the designated session, while idempotency
  prevents retries from creating duplicate turns and transient failures receive
  bounded retries.
- **Validation:** `bun run typecheck`, `bun test` (27 passed, zero failed),
  `bun run build`, and `git diff --check` passed. No live Hermes gateway available;
  tests use mock responses and a local HTTP server. Delivery indicates run
  acceptance; runs are not polled for completion. State and failed events remain
  in memory, with no persistent background retry queue.

### 2026-09-27 — Add AI change tracking

- **Agent:** Codex
- **Changes:** Added `CHANGELOG.md` to record AI-authored changes. Added
  `AGENTS.md` with a repository-wide rule requiring agents to keep entries
  current and include the matching changelog update in each commit. Backfilled
  the existing AI-authored implementation after the user confirmed its origin.
- **Why:** Make AI changes traceable, including their purpose and validation,
  as requested by the user.
- **Validation:** Reviewed both Markdown files and checked whitespace with
  `git diff --no-index --check` against an empty file for each new file.
  Application tests were not run because these changes only add documentation.

### 2026-09-27 — Backfill existing task management implementation

- **Agent:** AI agent; specific identity unknown. AI authorship confirmed by
  the user. Original implementation dates and commit boundaries are unknown;
  this entry summarizes the existing uncommitted work.
- **Changes:**
  - Added the Bun/TypeScript project setup in `package.json`, `bun.lock`, and
    `tsconfig.json`, including Express 5, development startup, typechecking,
    tests, and server bundling.
  - Implemented the API and server in `src/app.ts`, `src/server.ts`, and
    `src/errors.ts`: public health checks, bearer authentication, request
    validation, structured errors, configurable host/port, and contact,
    task, messaging, webhook, and action-history endpoints.
  - Added domain models, in-memory storage, and task orchestration in
    `src/domain.ts`, `src/store.ts`, and `src/task-service.ts`. Enforced one
    open task per platform/contact, completion and cancellation rules,
    webhook deduplication, session-ordered delivery, and binding replies
    to their original task.
  - Added stub messaging and simulated Hermes delivery in `src/adapters.ts`,
    including fictional seed contacts, reply simulation, and envelopes
    marking external content as untrusted.
  - Added WAHA integration in `src/waha-adapter.ts` for contact discovery,
    WhatsApp text sending, inbound event normalization/filtering, raw-body
    SHA-512 HMAC or bearer webhook authentication, and provider timeouts.
  - Added request/response console logs in `src/app.ts`, including request
    identifiers, timestamps, response status/body, and elapsed time.
  - Added API and WAHA tests in `test/api.test.ts`, `test/waha.test.ts`, and
    `test/helpers.ts`, covering lifecycle, authentication, validation,
    concurrency, deduplication, webhook signatures, and provider failures.
  - Added a multi-stage `Dockerfile` with build-time checks, a bundled
    runtime running as the `bun` user, and a health check; added
    `.dockerignore` and `docker-compose.yaml` to run the app alongside WAHA
    with environment configuration and WAHA session/media volumes.
  - Added `.github/workflows/publish-docker-image.yaml` to build and publish
    `latest` and SHA-tagged images to GitHub Container Registry on pushes
    to `master`, using pinned actions and build caching.
  - Expanded `README.md` with setup, endpoint usage, a simulated conversation
    walkthrough, Docker/WAHA configuration, request logs, and V1 limitations.
    Expanded `.gitignore` to exclude dependencies, build output, environment
    files, and WAHA runtime data.
- **Why:** The implementation provides delegated messaging tasks tied to
  explicit Hermes sessions. Task ownership, lifecycle rules, deduplication,
  and delivery ordering keep replies associated with the correct task.
  Stub mode enables local simulation; WAHA supports real WhatsApp messaging.
  Authentication and validation control API/webhook access, while logs and
  tests support diagnosis and verification. Docker and image publishing
  support repeatable deployment; documentation explains operation and
  ignored files keep local configuration and generated data out of Git.
  These purposes are inferred from the implementation and documentation;
  the original agent's reasoning is unavailable.
- **Validation:** Inspected the existing source, test cases, project
  configuration, Docker files, publishing workflow, and README when
  backfilling. Historical check results are unknown; application tests,
  Docker builds, live WAHA/Hermes integration, and the publishing workflow
  were not run for this documentation update. State remains in memory and
  Hermes delivery is simulated.

<!-- Entry template: copy below Unreleased and fill in the actual details.
### YYYY-MM-DD — Descriptive change title

- **Agent:** Agent name, or unknown if attribution cannot be established
- **Changes:** What changed, including relevant paths
- **Why:** The request, problem, or rationale for the change
- **Validation:** Checks performed and results, or why checks were not run;
  include known failures or limitations
-->
