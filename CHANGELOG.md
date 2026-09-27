# Changelog

This file records changes made by AI agents and the reasons for those changes.
Existing work has been backfilled based on the repository contents and the
user's confirmation of AI authorship. Backfill dates indicate when the work
was recorded, not its original implementation date. Each entry must accompany
the changes it describes in the same commit.
Repository-wide instructions are in [AGENTS.md](AGENTS.md).

## Unreleased

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
