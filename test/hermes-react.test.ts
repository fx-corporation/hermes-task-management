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
  globalThis.fetch = (async (url, init) => {
    const path = String(url);
    requests.push(path);
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      mutations.push({ path, body });
      if (path === "/api/tracker/tasks") {
        const task: MessagingTask = { ...body, id: `task-${tasks.length}`, status: "ACTIVE", hermesSessionId: body.hermesSessionId, result: null, cancelReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null };
        tasks.push(task); return Response.json({ task });
      }
      const task = tasks.find(t => path.includes(t.id))!;
      if (path.endsWith("/send")) task.status = "WAITING_EXTERNAL_REPLY";
      if (path.endsWith("/complete")) { task.status = "COMPLETED"; task.result = body.result; }
      if (path.endsWith("/cancel")) { task.status = "CANCELLED"; task.cancelReason = body.reason; }
      return Response.json({ status: task.status });
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
    fireEvent.change(view.getByLabelText("Task title"), { target: { value: "Book dentist" } });
    fireEvent.click(view.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(view.getByLabelText("Message")).toBeDefined());
    fireEvent.change(view.getByLabelText("Message"), { target: { value: "Available?" } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(view.getByText("WAITING_EXTERNAL_REPLY · 12025550101@lid")).toBeDefined());
    expect(mutations.find(m => m.path.endsWith("/send"))?.body.message).toBe("Available?");
    await act(async () => {
      activeSource!.dispatchEvent(new dom.MessageEvent("message", { data: JSON.stringify({ id: "live-reply", taskId: "task-0", sessionId: mutations[0]!.body.hermesSessionId, sender: "Dental", message: "Live callback reply", direction: "received", timestamp: new Date().toISOString() }) }));
    });
    expect(view.getAllByText("Live callback reply")).toHaveLength(2);
    expect(view.getByText("ACTIVE · 12025550101@lid")).toBeDefined();
    fireEvent.change(view.getByLabelText("Completion result"), { target: { value: "Booked" } });
    fireEvent.click(view.getByRole("button", { name: "Complete task" }));
    await waitFor(() => expect(view.getByText("Result: Booked")).toBeDefined());
    expect(view.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.change(view.getByLabelText("Task title"), { target: { value: "Second task" } });
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
