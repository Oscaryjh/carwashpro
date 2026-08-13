"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { businessCapabilities } from "@/lib/business-groups/capabilities";
import {
  approveCommissionPeriod,
  calculateCommissionPeriod,
  captureCommissionRefundAdjustments,
  captureCommissionSourceEvents,
  captureCommissionVoidAdjustments,
  createCommissionRule,
  createManualCommissionCorrection,
  linkApprovedCommissionToPayroll,
} from "@/lib/commission/service";

export async function createCommissionRuleAction(formData: FormData) {
  return run("MANAGE_COMMISSION_RULES", async (context) => {
    await createCommissionRule(context, {
      name: formData.get("name"),
      sourceType: String(formData.get("sourceType")) as never,
      branchId: formData.get("branchId")?.toString() || null,
      scope: String(formData.get("scope")) as never,
      scopeId: formData.get("scopeId")?.toString() || null,
      ruleType: String(formData.get("ruleType")) as never,
      basis: String(formData.get("basis")) as never,
      rateBasisPoints: formData.get("rateBasisPoints"),
      fixedAmountCents: formData.get("fixedAmountCents"),
      tiers: parseTiers(formData.get("tiers")),
      priority: formData.get("priority"),
      effectiveFrom: formData.get("effectiveFrom"),
      effectiveUntil: formData.get("effectiveUntil"),
      reason: formData.get("reason"),
    });
    return "Effective-dated commission rule created.";
  });
}

export async function calculateCommissionPeriodAction(formData: FormData) {
  return run("CALCULATE_COMMISSION", async (context) => {
    await captureCommissionRefundAdjustments(context);
    await captureCommissionVoidAdjustments(context);
    await calculateCommissionPeriod(context, {
      branchId: formData.get("branchId")?.toString() || null,
      earnedPeriodStart: formData.get("earnedPeriodStart"),
      earnedPeriodEnd: formData.get("earnedPeriodEnd"),
    });
    return "Commission period calculated from durable POS sources.";
  });
}

export async function recoverCommissionSourcesAction() {
  return run("CALCULATE_COMMISSION", async (context) => {
    const source = await captureCommissionSourceEvents(context);
    const refunds = await captureCommissionRefundAdjustments(context);
    const voids = await captureCommissionVoidAdjustments(context);
    return `Recovery complete: ${source.insertedEventCount} source event(s), ${refunds.insertedAdjustmentCount} refund adjustment(s), ${voids.insertedAdjustmentCount} void adjustment(s).`;
  });
}

export async function approveCommissionPeriodAction(formData: FormData) {
  return run("APPROVE_COMMISSION", async (context) => {
    await approveCommissionPeriod(context, {
      periodId: String(formData.get("periodId")),
      expectedRevision: Number(formData.get("expectedRevision")),
      reason: formData.get("reason"),
    });
    return "Commission period approved and frozen.";
  });
}

export async function linkCommissionToPayrollAction(formData: FormData) {
  return run("LINK_COMMISSION_TO_PAYROLL", async (context) => {
    await linkApprovedCommissionToPayroll(context, {
      statementId: String(formData.get("statementId")),
      targetPayrollMonth: formData.get("targetPayrollMonth"),
    });
    return "Approved frozen commission linked to the selected Payroll month.";
  });
}

export async function createCommissionCorrectionAction(formData: FormData) {
  return run("ADJUST_COMMISSION", async (context) => {
    await createManualCommissionCorrection(context, {
      statementId: String(formData.get("statementId")),
      amountCents: formData.get("amountCents"),
      reason: formData.get("reason"),
    });
    return "Append-only commission correction queued for a future statement.";
  });
}

async function run(capability: Parameters<typeof requireBusinessUserForModule>[1], work: (context: Awaited<ReturnType<typeof commissionContext>>) => Promise<string>) {
  try {
    const context = await commissionContext(capability);
    done("success", await work(context));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", error instanceof Error ? error.message : "Commission action failed.");
  }
}

async function commissionContext(capability: Parameters<typeof requireBusinessUserForModule>[1]) {
  const { businessId, user, access } = await requireBusinessUserForModule("COMMISSION", capability);
  return {
    businessId,
    branchId: access.effectiveBusinessRole === "STAFF" ? access.branchId : null,
    actor: user,
    capabilities: businessCapabilities.filter((candidate) => hasBusinessCapability(access, candidate)),
    request: await getAuditRequestContext(),
  };
}

function parseTiers(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text.split(";").map((row) => {
    const [fromRinggit, ratePercent] = row.split(":").map(Number);
    return { fromCents: Math.round(fromRinggit * 100), rateBasisPoints: Math.round(ratePercent * 100) };
  });
}

function done(type: "success" | "error", message: string): never {
  revalidatePath("/team/approvals");
  revalidatePath("/team/commission");
  revalidatePath("/staff/commission");
  redirect(`/team/commission?type=${type}&message=${encodeURIComponent(message)}`);
}
