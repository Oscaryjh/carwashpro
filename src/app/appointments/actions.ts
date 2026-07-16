"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import { makeInvoiceNumber } from "@/lib/invoices/invoice-number";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { normalizeCustomerPhone } from "@/lib/validation/crm";
import {
  canMoveAppointmentStatus,
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

export async function createAppointmentAction(formData: FormData) {
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
    const scheduledDate = formData.get("scheduledDate")?.toString() || new Date().toISOString().slice(0, 10);
    const message = parsedInput.error.issues[0]?.message ?? "Appointment details are incomplete.";
    redirect(
      `/appointments?status=active&page=1&date=${scheduledDate}&type=error&message=${encodeURIComponent(
        message,
      )}`,
    );
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
    redirect(
      `/appointments?status=active&page=1&date=${input.scheduledDate}&type=error&message=${encodeURIComponent(
        "Vehicle is required.",
      )}`,
    );
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
    redirect(
      `/appointments?status=active&page=1&date=${input.scheduledDate}&type=error&message=${encodeURIComponent(
        isSalon ? "Customer is required." : "Vehicle is required.",
      )}`,
    );
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

  const appointment = await prisma.appointment.create({
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
      scheduledAt,
      notes: input.notes || null,
    },
  });

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  redirect(`/appointments?status=active&page=1&date=${input.scheduledDate}`);
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

  if (
    ["IN_SERVICE", "COMPLETED"].includes(input.status) &&
    industryType !== "SALON_BEAUTY"
  ) {
    throw new Error("This status is only available for Salon appointments.");
  }

  if (input.status === "IN_SERVICE") {
    if (!appointment.assignedStaffId) {
      throw new Error("Assign a staff member before starting the service.");
    }

    if (!appointment.serviceId && appointment.serviceIds.length === 0) {
      throw new Error("Select at least one service before starting the service.");
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
      confirmedAt: input.status === "CONFIRMED" ? now : undefined,
      arrivedAt: input.status === "ARRIVED" ? now : undefined,
      startedAt: input.status === "IN_SERVICE" ? now : undefined,
      completedAt: input.status === "COMPLETED" ? now : undefined,
      cancelledAt: input.status === "CANCELLED" ? now : undefined,
      noShowAt: input.status === "NO_SHOW" ? now : undefined,
    },
  });

  if (input.status === "CONFIRMED") {
    await scheduleReminderSafely({
      appointmentId: appointment.id,
      businessId,
      sentByUserId: user.userId,
    });
  } else if (["ARRIVED", "IN_SERVICE", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(input.status)) {
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

export async function rescheduleAppointmentAction(formData: FormData) {
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
      branchId: true,
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

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      scheduledAt,
      ...(shouldUpdateStaff ? { assignedStaffId } : {}),
    },
  });

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
}

export async function updateAppointmentDetailsAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const input = updateAppointmentDetailsSchema.parse({
    appointmentId: formData.get("appointmentId"),
    assignedStaffId: formData.get("assignedStaffId"),
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

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      assignedStaffId,
      scheduledAt,
      serviceId,
      serviceIds,
    },
  });

  await scheduleReminderSafely({
    appointmentId: appointment.id,
    businessId,
    sentByUserId: user.userId,
  });

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
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

export async function recordSalonAppointmentPaymentAction(formData: FormData) {
  const { businessId, industryType, user } = await requireBusinessUser();
  const auditRequest = await getAuditRequestContext();
  const input = salonAppointmentPaymentSchema.parse({
    appointmentId: formData.get("appointmentId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });

  if (industryType !== "SALON_BEAUTY") {
    throw new Error("Salon appointment checkout is only available to Salon businesses.");
  }

  const result = await prisma.$transaction(async (tx) => {
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

    if (!["ARRIVED", "IN_SERVICE", "COMPLETED"].includes(appointment.status)) {
      throw new Error("Mark the customer as arrived before taking payment.");
    }

    if (shift.branchId !== appointment.branchId) {
      throw new Error("This payment does not belong to the current shift branch.");
    }

    let invoice = appointment.invoice;

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

      invoice = await tx.invoice.create({
        data: {
          appointmentId: appointment.id,
          branchId: appointment.branchId,
          businessId,
          customerId: appointment.customerId,
          invoiceNumber: makeInvoiceNumber(),
          subtotal: fromCents(serviceTotalCents),
          total: fromCents(serviceTotalCents),
          paidAmount: fromCents(0),
          balance: fromCents(serviceTotalCents),
          status: "UNPAID",
          items: {
            create: services.map((service) => ({
              businessId,
              serviceId: service.id,
              name: service.name,
              quantity: 1,
              unitPrice: service.price,
              lineTotal: service.price,
            })),
          },
        },
        include: { items: true },
      });
    }

    if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
      throw new Error("This invoice cannot accept another payment.");
    }

    const totalCents = toCents(invoice.total);
    const paidCents = toCents(invoice.paidAmount);
    const amountCents = toCents(input.amount);
    const balanceCents = Math.max(0, totalCents - paidCents);

    if (balanceCents === 0 || invoice.status === "PAID") {
      throw new Error("This appointment is already fully paid.");
    }

    if (amountCents > balanceCents) {
      throw new Error("Payment amount cannot exceed the outstanding balance.");
    }

    const nextPaidCents = paidCents + amountCents;
    const nextBalanceCents = totalCents - nextPaidCents;
    const nextStatus = nextBalanceCents === 0 ? "PAID" : "PARTIAL";
    const payment = await tx.payment.create({
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
    });

    await awardLoyaltyPointsForPayment(tx, {
      businessId,
      branchId: appointment.branchId,
      customerId: appointment.customerId,
      paymentId: payment.id,
      amountCents,
      paymentMethod: payment.method,
      createdById: user.userId,
    });

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
        summary: `Recorded ${fromCents(amountCents)} ${input.method} Salon payment`,
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
          amount: payment.amount,
          method: payment.method,
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
    };
  });

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

  redirect(`/invoices/${result.invoiceId}`);
}
