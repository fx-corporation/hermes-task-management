import { defineEntity, p } from "@mikro-orm/core";
import type { ConversationAction } from "../domain/conversation-action.ts";
import type { Conversation } from "../domain/conversation.ts";
import type { InboundEvent } from "../domain/inbound-event.ts";
import type { InboundMessage } from "../domain/inbound-message.ts";
import type { MessagingTask } from "../domain/messaging-task.ts";
import type { Platform } from "../domain/platform.ts";
import type { TaskStatus } from "../domain/task-status.ts";

const ConversationSchema = defineEntity({
  name: "StoredConversation",
  tableName: "conversations",
  properties: {
    sequence: p.integer().primary().autoincrement(),
    platform: p.string().$type<Platform>(),
    conversationId: p.string(),
    displayName: p.string(),
  },
  uniques: [{
    name: "conversation_platform_id_unique",
    properties: ["platform", "conversationId"],
  }],
});
export class ConversationEntity extends ConversationSchema.class {}
ConversationSchema.setClass(ConversationEntity);

const TaskSchema = defineEntity({
  name: "StoredTask",
  tableName: "tasks",
  properties: {
    sequence: p.integer().primary().autoincrement(),
    id: p.string().unique("task_id_unique"),
    description: p.string(),
    platform: p.string().$type<Platform>(),
    conversationId: p.string(),
    hermesSessionId: p.string(),
    status: p.string().$type<TaskStatus>(),
    result: p.string().nullable(),
    cancelReason: p.string().nullable(),
    createdAt: p.string(),
    updatedAt: p.string(),
    completedAt: p.string().nullable(),
  },
  indexes: [{
    name: "tasks_destination_status",
    properties: ["platform", "conversationId", "status"],
  }],
});
export class TaskEntity extends TaskSchema.class {}
TaskSchema.setClass(TaskEntity);

const InboundEventSchema = defineEntity({
  name: "StoredInboundEvent",
  tableName: "inbound_events",
  properties: {
    id: p.string().primary(),
    platform: p.string().$type<Platform>(),
    externalMessageId: p.string(),
    message: p.json<InboundMessage>(),
    taskIds: p.json<string[]>(),
    actionId: p.string(),
    outcome: p.string(),
    routingOutcome: p.string(),
    ownerSessionId: p.string().nullable(),
  },
  uniques: [{
    name: "inbound_events_provider_message_unique",
    properties: ["platform", "externalMessageId"],
  }],
});
export class InboundEventEntity extends InboundEventSchema.class {}
InboundEventSchema.setClass(InboundEventEntity);

const ConversationActionSchema = defineEntity({
  name: "StoredConversationAction",
  tableName: "conversation_actions",
  properties: {
    sequence: p.integer().primary().autoincrement(),
    id: p.string().unique("conversation_action_id_unique"),
    timestamp: p.string(),
    type: p.string(),
    platform: p.string().$type<Platform>(),
    conversationId: p.string(),
    taskId: p.string().nullable(),
    taskIds: p.json<string[]>().nullable(),
    hermesSessionId: p.string().nullable(),
    externalMessageId: p.string().nullable(),
    message: p.string(),
    outcome: p.string(),
    envelope: p.string().nullable(),
  },
  indexes: [{
    name: "actions_destination_sequence",
    properties: ["platform", "conversationId", "sequence"],
  }],
});
export class ConversationActionEntity extends ConversationActionSchema.class {}
ConversationActionSchema.setClass(ConversationActionEntity);

export const STORAGE_ENTITIES = [
  ConversationEntity,
  TaskEntity,
  InboundEventEntity,
  ConversationActionEntity,
] as const;

export function toConversation(entity: ConversationEntity): Conversation {
  return {
    platform: entity.platform,
    conversationId: entity.conversationId,
    displayName: entity.displayName,
  };
}

export function toTask(entity: TaskEntity): MessagingTask {
  return {
    id: entity.id,
    description: entity.description,
    platform: entity.platform,
    conversationId: entity.conversationId,
    hermesSessionId: entity.hermesSessionId,
    status: entity.status,
    result: entity.result ?? null,
    cancelReason: entity.cancelReason ?? null,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    completedAt: entity.completedAt ?? null,
  };
}

export function toInboundEvent(entity: InboundEventEntity): InboundEvent {
  return {
    id: entity.id,
    deduplicationKey: `${entity.platform}\u0000${entity.externalMessageId}`,
    message: entity.message,
    taskIds: [...entity.taskIds],
    actionId: entity.actionId,
    outcome: entity.outcome as InboundEvent["outcome"],
    routingOutcome: entity.routingOutcome as InboundEvent["routingOutcome"],
    ...(entity.ownerSessionId != null ? { ownerSessionId: entity.ownerSessionId } : {}),
  };
}

export function toConversationAction(
  entity: ConversationActionEntity,
): ConversationAction {
  return {
    id: entity.id,
    sequence: entity.sequence,
    timestamp: entity.timestamp,
    type: entity.type as ConversationAction["type"],
    platform: entity.platform,
    conversationId: entity.conversationId,
    ...(entity.taskId != null ? { taskId: entity.taskId } : {}),
    ...(entity.taskIds != null ? { taskIds: [...entity.taskIds] } : {}),
    ...(entity.hermesSessionId != null ? { hermesSessionId: entity.hermesSessionId } : {}),
    ...(entity.externalMessageId != null ? { externalMessageId: entity.externalMessageId } : {}),
    message: entity.message,
    outcome: entity.outcome,
    ...(entity.envelope != null ? { envelope: entity.envelope } : {}),
  };
}

export function conversationData(conversation: Conversation) {
  return { ...conversation };
}

export function taskData(task: MessagingTask) {
  return { ...task };
}

export function inboundEventData(event: InboundEvent) {
  const separator = event.deduplicationKey.indexOf("\u0000");
  if (
    separator < 0 ||
    event.deduplicationKey.slice(0, separator) !== event.message.platform ||
    event.deduplicationKey.slice(separator + 1) !== event.message.externalMessageId
  ) {
    throw new Error("Invalid inbound-event deduplication key.");
  }
  return {
    id: event.id,
    platform: event.message.platform,
    externalMessageId: event.message.externalMessageId,
    message: event.message,
    taskIds: [...event.taskIds],
    actionId: event.actionId,
    outcome: event.outcome,
    routingOutcome: event.routingOutcome,
    ownerSessionId: event.ownerSessionId ?? null,
  };
}

export function conversationActionData(action: ConversationAction) {
  const { sequence: _sequence, ...values } = action;
  return {
    ...values,
    taskId: action.taskId ?? null,
    taskIds: action.taskIds ?? null,
    hermesSessionId: action.hermesSessionId ?? null,
    externalMessageId: action.externalMessageId ?? null,
    envelope: action.envelope ?? null,
  };
}
