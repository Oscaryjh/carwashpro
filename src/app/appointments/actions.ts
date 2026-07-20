"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import {
  findStaffAppointmentConflict,
  formatAppointmentConflictMessage,
  lockStaffAppointmentSchedule,
  resolveAppointmentDurationMinutes,
} from "@/lib/appointments/scheduling-service";
import { assertStaffAvailability } from "@/lib/appointments/staff-availability";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import { normalizeCustomerPhone } from "@/lib/validation/crm";
import {
  canMoveAppointmentStatus,
  addAppointmentServicesSchema,
  convertAppointmentSchema,
  createAppointmentSchema,
  parseAppointmentDateTime,
  rescheduleAppointmentSchema,
  updateAppointmentDetailsSchema,
  updateAppointmentStatusSchema,
} from "@/lib/validation/appointments";
import { money } from "@/lib/validation/services";
import {
  fromCents,
  salonAppointmentPaymentSchema,
} from "@/lib/validation/pos";
import { makeOrderNumber } from "@/lib/validation/work-orders";
import {
  cancelAppointmentReminder,
  scheduleAppointmentReminder,
} from "@/lib/whatsapp/appointment-reminders";
import { sendServiceConfirmationQueued } from "@/lib/whatsapp/work-order-notifications";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function staffBranchFilter(user: { role: string; branchId?: string | null }) {
  return user.role === "BUSINESS_OWNER"
    ? {}
    : { branchId: user.branchId ?? "00000000-0000-0000-0000-000000000000" };
}

function optionalUuid(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export type AppointmentMutationResult =
  | { ok: true }
  | { ok: false; error: string };

async function assertStaffCanPerformServices(input: {
  assignedStaffId: string | null;
  businessId: string;
  serviceIds: string[];
}) {
  if (!input.assignedStaffId || input.serviceIds.length === 0) {
    return;
  }

  const services = await prisma.service.findMany({
    where: {
      businessId: input.businessId,
      id: { in: input.serviceIds },
    },
    select: {
      name: true,
      staffAssignments: {
        select: { userId: true },
      },
    },
  });

  const unsupportedService = services.find(
    (service) =>
      service.staffAssignments.length > 0 &&
      !service.staffAssignments.some(
        (assignment) => assignment.userId === input.assignedStaffId,
      ),
  );

  if (unsupportedService) {
    throw new Error(
      `The selected staff member is not assigned to ${unsupportedService.name}.`,
    );
  }
}

async function scheduleReminderSafely(input: {
  appointmentId: string;
  businessId: string;
  sentByUserId: string;
}) {
  try {
    await scheduleAppointmentReminder(input);
  } catch (error) {
    console.error("[appointment-reminder] Unable to schedule reminder", {
      appointmentId: input.appointmentId,
      businessId: input.businessId,
      error,
    });
  }
}

async function cancelReminderSafely(input: {
  appointmentId: string;
  businessId: string;
  reason: string;
}) {
  try {
    await cancelAppointmentReminder(input);
  } catch (error) {
    console.error("[appointment-reminder] Unable to cancel reminder", {
      appointmentId: input.appointmentId,
      businessId: input.businessId,
      error,
    });
  }
}

async function createAppointment(formData: FormData): Promise<AppointmentMutationResult> {
  const { businessId, industryType, user } = await requireBusinessUser();
  const parsedInput = createAppointmentSchema.safeParse({
    assignedStaffId: formData.get("assignedStaffId"),
    branchId: formData.get("branchId"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactType: formData.get("contactType"),
    customerId: formData.get("customerId"),
    vehicleId: formData.get("vehicleId"),
    serviceId: formData.get("serviceId"),
    serviceIds: formData.getAll("serviceIds"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
    notes: formData.get("notes"),
  });

  if (!parsedInput.success) {
    const message = parsedInput.error.issues[0]?.message ?? "Appointment details are incomplete.";
    return { ok: false, error: message };
  }

  const input = parsedInput.data;
  const branchId = optionalUuid(await resolveOperationalBranchId(
    businessId,
    user,
    input.branchId || null,
  ));
  const appointmentBranchId = branchId;
  const scheduledAt = parseAppointmentDateTime(
    input.scheduledDate,
    input.scheduledTime,
  );

  const isSalon = industryType === "SALON_BEAUTY";
  const vehicle = input.vehicleId
    ? await prisma.vehicle.findFirst({
        where: { id: input.vehicleId, businessId },
        select: {
          id: true,
          customerId: true,
          customer: { select: { name: true, phone: true } },
        },
      })
    : null;

  if (!isSalon && !vehicle) {
    return { ok: false, error: "Vehicle is required." };
  }

  const customer = isSalon && input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, businessId },
        select: { id: true, name: true, phone: true },
      })
    : vehicle
      ? { id: vehicle.customerId, ...vehicle.customer }
      : null;

  if (!customer) {
    return {
      ok: false,
      error: isSalon ? "Customer is required." : "Vehicle is required.",
    };
  }

  const serviceIds = [...new Set(input.serviceIds.filter(Boolean))];
  const serviceId = (serviceIds[0] ?? input.serviceId) || null;
  const assignedStaffId = optionalUuid(input.assignedStaffId);
  const appointmentContactName =
    !isSalon && input.contactType === "OTHER_PERSON"
      ? input.contactName || null
      : customer.name;
  const appointmentContactPhone =
    !isSalon && input.contactType === "OTHER_PERSON"
      ? normalizeCustomerPhone(input.contactPhone || "")
      : customer.phone;

  if (serviceIds.length) {
    const activeServiceCount = await prisma.service.count({
      where: {
        id: { in: serviceIds },
        businessId,
        status: "ACTIVE",
      },
    });

    if (activeServiceCount !== serviceIds.length) {
      throw new Error("One or more selected services are invalid.");
    }
  } else if (serviceId) {
    await prisma.service.findFirstOrThrow({
      where: { id: serviceId, businessId, status: "ACTIVE" },
      select: { id: true },
    });
  }

  if (assignedStaffId) {
    await prisma.user.findFirstOrThrow({
      where: {
        id: assignedStaffId,
        businessId,
        status: "active",
        ...(appointmentBranchId ? { OR: [{ branchId: appointmentBranchId }, { role: "BUSINESS_OWNER" }] } : {}),
      },
      select: { id: true },
    });
  }

  await assertStaffCanPerformServices({
    assignedStaffId,
    businessId,
    serviceIds: serviceIds.length ? serviceIds : serviceId ? [serviceId] : [],
  });

  const selectedServiceIds = serviceIds.length
    ? serviceIds
    : serviceId
      ? [serviceId]
      : [];
  const result = await prisma.$transaction(async (tx) => {
    const durationMinutes = await resolveAppointmentDurationMinutes(tx, {
      businessId,
      serviceIds: selectedServiceIds,
    });

    if (assignedStaffId) {
      await assertStaffAvailability(tx, {
        businessId,
        userId: assignedStaffId,
        scheduledAt,
        durationMinutes,
      });
      await lockStaffAppointmentSchedule(tx, assignedStaffId);
      const conflict = await findStaffAppointmentConflict(tx, {
        businessId,
        durationMinutes,
        scheduledAt,
        staffId: assignedStaffId,
      });

      if (conflict) {
        return { appointment: null, conflict };
      }
    }

    const appointment = await tx.appointment.create({
      data: {
        businessId,
        branchId: appointmentBranchId,
        customerId: customer.id,
        vehicleId: vehicle?.id ?? null,
        serviceId,
        serviceIds,
        createdById: user.userId,
        assignedStaffId,
        contactType: isSalon ? "REGISTERED_OWNER" : input.contactType,
        contactName: appointmentContactName,
        contactPhone: appointmentContactPhone,
        durationMinutes,
        scheduledAt,
        notes: input.notes || null,
      },
    });

    return { appointment, conflict: null };
  });

  if (result.conflict) {
    return {
      ok: false,
      error: formatAppointmentConflictMessage(result.conflict),
    };
  }

  const appointment = result.appointment!;

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  return { ok: true };
}

export async function createAppointmentInlineAction(
  formData: FormData,
): Promise<AppointmentMutationResult> {
  return createAppointment(formData);
}

export async function createAppointmentAction(formData: FormData): Promise<void> {
  const scheduledDate =
    formData.get("scheduledDate")?.toString() || new Date().toISOString().slice(0, 10);
  const result = await createAppointment(formData);

  if (!result.ok) {
    redirect(
      `/appointments?status=active&page=1&date=${scheduledDate}&type=error&message=${encodeURIComponent(
        result.error,
      )}`,
    );
  }

  redirect(`/appointments?status=active&page=1&date=${scheduledDate}`);
}

export async function updateAppointmentStatusAction(formData: FormData) {
  const { businessId, industryType, user } = await requireBusinessUser();
  const input = updateAppointmentStatusSchema.parse({
    appointmentId: formData.get("appointmentId"),
    status: formData.get("status"),
  });
  const redirectTo = formData.get("redirectTo")?.toString();

  const appointment = await prisma.appointment.findFirstOrThrow({
    where: {
      id: input.appointmentId,
      businessId,
      ...staffBranchFilter(user),
    },
    select: {
      assignedStaffId: true,
      id: true,
      serviceId: true,
      serviceIds: true,
      status: true,
    },
  });

  if (input.status === "COMPLETED" && industryType !== "SALON_BEAUTY") {
    throw new Error("This status is only available for Salon appointments.");
  }

  if (input.status === "COMPLETED") {
    if (!appointment.serviceId && appointment.serviceIds.length === 0) {
      throw new Error("Select at least one service before completing the service.");
    }
  }

  if (!canMoveAppointmentStatus(appointment.status, input.status)) {
    throw new Error("This appointment cannot move to that status.");
  }

  const now = new Date();
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: input.status,
      completedAt: input.status === "COMPLETED" ? now : undefined,
      cancelledAt: input.status === "CANCELLED" ? now : undefined,
      noShowAt: input.status === "NO_SHOW" ? now : undefined,
    },
  });

  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(input.status)) {
    await cancelReminderSafely({
      appointmentId: appointment.id,
      businessId,
      reason: `Appointment status changed to ${input.status}.`,
    });
  }

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
  redirect(redirectTo || `/appointments/${appointment.id}`);
}

export async function rescheduleAppointmentAction(
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const { businessId, user } = await requireBusinessUser();
  const input = rescheduleAppointmentSchema.parse({
    assignedStaffId: formData.get("assignedStaffId"),
    appointmentId: formData.get("appointmentId"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
  });
  const shouldUpdateStaff = formData.has("assignedStaffId");
  const assignedStaffId = optionalUuid(input.assignedStaffId);
  const scheduledAt = parseAppointmentDateTime(
    input.scheduledDate,
    input.scheduledTime,
  );

  const appointment = await prisma.appointment.findFirstOrThrow({
    where: {
      id: input.appointmentId,
      businessId,
      ...staffBranchFilter(user),
      status: {
        in: ["SCHEDULED", "CONFIRMED", "ARRIVED"],
      },
    },
    select: {
      assignedStaffId: true,
      branchId: true,
      durationMinutes: true,
      id: true,
      invoice: { select: { id: true } },
      serviceId: true,
      serviceIds: true,
    },
  });

  if (appointment.invoice) {
    throw new Error("This appointment already has an invoice and can no longer be rescheduled.");
  }

  if (shouldUpdateStaff && assignedStaffId) {
    await prisma.user.findFirstOrThrow({
      where: {
        id: assignedStaffId,
        businessId,
        status: "active",
        ...(appointment.branchId
          ? { OR: [{ branchId: appointment.branchId }, { role: "BUSINESS_OWNER" }] }
          : {}),
      },
      select: { id: true },
    });

    await assertStaffCanPerformServices({
      assignedStaffId,
      businessId,
      serviceIds: appointment.serviceIds.length
        ? appointment.serviceIds
        : appointment.serviceId
          ? [appointment.serviceId]
          : [],
    });
  }

  const targetStaffId = shouldUpdateStaff
    ? assignedStaffId
    : appointment.assignedStaffId;
  const result = await prisma.$transaction(async (tx) => {
    if (targetStaffId) {
      await assertStaffAvailability(tx, {
        businessId,
        userId: targetStaffId,
        scheduledAt,
        durationMinutes: appointment.durationMinutes,
      });
      await lockStaffAppointmentSchedule(tx, targetStaffId);
      const conflict = await findStaffAppointmentConflict(tx, {
        businessId,
        durationMinutes: appointment.durationMinutes,
        excludeAppointmentId: appointment.id,
        scheduledAt,
        staffId: targetStaffId,
      });

      if (conflict) {
        return { conflict };
      }
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        scheduledAt,
        ...(shouldUpdateStaff ? { assignedStaffId } : {}),
      },
    });

    return { conflict: null };
  });

  if (result.conflict) {
    return {
      ok: false,
      error: formatAppointmentConflictMessage(result.conflict),
    };
  }

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
  return { ok: true };
}

export async function updateAppointmentDetailsAction(
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const { businessId, user } = await requireBusinessUser();
  const input = updateAppointmentDetailsSchema.parse({
    appointmentId: formData.get("appointmentId"),
    assignedStaffId: formData.get("assignedStaffId"),
    notes: formData.get("notes"),
    serviceIds: formData.getAll("serviceIds"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
  });
  const scheduledAt = parseAppointmentDateTime(input.scheduledDate, input.scheduledTime);
  const serviceIds = [...new Set(input.serviceIds)];
  const serviceId = serviceIds[0] ?? null;
  const assignedStaffId = optionalUuid(input.assignedStaffId);

  const appointment = await prisma.appointment.findFirstOrThrow({
    where: {
      id: input.appointmentId,
      businessId,
      ...staffBranchFilter(user),
      status: {
        in: ["SCHEDULED", "CONFIRMED", "ARRIVED"],
      },
    },
    select: {
      branchId: true,
      id: true,
      invoice: { select: { id: true } },
    },
  });

  if (appointment.invoice) {
    throw new Error("This appointment already has an invoice. Void or refund it before changing appointment details.");
  }

  if (serviceIds.length) {
    const activeServiceCount = await prisma.service.count({
      where: {
        id: { in: serviceIds },
        businessId,
        status: "ACTIVE",
      },
    });

    if (activeServiceCount !== serviceIds.length) {
      throw new Error("One or more selected services are invalid.");
    }
  }

  if (assignedStaffId) {
    await prisma.user.findFirstOrThrow({
      where: {
        id: assignedStaffId,
        businessId,
        status: "active",
        ...(appointment.branchId
          ? { OR: [{ branchId: appointment.branchId }, { role: "BUSINESS_OWNER" }] }
          : {}),
      },
      select: { id: true },
    });
  }


  await assertStaffCanPerformServices({
    assignedStaffId,
    businessId,
    serviceIds,
  });

  const result = await prisma.$transaction(async (tx) => {
    const durationMinutes = await resolveAppointmentDurationMinutes(tx, {
      businessId,
      serviceIds,
    });

    if (assignedStaffId) {
      await assertStaffAvailability(tx, {
        businessId,
        userId: assignedStaffId,
        scheduledAt,
        durationMinutes,
      });
      await lockStaffAppointmentSchedule(tx, assignedStaffId);
      const conflict = await findStaffAppointmentConflict(tx, {
        businessId,
        durationMinutes,
        excludeAppointmentId: appointment.id,
        scheduledAt,
        staffId: assignedStaffId,
      });

      if (conflict) {
        return { conflict };
      }
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        assignedStaffId,
        durationMinutes,
        notes: input.notes || null,
        scheduledAt,
        serviceId,
        serviceIds,
      },
    });

    return { conflict: null };
  });

  if (result.conflict) {
    return {
      ok: false,
      error: formatAppointmentConflictMessage(result.conflict),
    };
  }

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
  return { ok: true };
}

export async function addAppointmentServicesAction(formData: FormData) {
  const { businessId, industryType, user } = await requireBusinessUser();
  const input = addAppointmentServicesSchema.parse({
    appointmentId: formData.get("appointmentId"),
    serviceIds: formData.getAll("serviceIds"),
  });
  const auditRequest = await getAuditRequestContext();

  if (industryType !== "SALON_BEAUTY") {
    throw new Error("Adding services during an appointment is only available to Salon businesses.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirstOrThrow({
      where: {
        id: input.appointmentId,
        businessId,
        ...staffBranchFilter(user),
      },
      select: {
        assignedStaffId: true,
        branchId: true,
        id: true,
        invoice: { select: { id: true } },
        serviceId: true,
        serviceIds: true,
        status: true,
        durationMinutes: true,
      },
    });

    if (!["SCHEDULED", "CONFIRMED", "ARRIVED", "IN_SERVICE"].includes(appointment.status)) {
      throw new Error("Services can only be added before service completion.");
    }

    if (appointment.invoice) {
      throw new Error("Services cannot be added after an invoice has been created.");
    }

    const existingServiceIds = [
      ...appointment.serviceIds,
      ...(appointment.serviceId ? [appointment.serviceId] : []),
    ];
    const requestedNewServiceIds = [...new Set(input.serviceIds)].filter(
      (serviceId) => !existingServiceIds.includes(serviceId),
    );

    if (!requestedNewServiceIds.length) {
      throw new Error("Select a new service to add.");
    }

    const combinedServiceIds = [...new Set([...existingServiceIds, ...requestedNewServiceIds])];
    const services = await tx.service.findMany({
      where: {
        businessId,
        id: { in: combinedServiceIds },
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (services.length !== combinedServiceIds.length) {
      throw new Error("One or more selected services are no longer available.");
    }

    await assertStaffCanPerformServices({
      assignedStaffId: appointment.assignedStaffId,
      businessId,
      serviceIds: combinedServiceIds,
    });

    const durationMinutes = await resolveAppointmentDurationMinutes(tx, {
      businessId,
      serviceIds: combinedServiceIds,
    });

    const updatedAppointment = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        serviceId: combinedServiceIds[0] ?? null,
        serviceIds: combinedServiceIds,
        durationMinutes,
      },
      select: { id: true, serviceIds: true, durationMinutes: true },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: appointment.branchId,
        actor: user,
        action: "SALON_APPOINTMENT_SERVICES_ADDED",
        entityType: "Appointment",
        entityId: appointment.id,
        summary: `Added ${requestedNewServiceIds.length} service(s) to Salon appointment`,
        before: {
          serviceIds: existingServiceIds,
          durationMinutes: appointment.durationMinutes,
        },
        after: {
          serviceIds: updatedAppointment.serviceIds,
          durationMinutes: updatedAppointment.durationMinutes,
        },
        request: auditRequest,
      },
      tx,
    );

    return updatedAppointment;
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${result.id}`);
  revalidatePath("/salon/dashboard");
  redirect(`/appointments/${result.id}`);
}

export async function convertAppointmentToJobAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const input = convertAppointmentSchema.parse({
    appointmentId: formData.get("appointmentId"),
  });
  const redirectTo = formData.get("redirectTo")?.toString();

  const result = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirstOrThrow({
      where: {
        id: input.appointmentId,
        businessId,
        ...staffBranchFilter(user),
      },
      include: {
        customer: true,
        vehicle: true,
        service: true,
      },
    });

    if (appointment.status === "CONVERTED_TO_JOB" && appointment.workOrderId) {
      return { workOrderId: appointment.workOrderId };
    }

    if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
      throw new Error("Cancelled or no-show appointments cannot be converted.");
    }

    if (!appointment.vehicleId || !appointment.vehicle) {
      throw new Error("Customer-only appointments cannot be converted to an automotive job.");
    }

    const appointmentServiceIds = [
      ...new Set([
        ...appointment.serviceIds,
        ...(appointment.serviceId ? [appointment.serviceId] : []),
      ]),
    ];

    if (!appointmentServiceIds.length) {
      throw new Error("Choose a service before converting this appointment to a job.");
    }

    const services = await tx.service.findMany({
      where: {
        id: { in: appointmentServiceIds },
        businessId,
        status: "ACTIVE",
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    if (!services.length) {
      throw new Error("Choose a service before converting this appointment to a job.");
    }

    const subtotalCents = services.reduce((sum, service) => sum + toCents(service.price), 0);
    const subtotal = money(subtotalCents / 100);
    const workOrder = await tx.workOrder.create({
      data: {
        businessId,
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        orderNumber: makeOrderNumber(),
        status: "IN_PROGRESS",
        contactType: appointment.contactType,
        contactName: appointment.contactName || appointment.customer.name,
        contactPhone: appointment.contactPhone || appointment.customer.phone,
        subtotal,
        total: subtotal,
        paidAmount: money(0),
        balance: subtotal,
        paymentStatus: "UNPAID",
        notes: appointment.notes || null,
        items: {
          create: services.map((service) => {
            const unitPrice = money(toCents(service.price) / 100);

            return {
              businessId,
              serviceId: service.id,
              name: service.name,
              quantity: 1,
              unitPrice,
              lineTotal: unitPrice,
            };
          }),
        },
      },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: "CONVERTED_TO_JOB",
        workOrderId: workOrder.id,
        convertedAt: new Date(),
      },
    });

    return { workOrderId: workOrder.id };
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${input.appointmentId}`);
  revalidatePath("/work-orders");
  await cancelReminderSafely({
    appointmentId: input.appointmentId,
    businessId,
    reason: "Appointment converted to a job.",
  });
  await sendServiceConfirmationQueued({
    businessId,
    workOrderId: result.workOrderId,
    sentByUserId: user.userId,
  });
  redirect(redirectTo || `/work-orders/${result.workOrderId}`);
}

export type SalonCheckoutInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  customerName: string;
  customerPhone: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  tipAmount: number;
  taxAmount: number;
  taxRate: number;
  taxLabel: string | null;
  total: number;
  paidAmount: number;
  balance: number;
};

export type SalonAppointmentPaymentState = {
  status: "idle" | "success" | "error";
  message: string;
  invoiceId: string | null;
  invoice: SalonCheckoutInvoiceSummary | null;
};

const salonCheckoutMessages = new Set([
  "Start a cashier shift before checkout.",
  "Complete the service before checkout.",
  "This payment does not belong to the current shift branch.",
  "Choose at least one service before checkout.",
  "One or more selected services are no longer available.",
  "The selected services must have a valid price.",
  "Discount cannot exceed the service subtotal.",
  "Invoice total must be more than 0.",
  "Deposit and payment cannot exceed the invoice total.",
  "This invoice cannot accept another payment.",
  "Discount, deposit, and tip can only be set when the invoice is created.",
  "This appointment is already fully paid.",
  "Deposit and payment cannot exceed the outstanding balance.",
  "At least one payment is required.",
]);

export async function recordSalonAppointmentPaymentAction(
  _previousState: SalonAppointmentPaymentState,
  formData: FormData,
): Promise<SalonAppointmentPaymentState> {
  const { businessId, industryType, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const parsed = salonAppointmentPaymentSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
    discountAmount: formData.get("discountAmount"),
    depositAmount: formData.get("depositAmount"),
    depositMethod: formData.get("depositMethod"),
    depositReference: formData.get("depositReference"),
    tipAmount: formData.get("tipAmount"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the payment details and try again.",
      invoiceId: null,
      invoice: null,
    };
  }

  const input = parsed.data;

  if (industryType !== "SALON_BEAUTY") {
    return {
      status: "error",
      message: "This checkout is only available to Beauty & Wellness businesses.",
      invoiceId: null,
      invoice: null,
    };
  }

  let result: {
    invoiceId: string;
    shouldSendInvoice: boolean;
    invoice: SalonCheckoutInvoiceSummary;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
    const businessSst = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { sstEnabled: true, sstLabel: true, sstRate: true },
    });
    const shift = await tx.cashierShift.findFirst({
      where: {
        businessId,
        cashierId: user.userId,
        status: "OPEN",
      },
      select: { branchId: true, id: true },
    });

    if (!shift) {
      throw new Error("Start a cashier shift before checkout.");
    }

    const appointment = await tx.appointment.findFirstOrThrow({
      where: {
        id: input.appointmentId,
        businessId,
        ...staffBranchFilter(user),
      },
      include: {
        customer: true,
        invoice: {
          include: { items: true },
        },
      },
    });

    if (appointment.status !== "COMPLETED") {
      throw new Error("Complete the service before checkout.");
    }

    if (shift.branchId !== appointment.branchId) {
      throw new Error("This payment does not belong to the current shift branch.");
    }

    let invoice = appointment.invoice;
    const isNewInvoice = !invoice;

    if (!invoice) {
      const serviceIds = [
        ...new Set([
          ...appointment.serviceIds,
          ...(appointment.serviceId ? [appointment.serviceId] : []),
        ]),
      ];

      if (!serviceIds.length) {
        throw new Error("Choose at least one service before checkout.");
      }

      const services = await tx.service.findMany({
        where: {
          businessId,
          id: { in: serviceIds },
          status: "ACTIVE",
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });

      if (services.length !== serviceIds.length) {
        throw new Error("One or more selected services are no longer available.");
      }

      const serviceTotalCents = services.reduce(
        (sum, service) => sum + toCents(service.price),
        0,
      );

      if (serviceTotalCents <= 0) {
        throw new Error("The selected services must have a valid price.");
      }

      const discountCents = toCents(input.discountAmount);
      const tipCents = toCents(input.tipAmount);
      if (discountCents > serviceTotalCents) {
        throw new Error("Discount cannot exceed the service subtotal.");
      }

      const tax = calculateTax({
        sstEnabled: businessSst.sstEnabled,
        sstLabel: businessSst.sstLabel,
        sstRate: Number(businessSst.sstRate),
        discount: discountCents / 100,
        tip: tipCents / 100,
        lines: services.map((service) => ({
          lineTotal: Number(service.price),
          taxable: service.taxable,
          taxRate: service.taxRate == null ? null : Number(service.taxRate),
        })),
      });
      const totalCents = toCents(tax.total);
      if (totalCents <= 0) {
        throw new Error("Invoice total must be more than 0.");
      }

      const depositCents = toCents(input.depositAmount);
      const amountCents = toCents(input.amount);
      if (depositCents + amountCents > totalCents) {
        throw new Error("Deposit and payment cannot exceed the invoice total.");
      }

      invoice = await tx.invoice.create({
        data: {
          appointmentId: appointment.id,
          branchId: appointment.branchId,
          businessId,
          customerId: appointment.customerId,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: fromCents(serviceTotalCents),
          discountAmount: fromCents(discountCents),
          depositAmount: fromCents(depositCents),
          tipAmount: fromCents(tipCents),
          taxableSubtotal: fromCents(toCents(tax.taxableSubtotal)),
          taxAmount: fromCents(toCents(tax.tax)),
          taxRate: fromCents(toCents(tax.taxRate)),
          taxLabel: tax.tax > 0 ? tax.taxLabel : null,
          total: fromCents(totalCents),
          paidAmount: fromCents(0),
          balance: fromCents(totalCents),
          status: "UNPAID",
          items: {
            create: services.map((service, index) => ({
              businessId,
              serviceId: service.id,
              name: service.name,
              quantity: 1,
              unitPrice: service.price,
              lineTotal: service.price,
              taxable: service.taxable,
              taxRate: fromCents(toCents(
                service.taxable && businessSst.sstEnabled
                  ? service.taxRate == null ? Number(businessSst.sstRate) : Number(service.taxRate)
                  : 0,
              )),
              taxAmount: fromCents(toCents(tax.lineTax[index])),
            })),
          },
        },
        include: { items: true },
      });
    }

    if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
      throw new Error("This invoice cannot accept another payment.");
    }

    if (!isNewInvoice && (input.discountAmount > 0 || input.depositAmount > 0 || input.tipAmount > 0)) {
      throw new Error("Discount, deposit, and tip can only be set when the invoice is created.");
    }

    const totalCents = toCents(invoice.total);
    const paidCents = toCents(invoice.paidAmount);
    const amountCents = toCents(input.amount);
    const depositCents = isNewInvoice ? toCents(input.depositAmount) : 0;
    const balanceCents = Math.max(0, totalCents - paidCents);

    if (balanceCents === 0 || invoice.status === "PAID") {
      throw new Error("This appointment is already fully paid.");
    }

    if (depositCents + amountCents > balanceCents) {
      throw new Error("Deposit and payment cannot exceed the outstanding balance.");
    }

    const createdPayments = [];
    if (depositCents > 0) {
      createdPayments.push(await tx.payment.create({
        data: {
          businessId,
          branchId: appointment.branchId,
          appointmentId: appointment.id,
          invoiceId: invoice.id,
          cashierId: user.userId,
          shiftId: shift.id,
          amount: fromCents(depositCents),
          method: input.depositMethod,
          reference: input.depositReference || "Deposit",
        },
      }));
    }

    if (amountCents > 0) {
      createdPayments.push(await tx.payment.create({
        data: {
          businessId,
          branchId: appointment.branchId,
          appointmentId: appointment.id,
          invoiceId: invoice.id,
          cashierId: user.userId,
          shiftId: shift.id,
          amount: fromCents(amountCents),
          method: input.method,
          reference: input.reference || null,
        },
      }));
    }

    const nextPaidCents = paidCents + depositCents + amountCents;
    const nextBalanceCents = totalCents - nextPaidCents;
    const nextStatus = nextBalanceCents === 0 ? "PAID" : "PARTIAL";

    for (const payment of createdPayments) {
      await awardLoyaltyPointsForPayment(tx, {
        businessId,
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        paymentId: payment.id,
        amountCents: toCents(payment.amount),
        paymentMethod: payment.method,
        createdById: user.userId,
      });
    }

    const payment = createdPayments.at(-1);
    if (!payment) {
      throw new Error("At least one payment is required.");
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: fromCents(nextPaidCents),
        balance: fromCents(nextBalanceCents),
        status: nextStatus,
        voidedAt: null,
        voidReason: null,
      },
    });

    await writeAuditLog(
      {
        businessId,
        branchId: appointment.branchId,
        actor: user,
        action: "SALON_APPOINTMENT_PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Recorded Salon checkout with ${createdPayments.length} payment record(s)`,
        before: {
          appointmentId: appointment.id,
          invoiceId: invoice.id,
          paidAmount: invoice.paidAmount,
          balance: invoice.balance,
          status: invoice.status,
        },
        after: {
          appointmentId: appointment.id,
          invoiceId: invoice.id,
          amount: fromCents(depositCents + amountCents),
          methods: createdPayments.map((entry) => entry.method),
          discountAmount: invoice.discountAmount,
          depositAmount: invoice.depositAmount,
          tipAmount: invoice.tipAmount,
          paidAmount: fromCents(nextPaidCents),
          balance: fromCents(nextBalanceCents),
          status: nextStatus,
        },
        request: auditRequest,
      },
      tx,
    );

    return {
      invoiceId: invoice.id,
      shouldSendInvoice: nextStatus === "PAID",
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: nextStatus,
        issuedAt: invoice.issuedAt.toISOString(),
        customerName: appointment.customer.name,
        customerPhone: appointment.customer.phone,
        items: invoice.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
        subtotal: Number(invoice.subtotal),
        discountAmount: Number(invoice.discountAmount),
        tipAmount: Number(invoice.tipAmount),
        taxAmount: Number(invoice.taxAmount),
        taxRate: Number(invoice.taxRate),
        taxLabel: invoice.taxLabel,
        total: Number(invoice.total),
        paidAmount: nextPaidCents / 100,
        balance: nextBalanceCents / 100,
      },
    };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      status: "error",
      message: salonCheckoutMessages.has(message)
        ? message
        : "Checkout could not be completed. Check the details and try again.",
      invoiceId: null,
      invoice: null,
    };
  }

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${input.appointmentId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${result.invoiceId}`);
  revalidatePath("/loyalty");
  revalidatePath("/closing");
  revalidatePath("/dashboard");
  revalidatePath("/reports");

  if (result.shouldSendInvoice) {
    await sendInvoiceIfConnected({
      businessId,
      invoiceId: result.invoiceId,
      sentByUserId: user.userId,
    });
  }

  return {
    status: "success",
    message: "Checkout completed.",
    invoiceId: result.invoiceId,
    invoice: result.invoice,
  };
}
