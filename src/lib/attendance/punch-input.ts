import { z } from "zod";

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "Idempotency key is too short.")
  .max(128, "Idempotency key is too long.")
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "Idempotency key contains unsupported characters.",
  );

const optionalLatitudeSchema = z
  .number()
  .finite()
  .min(-90)
  .max(90)
  .nullable()
  .optional();
const optionalLongitudeSchema = z
  .number()
  .finite()
  .min(-180)
  .max(180)
  .nullable()
  .optional();
const optionalAccuracySchema = z
  .number()
  .finite()
  .positive("GPS accuracy must be greater than zero.")
  .max(100_000, "GPS accuracy is outside the supported range.")
  .nullable()
  .optional();

const deviceTimestampSchema = z.union([
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  z.date(),
]);

export const attendancePunchInputSchema = z
  .object({
    branchId: z.string().uuid("Branch is invalid."),
    latitude: optionalLatitudeSchema,
    longitude: optionalLongitudeSchema,
    accuracyMeters: optionalAccuracySchema,
    deviceTimestamp: deviceTimestampSchema.nullable().optional(),
    deviceIdentifier: z
      .string()
      .trim()
      .min(8, "Device identifier is too short.")
      .max(256, "Device identifier is too long."),
    idempotencyKey: idempotencyKeySchema,
    exceptionReason: z
      .string()
      .trim()
      .min(3, "Exception reason is too short.")
      .max(500, "Exception reason is too long.")
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const gpsValues = [
      value.latitude,
      value.longitude,
      value.accuracyMeters,
    ];
    const suppliedGpsValues = gpsValues.filter(
      (item) => item !== null && item !== undefined,
    ).length;
    if (suppliedGpsValues !== 0 && suppliedGpsValues !== gpsValues.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latitude"],
        message:
          "Latitude, longitude and GPS accuracy must be supplied together.",
      });
    }
  });

export type AttendancePunchInput = z.infer<
  typeof attendancePunchInputSchema
>;

export const attendanceExceptionInputSchema = z
  .object({
    branchId: z.string().uuid("Branch is invalid."),
    attendanceSessionId: z
      .string()
      .uuid("Attendance session is invalid."),
    attendancePunchId: z
      .string()
      .uuid("Attendance punch is invalid.")
      .nullable()
      .optional(),
    type: z.enum([
      "OUTSIDE_GEOFENCE",
      "GPS_INACCURATE",
      "GPS_UNAVAILABLE",
      "OTHER",
    ]),
    reason: z
      .string()
      .trim()
      .min(3, "Exception reason is too short.")
      .max(500, "Exception reason is too long."),
    deviceIdentifier: z
      .string()
      .trim()
      .min(8, "Device identifier is too short.")
      .max(256, "Device identifier is too long."),
  })
  .strict();

export type AttendanceExceptionInput = z.infer<
  typeof attendanceExceptionInputSchema
>;

export const ATTENDANCE_HISTORY_MAX_RANGE_DAYS = 31;

export function parseAttendanceDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }
  return parsed;
}

const historyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD.")
  .refine(
    (value) => parseAttendanceDateKey(value) !== null,
    "Date does not exist.",
  );

export const attendanceHistoryInputSchema = z
  .object({
    from: historyDateSchema.optional(),
    to: historyDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z
      .enum(["OPEN", "ON_BREAK", "COMPLETED", "INCOMPLETE", "CANCELLED"])
      .optional(),
    branchId: z.string().uuid("Branch is invalid.").optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.from || !value.to) {
      return;
    }
    const from = parseAttendanceDateKey(value.from);
    const to = parseAttendanceDateKey(value.to);
    if (!from || !to) {
      return;
    }
    if (from.getTime() > to.getTime()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "History start date must not be after end date.",
      });
      return;
    }
    const inclusiveDays =
      Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (inclusiveDays > ATTENDANCE_HISTORY_MAX_RANGE_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `History range cannot exceed ${ATTENDANCE_HISTORY_MAX_RANGE_DAYS} days.`,
      });
    }
  });

export type AttendanceHistoryInput = z.infer<
  typeof attendanceHistoryInputSchema
>;
