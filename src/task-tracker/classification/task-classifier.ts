import type { ClassifyInput } from "./classify-input.ts";

export interface TaskClassifier {
  classify(input: ClassifyInput): Promise<string[]>;
  checkWithUser(input: ClassifyInput & { taskIds: string[] }): Promise<string>;
}

export type { ClassifyInput } from "./classify-input.ts";
export type { HttpTaskClassifierOptions } from "./http-task-classifier-options.ts";
export { HttpTaskClassifier } from "./http-task-classifier.ts";
export { taskClassifierFromEnvironment } from "./task-classifier-from-environment.ts";
export { UnavailableTaskClassifier } from "./unavailable-task-classifier.ts";
