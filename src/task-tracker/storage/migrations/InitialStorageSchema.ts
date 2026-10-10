import { Migration } from "@mikro-orm/migrations";

export class InitialStorageSchema extends Migration {
  override name = "InitialStorageSchema";

  override up(): void {
    this.addSql(`
      create table "conversations" (
        "sequence" integer not null primary key autoincrement,
        "platform" text not null,
        "conversation_id" text not null,
        "display_name" text not null,
        constraint "conversation_platform_id_unique" unique ("platform", "conversation_id")
      )
    `);
    this.addSql(`
      create table "tasks" (
        "sequence" integer not null primary key autoincrement,
        "id" text not null,
        "description" text not null,
        "platform" text not null,
        "conversation_id" text not null,
        "hermes_session_id" text not null,
        "status" text not null,
        "result" text null,
        "cancel_reason" text null,
        "created_at" text not null,
        "updated_at" text not null,
        "completed_at" text null,
        constraint "task_id_unique" unique ("id")
      )
    `);
    this.addSql(`create index "tasks_destination_status" on "tasks" ("platform", "conversation_id", "status")`);
    this.addSql(`
      create table "inbound_events" (
        "id" text not null primary key,
        "platform" text not null,
        "external_message_id" text not null,
        "message" text not null,
        "task_ids" text not null,
        "action_id" text not null,
        "outcome" text not null,
        "routing_outcome" text not null,
        "owner_session_id" text null,
        constraint "inbound_events_provider_message_unique" unique ("platform", "external_message_id")
      )
    `);
    this.addSql(`
      create table "conversation_actions" (
        "sequence" integer not null primary key autoincrement,
        "id" text not null,
        "timestamp" text not null,
        "type" text not null,
        "platform" text not null,
        "conversation_id" text not null,
        "task_id" text null,
        "task_ids" text null,
        "hermes_session_id" text null,
        "external_message_id" text null,
        "message" text not null,
        "outcome" text not null,
        "envelope" text null,
        constraint "conversation_action_id_unique" unique ("id")
      )
    `);
    this.addSql(`create index "actions_destination_sequence" on "conversation_actions" ("platform", "conversation_id", "sequence")`);
  }

  override down(): void {
    this.addSql('drop table if exists "conversation_actions"');
    this.addSql('drop table if exists "inbound_events"');
    this.addSql('drop table if exists "tasks"');
    this.addSql('drop table if exists "conversations"');
  }
}
