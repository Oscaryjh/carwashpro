"use server";

import { FinancialOperationType, type Payment } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveOperationalBranchId } from "@/lib/branches";
import {
  calculateCatalogDiscountCents,
  formatCatalogDiscountValue,
  type CatalogDiscountOption,
} from "@/lib/catalog-discounts";
import { nextInvoiceNumber } from "@/lib/invoices/invoice-number";
import { getInvoicePaymentSummary } from "@/lib/invoices/payment-summary";
import {
  activateCustomerPackageServiceBalances,
  createCustomerPackageServiceBalances,
} from "@/lib/packages/service-balances";
import {
  findStaffAppointmentConflict,
  formatAppointmentConflictMessage,
  lockStaffAppointmentSchedule,
  resolveAppointmentDurationMinutes,
} from "@/lib/appointments/scheduling-service";
import { assertStaffAvailability } from "@/lib/appointments/staff-availability";
import { buildAppointmentStaffWhere } from "@/lib/appointments/staff-branch-scope";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import { normalizeCustomerPhone } from "@/lib/validation/crm";
import {
  canMoveAppointmentStatus,
  addAppointmentServicesSchema,
  convertAppointmentSchema,
  createAppointmentSchema,
  getDefaultAppointmentVisitType,
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
import { runFinancialOperation } from "@/lib/financial-idempotency";
import { recordSaleInventory } from "@/lib/inventory/service";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function countSelectedIds(ids: string[]) {
  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return counts;
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
  const { businessId, industryType, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
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
    productIds: formData.getAll("productIds"),
    packageIds: formData.getAll("packageIds"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
    visitType: formData.get("visitType"),
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
  const visitType = input.visitType ?? getDefaultAppointmentVisitType(scheduledAt);
  const isWalkIn = visitType === "WALK_IN";

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
  const productIds = input.productIds.filter(Boolean);
  const packageIds = input.packageIds.filter(Boolean);
  const uniqueProductIds = [...new Set(productIds)];
  const uniquePackageIds = [...new Set(packageIds)];
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

  if (uniqueProductIds.length) {
    const activeProductCount = await prisma.product.count({
      where: { id: { in: uniqueProductIds }, businessId, status: "ACTIVE" },
    });
    if (activeProductCount !== uniqueProductIds.length) {
      throw new Error("One or more selected products are invalid.");
    }
  }

  if (uniquePackageIds.length) {
    const activePackageCount = await prisma.package.count({
      where: {
        id: { in: uniquePackageIds },
        businessId,
        status: "ACTIVE",
        OR: [{ branchId: null }, ...(appointmentBranchId ? [{ branchId: appointmentBranchId }] : [])],
      },
    });
    if (activePackageCount !== uniquePackageIds.length) {
      throw new Error("One or more selected packages are invalid for this branch.");
    }
  }

  if (assignedStaffId) {
    await prisma.user.findFirstOrThrow({
      where: buildAppointmentStaffWhere({
        branchId: appointmentBranchId,
        businessId,
        staffId: assignedStaffId,
      }),
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

  if (isWalkIn && selectedServiceIds.length === 0) {
    return { ok: false, error: "Select at least one service for a walk-in." };
  }

  if (isWalkIn && !assignedStaffId) {
    return { ok: false, error: "Select a staff member for a walk-in." };
  }

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
        productIds,
        packageIds,
        createdById: user.userId,
        assignedStaffId,
        contactType: isSalon ? "REGISTERED_OWNER" : input.contactType,
        contactName: appointmentContactName,
        contactPhone: appointmentContactPhone,
        durationMinutes,
        scheduledAt,
        startedAt: isWalkIn ? new Date() : null,
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

  if (!isWalkIn) {
    await scheduleReminderSafely({
      appointmentId: appointment.id,
      businessId,
      sentByUserId: user.userId,
    });
  }

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
  const { businessId, industryType, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
  const input = updateAppointmentStatusSchema.parse({
    appointmentId: formData.get("appointmentId"),
    status: formData.get("status"),
  });
  const redirectTo = formData.get("redirectTo")?.toString();
  const returnToClient = formData.get("returnToClient") === "1";

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

  if (returnToClient) {
    return;
  }

  redirect(redirectTo || `/appointments/${appointment.id}`);
}

export async function rescheduleAppointmentAction(
  formData: FormData,
): Promise<AppointmentMutationResult> {
  const { businessId, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
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
      where: buildAppointmentStaffWhere({
        branchId: appointment.branchId,
        businessId,
        staffId: assignedStaffId,
      }),
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
  const { businessId, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
  const input = updateAppointmentDetailsSchema.parse({
    appointmentId: formData.get("appointmentId"),
    assignedStaffId: formData.get("assignedStaffId"),
    notes: formData.get("notes"),
    serviceIds: formData.getAll("serviceIds"),
    productIds: formData.getAll("productIds"),
    packageIds: formData.getAll("packageIds"),
    scheduledDate: formData.get("scheduledDate"),
    scheduledTime: formData.get("scheduledTime"),
  });
  const scheduledAt = parseAppointmentDateTime(input.scheduledDate, input.scheduledTime);
  const serviceIds = [...new Set(input.serviceIds)];
  const productIds = input.productIds;
  const packageIds = input.packageIds;
  const uniqueProductIds = [...new Set(productIds)];
  const uniquePackageIds = [...new Set(packageIds)];
  const serviceId = serviceIds[0] ?? null;
  const assignedStaffId = optionalUuid(input.assignedStaffId);

  const appointment = await prisma.appointment.findFirstOrThrow({
    where: {
      id: input.appointmentId,
      businessId,
      ...staffBranchFilter(user),
    },
    select: {
      branchId: true,
      id: true,
      invoice: { select: { id: true } },
      status: true,
    },
  });

  const isCompletedSaleUpdate = appointment.status === "COMPLETED";

  if (
    !isCompletedSaleUpdate &&
    !["SCHEDULED", "CONFIRMED", "ARRIVED"].includes(appointment.status)
  ) {
    throw new Error("This appointment can no longer be changed.");
  }

  if (appointment.invoice) {
    throw new Error("This appointment already has an invoice. Void or refund it before changing appointment details.");
  }

  if (uniqueProductIds.length) {
    const activeProductCount = await prisma.product.count({
      where: { id: { in: uniqueProductIds }, businessId, status: "ACTIVE" },
    });
    if (activeProductCount !== uniqueProductIds.length) {
      throw new Error("One or more selected products are invalid.");
    }
  }

  if (uniquePackageIds.length) {
    const activePackageCount = await prisma.package.count({
      where: {
        id: { in: uniquePackageIds },
        businessId,
        status: "ACTIVE",
        OR: [{ branchId: null }, ...(appointment.branchId ? [{ branchId: appointment.branchId }] : [])],
      },
    });
    if (activePackageCount !== uniquePackageIds.length) {
      throw new Error("One or more selected packages are invalid for this branch.");
    }
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

  if (isCompletedSaleUpdate && serviceIds.length === 0) {
    throw new Error("A completed appointment must keep at least one service.");
  }

  if (assignedStaffId) {
    await prisma.user.findFirstOrThrow({
      where: buildAppointmentStaffWhere({
        branchId: appointment.branchId,
        businessId,
        staffId: assignedStaffId,
      }),
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
        productIds,
        packageIds,
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

  if (!isCompletedSaleUpdate) {
    await scheduleReminderSafely({
      appointmentId: appointment.id,
      businessId,
      sentByUserId: user.userId,
    });
  }

  revalidatePath("/appointments");
  revalidatePath(`/appointments/${appointment.id}`);
  return { ok: true };
}

export async function addAppointmentServicesAction(formData: FormData) {
  const { businessId, industryType, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
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
  const { businessId, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
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
  packageVoucherAmount?: number;
  cashPaidAmount?: number;
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
  "Choose at least one item before checkout.",
  "One or more selected services are no longer available.",
  "One or more selected products are no longer available.",
  "One or more selected packages are no longer available.",
  "The selected services must have a valid price.",
  "The selected items must have a valid price.",
  "Discount cannot exceed the service subtotal.",
  "Discount cannot exceed the item subtotal.",
  "Select a branch before checkout.",
  "Invoice total must be more than 0.",
  "Deposit and payment cannot exceed the invoice total.",
  "This invoice cannot accept another payment.",
  "Discount, deposit, and tip can only be set when the invoice is created.",
  "This appointment is already fully paid.",
  "Deposit and payment cannot exceed the outstanding balance.",
  "At least one payment is required.",
  "This customer package is no longer available.",
  "This package cannot be used for the selected services.",
  "Only one package can be used for each service.",
]);

export async function recordSalonAppointmentPaymentAction(
  _previousState: SalonAppointmentPaymentState,
  formData: FormData,
): Promise<SalonAppointmentPaymentState> {
  const { businessId, industryType, user } = await requireBusinessUser("MODIFY_APPOINTMENTS");
  const auditRequest = await getAuditRequestContext();
  const parsed = salonAppointmentPaymentSchema.safeParse({
    operationId: formData.get("operationId"),
    appointmentId: formData.get("appointmentId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
    discountAmount: formData.get("discountAmount"),
    catalogDiscountId: formData.get("catalogDiscountId")?.toString() || undefined,
    discountReference: formData.get("discountReference")?.toString() || undefined,
    depositAmount: formData.get("depositAmount"),
    depositMethod: formData.get("depositMethod"),
    depositReference: formData.get("depositReference"),
    tipAmount: formData.get("tipAmount"),
    customerPackageIds: formData.getAll("customerPackageIds"),
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.path[0] === "method"
      ? "Please select a payment method."
      : firstIssue?.message ?? "Check the payment details and try again.";
    return {
      status: "error",
      message,
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
    customerId: string;
    shouldSendInvoice: boolean;
    invoice: SalonCheckoutInvoiceSummary;
  };

  try {
    const { operationId, ...financialPayload } = input;
    ({ result } = await runFinancialOperation({
    actorUserId: user.userId,
    branchId: null,
    businessId,
    operationKey: operationId,
    operationType: FinancialOperationType.SALON_APPOINTMENT_PAYMENT,
    payload: financialPayload,
    execute: async (tx) => {
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
          include: {
            items: true,
            payments: { include: { refunds: { select: { amount: true } } } },
          },
        },
      },
    });

    if (appointment.status !== "COMPLETED") {
      throw new Error("Complete the service before checkout.");
    }

    if (shift.branchId !== appointment.branchId) {
      throw new Error("This payment does not belong to the current shift branch.");
    }

    const now = new Date();
    const catalogDiscountRecord = input.catalogDiscountId
      ? await tx.catalogDiscount.findFirst({
          where: {
            id: input.catalogDiscountId,
            businessId,
            active: true,
            OR: [{ branchId: null }, { branchId: appointment.branchId }],
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            ],
          },
          select: {
            id: true,
            name: true,
            discountType: true,
            percentage: true,
            fixedAmount: true,
            scope: true,
            minimumSpend: true,
            maximumDiscount: true,
            allowLoyaltyStacking: true,
          },
        })
      : null;

    if (input.catalogDiscountId && !catalogDiscountRecord) {
      throw new Error("This catalog discount is no longer available for this branch.");
    }

    let invoice = appointment.invoice;
    const isNewInvoice = !invoice;
    const packagePayments: Payment[] = [];
    let packageCoverageCents = 0;

    if (!invoice) {
      const serviceIds = [...new Set([
        ...appointment.serviceIds,
        ...(appointment.serviceId ? [appointment.serviceId] : []),
      ])];
      const productCounts = countSelectedIds(appointment.productIds);
      const packageCounts = countSelectedIds(appointment.packageIds);
      const productIds = [...productCounts.keys()];
      const packageIds = [...packageCounts.keys()];

      if (!serviceIds.length && !productIds.length && !packageIds.length) {
        throw new Error("Choose at least one item before checkout.");
      }

      const [services, products, packageDefinitions, customerPackages] = await Promise.all([
        tx.service.findMany({
          where: { businessId, id: { in: serviceIds }, status: "ACTIVE" },
          orderBy: [{ category: "asc" }, { name: "asc" }],
        }),
        tx.product.findMany({
          where: { businessId, id: { in: productIds }, status: "ACTIVE" },
          orderBy: [{ category: "asc" }, { name: "asc" }],
        }),
        tx.package.findMany({
          where: {
            businessId,
            id: { in: packageIds },
            status: "ACTIVE",
            OR: [{ branchId: null }, ...(appointment.branchId ? [{ branchId: appointment.branchId }] : [])],
          },
          include: {
            service: true,
            serviceBenefits: { select: { serviceId: true, totalUses: true } },
          },
          orderBy: [{ name: "asc" }],
        }),
        tx.customerPackageServiceBalance.findMany({
          where: {
            businessId,
            id: { in: [...new Set(input.customerPackageIds)] },
            remainingUses: { gt: 0 },
            customerPackage: {
              customerId: appointment.customerId,
              status: "ACTIVE",
              OR: [
                { branchId: null },
                ...(appointment.branchId ? [{ branchId: appointment.branchId }] : []),
              ],
              package: { status: "ACTIVE" },
            },
          },
          include: {
            service: true,
            customerPackage: { include: { package: true } },
          },
          orderBy: [{ customerPackage: { purchasedAt: "asc" } }, { createdAt: "asc" }],
        }),
      ]);

      if (services.length !== serviceIds.length) {
        throw new Error("One or more selected services are no longer available.");
      }
      if (products.length !== productIds.length) {
        throw new Error("One or more selected products are no longer available.");
      }
      if (packageDefinitions.length !== packageIds.length) {
        throw new Error("One or more selected packages are no longer available.");
      }
      if (customerPackages.length !== new Set(input.customerPackageIds).size) {
        throw new Error("This customer package is no longer available.");
      }
      if (!appointment.branchId) {
        throw new Error("Select a branch before checkout.");
      }

      const redeemedPackageByServiceId = new Map<string, typeof customerPackages[number]>();
      for (const serviceBalance of customerPackages) {
        const serviceId = serviceBalance.serviceId;
        if (!serviceIds.includes(serviceId)) {
          throw new Error("This package cannot be used for the selected services.");
        }
        if (redeemedPackageByServiceId.has(serviceId)) {
          throw new Error("Only one package can be used for each service.");
        }
        redeemedPackageByServiceId.set(serviceId, serviceBalance);
      }

      const saleLines: Array<{
        kind: "service" | "product" | "package";
        id: string;
        name: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        taxable: boolean;
        taxRate: number | null;
        redeemedCustomerPackageId?: string | null;
        redeemedCustomerPackageServiceBalanceId?: string | null;
        serviceId?: string | null;
        totalUses?: number;
        eligibleVehicleSize?: "ALL" | "SMALL" | "MEDIUM" | "LARGE";
      }> = [
        ...services.map((service) => ({
          kind: "service" as const,
          id: service.id,
          name: service.name,
          quantity: 1,
          unitPrice: Number(service.price),
          lineTotal: Number(service.price),
          taxable: service.taxable,
          taxRate: service.taxRate == null ? null : Number(service.taxRate),
          redeemedCustomerPackageId:
            redeemedPackageByServiceId.get(service.id)?.customerPackageId ?? null,
          redeemedCustomerPackageServiceBalanceId:
            redeemedPackageByServiceId.get(service.id)?.id ?? null,
        })),
        ...products.map((product) => {
          const quantity = productCounts.get(product.id) ?? 0;
          return {
            kind: "product" as const,
            id: product.id,
            name: product.name,
            quantity,
            unitPrice: Number(product.price),
            lineTotal: Number(product.price) * quantity,
            taxable: product.taxable,
            taxRate: product.taxRate == null ? null : Number(product.taxRate),
          };
        }),
        ...packageDefinitions.flatMap((item) => Array.from(
          { length: packageCounts.get(item.id) ?? 0 },
          () => ({
            kind: "package" as const,
            id: item.id,
            name: item.name,
            quantity: 1,
            unitPrice: Number(item.price),
            lineTotal: Number(item.price),
            taxable: item.service?.taxable ?? true,
            taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
            serviceId: item.serviceId,
            totalUses: item.totalUses,
            eligibleVehicleSize: item.eligibleVehicleSize,
          }),
        )),
      ];
      const subtotalCents = saleLines.reduce((sum, line) => sum + toCents(line.lineTotal), 0);

      if (subtotalCents <= 0) {
        throw new Error("The selected items must have a valid price.");
      }

      const catalogDiscount = catalogDiscountRecord
        ? {
            id: catalogDiscountRecord.id,
            name: catalogDiscountRecord.name,
            discountType: catalogDiscountRecord.discountType,
            percentage: catalogDiscountRecord.percentage == null ? null : Number(catalogDiscountRecord.percentage),
            fixedAmount: catalogDiscountRecord.fixedAmount == null ? null : Number(catalogDiscountRecord.fixedAmount),
            scope: catalogDiscountRecord.scope,
            minimumSpend: Number(catalogDiscountRecord.minimumSpend),
            maximumDiscount: catalogDiscountRecord.maximumDiscount == null
              ? null
              : Number(catalogDiscountRecord.maximumDiscount),
            allowLoyaltyStacking: catalogDiscountRecord.allowLoyaltyStacking,
          } satisfies CatalogDiscountOption
        : null;
      const discountCents = catalogDiscount
        ? calculateCatalogDiscountCents({
            discount: catalogDiscount,
            lines: saleLines.map((line) => ({
              lineTotalCents: toCents(line.lineTotal),
              type: line.kind,
            })),
          })
        : toCents(input.discountAmount);
      const tipCents = toCents(input.tipAmount);

      if (catalogDiscount && discountCents <= 0) {
        throw new Error("This catalog discount does not apply to the current appointment.");
      }
      if (discountCents > subtotalCents) {
        throw new Error("Discount cannot exceed the item subtotal.");
      }

      const tax = calculateTax({
        sstEnabled: businessSst.sstEnabled,
        sstLabel: businessSst.sstLabel,
        sstRate: Number(businessSst.sstRate),
        discount: discountCents / 100,
        tip: tipCents / 100,
        lines: saleLines.map((line) => ({
          lineTotal: line.lineTotal,
          taxable: line.taxable,
          taxRate: line.taxRate,
        })),
      });
      const totalCents = toCents(tax.total);
      if (totalCents <= 0) {
        throw new Error("Invoice total must be more than 0.");
      }

      const packageCoverageByServiceBalanceId = new Map<string, number>();
      saleLines.forEach((line, index) => {
        if (!line.redeemedCustomerPackageServiceBalanceId) return;
        const coveredCents = Math.max(
          0,
          toCents(line.lineTotal)
            - toCents(tax.lineDiscount[index])
            + toCents(tax.lineTax[index]),
        );
        packageCoverageByServiceBalanceId.set(
          line.redeemedCustomerPackageServiceBalanceId,
          coveredCents,
        );
        packageCoverageCents += coveredCents;
      });

      const depositCents = toCents(input.depositAmount);
      const amountCents = toCents(input.amount);
      if (packageCoverageCents + depositCents + amountCents > totalCents) {
        throw new Error("Deposit and payment cannot exceed the invoice total.");
      }

      const customerPackageIdByLine = new Map<number, string>();
      for (const [index, line] of saleLines.entries()) {
        if (line.kind !== "package") continue;
        const customerPackage = await tx.customerPackage.create({
          data: {
            businessId,
            branchId: appointment.branchId,
            customerId: appointment.customerId,
            packageId: line.id,
            purchasePrice: fromCents(toCents(line.unitPrice)),
            totalUses: line.totalUses ?? 1,
            remainingUses: 0,
            eligibleVehicleSize: line.eligibleVehicleSize ?? "ALL",
            status: "PENDING_PAYMENT",
          },
        });
        const packageDefinition = packageDefinitions.find((item) => item.id === line.id);
        if (!packageDefinition) {
          throw new Error("One or more selected packages are no longer available.");
        }
        await createCustomerPackageServiceBalances(tx, {
          businessId,
          customerPackageId: customerPackage.id,
          packagePlan: packageDefinition,
          active: false,
        });
        customerPackageIdByLine.set(index, customerPackage.id);
      }

      invoice = await tx.invoice.create({
        data: {
          appointmentId: appointment.id,
          branchId: appointment.branchId,
          businessId,
          customerId: appointment.customerId,
          customerPackageId: customerPackageIdByLine.values().next().value ?? null,
          invoiceNumber: await nextInvoiceNumber(tx, businessId),
          subtotal: fromCents(subtotalCents),
          discountAmount: fromCents(discountCents),
          discountReason: catalogDiscount
            ? `Catalog: ${catalogDiscount.name} (${formatCatalogDiscountValue(catalogDiscount)}) · Reference: ${input.discountReference}`
            : discountCents > 0 ? "Checkout discount" : null,
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
            create: saleLines.map((line, index) => ({
              businessId,
              serviceId: line.kind === "service" ? line.id : line.serviceId ?? null,
              productId: line.kind === "product" ? line.id : null,
              customerPackageId:
                line.redeemedCustomerPackageId ?? customerPackageIdByLine.get(index) ?? null,
              name: line.name,
              quantity: line.quantity,
              unitPrice: fromCents(toCents(line.unitPrice)),
              lineTotal: fromCents(toCents(line.lineTotal)),
              taxable: line.taxable,
              taxRate: fromCents(toCents(
                line.taxable && businessSst.sstEnabled
                  ? line.taxRate == null ? Number(businessSst.sstRate) : line.taxRate
                  : 0,
              )),
              taxAmount: fromCents(toCents(tax.lineTax[index])),
            })),
          },
        },
        include: {
          items: true,
          payments: { include: { refunds: { select: { amount: true } } } },
        },
      });

      await recordSaleInventory(tx, {
        actorUserId: user.userId,
        branchId: appointment.branchId,
        businessId,
        invoiceId: invoice.id,
        lines: invoice.items
          .filter((item): item is typeof item & { productId: string } => Boolean(item.productId))
          .map((item) => ({ invoiceItemId: item.id, productId: item.productId, quantity: item.quantity })),
      });

      for (const serviceBalance of customerPackages) {
        const nextServiceRemainingUses = serviceBalance.remainingUses - 1;
        const updatedBalance = await tx.customerPackageServiceBalance.updateMany({
          where: {
            id: serviceBalance.id,
            businessId,
            remainingUses: serviceBalance.remainingUses,
          },
          data: {
            remainingUses: nextServiceRemainingUses,
          },
        });
        if (updatedBalance.count !== 1) {
          throw new Error("This customer package is no longer available.");
        }

        const updatedPackage = await tx.customerPackage.updateMany({
          where: {
            id: serviceBalance.customerPackageId,
            businessId,
            remainingUses: { gt: 0 },
            status: "ACTIVE",
          },
          data: { remainingUses: { decrement: 1 } },
        });
        if (updatedPackage.count !== 1) {
          throw new Error("This customer package is no longer available.");
        }

        packagePayments.push(await tx.payment.create({
          data: {
            businessId,
            branchId: appointment.branchId,
            appointmentId: appointment.id,
            invoiceId: invoice.id,
            customerPackageId: serviceBalance.customerPackageId,
            customerPackageServiceBalanceId: serviceBalance.id,
            cashierId: user.userId,
            shiftId: shift.id,
            amount: fromCents(packageCoverageByServiceBalanceId.get(serviceBalance.id) ?? 0),
            method: "PACKAGE",
            packageUses: 1,
            reference: `${serviceBalance.customerPackage.package.name} - ${serviceBalance.service.name}`,
          },
        }));
      }

      await tx.customerPackage.updateMany({
        where: {
          id: {
            in: [...new Set(customerPackages.map((item) => item.customerPackageId))],
          },
          businessId,
          remainingUses: 0,
          status: "ACTIVE",
        },
        data: { status: "USED_UP" },
      });

    }

    if (invoice.status === "VOID" || invoice.status === "REFUNDED") {
      throw new Error("This invoice cannot accept another payment.");
    }

    if (!isNewInvoice && (input.discountAmount > 0 || input.catalogDiscountId || input.depositAmount > 0 || input.tipAmount > 0)) {
      throw new Error("Discount, deposit, and tip can only be set when the invoice is created.");
    }

    const totalCents = toCents(invoice.total);
    const paidCents = toCents(invoice.paidAmount) + packageCoverageCents;
    const amountCents = toCents(input.amount);
    const depositCents = isNewInvoice ? toCents(input.depositAmount) : 0;
    const balanceCents = Math.max(0, totalCents - paidCents);

    if ((!isNewInvoice && balanceCents === 0) || invoice.status === "PAID") {
      throw new Error("This appointment is already fully paid.");
    }

    if (depositCents + amountCents > balanceCents) {
      throw new Error("Deposit and payment cannot exceed the outstanding balance.");
    }

    const createdPayments: Payment[] = [...packagePayments];
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
    const paymentSummary = getInvoicePaymentSummary([
      ...invoice.payments,
      ...createdPayments,
    ]);

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

    if (nextStatus === "PAID") {
      const customerPackageIds = invoice.items
        .map((item) => item.customerPackageId)
        .filter((id): id is string => Boolean(id));
      if (customerPackageIds.length) {
        const pendingCustomerPackages = await tx.customerPackage.findMany({
          where: {
            id: { in: customerPackageIds },
            businessId,
            status: "PENDING_PAYMENT",
          },
          select: { id: true, totalUses: true },
        });
        await tx.customerPackage.updateMany({
          where: {
            id: { in: pendingCustomerPackages.map((item) => item.id) },
            businessId,
            status: "PENDING_PAYMENT",
          },
          data: {
            status: "ACTIVE",
            purchasedAt: new Date(),
          },
        });
        await Promise.all(
          pendingCustomerPackages.map(async (customerPackage) => {
            await tx.customerPackage.update({
              where: { id: customerPackage.id },
              data: { remainingUses: customerPackage.totalUses },
            });
            await activateCustomerPackageServiceBalances(tx, customerPackage.id);
          }),
        );
      }
    }

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
      customerId: appointment.customerId,
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
        packageVoucherAmount: paymentSummary.packageVoucherAmount,
        cashPaidAmount: paymentSummary.cashPaidAmount,
      },
    };
    },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      status: "error",
      message: salonCheckoutMessages.has(message) || message.includes("does not have enough stock")
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
  revalidatePath(`/crm/customers/${result.customerId}`);
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
