import { InMemoryStore } from "./in-memory-store.ts";
import type { Store } from "./store.ts";
import { MikroOrmStore } from "./mikro-orm-store.ts";

export const DEFAULT_SQLITE_FILE_PATH = "./data/task-tracker.sqlite";

export async function createStoreFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Promise<Store> {
  const storage = environment.TASK_STORAGE ?? "sqlite";
  if (storage === "memory") {
    const store = new InMemoryStore();
    await store.setup();
    return store;
  }
  if (storage !== "sqlite") {
    throw new Error('TASK_STORAGE must be either "memory" or "sqlite".');
  }
  const store = new MikroOrmStore(
    environment.SQLITE_FILE_PATH ?? DEFAULT_SQLITE_FILE_PATH,
  );
  await store.setup();
  return store;
}
