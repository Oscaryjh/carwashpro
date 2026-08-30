import { z } from "zod";
import {
  DEFAULT_BUSINESS_TIME_ZONE,
  isValidIanaTimeZone,
} from "@/lib/business-day";

export const branchAttendanceSettingInputSchema = z.object({
  businessId: z.string().uuid("Business is invalid."),
  branchId: z.string().uuid("Branch is invalid."),
  latitude: z.coerce
    .number()
    .finite()
    .min(-90, "Latitude must be at least -90.")
    .max(90, "Latitude must be at most 90."),
  longitude: z.coerce
    .number()
    .finite()
    .min(-180, "Longitude must be at least -180.")
    .max(180, "Longitude must be at most 180."),
  geofenceRadiusMeters: z.coerce
    .number()
    .int()
    .min(20, "Geofence radius must be at least 20 metres.")
    .max(1000, "Geofence radius cannot exceed 1000 metres.")
    .default(100),
  minimumAccuracyMeters: z.coerce
    .number()
    .int()
    .min(10, "Maximum accepted GPS error must be at least 10 metres.")
    .max(500, "Maximum accepted GPS error cannot exceed 500 metres.")
    .default(80),
  requireGeofence: z.boolean().default(true),
  allowOutsideGeofenceRequest: z.boolean().default(true),
  requirePhoto: z.boolean().default(false),
  breakPolicy: z
    .enum(["MANUAL_PUNCH", "FLEXIBLE_CONFIRMATION", "PAID_BREAK"])
    .default("MANUAL_PUNCH"),
  targetBreakMinutes: z.coerce
    .number()
    .int()
    .min(0, "Break minutes cannot be negative.")
    .max(480, "Break minutes cannot exceed 480.")
    .default(60),
  normalWorkMinutesPerDay: z.coerce
    .number()
    .int()
    .min(60, "Normal work time must be at least 60 minutes.")
    .max(1440, "Normal work time cannot exceed 1440 minutes.")
    .default(480),
  shiftSpanMinutes: z.coerce
    .number()
    .int()
    .min(60, "Shift span must be at least 60 minutes.")
    .max(1440, "Shift span cannot exceed 1440 minutes.")
    .default(540),
  timezone: z
    .string()
    .trim()
    .default(DEFAULT_BUSINESS_TIME_ZONE)
    .refine(isValidIanaTimeZone, "Enter a valid IANA timezone."),
  isEnabled: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.shiftSpanMinutes < value.normalWorkMinutesPerDay) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shiftSpanMinutes"],
      message: "Shift span cannot be shorter than paid work time.",
    });
  }
});

export type BranchAttendanceSettingInput = z.infer<
  typeof branchAttendanceSettingInputSchema
>;

export function validateBranchAttendanceSettingInput(input: unknown) {
  return branchAttendanceSettingInputSchema.parse(input);
}
