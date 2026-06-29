import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (value === null ? "" : value),
  z.string().trim().optional(),
);

function isPhoneLike(value: string) {
  return /^[0-9]{7,20}$/.test(value);
}

export const createWorkOrderSchema = z
  .object({
    vehicleId: z.string().uuid("Vehicle is required."),
    contactType: z.enum([
      "REGISTERED_OWNER",
      "OTHER_PERSON",
      "NEW_OWNER",
    ]),
    contactName: optionalText,
    contactPhone: optionalText,
    newOwnerName: optionalText,
    newOwnerPhone: optionalText,
    ownershipNotes: optionalText,
    notes: optionalText,
  })
  .superRefine((input, context) => {
    if (
      input.contactType === "OTHER_PERSON" &&
      input.contactPhone &&
      !isPhoneLike(input.contactPhone)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Other person phone can only contain numbers.",
        path: ["contactPhone"],
      });
    }

    if (
      input.contactType === "NEW_OWNER" &&
      input.newOwnerPhone &&
      !isPhoneLike(input.newOwnerPhone)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "New owner phone can only contain numbers.",
        path: ["newOwnerPhone"],
      });
    }
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

export const updateWorkOrderContactSchema = z
  .object({
    workOrderId: z.string().uuid("Work order is required."),
    contactType: z.enum(["REGISTERED_OWNER", "OTHER_PERSON"]),
    contactName: optionalText,
    contactPhone: optionalText,
  })
  .superRefine((input, context) => {
    if (input.contactType !== "OTHER_PERSON") {
      return;
    }

    if (!input.contactName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Other person name is required.",
        path: ["contactName"],
      });
    }

    if (!input.contactPhone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Other person phone is required.",
        path: ["contactPhone"],
      });
      return;
    }

    if (!isPhoneLike(input.contactPhone)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Other person phone can only contain numbers.",
        path: ["contactPhone"],
      });
    }
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
