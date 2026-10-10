import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { defineConfig, MikroORM, SqliteDriver } from "@mikro-orm/sql";
import { Migrator } from "@mikro-orm/migrations";
import { Database } from "bun:sqlite";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { ConversationAction } from "../domain/conversation-action.ts";
import type { Conversation } from "../domain/conversation.ts";
import type { InboundEvent } from "../domain/inbound-event.ts";
import type { MessagingTask } from "../domain/messaging-task.ts";
import type { Platform } from "../domain/platform.ts";
import { InitialStorageSchema } from "./migrations/InitialStorageSchema.ts";
import {
  ConversationActionEntity,
  ConversationEntity,
  InboundEventEntity,
  STORAGE_ENTITIES,
  TaskEntity,
  conversationActionData,
  conversationData,
  inboundEventData,
  taskData,
  toConversation,
  toConversationAction,
  toInboundEvent,
  toTask,
} from "./entities.ts";
import type { Store } from "./store.ts";

type StorageOrm = MikroORM<SqliteDriver>;

export class MikroOrmStore implements Store {
  readonly filePath: string;
  private ormPromise?: Promise<StorageOrm>;
  private closed = false;

  constructor(filePath: string) {
    if (!filePath.trim()) throw new Error("SQLITE_FILE_PATH must not be empty.");
    this.filePath = filePath === ":memory:"
      ? filePath
      : isAbsolute(filePath)
        ? filePath
        : resolve(filePath);
  }

  async setup(): Promise<void> {
    if (this.closed) throw new Error("The storage connection has been closed.");
    this.ormPromise ??= this.initialize();
    await this.ormPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.ormPromise) return;
    try {
      const orm = await this.ormPromise;
      await orm.close(true);
    } catch {
      // Initialization closes its own connection on failure.
    }
  }

  async addConversation(conversation: Conversation): Promise<void> {
    const em = await this.entityManager();
    const existing = await em.findOne(ConversationEntity, {
      platform: conversation.platform,
      conversationId: conversation.conversationId,
    });
    if (existing) existing.displayName = conversation.displayName;
    else em.persist(em.create(ConversationEntity, conversationData(conversation)));
    await em.flush();
  }

  async getConversation(
    platform: Platform,
    conversationId: string,
  ): Promise<Conversation | undefined> {
    const em = await this.entityManager();
    const entity = await em.findOne(ConversationEntity, { platform, conversationId });
    return entity ? toConversation(entity) : undefined;
  }

  async listConversations(platform?: Platform): Promise<Conversation[]> {
    const em = await this.entityManager();
    const entities = await em.find(
      ConversationEntity,
      platform ? { platform } : {},
      { orderBy: { sequence: "asc" } },
    );
    return entities.map(toConversation);
  }

  async saveTask(task: MessagingTask): Promise<void> {
    const em = await this.entityManager();
    const existing = await em.findOne(TaskEntity, { id: task.id });
    if (existing) Object.assign(existing, taskData(task));
    else em.persist(em.create(TaskEntity, taskData(task)));
    await em.flush();
  }

  async getTask(taskId: string): Promise<MessagingTask | undefined> {
    const em = await this.entityManager();
    const entity = await em.findOne(TaskEntity, { id: taskId });
    return entity ? toTask(entity) : undefined;
  }

  async getTasks(): Promise<MessagingTask[]> {
    const em = await this.entityManager();
    const entities = await em.find(TaskEntity, {}, { orderBy: { sequence: "asc" } });
    return entities.map(toTask);
  }

  async getOpenTasks(platform: Platform, conversationId: string): Promise<MessagingTask[]> {
    const em = await this.entityManager();
    const entities = await em.find(
      TaskEntity,
      { platform, conversationId, status: { $in: ["ACTIVE", "WAITING_EXTERNAL_REPLY"] } },
      { orderBy: { sequence: "asc" } },
    );
    return entities.map(toTask);
  }

  async saveInboundEvent(event: InboundEvent): Promise<void> {
    const data = inboundEventData(event);
    const em = await this.entityManager();
    const existing = await em.findOne(InboundEventEntity, {
      platform: data.platform,
      externalMessageId: data.externalMessageId,
    });
    if (existing) Object.assign(existing, data);
    else em.persist(em.create(InboundEventEntity, data));
    await em.flush();
  }

  async getInboundEvent(deduplicationKey: string): Promise<InboundEvent | undefined> {
    const separator = deduplicationKey.indexOf("\u0000");
    if (separator < 0) return undefined;
    const platform = deduplicationKey.slice(0, separator) as Platform;
    const externalMessageId = deduplicationKey.slice(separator + 1);
    const em = await this.entityManager();
    const entity = await em.findOne(InboundEventEntity, { platform, externalMessageId });
    return entity ? toInboundEvent(entity) : undefined;
  }

  async reserveAction(
    action: Omit<ConversationAction, "id" | "sequence" | "timestamp">,
  ): Promise<ConversationAction> {
    const complete: ConversationAction = {
      ...action,
      id: `action_${crypto.randomUUID()}`,
      sequence: 0,
      timestamp: new Date().toISOString(),
    };
    await this.saveAction(complete);
    return complete;
  }

  async saveAction(action: ConversationAction): Promise<void> {
    const em = await this.entityManager();
    const existing = await em.findOne(ConversationActionEntity, { id: action.id });
    if (existing) {
      const sequence = existing.sequence;
      Object.assign(existing, conversationActionData(action), { sequence });
      await em.flush();
      action.sequence = sequence;
      return;
    }

    const entity = em.create(ConversationActionEntity, conversationActionData(action));
    em.persist(entity);
    await em.flush();
    action.sequence = entity.sequence;
  }

  async getConversationActions(
    platform: Platform,
    conversationId: string,
  ): Promise<ConversationAction[]> {
    const em = await this.entityManager();
    const entities = await em.find(
      ConversationActionEntity,
      { platform, conversationId },
      { orderBy: { sequence: "asc" } },
    );
    return entities.map(toConversationAction);
  }

  private async entityManager() {
    await this.setup();
    return (await this.ormPromise!).em.fork({ clear: true });
  }

  private async initialize(): Promise<StorageOrm> {
    if (this.filePath !== ":memory:")
      mkdirSync(dirname(this.filePath), { recursive: true });
    let orm: StorageOrm | undefined;
    try {
      orm = await MikroORM.init(defineConfig({
        driver: SqliteDriver,
        entities: [...STORAGE_ENTITIES],
        dbName: this.filePath,
        driverOptions: new BunSqliteDialect({
          database: new Database(this.filePath, { strict: true, create: true }),
        }),
        extensions: [Migrator],
        migrations: {
          migrationsList: [InitialStorageSchema],
          transactional: true,
          allOrNothing: false,
          snapshot: false,
          snapshotOnMigrate: false,
        },
      })) as StorageOrm;

      const tables = await orm.em.getConnection().execute(
        "select name from sqlite_master where type = 'table'",
      ) as { name: string }[];
      const tableNames = new Set(tables.map(({ name }) => name));
      const currentTables = ["conversations", "tasks", "inbound_events", "conversation_actions"];
      if (
        !tableNames.has("mikro_orm_migrations") &&
        currentTables.some((table) => tableNames.has(table))
      ) {
        throw new Error(
          "This SQLite file uses the legacy storage schema. Choose a new SQLITE_FILE_PATH or recreate the database before starting.",
        );
      }

      await orm.migrator.up();
      return orm;
    } catch (error) {
      if (orm) await orm.close(true);
      throw error;
    }
  }
}
