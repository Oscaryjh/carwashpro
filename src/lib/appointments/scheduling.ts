export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 15;
export const APPOINTMENT_SLOT_MINUTES = 15;

export const STAFF_BLOCKING_APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_SERVICE",
] as const;

export function calculateAppointmentDurationMinutes(
  serviceDurations: Array<number | null | undefined>,
): number {
  if (serviceDurations.length === 0) {
    return DEFAULT_APPOINTMENT_DURATION_MINUTES;
  }

  return serviceDurations.reduce<number>(
    (total, duration) =>
      total +
      (typeof duration === "number" && duration > 0
        ? duration
        : DEFAULT_APPOINTMENT_DURATION_MINUTES),
    0,
  );
}

export function getAppointmentEnd(
  scheduledAt: Date,
  durationMinutes: number,
) {
  return new Date(
    scheduledAt.getTime() +
      Math.max(DEFAULT_APPOINTMENT_DURATION_MINUTES, durationMinutes) * 60_000,
  );
}

export function appointmentIntervalsOverlap(input: {
  firstDurationMinutes: number;
  firstStart: Date;
  secondDurationMinutes: number;
  secondStart: Date;
}) {
  const firstEnd = getAppointmentEnd(
    input.firstStart,
    input.firstDurationMinutes,
  );
  const secondEnd = getAppointmentEnd(
    input.secondStart,
    input.secondDurationMinutes,
  );

  return input.firstStart < secondEnd && input.secondStart < firstEnd;
}

export function getAppointmentSlotCount(durationMinutes: number) {
  return Math.max(
    1,
    Math.ceil(
      Math.max(DEFAULT_APPOINTMENT_DURATION_MINUTES, durationMinutes) /
        APPOINTMENT_SLOT_MINUTES,
    ),
  );
}
