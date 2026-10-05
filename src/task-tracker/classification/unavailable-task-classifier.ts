import type { ClassifyInput } from "./classify-input.ts";
import { InMemoryStore } from "../storage/store.ts";
import type { TaskClassifier } from "./task-classifier.ts";

/** Used when tests inject a delivery adapter without configuring Hermes routing calls. */
export class UnavailableTaskClassifier implements TaskClassifier {
  constructor(private readonly store: InMemoryStore) {}

  async classify(input: ClassifyInput): Promise<string[]> {
    return this.store
      .getOpenTasks(input.platform, input.conversationId)
      .map((task) => task.id);
  }

  async checkWithUser(): Promise<string> {
    throw new Error(
      "Task owner review requires a configured Hermes classifier.",
    );
  }
}
