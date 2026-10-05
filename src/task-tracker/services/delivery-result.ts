export interface DeliveryResult {
  taskId: string;
  outcome: "DELIVERED" | "DELIVERY_FAILED" | "IGNORED_TASK_CLOSED";
}
