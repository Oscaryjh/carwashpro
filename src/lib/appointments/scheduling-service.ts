import type { AppointmentStatus, Prisma } from "@prisma/client";
import {
  STAFF_BLOCKING_APPOINTMENT_STATUSES,
  appointmentIntervalsOverlap,
  calculateAppointmentDurationMinutes,
  getAppointmentEnd,
} from "@/lib/appointments/scheduling";

type AppointmentSchedulingDb = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "appointment" | "service"
>;

export type AppointmentScheduleConflict = {
  appointmentId: string;
  customerName: string;
  durationMinutes: number;
  scheduledAt: Date;
};

export async function resolveAppointmentDurationMinutes(
  db: AppointmentSchedulingDb,
  input: {
    businessId: string;
    serviceIds: string[];
  },
) {
  if (input.serviceIds.length === 0) {
    return calculateAppointmentDurationMinutes([]);
  }

  const services = await db.service.findMany({
    where: {
      businessId: input.businessId,
      id: { in: input.serviceIds },
    },
    select: { durationMinutes: true },
  });

  return calculateAppointmentDurationMinutes(
    services.map((service) => service.durationMinutes),
  );
}

export async function lockStaffAppointmentSchedule(
  db: AppointmentSchedulingDb,
  staffId: string,
) {
  await db.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${staffId}, 0))
  `;
}

export async function findStaffAppointmentConflict(
  db: AppointmentSchedulingDb,
  input: {
    businessId: string;
    durationMinutes: number;
    excludeAppointmentId?: string;
    scheduledAt: Date;
    staffId: string | null;
  },
): Promise<AppointmentScheduleConflict | null> {
  if (!input.staffId) {
    return null;
  }

  const candidateEnd = getAppointmentEnd(
    input.scheduledAt,
    input.durationMinutes,
  );
  const lookbackStart = new Date(input.scheduledAt.getTime() - 7 * 24 * 60 * 60_000);
  const appointments = await db.appointment.findMany({
    where: {
      businessId: input.businessId,
      assignedStaffId: input.staffId,
      ...(input.excludeAppointmentId
        ? { id: { not: input.excludeAppointmentId } }
        : {}),
      status: {
        in: STAFF_BLOCKING_APPOINTMENT_STATUSES as unknown as AppointmentStatus[],
      },
      scheduledAt: {
        gte: lookbackStart,
        lt: candidateEnd,
      },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      customer: { select: { name: true } },
      durationMinutes: true,
      id: true,
      scheduledAt: true,
    },
  });

  const conflict = appointments.find((appointment) =>
    appointmentIntervalsOverlap({
      firstDurationMinutes: input.durationMinutes,
      firstStart: input.scheduledAt,
      secondDurationMinutes: appointment.durationMinutes,
      secondStart: appointment.scheduledAt,
    }),
  );

  return conflict
    ? {
        appointmentId: conflict.id,
        customerName: conflict.customer.name,
        durationMinutes: conflict.durationMinutes,
        scheduledAt: conflict.scheduledAt,
      }
    : null;
}

export function formatAppointmentConflictMessage(
  conflict: AppointmentScheduleConflict,
) {
  const start = conflict.scheduledAt.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = getAppointmentEnd(
    conflict.scheduledAt,
    conflict.durationMinutes,
  ).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `This staff member already has ${conflict.customerName} booked from ${start} to ${end}.`;
}
