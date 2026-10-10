import { expect, test } from "bun:test";
import { InMemoryHermesAdapter } from "../src/task-tracker/adapters.ts";
import { createApplication } from "../src/task-tracker/app.ts";
import type { Platform } from "../src/task-tracker/domain.ts";
import { InMemoryStore } from "../src/task-tracker/store.ts";
import { HttpTaskClassifier, type TaskClassifier } from "../src/task-tracker/task-classifier.ts";
import { startHermesStub } from "../src/hermes-stub/server.ts";
import { fetchApplication } from "./helpers.ts";

const CONTACT = "+12025550101";
const MESSAGE = "Tuesday at 3 PM is available.";

async function createTasks(store: InMemoryStore, count = 2, session = (index: number) => `session-${index}`) {
  const app = await createApplication({ apiToken: "api", webhookToken: "hook", store, hermes: new InMemoryHermesAdapter() });
  const tasks = await Promise.all(Array.from({ length: count }, (_, index) => app.service.createTask({
    platform: "stub", conversationId: CONTACT, hermesSessionId: session(index),
    description: `Appointment follow-up ${index + 1}. Latest state: waiting for a time confirmation.`,
  })));
  return { app, tasks };
}

function classifierFor(store: InMemoryStore, fixture: unknown, status = 200) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const classifier = new HttpTaskClassifier({
    baseUrl: "http://hermes.test:8642", apiKey: "classifier-secret", trackerUrl: "http://tracker.test:9005",
    store, fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      return status === 200
        ? Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(fixture) } }] })
        : Response.json({ error: "model unavailable" }, { status });
    }) as typeof fetch,
  });
  return { classifier, requests };
}

const classifyInput = { webhookMessage: MESSAGE, platform: "stub" as const, conversationId: CONTACT };

test("classifier skips one-task conversations and routes independent threshold scores", async () => {
  const store = new InMemoryStore();
  const { tasks } = await createTasks(store, 1);
  let calls = 0;
  const direct = new HttpTaskClassifier({
    baseUrl: "http://hermes.test", apiKey: "key", trackerUrl: "http://tracker.test", store,
    fetch: (async () => { calls++; throw new Error("Should not classify one candidate"); }) as unknown as typeof fetch,
  });
  expect(await direct.classify(classifyInput)).toEqual([tasks[0]!.id]);
  expect(calls).toBe(0);

  const manyStore = new InMemoryStore();
  const { tasks: many } = await createTasks(manyStore);
  const { classifier, requests } = classifierFor(manyStore, { scores: [
    { taskId: many[0]!.id, confidence: 0.8 },
    { taskId: many[1]!.id, confidence: 0.79 },
  ] });
  expect(await classifier.classify(classifyInput)).toEqual([many[0]!.id]);
  expect(requests[0]!.url).toBe("http://hermes.test:8642/v1/chat/completions");
  const prompt = JSON.parse(requests[0]!.init!.body as string) as { messages: { role: string; content: string }[] };
  expect(prompt.messages[0]!.content).toContain("untrusted data");
  expect(prompt.messages[1]!.content).toContain(many[0]!.description);
  expect(prompt.messages[1]!.content).toContain(MESSAGE);
  expect(requests[0]!.init!.body).not.toContain("classifier-secret");
  expect(new Headers(requests[0]!.init!.headers).get("authorization")).toBe("Bearer classifier-secret");
});

test("multiple matches and no threshold matches both require owner review of candidates", async () => {
  const store = new InMemoryStore();
  const { tasks } = await createTasks(store);
  const multiple = classifierFor(store, { scores: tasks.map(task => ({ taskId: task.id, confidence: 0.8 })) });
  expect(await multiple.classifier.classify(classifyInput)).toEqual(tasks.map(task => task.id));
  const none = classifierFor(store, { scores: tasks.map(task => ({ taskId: task.id, confidence: 0.79 })) });
  expect(await none.classifier.classify(classifyInput)).toEqual(tasks.map(task => task.id));
});

test("missing, duplicate, unknown, out-of-range, and malformed scores fall back to every open task", async () => {
  const store = new InMemoryStore();
  const { tasks } = await createTasks(store);
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  const candidates = tasks.map(task => ({ taskId: task.id, confidence: 0.9 }));
  const malformed: unknown[] = [
    { scores: [candidates[0]] },
    { scores: [...candidates, candidates[0]] },
    { scores: [{ taskId: "unknown", confidence: 0.9 }, candidates[1]] },
    { scores: [candidates[0], { taskId: tasks[1]!.id, confidence: 1.01 }] },
    { unexpected: true },
    { scores: [{ ...candidates[0], extra: "not allowed" }, candidates[1]] },
  ];
  try {
    for (const fixture of malformed) {
      const { classifier } = classifierFor(store, fixture);
      expect(await classifier.classify(classifyInput)).toEqual(tasks.map(task => task.id));
    }
    const failed = classifierFor(store, {}, 503);
    expect(await failed.classifier.classify(classifyInput)).toEqual(tasks.map(task => task.id));
  } finally {
    console.error = originalError;
  }
  expect(errors).toHaveLength(malformed.length + 1);
  expect(errors.at(-1)?.[0]).toContain("Task classification failed for stub conversation +12025550101 via http://hermes.test:8642/v1/chat/completions");
  expect(errors.at(-1)?.[1]).toEqual(expect.any(Error));
});

test("owner session is created before its prompt and duplicate webhooks do not repeat routing", async () => {
  const logs: Record<string, unknown>[] = [];
  const store = new InMemoryStore();
  const stub = startHermesStub({
    port: 0,
    scoringFixtures: [{ scores: [{ taskId: "placeholder", confidence: 0.2 }] }],
    log: row => logs.push(row),
  });
  try {
    const classifier = new HttpTaskClassifier({ baseUrl: stub.url.toString(), apiKey: "route-key", trackerUrl: "http://task-tracker:9005", store });
    const app = await createApplication({ apiToken: "api", webhookToken: "hook", store, hermes: new InMemoryHermesAdapter(), taskClassifier: classifier });
    const tasks = await Promise.all([0, 1].map(index => app.service.createTask({
      platform: "stub", conversationId: CONTACT, hermesSessionId: `work-${index}`,
      description: `Appointment task ${index + 1}: confirm a different date and update the owner.`,
    })));
    // Deliberately provide malformed fixture scores: safe fallback must show every candidate to the owner.
    const inbound = { conversationId: CONTACT, externalMessageId: "owner-review-1", message: MESSAGE };
    const first = await app.service.receiveInbound("stub", inbound);
    expect(first).toMatchObject({ outcome: "PENDING_OWNER_SELECTION", routingOutcome: "OWNER_REVIEW", duplicate: false, taskIds: tasks.map(task => task.id) });
    expect(first.ownerSessionId).toEqual(expect.any(String));
    expect(logs.map(row => new URL(row.url as string).pathname)).toEqual([
      "/v1/chat/completions", "/api/sessions", `/api/sessions/${first.ownerSessionId}/chat`,
    ]);
    const prompt = JSON.parse(logs[2]!.body as string) as { input: string };
    expect(prompt.input).toContain(tasks[0]!.description);
    expect(prompt.input).toContain(tasks[1]!.description);
    expect(prompt.input).toContain(MESSAGE);
    expect(prompt.input).toContain(JSON.stringify({ webhookMessage: MESSAGE, platform: "stub", conversationId: CONTACT, taskIds: tasks.map(task => task.id) }, null, 2));
    expect(prompt.input).toContain("http://task-tracker:9005/tasks/selection");
    expect(prompt.input).not.toContain("route-key");
    const retry = await app.service.receiveInbound("stub", inbound);
    expect(retry).toMatchObject({ eventId: first.eventId, duplicate: true, ownerSessionId: first.ownerSessionId });
    expect(logs).toHaveLength(3);
  } finally {
    await stub.stop(true);
  }
});

test("selection validates every task, delivers all choices in order, reports partial failure, and accepts repeated callbacks", async () => {
  let active = 0;
  let maxActive = 0;
  const delivered: string[] = [];
  let failTaskId = "";
  const hermes = {
    async deliver(delivery: { taskId: string; externalMessageId: string; envelope: string }) {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      delivered.push(`${delivery.taskId}:${delivery.externalMessageId}`);
      active--;
      if (delivery.taskId === failTaskId) throw new Error("simulated Hermes failure");
      expect(delivery.envelope).toContain("untrusted external content");
    },
  };
  const app = await createApplication({ apiToken: "api", webhookToken: "hook", hermes, taskClassifier: {
    async classify() { return []; }, async checkWithUser() { return "owner"; },
  } });
  const tasks = await Promise.all([0, 1, 2].map(index => app.service.createTask({
    platform: "stub", conversationId: CONTACT, hermesSessionId: "shared-owner-session",
    description: `Choice ${index + 1} description`,
  })));
  const call = async (body: unknown) => fetchApplication(app, new Request("http://localhost/tasks/selection", {
    method: "POST", headers: { authorization: "Bearer api", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const base = { webhookMessage: MESSAGE, platform: "stub", conversationId: CONTACT, taskIds: [tasks[0]!.id, tasks[1]!.id] };
  expect((await call({ ...base, taskIds: [tasks[0]!.id, tasks[0]!.id] })).status).toBe(400);
  expect((await call({ ...base, taskIds: [tasks[0]!.id, "missing"] })).status).toBe(404);
  expect((await call({ ...base, platform: "waha", conversationId: "12025550101@lid" })).status).toBe(400);
  await app.service.completeTask(tasks[2]!.id, "Closed");
  expect((await call({ ...base, taskIds: [tasks[0]!.id, tasks[2]!.id] })).status).toBe(409);
  expect(delivered).toHaveLength(0);

  tasks[0]!.status = "WAITING_EXTERNAL_REPLY";
  const successResponse = await call(base);
  expect(successResponse.status).toBe(200);
  const success = await successResponse.json() as any;
  expect(success.deliveries).toEqual([
    { taskId: tasks[0]!.id, outcome: "DELIVERED" },
    { taskId: tasks[1]!.id, outcome: "DELIVERED" },
  ]);
  expect(String(tasks[0]!.status)).toBe("ACTIVE");
  expect(delivered.slice(0, 2).map(item => item.slice(0, item.indexOf(":")))).toEqual([tasks[0]!.id, tasks[1]!.id]);

  failTaskId = tasks[1]!.id;
  const partialResponse = await call(base);
  expect(partialResponse.status).toBe(502);
  const partial = await partialResponse.json() as any;
  expect(partial).toMatchObject({ success: false, routingOutcome: "MANUAL_SELECTION", taskIds: base.taskIds });
  expect(partial.deliveries).toEqual([
    { taskId: tasks[0]!.id, outcome: "DELIVERED" },
    { taskId: tasks[1]!.id, outcome: "DELIVERY_FAILED" },
  ]);
  expect(maxActive).toBe(1);
  expect((await app.store.getConversationActions("stub", CONTACT)).filter(action => action.type === "HERMES_DELIVERED")).toHaveLength(3);

  const retryResponse = await call(base);
  expect(retryResponse.status).toBe(502);
  const retry = await retryResponse.json() as any;
  expect(retry.eventId).not.toBe(partial.eventId);
  expect(delivered).toHaveLength(6);
  expect(new Set(delivered.map(item => item.slice(item.indexOf(":") + 1))).size).toBe(3);
});

test("a selected task that closes while queued is skipped without rerouting", async () => {
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  const holdFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  const seen: string[] = [];
  const app = await createApplication({ apiToken: "api", webhookToken: "hook", hermes: {
    async deliver(delivery) {
      if (delivery.taskId === firstId) {
        markFirstStarted();
        await holdFirst;
      }
      seen.push(delivery.taskId);
    },
  }, taskClassifier: { async classify() { return []; }, async checkWithUser() { return "owner"; } } });
  const first = await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "ordered", description: "First" });
  const second = await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "ordered", description: "Second" });
  const firstId = first.id;
  const pending = app.service.selectTasks({ webhookMessage: MESSAGE, platform: "stub", conversationId: CONTACT, taskIds: [first.id, second.id] });
  await firstStarted;
  await app.service.completeTask(second.id, "Closed while in queue");
  releaseFirst();
  const result = await pending;
  expect(result.deliveries).toEqual([
    { taskId: first.id, outcome: "DELIVERED" },
    { taskId: second.id, outcome: "IGNORED_TASK_CLOSED" },
  ]);
  expect(seen).toEqual([first.id]);
});

test("a classifier-selected webhook task that closes in the session queue is not replaced by another open task", async () => {
  let releaseBlocker!: () => void;
  let markBlockerStarted!: () => void;
  let markTargetRoutingStarted!: () => void;
  const blockerStarted = new Promise<void>(resolve => { markBlockerStarted = resolve; });
  const targetRoutingStarted = new Promise<void>(resolve => { markTargetRoutingStarted = resolve; });
  const holdBlocker = new Promise<void>(resolve => { releaseBlocker = resolve; });
  const seen: string[] = [];
  const store = new InMemoryStore();
  const hermes = {
    async deliver(delivery: { taskId: string; externalMessageId: string }) {
      if (delivery.externalMessageId === "blocker") {
        markBlockerStarted();
        await holdBlocker;
      }
      seen.push(delivery.taskId);
    },
  };
  let selectedTaskId = "";
  const classifier: TaskClassifier = {
    async classify() { markTargetRoutingStarted(); return [selectedTaskId]; },
    async checkWithUser() { return "owner"; },
  };
  const app = await createApplication({ apiToken: "api", webhookToken: "hook", store, hermes, taskClassifier: classifier });
  const blocker = await app.service.createTask({ platform: "stub", conversationId: "+12025550102", hermesSessionId: "shared-queue", description: "Queue blocker" });
  const selected = await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "shared-queue", description: "Likely target" });
  const alternate = await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "alternate-session", description: "Different task" });
  selectedTaskId = selected.id;

  const blockerDelivery = app.service.receiveInbound("stub", { conversationId: blocker.conversationId, externalMessageId: "blocker", message: "Hold queue" });
  await blockerStarted;
  const queuedReply = app.service.receiveInbound("stub", { conversationId: CONTACT, externalMessageId: "queued-target", message: MESSAGE });
  await targetRoutingStarted;
  await app.service.completeTask(selected.id, "Closed before delivery");
  releaseBlocker();
  await blockerDelivery;
  const result = await queuedReply;
  expect(result).toMatchObject({ outcome: "IGNORED_TASK_CLOSED", routingOutcome: "IGNORED_TASK_CLOSED", taskIds: [selected.id] });
  expect(alternate.status).toBe("ACTIVE");
  expect(seen).toEqual([blocker.id]);
});

test("description is visible to routing during an in-flight send and send failure restores it without undoing reply state", async () => {
  const store = new InMemoryStore();
  let releaseSend!: () => void;
  let markSendStarted!: () => void;
  const sendStarted = new Promise<void>(resolve => { markSendStarted = resolve; });
  const holdSend = new Promise<void>(resolve => { releaseSend = resolve; });
  let firstId = "";
  const adapter = {
    platform: "stub" as Platform,
    listConversations: () => [],
    async sendMessage() { markSendStarted(); await holdSend; throw new Error("send failed"); },
    normalizeInbound(payload: unknown) {
      if (!payload || typeof payload !== "object") return null;
      const value = payload as Record<string, unknown>;
      return {
        platform: "stub" as const,
        conversationId: CONTACT,
        externalMessageId: String(value.externalMessageId),
        senderId: CONTACT,
        senderDisplayName: "Example Dental",
        content: String(value.message),
        timestamp: new Date().toISOString(),
      };
    },
  };
  let descriptionsSeen: string[] = [];
  const hermes = new InMemoryHermesAdapter();
  const classifier: TaskClassifier = {
    async classify(input) {
      descriptionsSeen = (await store.getOpenTasks(input.platform, input.conversationId)).map(task => task.description);
      return [firstId];
    },
    async checkWithUser() { return "owner"; },
  };
  const app = await createApplication({ apiToken: "api", webhookToken: "hook", store, platform: adapter, hermes, taskClassifier: classifier });
  const first = await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "task-one", description: "Original task context" });
  firstId = first.id;
  await app.service.createTask({ platform: "stub", conversationId: CONTACT, hermesSessionId: "task-two", description: "Second task context" });
  const send = app.service.sendMessage(first.id, {
    platform: "stub", conversationId: CONTACT, message: "Are you available Tuesday?", description: "Updated context before provider send: Tuesday was offered.",
  }).catch(error => error);
  await sendStarted;
  expect(first.description).toContain("Updated context before provider send");
  const reply = await app.service.receiveInbound("stub", { conversationId: CONTACT, externalMessageId: "immediate-reply", message: "Tuesday works." });
  expect(reply).toMatchObject({ outcome: "DELIVERED", taskIds: [first.id] });
  expect(descriptionsSeen).toContain("Updated context before provider send: Tuesday was offered.");
  expect(first.status).toBe("ACTIVE");
  releaseSend();
  await send;
  expect(first.description).toBe("Original task context");
  expect(first.status).toBe("ACTIVE");
  expect(hermes.deliveries).toHaveLength(1);
});
