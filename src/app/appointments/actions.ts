"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
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
import { makeOrderNumber } from "@/lib/validation/work-orders";
import { sendServiceConfirmationQueued } from "@/lib/whatsapp/work-order-notifications";

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

export async function createAppointmentAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  const parsedInput = createAppointmentSchema.safeParse({
    assignedStaffId: formData.get("assignedStaffId"),
    branchId: formData.get("branchId"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactType: formData.get("contactType"),
    vehicleId: formData.get("vehicleId"),
    serviceId: formData.get("serviceId"),
    serviceIds: formData.getAll("serviceIds"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
    notes: formData.get("notes"),
  });

  if (!parsedInput.success) {
    const scheduledDate = formData.get("scheduledDate")?.toString() || new Date().toISOString().slice(0, 10);
    const message =
      parsedInput.error.issues.find((issue) => issue.path.includes("vehicleId"))?.message ??
      "Appointment details are incomplete.";
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

  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: {
      id: input.vehicleId,
      businessId,
    },
    select: {
      id: true,
      customerId: true,
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
    },
  });

  const serviceIds = [...new Set(input.serviceIds.filter(Boolean))];
  const serviceId = (serviceIds[0] ?? input.serviceId) || null;
  const assignedStaffId = optionalUuid(input.assignedStaffId);
  const appointmentContactName =
    input.contactType === "OTHER_PERSON"
      ? input.contactName || null
      : vehicle.customer.name;
  const appointmentContactPhone =
    input.contactType === "OTHER_PERSON"
      ? normalizeCustomerPhone(input.contactPhone || "")
      : vehicle.customer.phone;

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

  const appointment = await prisma.appointment.create({
    data: {
      businessId,
      branchId: appointmentBranchId,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      serviceId,
      serviceIds,
      createdById: user.userId,
      assignedStaffId,
      contactType: input.contactType,
      contactName: appointmentContactName,
      contactPhone: appointmentContactPhone,
      scheduledAt,
      notes: input.notes || null,
    },
  });

  revalidatePath("/appointments");
  redirect(`/appointments?status=active&page=1&date=${input.scheduledDate}`);
}

export async function updateAppointmentStatusAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
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
      id: true,
      status: true,
    },
  });

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
      cancelledAt: input.status === "CANCELLED" ? now : undefined,
      noShowAt: input.status === "NO_SHOW" ? now : undefined,
    },
  });

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
    },
  });

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
  }

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      scheduledAt,
      ...(shouldUpdateStaff ? { assignedStaffId } : {}),
    },
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
    },
  });

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

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      assignedStaffId,
      scheduledAt,
      serviceId,
      serviceIds,
    },
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
  await sendServiceConfirmationQueued({
    businessId,
    workOrderId: result.workOrderId,
    sentByUserId: user.userId,
  });
  redirect(redirectTo || `/work-orders/${result.workOrderId}`);
}
