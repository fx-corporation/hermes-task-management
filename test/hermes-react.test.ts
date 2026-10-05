import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { App } from "../src/hermes-stub/frontend/App.tsx";
import type { MessagingTask } from "../src/task-tracker/domain.ts";

test("React console creates tasks, sends, completes, cancels, and safely renders webhook text", async () => {
  const dom = new Window({ url: "http://localhost" });
  const originalFetch = globalThis.fetch;
  let activeSource: LiveMessages | undefined;
  class LiveMessages extends dom.EventTarget {
    constructor() {
      super(); activeSource = this;
      queueMicrotask(() => this.dispatchEvent(new dom.MessageEvent("snapshot", { data: JSON.stringify([{ id: "event-1", sessionId: "session", sender: "Dental", message: "<script>bad()</script> Confirmed", timestamp: new Date().toISOString(), direction: "received" }]) })));
    }
    close() {}
  }
  const globals = { EventSource: LiveMessages, window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const tasks: MessagingTask[] = [];
  const requests: string[] = [];
  const mutations: { path: string; body: any }[] = [];
  let selectionFailure = false;
  let selectionPending: Promise<void> | undefined;
  globalThis.fetch = (async (url, init) => {
    const path = String(url);
    requests.push(path);
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      mutations.push({ path, body });
      if (path === "/api/tracker/tasks/selection") {
        if (selectionPending) await selectionPending;
        if (selectionFailure) return Response.json({ error: { message: "Selection rejected." } }, { status: 502 });
        return Response.json({ success: true, taskIds: body.taskIds, routingOutcome: "MANUAL_SELECTION", deliveries: [] });
      }
      if (path === "/api/tracker/tasks") {
        const task: MessagingTask = { ...body, id: `task-${tasks.length}`, status: "ACTIVE", hermesSessionId: body.hermesSessionId, result: null, cancelReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null };
        tasks.push(task); return Response.json({ task });
      }
      const task = tasks.find(t => path.includes(t.id))!;
      if (/\/tasks\/[^/]+$/.test(path)) { task.status = "WAITING_EXTERNAL_REPLY"; task.description = body.description; }
      if (path.endsWith("/complete")) { task.status = "COMPLETED"; task.result = body.result; }
      if (path.endsWith("/cancel")) { task.status = "CANCELLED"; task.cancelReason = body.reason; }
      return Response.json({ status: task.status, description: task.description });
    }
    if (path.startsWith("/api/tracker/conversations?")) return Response.json({ conversations: [{ platform: "waha", conversationId: "12025550101@lid", displayName: "Dental" }] });
    if (path === "/api/tracker/tasks") return Response.json({ tasks });
    throw Error(`Unexpected request ${path}`);
  }) as typeof fetch;
  const { render, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react/pure");
  try {
    const view = render(createElement(App));
    await waitFor(() => expect(view.getByRole("option", { name: "Dental (12025550101@lid)" })).toBeDefined());
    await waitFor(() => expect(view.getByText("<script>bad()</script> Confirmed")).toBeDefined());
    expect(view.container.querySelector("script")).toBeNull();
    const selectionForm = view.getByLabelText("Selected task IDs").closest("form")!;
    fireEvent.submit(selectionForm);
    await waitFor(() => expect(view.getByText("Conversation ID is required.")).toBeDefined());
    fireEvent.change(view.getByLabelText("Conversation ID"), { target: { value: "12025550101@lid" } });
    fireEvent.submit(selectionForm);
    await waitFor(() => expect(view.getByText("Original webhook message is required.")).toBeDefined());
    fireEvent.change(view.getByLabelText("Original webhook message"), { target: { value: "A reply" } });
    fireEvent.submit(selectionForm);
    await waitFor(() => expect(view.getByText("At least one task ID is required.")).toBeDefined());
    fireEvent.change(view.getByLabelText("Conversation ID"), { target: { value: " 12025550101@lid " } });
    fireEvent.change(view.getByLabelText("Original webhook message"), { target: { value: " Tuesday at 3 PM is available. " } });
    fireEvent.change(view.getByLabelText("Selected task IDs"), { target: { value: " task-1,\n task-2 " } });
    fireEvent.click(view.getByRole("button", { name: "Send task selection" }));
    await waitFor(() => expect(view.getByText("Selection sent for task-1, task-2.")).toBeDefined());
    expect(mutations.find(m => m.path === "/api/tracker/tasks/selection")?.body).toEqual({
      webhookMessage: " Tuesday at 3 PM is available. ", platform: "waha", conversationId: "12025550101@lid", taskIds: ["task-1", "task-2"],
    });
    expect((view.getByLabelText("Platform") as HTMLSelectElement).value).toBe("waha");
    expect((view.getByLabelText("Conversation ID") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Original webhook message") as HTMLTextAreaElement).value).toBe("");
    expect((view.getByLabelText("Selected task IDs") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(view.getByLabelText("Platform"), { target: { value: "stub" } });
    fireEvent.change(view.getByLabelText("Conversation ID"), { target: { value: "stub-contact" } });
    fireEvent.change(view.getByLabelText("Original webhook message"), { target: { value: "Stub reply" } });
    fireEvent.change(view.getByLabelText("Selected task IDs"), { target: { value: "task-stub" } });
    fireEvent.click(view.getByRole("button", { name: "Send task selection" }));
    await waitFor(() => expect(view.getByText("Selection sent for task-stub.")).toBeDefined());
    expect(mutations.filter(m => m.path === "/api/tracker/tasks/selection").at(-1)?.body.platform).toBe("stub");
    expect((view.getByLabelText("Conversation ID") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Original webhook message") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(view.getByLabelText("Conversation ID"), { target: { value: "12025550101@lid" } });
    fireEvent.change(view.getByLabelText("Original webhook message"), { target: { value: "A duplicate selection" } });
    fireEvent.change(view.getByLabelText("Selected task IDs"), { target: { value: "task-stub, task-stub" } });
    fireEvent.click(view.getByRole("button", { name: "Send task selection" }));
    await waitFor(() => expect(view.getByText("Task IDs must be unique.")).toBeDefined());
    expect(mutations.filter(m => m.path === "/api/tracker/tasks/selection")).toHaveLength(2);
    fireEvent.change(view.getByLabelText("Selected task IDs"), { target: { value: "task-failure" } });
    selectionFailure = true;
    fireEvent.click(view.getByRole("button", { name: "Send task selection" }));
    await waitFor(() => expect(view.getByText("Selection rejected.")).toBeDefined());
    expect((view.getByLabelText("Selected task IDs") as HTMLTextAreaElement).value).toBe("task-failure");
    selectionFailure = false;
    let resolveSelection!: () => void;
    selectionPending = new Promise<void>(resolve => { resolveSelection = resolve; });
    fireEvent.click(view.getByRole("button", { name: "Send task selection" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Send task selection" }).closest("fieldset")?.hasAttribute("disabled")).toBe(true));
    resolveSelection();
    selectionPending = undefined;
    await waitFor(() => expect(view.getByText("Selection sent for task-failure.")).toBeDefined());
    expect((view.getByLabelText("Platform") as HTMLSelectElement).value).toBe("waha");
    expect((view.getByLabelText("Conversation ID") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Original webhook message") as HTMLTextAreaElement).value).toBe("");
    expect((view.getByLabelText("Selected task IDs") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(view.getByLabelText("Task description"), { target: { value: "Book dentist; ask about availability and record latest state." } });
    fireEvent.click(view.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(view.getByLabelText("Message")).toBeDefined());
    fireEvent.change(view.getByLabelText("Current task description"), { target: { value: "Book dentist; asked about Tuesday availability." } });
    fireEvent.change(view.getByLabelText("Message"), { target: { value: "Available?" } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(view.getByText("WAITING_EXTERNAL_REPLY · 12025550101@lid")).toBeDefined());
    expect(mutations.find(m => m.path !== "/api/tracker/tasks/selection" && /\/tasks\/[^/]+$/.test(m.path))?.body).toMatchObject({ message: "Available?", platform: "waha", conversationId: "12025550101@lid", description: "Book dentist; asked about Tuesday availability." });
    await act(async () => {
      activeSource!.dispatchEvent(new dom.MessageEvent("message", { data: JSON.stringify({ id: "live-reply", taskId: "task-0", sessionId: mutations[0]!.body.hermesSessionId, sender: "Dental", message: "Live callback reply", direction: "received", timestamp: new Date().toISOString() }) }));
    });
    expect(view.getAllByText("Live callback reply")).toHaveLength(2);
    expect(view.getByText("ACTIVE · 12025550101@lid")).toBeDefined();
    fireEvent.change(view.getByLabelText("Completion result"), { target: { value: "Booked" } });
    fireEvent.click(view.getByRole("button", { name: "Complete task" }));
    await waitFor(() => expect(view.getByText("Result: Booked")).toBeDefined());
    expect(view.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.change(view.getByLabelText("Task description"), { target: { value: "Follow up about a second appointment." } });
    fireEvent.click(view.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(view.getByLabelText("Cancellation reason (optional)")).toBeDefined());
    fireEvent.change(view.getByLabelText("Cancellation reason (optional)"), { target: { value: "Changed plans" } });
    fireEvent.click(view.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(view.getByText("Cancelled: Changed plans")).toBeDefined());
    expect(requests.some(path => path.includes("/actions?") || path === "/api/events")).toBe(false);
    expect(requests.filter(path => path === "/api/tracker/tasks")).toHaveLength(3); // Initial load and two POST creates only.
    expect(view.queryByText("COMPLETED · 12025550101@lid")).toBeNull();
  } finally {
    cleanup(); await dom.happyDOM.abort(); globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
