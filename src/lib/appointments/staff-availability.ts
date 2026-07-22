import type { Prisma, PrismaClient } from "@prisma/client";
import { BUSINESS_TIME_ZONE } from "@/lib/business-time";
import { getAppointmentEnd } from "./scheduling";

type StaffAvailabilityRecord = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type StaffBreakRecord = {
  startTime: string;
  endTime: string;
  enabled: boolean;
};

type StaffAvailabilityDb = PrismaClient | Prisma.TransactionClient;

export function parseStaffTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isTimeRangeAvailable(input: {
  startTime: string;
  endTime: string;
  appointmentStartMinutes: number;
  appointmentEndMinutes: number;
}) {
  const start = parseStaffTime(input.startTime);
  const end = parseStaffTime(input.endTime);

  if (start === null || end === null || end <= start) {
    return false;
  }

  return (
    input.appointmentStartMinutes >= start && input.appointmentEndMinutes <= end
  );
}

export function timeRangesOverlap(input: {
  firstStart: string;
  firstEnd: string;
  secondStartMinutes: number;
  secondEndMinutes: number;
}) {
  const firstStart = parseStaffTime(input.firstStart);
  const firstEnd = parseStaffTime(input.firstEnd);

  if (firstStart === null || firstEnd === null || firstEnd <= firstStart) {
    return false;
  }

  return (
    firstStart < input.secondEndMinutes && input.secondStartMinutes < firstEnd
  );
}

function getLocalAppointmentParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  if (!weekday || weekdayMap[weekday] === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("Appointment date or time is invalid.");
  }

  return {
    dayOfWeek: weekdayMap[weekday],
    startMinutes: hour * 60 + minute,
  };
}

export async function assertStaffAvailability(
  db: StaffAvailabilityDb,
  input: {
    businessId: string;
    userId: string;
    scheduledAt: Date;
    durationMinutes: number;
  },
) {
  const local = getLocalAppointmentParts(input.scheduledAt);
  const appointmentEnd = getAppointmentEnd(
    input.scheduledAt,
    input.durationMinutes,
  );
  const endParts = getLocalAppointmentParts(appointmentEnd);

  if (endParts.dayOfWeek !== local.dayOfWeek) {
    throw new Error("The appointment cannot cross midnight.");
  }

  const weeklyAvailability = await db.staffAvailability.findMany({
    where: {
      businessId: input.businessId,
      userId: input.userId,
    },
  });

  // Existing staff without a configured schedule remain backward compatible.
  if (weeklyAvailability.length > 0) {
    const availability = weeklyAvailability.filter(
      (slot: StaffAvailabilityRecord) => slot.dayOfWeek === local.dayOfWeek,
    );
    const available = availability.some(
      (slot: StaffAvailabilityRecord) =>
        slot.enabled &&
        isTimeRangeAvailable({
          startTime: slot.startTime,
          endTime: slot.endTime,
          appointmentStartMinutes: local.startMinutes,
          appointmentEndMinutes: endParts.startMinutes,
        }),
    );

    if (!available) {
      throw new Error("The selected staff member is not available at this time.");
    }
  }

  const breaks = await db.staffBreak.findMany({
    where: {
      businessId: input.businessId,
      userId: input.userId,
      dayOfWeek: local.dayOfWeek,
      enabled: true,
    },
  });

  const overlapsBreak = breaks.some((breakSlot: StaffBreakRecord) =>
    timeRangesOverlap({
      firstStart: breakSlot.startTime,
      firstEnd: breakSlot.endTime,
      secondStartMinutes: local.startMinutes,
      secondEndMinutes: endParts.startMinutes,
    }),
  );

  if (overlapsBreak) {
    throw new Error("The selected staff member is on a break at this time.");
  }

  const timeOff = await db.staffTimeOff.findFirst({
    where: {
      businessId: input.businessId,
      userId: input.userId,
      startsAt: { lt: appointmentEnd },
      endsAt: { gt: input.scheduledAt },
    },
    select: { id: true },
  });

  if (timeOff) {
    throw new Error("The selected staff member is on leave at this time.");
  }
}
