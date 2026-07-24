import { z } from "zod";
import { parseBusinessDateTime } from "@/lib/business-time";

const optionalText = z.preprocess(
  (value) => (value === null ? "" : value),
  z.string().trim().optional(),
);

const optionalUuid = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    return value;
  },
  z.string().uuid("Customer is invalid.").optional(),
);

const contactType = z.preprocess(
  (value) => (value === null || value === "" ? "REGISTERED_OWNER" : value),
  z.enum(["REGISTERED_OWNER", "OTHER_PERSON"]),
);

export const WALK_IN_WINDOW_MINUTES = 30;
export type AppointmentVisitType = "BOOKING" | "WALK_IN";

const appointmentVisitType = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.enum(["BOOKING", "WALK_IN"]).optional(),
);

export function getDefaultAppointmentVisitType(
  scheduledAt: Date,
  now = new Date(),
): AppointmentVisitType {
  const differenceMinutes = Math.abs(scheduledAt.getTime() - now.getTime()) / 60_000;
  return differenceMinutes <= WALK_IN_WINDOW_MINUTES ? "WALK_IN" : "BOOKING";
}

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
    customerId: optionalUuid,
    vehicleId: optionalText,
    serviceId: optionalText,
    serviceIds: z.array(z.string().uuid("Service is invalid.")).default([]),
    productIds: z.array(z.string().uuid("Product is invalid.")).max(100).default([]),
    packageIds: z.array(z.string().uuid("Package is invalid.")).max(100).default([]),
    scheduledDate: z.string().trim().min(1, "Date is required."),
    scheduledTime: z.string().trim().min(1, "Time is required."),
    visitType: appointmentVisitType,
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
  status: z.enum(["COMPLETED", "CANCELLED", "NO_SHOW"]),
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
  notes: optionalText,
  serviceIds: z.array(z.string().uuid("Service is invalid.")).default([]),
  productIds: z.array(z.string().uuid("Product is invalid.")).max(100).default([]),
  packageIds: z.array(z.string().uuid("Package is invalid.")).max(100).default([]),
  scheduledDate: z.string().trim().min(1, "Date is required."),
  scheduledTime: z.string().trim().min(1, "Time is required."),
});

export const addAppointmentServicesSchema = z.object({
  appointmentId: z.string().uuid("Appointment is required."),
  serviceIds: z.array(z.string().uuid("Service is invalid.")).min(1, "Select at least one service."),
});

// Legacy states remain readable for existing records, but new appointment
// workflows only expose Scheduled, Completed, Cancelled and No Show.
export const LEGACY_ACTIVE_APPOINTMENT_STATUSES = [
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
] as const;

// Salon exposes a short operational flow. Legacy values stay readable so old
// appointments can still be displayed and completed safely.
export const SALON_APPOINTMENT_ACTIVE_STATUSES = [
  "SCHEDULED",
  ...LEGACY_ACTIVE_APPOINTMENT_STATUSES,
] as const;

export const SALON_APPOINTMENT_CALENDAR_STATUSES = [
  ...SALON_APPOINTMENT_ACTIVE_STATUSES,
  "COMPLETED",
] as const;

export const ACTIVE_APPOINTMENT_STATUSES = [
  ...SALON_APPOINTMENT_ACTIVE_STATUSES,
] as const;

export function parseAppointmentDateTime(date: string, time: string) {
  return parseBusinessDateTime(date, time);
}

export function canMoveAppointmentStatus(current: string, next: string) {
  if (
    current === "COMPLETED" ||
    current === "CONVERTED_TO_JOB" ||
    current === "CANCELLED" ||
    current === "NO_SHOW"
  ) {
    return false;
  }

  if (next === "CANCELLED") {
    return ACTIVE_APPOINTMENT_STATUSES.includes(current as (typeof ACTIVE_APPOINTMENT_STATUSES)[number]);
  }

  if (next === "NO_SHOW") {
    return ["SCHEDULED", ...LEGACY_ACTIVE_APPOINTMENT_STATUSES].includes(
      current as (typeof ACTIVE_APPOINTMENT_STATUSES)[number],
    );
  }

  return next === "COMPLETED" &&
    ACTIVE_APPOINTMENT_STATUSES.includes(current as (typeof ACTIVE_APPOINTMENT_STATUSES)[number]);
}

export function formatAppointmentStatus(status: string) {
  if (LEGACY_ACTIVE_APPOINTMENT_STATUSES.includes(status as (typeof LEGACY_ACTIVE_APPOINTMENT_STATUSES)[number])) {
    return "scheduled";
  }

  return status.toLowerCase().replaceAll("_", " ");
}

export function normalizeSalonAppointmentStatus(status: string) {
  if (LEGACY_ACTIVE_APPOINTMENT_STATUSES.includes(
    status as (typeof LEGACY_ACTIVE_APPOINTMENT_STATUSES)[number],
  )) {
    return "SCHEDULED" as const;
  }

  return status;
}
