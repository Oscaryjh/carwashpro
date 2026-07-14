"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { ensureCustomerMembership } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(60),
  pointsPerRinggit: z.coerce.number().min(0).max(100),
  welcomePoints: z.coerce.number().int().min(0).max(100000),
});

const customerSchema = z.string().uuid();

const adjustmentSchema = z.object({
  customerId: z.string().uuid(),
  points: z.coerce.number().int().min(-100000).max(100000).refine(Boolean),
  reason: z.string().trim().min(3).max(160),
});

export async function updateLoyaltySettingsAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  assertOwner(user.role);
  const request = await getAuditRequestContext();
  const input = settingsSchema.parse({
    name: formData.get("name"),
    pointsPerRinggit: formData.get("pointsPerRinggit"),
    welcomePoints: formData.get("welcomePoints"),
  });
  const enabled = formData.get("enabled") === "on";

  await prisma.$transaction(async (tx) => {
    const before = await tx.loyaltyProgram.findUnique({ where: { businessId } });
    const program = await tx.loyaltyProgram.upsert({
      where: { businessId },
      update: {
        enabled,
        name: input.name,
        pointsPerRinggit: input.pointsPerRinggit.toString(),
        welcomePoints: input.welcomePoints,
      },
      create: {
        businessId,
        enabled,
        name: input.name,
        pointsPerRinggit: input.pointsPerRinggit.toString(),
        welcomePoints: input.welcomePoints,
      },
    });

    await writeAuditLog(
      {
        businessId,
        actor: user,
        action: "LOYALTY_SETTINGS_UPDATED",
        entityType: "LoyaltyProgram",
        entityId: program.id,
        summary: `Updated ${program.name} settings`,
        before,
        after: program,
        request,
      },
      tx,
    );
  });

  revalidatePath("/loyalty");
  revalidatePath("/loyalty/settings");
  redirect("/loyalty/settings?type=success&message=Loyalty%20settings%20updated.");
}

export async function enrollCustomerMembershipAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "LOYALTY");
  const customerId = customerSchema.parse(formData.get("customerId"));
  const request = await getAuditRequestContext();

  const membership = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: customerId, businessId },
      select: { id: true, name: true },
    });
    const existing = await tx.customerMembership.findUnique({
      where: { customerId },
    });
    const nextMembership = await ensureCustomerMembership(tx, {
      businessId,
      customerId,
      createdById: user.userId,
    });

    if (!existing) {
      await writeAuditLog(
        {
          businessId,
          actor: user,
          action: "MEMBERSHIP_ENROLLED",
          entityType: "CustomerMembership",
          entityId: nextMembership.id,
          summary: `Enrolled ${customer.name} in membership`,
          after: nextMembership,
          request,
        },
        tx,
      );
    }

    return nextMembership;
  });

  revalidateMembershipPaths(customerId);
  redirect(
    `/crm/customers/${customerId}?type=success&message=${encodeURIComponent(
      membership.status === "ACTIVE" ? "Customer enrolled in membership." : "Membership already exists.",
    )}`,
  );
}

export async function adjustLoyaltyPointsAction(formData: FormData) {
  const { businessId, user } = await requireBusinessUser();
  assertOwner(user.role);
  const request = await getAuditRequestContext();
  const input = adjustmentSchema.parse({
    customerId: formData.get("customerId"),
    points: formData.get("points"),
    reason: formData.get("reason"),
  });

  await prisma.$transaction(
    async (tx) => {
      const membership = await tx.customerMembership.findFirstOrThrow({
        where: {
          businessId,
          customerId: input.customerId,
        },
        include: { customer: { select: { name: true } } },
      });
      const nextBalance = membership.pointsBalance + input.points;

      if (nextBalance < 0) {
        throw new Error("Point adjustment cannot make the balance negative.");
      }

      const transaction = await tx.loyaltyTransaction.create({
        data: {
          businessId,
          membershipId: membership.id,
          customerId: input.customerId,
          createdById: user.userId,
          type: "MANUAL_ADJUSTMENT",
          points: input.points,
          description: input.reason,
        },
      });

      await tx.customerMembership.update({
        where: { id: membership.id },
        data: {
          pointsBalance: { increment: input.points },
          lifetimePointsAdjusted: { increment: input.points },
        },
      });

      await writeAuditLog(
        {
          businessId,
          actor: user,
          action: "LOYALTY_POINTS_ADJUSTED",
          entityType: "LoyaltyTransaction",
          entityId: transaction.id,
          summary: `Adjusted ${membership.customer.name} by ${formatSignedPoints(input.points)} points`,
          before: { pointsBalance: membership.pointsBalance },
          after: { pointsBalance: nextBalance, reason: input.reason },
          request,
        },
        tx,
      );
    },
    { isolationLevel: "Serializable" },
  );

  revalidateMembershipPaths(input.customerId);
  redirect(
    `/crm/customers/${input.customerId}?type=success&message=${encodeURIComponent(
      "Membership points adjusted.",
    )}`,
  );
}

function revalidateMembershipPaths(customerId: string) {
  revalidatePath("/loyalty");
  revalidatePath("/loyalty/members");
  revalidatePath("/loyalty/activity");
  revalidatePath("/reports");
  revalidatePath(`/crm/customers/${customerId}`);
}

function assertOwner(role: string) {
  if (role !== "BUSINESS_OWNER") {
    throw new Error("Only the business owner can perform this action.");
  }
}

function formatSignedPoints(points: number) {
  return points > 0 ? `+${points}` : String(points);
}
