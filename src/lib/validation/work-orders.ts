import { z } from "zod";

export const createWorkOrderSchema = z.object({
  vehicleId: z.string().uuid("Vehicle is required."),
  contactType: z.enum([
    "REGISTERED_OWNER",
    "OTHER_PERSON",
    "NEW_OWNER",
  ]),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  newOwnerName: z.string().trim().optional(),
  newOwnerPhone: z.string().trim().optional(),
  ownershipNotes: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export const updateWorkOrderStatusSchema = z.object({
  workOrderId: z.string().uuid("Work order is required."),
  status: z.enum([
    "IN_PROGRESS",
    "READY_FOR_PICKUP",
    "COMPLETED",
    "CANCELLED",
  ]),
});

export function canMoveWorkOrderStatus(
  current: string,
  next: string,
) {
  if (next === "CANCELLED") {
    return current !== "COMPLETED" && current !== "CANCELLED";
  }

  return (
    (current === "WAITING" && next === "IN_PROGRESS") ||
    (current === "IN_PROGRESS" && next === "READY_FOR_PICKUP") ||
    (current === "READY_FOR_PICKUP" && next === "COMPLETED")
  );
}

export function makeOrderNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`
    .padStart(9, "0")
    .slice(0, 9);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `WO-${date}-${time}-${suffix}`;
}
