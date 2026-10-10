import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Conversation } from "../src/task-tracker/domain.ts";
import type { InboundEvent } from "../src/task-tracker/domain.ts";
import type { MessagingTask } from "../src/task-tracker/domain.ts";
import type { HermesDelivery } from "../src/task-tracker/domain.ts";
import { createApplication } from "../src/task-tracker/app.ts";
import { StubPlatformAdapter } from "../src/task-tracker/adapters.ts";
import { createStoreFromEnvironment, DEFAULT_SQLITE_FILE_PATH, InMemoryStore, MikroOrmStore, type Store } from "../src/task-tracker/store.ts";

function createTask(id: string, status: MessagingTask["status"] = "ACTIVE"): MessagingTask {
  return {
    id,
    description: `Task ${id}`,
    platform: "stub",
    conversationId: "+12025550101",
    hermesSessionId: `session-${id}`,
    status,
    result: status === "COMPLETED" ? "Finished" : null,
    cancelReason: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    completedAt: status === "COMPLETED" ? "2026-10-10T00:00:00.000Z" : null,
  };
}

function createEvent(deduplicationKey: string): InboundEvent {
  return {
    id: "event_test",
    deduplicationKey,
    message: {
      platform: "stub",
      conversationId: "+12025550101",
      externalMessageId: "external-test",
      senderId: "+12025550101",
      senderDisplayName: "Example Dental",
      content: "Tuesday works.",
      timestamp: "2026-10-10T00:00:00.000Z",
    },
    taskIds: ["task_active"],
    actionId: "action_test",
    outcome: "PENDING_HERMES",
    routingOutcome: "AUTO_ROUTED",
  };
}

const storeFactories: [string, (directory: string) => Store][] = [
  ["in-memory", () => new InMemoryStore(false)],
  ["MikroORM SQLite", (directory) => new MikroOrmStore(join(directory, "nested", "store.sqlite"))],
];

for (const [name, createStore] of storeFactories) {
  test(`${name} store supports setup, record updates, filtering, and ordered actions`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "hermes-store-contract-"));
    const store = createStore(directory);
    try {
      await store.setup();
      await store.setup();

      const stubConversation: Conversation = {
        platform: "stub",
        conversationId: "+12025550101",
        displayName: "Example Dental",
      };
      await store.addConversation(stubConversation);
      await store.addConversation({ ...stubConversation, platform: "waha" });
      expect(await store.listConversations("stub")).toEqual([stubConversation]);
      expect((await store.getConversation("waha", stubConversation.conversationId))?.platform).toBe("waha");

      const active = createTask("task_active");
      const completed = createTask("task_completed", "COMPLETED");
      await store.saveTask(active);
      await store.saveTask(completed);
      await store.saveTask({ ...active, description: "Updated task" });
      expect((await store.getTask(active.id))?.description).toBe("Updated task");
      expect((await store.getOpenTasks("stub", active.conversationId)).map(({ id }) => id)).toEqual([active.id]);
      expect(await store.getOpenTasks("waha", active.conversationId)).toEqual([]);

      const eventKey = `stub${String.fromCharCode(0)}external-test`;
      const event = createEvent(eventKey);
      await store.saveInboundEvent({ ...event, ownerSessionId: "owner-review-session" });
      await store.saveInboundEvent({ ...event, ownerSessionId: "owner-review-session", outcome: "DELIVERED" });
      expect(await store.getInboundEvent(eventKey)).toEqual({ ...event, ownerSessionId: "owner-review-session", outcome: "DELIVERED" });

      const first = await store.reserveAction({
        type: "WEBHOOK_RECEIVED",
        platform: "stub",
        conversationId: active.conversationId,
        taskId: active.id,
        taskIds: [active.id],
        hermesSessionId: active.hermesSessionId,
        externalMessageId: "external-test",
        message: "Tuesday works.",
        outcome: "PENDING_HERMES",
        envelope: "Persisted Hermes envelope",
      });
      const second = await store.reserveAction({
        type: "HERMES_DELIVERED",
        platform: "stub",
        conversationId: active.conversationId,
        message: "Tuesday works.",
        outcome: "DELIVERED",
      });
      first.outcome = "DELIVERED";
      await store.saveAction(first);
      expect(second.sequence).toBeGreaterThan(first.sequence);
      expect(await store.getConversationActions("stub", active.conversationId)).toEqual([first, second]);
      expect(await store.getConversationActions("waha", active.conversationId)).toEqual([]);

      await store.setup();
      expect(await store.getTasks()).toHaveLength(2);
      expect((await store.getInboundEvent(eventKey))?.outcome).toBe("DELIVERED");
      expect(await store.getConversationActions("stub", active.conversationId)).toHaveLength(2);
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("MikroORM SQLite migrations reject legacy schemas and preserve records across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hermes-sqlite-persistence-"));
  const filePath = join(directory, "nested", "store.sqlite");
  const store = new MikroOrmStore(filePath);
  let firstSequence = 0;
  const eventKey = `stub${String.fromCharCode(0)}external-test`;
  try {
    await store.setup();
    await store.setup();
    const task = createTask("task_persisted");
    await store.addConversation({ platform: "stub", conversationId: task.conversationId, displayName: "Dental" });
    await store.saveTask(task);
    await store.saveInboundEvent(createEvent(eventKey));
    firstSequence = (await store.reserveAction({
      type: "WEBHOOK_RECEIVED",
      platform: "stub",
      conversationId: task.conversationId,
      message: "Reply",
      outcome: "PENDING_HERMES",
    })).sequence;
    await store.close();

    const reopened = new MikroOrmStore(filePath);
    await reopened.setup();
    expect(await reopened.getConversation("stub", task.conversationId)).toEqual({
      platform: "stub", conversationId: task.conversationId, displayName: "Dental",
    });
    expect(await reopened.getTask(task.id)).toEqual(task);
    expect((await reopened.getInboundEvent(eventKey))?.id).toBe("event_test");
    const next = await reopened.reserveAction({
      type: "HERMES_DELIVERED",
      platform: "stub",
      conversationId: task.conversationId,
      message: "Reply",
      outcome: "DELIVERED",
    });
    expect(next.sequence).toBeGreaterThan(firstSequence);
    await reopened.setup();
    expect(await reopened.getConversationActions("stub", task.conversationId)).toHaveLength(2);
    await reopened.close();
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("MikroORM SQLite rejects a legacy database without deleting it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hermes-sqlite-legacy-"));
  const filePath = join(directory, "legacy.sqlite");
  const database = new Database(filePath);
  database.run("CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  database.close();
  const store = new MikroOrmStore(filePath);
  try {
    await expect(store.setup()).rejects.toThrow("legacy storage schema");
    const reopened = new Database(filePath);
    expect(reopened.query("select name from sqlite_master where name = 'tasks'").get()).toBeDefined();
    reopened.close();
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite persists task lifecycle, owner review, retries, and queued replies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hermes-sqlite-workflow-"));
  const filePath = join(directory, "store.sqlite");
  const store = new MikroOrmStore(filePath);
  await store.setup();
  const dentalId = "+12025550101";
  const plumbingId = "+12025550102";
  await store.addConversation({ platform: "stub", conversationId: dentalId, displayName: "Dental" });
  await store.addConversation({ platform: "stub", conversationId: plumbingId, displayName: "Plumbing" });

  let blockedMessageId: string | undefined;
  let releaseBlocked!: () => void;
  let markBlocked!: () => void;
  let blockedStarted = new Promise<void>((resolveStarted) => { markBlocked = resolveStarted; });
  let holdBlocked = new Promise<void>((resolveBlocked) => { releaseBlocked = resolveBlocked; });
  const delivered: string[] = [];
  const hermes = {
    async deliver(delivery: HermesDelivery) {
      if (delivery.externalMessageId === blockedMessageId) {
        markBlocked();
        await holdBlocked;
      }
      delivered.push(delivery.externalMessageId);
    },
  };
  const storePlatform = new StubPlatformAdapter(store);
  const sendMessage = storePlatform.sendMessage.bind(storePlatform);
  let failSend = true;
  storePlatform.sendMessage = async (...args) => {
    if (failSend) throw new Error("Simulated platform send failure");
    return sendMessage(...args);
  };
  const taskClassifier = {
    async classify(input: { conversationId: string }) {
      return (await store.getOpenTasks("stub", input.conversationId)).map(({ id }) => id);
    },
    async checkWithUser() {
      return "owner-review-session";
    },
  };
  const app = await createApplication({
    apiToken: "api",
    webhookToken: "hook",
    store,
    platform: storePlatform,
    hermes,
    taskClassifier,
  });

  try {
    const first = await app.service.createTask({
      platform: "stub", conversationId: dentalId, hermesSessionId: "primary-session", description: "Original context",
    });
    await expect(app.service.sendMessage(first.id, {
      platform: "stub", conversationId: dentalId, message: "Hello", description: "Temporary context",
    })).rejects.toThrow("Simulated platform send failure");
    expect(await store.getTask(first.id)).toMatchObject({ status: "ACTIVE", description: "Original context" });

    failSend = false;
    await app.service.sendMessage(first.id, {
      platform: "stub", conversationId: dentalId, message: "Hello", description: "Latest context",
    });
    const second = await app.service.createTask({
      platform: "stub", conversationId: dentalId, hermesSessionId: "second-session", description: "Another task",
    });
    const ownerReview = await app.service.receiveInbound("stub", {
      conversationId: dentalId, externalMessageId: "owner-review", message: "Which appointment?",
    });
    expect(ownerReview).toMatchObject({ outcome: "PENDING_OWNER_SELECTION", taskIds: [first.id, second.id] });
    expect((await store.getInboundEvent(`stub${String.fromCharCode(0)}owner-review`))?.ownerSessionId).toBe("owner-review-session");
    const selection = await app.service.selectTasks({
      webhookMessage: "Both need Tuesday.", platform: "stub", conversationId: dentalId, taskIds: [first.id, second.id],
    });
    expect(selection.deliveries.map(({ outcome }) => outcome)).toEqual(["DELIVERED", "DELIVERED"]);
    expect(delivered).toHaveLength(2);
    expect((await app.service.receiveInbound("stub", {
      conversationId: dentalId, externalMessageId: "owner-review", message: "Which appointment?",
    })).duplicate).toBe(true);
    await app.service.completeTask(second.id, "Finished the second task.");

    blockedMessageId = "concurrent-retry";
    blockedStarted = new Promise<void>((resolveStarted) => { markBlocked = resolveStarted; });
    holdBlocked = new Promise<void>((resolveBlocked) => { releaseBlocked = resolveBlocked; });
    const originalRetry = app.service.receiveInbound("stub", {
      conversationId: dentalId, externalMessageId: "concurrent-retry", message: "One delivery only",
    });
    await blockedStarted;
    const duplicateRetry = app.service.receiveInbound("stub", {
      conversationId: dentalId, externalMessageId: "concurrent-retry", message: "One delivery only",
    });
    releaseBlocked();
    expect((await originalRetry).outcome).toBe("DELIVERED");
    expect(await duplicateRetry).toMatchObject({ outcome: "DELIVERED", duplicate: true });
    await app.service.completeTask(first.id, "Finished the primary task.");

    const queuedFirst = await app.service.createTask({
      platform: "stub", conversationId: dentalId, hermesSessionId: "shared-session", description: "First queued task",
    });
    const queuedSecond = await app.service.createTask({
      platform: "stub", conversationId: plumbingId, hermesSessionId: "shared-session", description: "Second queued task",
    });
    blockedMessageId = "queue-blocker";
    blockedStarted = new Promise<void>((resolveStarted) => { markBlocked = resolveStarted; });
    holdBlocked = new Promise<void>((resolveBlocked) => { releaseBlocked = resolveBlocked; });
    const firstReply = app.service.receiveInbound("stub", {
      conversationId: dentalId, externalMessageId: "queue-blocker", message: "First reply",
    });
    await blockedStarted;
    const queuedReply = app.service.receiveInbound("stub", {
      conversationId: plumbingId, externalMessageId: "queued-reply", message: "Second reply",
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await store.getInboundEvent(`stub${String.fromCharCode(0)}queued-reply`)) break;
      await new Promise<void>((resolveTick) => setImmediate(resolveTick));
    }
    expect((await store.getInboundEvent(`stub${String.fromCharCode(0)}queued-reply`))?.taskIds).toEqual([queuedSecond.id]);
    await app.service.completeTask(queuedSecond.id, "Closed while the reply was queued.");
    releaseBlocked();
    expect((await firstReply).outcome).toBe("DELIVERED");
    expect(await queuedReply).toMatchObject({ outcome: "IGNORED_TASK_CLOSED", taskIds: [queuedSecond.id] });
    expect((await store.getTask(queuedFirst.id))?.status).toBe("ACTIVE");
    expect((await store.getInboundEvent(`stub${String.fromCharCode(0)}queued-reply`))?.outcome).toBe("IGNORED_TASK_CLOSED");
    await store.close();
    const reopened = new MikroOrmStore(filePath);
    await reopened.setup();
    try {
      expect((await reopened.getTask(first.id))?.status).toBe("COMPLETED");
      expect((await reopened.getInboundEvent(`stub${String.fromCharCode(0)}concurrent-retry`))?.outcome).toBe("DELIVERED");
      expect((await reopened.getInboundEvent(`stub${String.fromCharCode(0)}queued-reply`))?.outcome).toBe("IGNORED_TASK_CLOSED");
      expect((await reopened.getConversationActions("stub", dentalId)).length).toBeGreaterThan(0);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("server storage configuration selects memory or MikroORM SQLite and validates settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hermes-store-config-"));
  const sqlitePath = join(directory, "custom", "tasks.sqlite");
  try {
    const memory = await createStoreFromEnvironment({
      TASK_STORAGE: "memory",
      SQLITE_FILE_PATH: "",
    });
    expect(memory).toBeInstanceOf(InMemoryStore);
    await memory.close();

    const sqlite = await createStoreFromEnvironment({
      SQLITE_FILE_PATH: sqlitePath,
    });
    expect(sqlite).toBeInstanceOf(MikroOrmStore);
    expect((sqlite as MikroOrmStore).filePath).toBe(resolve(sqlitePath));
    await sqlite.close();

    expect(DEFAULT_SQLITE_FILE_PATH).toBe("./data/task-tracker.sqlite");
    await expect(createStoreFromEnvironment({ TASK_STORAGE: "postgres" })).rejects.toThrow("TASK_STORAGE");
    await expect(createStoreFromEnvironment({ TASK_STORAGE: "sqlite", SQLITE_FILE_PATH: "" })).rejects.toThrow("SQLITE_FILE_PATH");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
