import { NotificationQueuePriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { renderManagedWhatsAppTemplate } from "@/lib/whatsapp/templates";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";

export const APPOINTMENT_REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_APPOINTMENT_REMINDER_LEAD_TIME_MINUTES = 24 * 60;

const REMINDER_ELIGIBLE_STATUSES = new Set(["SCHEDULED", "CONFIRMED"]);
const APPOINTMENT_TIME_ZONE = "Asia/Kuala_Lumpur";

type ScheduleAppointmentReminderInput = {
  appointmentId: string;
  businessId: string;
  sentByUserId?: string | null;
  now?: Date;
};

type CancelAppointmentReminderInput = {
  appointmentId: string;
  businessId: string;
  reason?: string;
};

export function getAppointmentReminderAt(
  scheduledAt: Date,
  now = new Date(),
  leadTimeMs = APPOINTMENT_REMINDER_LEAD_TIME_MS,
) {
  if (scheduledAt.getTime() <= now.getTime()) {
    return null;
  }

  const preferredReminderAt = new Date(
    scheduledAt.getTime() - leadTimeMs,
  );

  return preferredReminderAt.getTime() > now.getTime()
    ? preferredReminderAt
    : now;
}

export function canScheduleAppointmentReminder(status: string) {
  return REMINDER_ELIGIBLE_STATUSES.has(status);
}

export async function scheduleAppointmentReminder({
  appointmentId,
  businessId,
  sentByUserId,
  now = new Date(),
}: ScheduleAppointmentReminderInput) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    include: {
      business: {
        select: {
          address: true,
          companyNo: true,
          name: true,
          phone: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      vehicle: {
        select: {
          brand: true,
          color: true,
          model: true,
          plateNumber: true,
        },
      },
    },
  });

  if (!appointment) {
    return { status: "NOT_FOUND" as const };
  }

  const reminderSetting = await prisma.appointmentReminderSetting.findUnique({
    where: { businessId },
    select: { enabled: true, leadTimeMinutes: true },
  });

  if (reminderSetting?.enabled === false) {
    await cancelAppointmentReminder({
      appointmentId,
      businessId,
      reason: "Appointment reminders are disabled for this business.",
    });
    return { status: "DISABLED" as const };
  }

  if (!canScheduleAppointmentReminder(appointment.status)) {
    await cancelAppointmentReminder({
      appointmentId,
      businessId,
      reason: "Appointment is no longer awaiting confirmation or arrival.",
    });
    return { status: "NOT_ELIGIBLE" as const };
  }

  const leadTimeMinutes = normalizeLeadTimeMinutes(
    reminderSetting?.leadTimeMinutes,
  );
  const reminderAt = getAppointmentReminderAt(
    appointment.scheduledAt,
    now,
    leadTimeMinutes * 60 * 1000,
  );

  if (!reminderAt) {
    await cancelAppointmentReminder({
      appointmentId,
      businessId,
      reason: "Appointment time has passed.",
    });
    return { status: "PAST_APPOINTMENT" as const };
  }

  const rawRecipientPhone =
    appointment.contactType === "OTHER_PERSON"
      ? appointment.contactPhone
      : appointment.customer.phone;
  const recipientPhone = normalizeMalaysiaWhatsAppPhone(rawRecipientPhone ?? "");

  if (!recipientPhone) {
    await cancelAppointmentReminder({
      appointmentId,
      businessId,
      reason: "Appointment reminder has no valid recipient phone.",
    });
    return { status: "NO_PHONE" as const };
  }

  const recipientName =
    appointment.contactType === "OTHER_PERSON"
      ? appointment.contactName?.trim() || appointment.customer.name
      : appointment.customer.name;
  const dedupeKey = getAppointmentReminderDedupeKey(
    appointment.id,
    appointment.scheduledAt,
  );
  const renderedMessageBody = await renderManagedWhatsAppTemplate("APPOINTMENT_REMINDER", {
    appointmentDate: formatAppointmentDate(appointment.scheduledAt),
    appointmentTime: formatAppointmentTime(appointment.scheduledAt),
    companyAddress: appointment.business.address,
    companyName: appointment.business.name,
    companyNo: appointment.business.companyNo,
    companyPhone: appointment.business.phone,
    customerName: recipientName,
    customerPhone: rawRecipientPhone,
    plateNumber: appointment.vehicle?.plateNumber ?? "",
    vehicleBrand: appointment.vehicle?.brand ?? "",
    vehicleModel: appointment.vehicle?.model ?? "",
    vehicleDisplayName: [
      appointment.vehicle?.brand,
      appointment.vehicle?.model,
      appointment.vehicle?.color,
    ]
      .filter(Boolean)
      .join(" "),
    vehicleName: [
      appointment.vehicle?.brand,
      appointment.vehicle?.model,
      appointment.vehicle?.color,
    ]
      .filter(Boolean)
      .join(" "),
  }, appointment.businessId);
  const messageBody = appointment.vehicle
    ? renderedMessageBody
    : renderedMessageBody
        .split("\n")
        .filter((line) => !/^\s*vehicle\s*:\s*$/i.test(line))
        .join("\n");
  const storedMessageBody =
    encodeWhatsAppStoredText(messageBody) ?? "Appointment reminder";

  const result = await prisma.$transaction(async (tx) => {
    const existingQueue = await tx.notificationQueue.findUnique({
      where: { dedupeKey },
      select: { id: true, queuedAt: true, status: true },
    });

    if (existingQueue) {
      return {
        queueId: existingQueue.id,
        reminderAt: existingQueue.queuedAt,
        status: "ALREADY_SCHEDULED" as const,
      };
    }

    const obsoleteQueues = await tx.notificationQueue.findMany({
      where: {
        appointmentId: appointment.id,
        businessId,
        status: "QUEUED",
      },
      select: { id: true, messageLogId: true },
    });
    const obsoleteMessageLogIds = obsoleteQueues
      .map((queueItem) => queueItem.messageLogId)
      .filter((messageLogId): messageLogId is string => Boolean(messageLogId));

    if (obsoleteQueues.length) {
      await tx.notificationQueue.updateMany({
        where: { id: { in: obsoleteQueues.map((queueItem) => queueItem.id) } },
        data: {
          status: "CANCELLED",
          errorMessage: "Replaced by a rescheduled appointment reminder.",
          nextAttemptAt: null,
        },
      });
    }

    if (obsoleteMessageLogIds.length) {
      await tx.whatsAppMessage.updateMany({
        where: { id: { in: obsoleteMessageLogIds }, status: "DRAFT" },
        data: {
          status: "CANCELLED",
          errorMessage: "Replaced by a rescheduled appointment reminder.",
        },
      });
    }

    const messageLog = await tx.whatsAppMessage.create({
      data: {
        appointmentId: appointment.id,
        businessId,
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        sentByUserId: sentByUserId ?? appointment.createdById,
        phone: recipientPhone,
        recipientPhone,
        messageType: "APPOINTMENT_REMINDER",
        messageBody: storedMessageBody,
        status: "DRAFT",
        provider: "WHATSAPP_WEB_AUTO",
        queuedAt: reminderAt,
      },
    });

    const queueItem = await tx.notificationQueue.create({
      data: {
        appointmentId: appointment.id,
        businessId,
        branchId: appointment.branchId,
        dedupeKey,
        phone: recipientPhone,
        message: messageBody,
        messageType: "APPOINTMENT_REMINDER",
        messageLogId: messageLog.id,
        priority: NotificationQueuePriority.NORMAL,
        status: "QUEUED",
        queuedAt: reminderAt,
        nextAttemptAt: reminderAt,
      },
    });

    return {
      queueId: queueItem.id,
      reminderAt,
      status: "SCHEDULED" as const,
    };
  });

  return result;
}

export async function cancelAppointmentReminder({
  appointmentId,
  businessId,
  reason = "Appointment reminder cancelled.",
}: CancelAppointmentReminderInput) {
  return prisma.$transaction(async (tx) => {
    const queueItems = await tx.notificationQueue.findMany({
      where: {
        appointmentId,
        businessId,
        status: "QUEUED",
      },
      select: { id: true, messageLogId: true },
    });

    if (!queueItems.length) {
      return { cancelled: 0 };
    }

    await tx.notificationQueue.updateMany({
      where: { id: { in: queueItems.map((queueItem) => queueItem.id) } },
      data: {
        status: "CANCELLED",
        errorMessage: reason,
        nextAttemptAt: null,
      },
    });

    const messageLogIds = queueItems
      .map((queueItem) => queueItem.messageLogId)
      .filter((messageLogId): messageLogId is string => Boolean(messageLogId));

    if (messageLogIds.length) {
      await tx.whatsAppMessage.updateMany({
        where: { id: { in: messageLogIds }, status: "DRAFT" },
        data: {
          status: "CANCELLED",
          errorMessage: reason,
        },
      });
    }

    return { cancelled: queueItems.length };
  });
}

export function getAppointmentReminderDedupeKey(
  appointmentId: string,
  scheduledAt: Date,
) {
  return `appointment-reminder:${appointmentId}:${scheduledAt.toISOString()}`;
}

function formatAppointmentDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "long",
    timeZone: APPOINTMENT_TIME_ZONE,
    year: "numeric",
  });
}

function formatAppointmentTime(value: Date) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APPOINTMENT_TIME_ZONE,
  });
}

function normalizeLeadTimeMinutes(value: number | null | undefined) {
  if (!Number.isInteger(value) || value === undefined || value === null) {
    return DEFAULT_APPOINTMENT_REMINDER_LEAD_TIME_MINUTES;
  }

  return Math.min(Math.max(value, 5), 10080);
}
