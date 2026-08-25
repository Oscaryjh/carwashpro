"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { businessCapabilities } from "@/lib/business-groups/capabilities";
import { getBusinessTodayDateValue } from "@/lib/business-time";
import {
  createCommissionRule,
  reviseCommissionRule,
} from "@/lib/commission/service";
import { prisma } from "@/lib/prisma";

const commandSchema = z.object({
  membershipId: z.string().uuid(),
  sourceType: z.enum(["SERVICE", "PRODUCT", "PACKAGE_PURCHASE"]),
  ruleType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  rate: z.coerce.number().min(0),
});

const itemCommandSchema = commandSchema.extend({
  itemId: z.string().uuid(),
});

export async function saveEmployeeCommissionOverrideAction(formData: FormData) {
  const rawMembershipId = String(formData.get("membershipId") ?? "");
  try {
    const input = commandSchema.parse({
      membershipId: rawMembershipId,
      sourceType: formData.get("sourceType"),
      ruleType: formData.get("ruleType"),
      rate: formData.get("rate"),
    });
    const { businessId, user, access } = await requireBusinessUserForModule(
      "COMMISSION",
      "MANAGE_COMMISSION_RULES",
    );
    const membership = await prisma.employeeBusinessMembership.findFirst({
      where: { id: input.membershipId, businessId },
      select: { employeeCode: true, fullName: true },
    });
    if (!membership)
      throw new Error("Employee was not found in this business.");

    const existing = await prisma.commissionRule.findFirst({
      where: {
        businessId,
        sourceType: input.sourceType,
        status: "ACTIVE",
        revisions: {
          some: { scope: "MEMBER", scopeId: input.membershipId, itemId: null },
        },
      },
      include: {
        revisions: {
          where: { scope: "MEMBER", scopeId: input.membershipId, itemId: null },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
    });
    const context = {
      businessId,
      branchId:
        access.effectiveBusinessRole === "STAFF" ? access.branchId : null,
      actor: user,
      capabilities: businessCapabilities.filter((capability) =>
        hasBusinessCapability(access, capability),
      ),
      request: await getAuditRequestContext(),
    };
    const ruleCommand = {
      name: `Employee override · ${membership.employeeCode ?? membership.fullName} · ${input.sourceType}`,
      sourceType: input.sourceType,
      branchId: null,
      scope: "MEMBER" as const,
      scopeId: input.membershipId,
      itemId: null,
      ruleType: input.ruleType,
      basis: "NET_AFTER_DISCOUNT" as const,
      rateBasisPoints:
        input.ruleType === "PERCENTAGE" ? Math.round(input.rate * 100) : null,
      fixedAmountCents:
        input.ruleType === "FIXED_AMOUNT" ? Math.round(input.rate * 100) : null,
      tiers: [],
      priority: 0,
      effectiveFrom: getBusinessTodayDateValue(),
      effectiveUntil: null,
      reason:
        "Employee personal commission rate updated from employee profile.",
    };

    if (existing?.revisions[0]) {
      await reviseCommissionRule(context, {
        ...ruleCommand,
        ruleId: existing.id,
        expectedRevision: existing.revisions[0].revision,
      });
    } else {
      await createCommissionRule(context, ruleCommand);
    }
    finish(
      input.membershipId,
      "success",
      "Employee commission override saved.",
    );
  } catch (error) {
    if (isRedirectError(error)) throw error;
    finish(
      rawMembershipId,
      "error",
      error instanceof Error
        ? error.message
        : "Commission override could not be saved.",
    );
  }
}

export async function saveEmployeeCommissionItemOverrideAction(
  formData: FormData,
) {
  const rawMembershipId = String(formData.get("membershipId") ?? "");
  try {
    const [rawSourceType, rawItemId] = String(
      formData.get("catalogItem") ?? "",
    ).split(":");
    const input = itemCommandSchema.parse({
      membershipId: rawMembershipId,
      sourceType: rawSourceType,
      itemId: rawItemId,
      ruleType: formData.get("ruleType"),
      rate: formData.get("rate"),
    });
    const { businessId, user, access } = await requireBusinessUserForModule(
      "COMMISSION",
      "MANAGE_COMMISSION_RULES",
    );
    const membership = await prisma.employeeBusinessMembership.findFirst({
      where: { id: input.membershipId, businessId },
      select: { employeeCode: true, fullName: true },
    });
    if (!membership)
      throw new Error("Employee was not found in this business.");

    const existing = await prisma.commissionRule.findFirst({
      where: {
        businessId,
        sourceType: input.sourceType,
        status: "ACTIVE",
        revisions: {
          some: {
            scope: "MEMBER",
            scopeId: input.membershipId,
            itemId: input.itemId,
          },
        },
      },
      include: {
        revisions: {
          where: {
            scope: "MEMBER",
            scopeId: input.membershipId,
            itemId: input.itemId,
          },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
    });
    const context = {
      businessId,
      branchId:
        access.effectiveBusinessRole === "STAFF" ? access.branchId : null,
      actor: user,
      capabilities: businessCapabilities.filter((capability) =>
        hasBusinessCapability(access, capability),
      ),
      request: await getAuditRequestContext(),
    };
    const ruleCommand = {
      name: `Employee item override · ${input.membershipId} · ${input.sourceType} · ${input.itemId}`,
      sourceType: input.sourceType,
      branchId: null,
      scope: "MEMBER" as const,
      scopeId: input.membershipId,
      itemId: input.itemId,
      ruleType: input.ruleType,
      basis: "NET_AFTER_DISCOUNT" as const,
      rateBasisPoints:
        input.ruleType === "PERCENTAGE" ? Math.round(input.rate * 100) : null,
      fixedAmountCents:
        input.ruleType === "FIXED_AMOUNT" ? Math.round(input.rate * 100) : null,
      tiers: [],
      priority: 0,
      effectiveFrom: getBusinessTodayDateValue(),
      effectiveUntil: null,
      reason:
        "Employee item-specific commission rate updated from employee profile.",
    };

    if (existing?.revisions[0]) {
      await reviseCommissionRule(context, {
        ...ruleCommand,
        ruleId: existing.id,
        expectedRevision: existing.revisions[0].revision,
      });
    } else {
      await createCommissionRule(context, ruleCommand);
    }
    finish(input.membershipId, "success", "Special item commission saved.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    finish(
      rawMembershipId,
      "error",
      error instanceof Error
        ? error.message
        : "Special item commission could not be saved.",
    );
  }
}

function finish(
  membershipId: string,
  type: "success" | "error",
  message: string,
): never {
  const path = `/team/people/${membershipId}?section=commission`;
  revalidatePath(path);
  revalidatePath("/team/commission");
  redirect(`${path}&type=${type}&message=${encodeURIComponent(message)}`);
}
