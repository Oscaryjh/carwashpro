import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (value === null ? "" : value),
  z.string().trim().optional(),
);

const contactType = z.preprocess(
  (value) => (value === null || value === "" ? "REGISTERED_OWNER" : value),
  z.enum(["REGISTERED_OWNER", "OTHER_PERSON"]),
);

function isPhoneLike(value: string) {
  return /^[0-9]{7,20}$/.test(value.trim().replace(/[^\d]/g, ""));
}

export const createAppointmentSchema = z
  .object({
    assignedStaffId: optionalText,
    branchId: optionalText,
    contactName: optionalText,
    contactPhone: optionalText,
    contactType,
    vehicleId: z.string().uuid("Vehicle is required."),
    serviceId: optionalText,
    serviceIds: z.array(z.string().uuid("Service is invalid.")).default([]),
    scheduledDate: z.string().trim().min(1, "Date is required."),
    scheduledTime: z.string().trim().min(1, "Time is required."),
    notes: optionalText,
  })
  .superRefine((input, context) => {
    if (input.contactType !== "OTHER_PERSON") {
      return;
    }

    if (!input.contactName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick up contact name is required.",
        path: ["contactName"],
      });
    }

    if (!input.contactPhone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick up contact phone is required.",
        path: ["contactPhone"],
      });
      return;
    }

    if (!isPhoneLike(input.contactPhone)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick up contact phone must contain 7 to 20 digits.",
        path: ["contactPhone"],
      });
    }
  });

export const updateAppointmentStatusSchema = z.object({
  appointmentId: z.string().uuid("Appointment is required."),
  status: z.enum(["CONFIRMED", "ARRIVED", "CANCELLED", "NO_SHOW"]),
});

export const convertAppointmentSchema = z.object({
  appointmentId: z.string().uuid("Appointment is required."),
});

export const rescheduleAppointmentSchema = z.object({
  assignedStaffId: optionalText,
  appointmentId: z.string().uuid("Appointment is required."),
  scheduledDate: z.string().trim().min(1, "Date is required."),
  scheduledTime: z.string().trim().min(1, "Time is required."),
});

export const updateAppointmentDetailsSchema = z.object({
  appointmentId: z.string().uuid("Appointment is required."),
  assignedStaffId: optionalText,
  serviceIds: z.array(z.string().uuid("Service is invalid.")).default([]),
  scheduledDate: z.string().trim().min(1, "Date is required."),
  scheduledTime: z.string().trim().min(1, "Time is required."),
});

export function parseAppointmentDateTime(date: string, time: string) {
  const scheduledAt = new Date(`${date}T${time}:00`);

  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("Appointment date or time is invalid.");
  }

  return scheduledAt;
}

export function canMoveAppointmentStatus(current: string, next: string) {
  if (current === "CONVERTED_TO_JOB" || current === "CANCELLED" || current === "NO_SHOW") {
    return false;
  }

  if (next === "CANCELLED" || next === "NO_SHOW") {
    return true;
  }

  return (
    (current === "SCHEDULED" && next === "CONFIRMED") ||
    ((current === "SCHEDULED" || current === "CONFIRMED") && next === "ARRIVED")
  );
}

export function formatAppointmentStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
