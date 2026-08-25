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
  reviseCommissionRule,
} from "@/lib/commission/service";

export async function createCommissionRuleAction(formData: FormData) {
  return run("MANAGE_COMMISSION_RULES", async (context) => {
    const sourceType = String(formData.get("sourceType")) as never;
    const appliesTo = String(formData.get("appliesTo") || "COMPANY");
    const itemSelection = String(formData.get("itemSelection") || "ALL");
    const itemIds = formData.getAll("itemIds").map(String).filter(Boolean);
    const membershipId = formData.get("membershipId")?.toString() || null;
    const categoryId = formData.get("categoryId")?.toString() || null;
    const targets = itemSelection === "SPECIFIC" ? itemIds : [null];
    if (itemSelection === "SPECIFIC" && targets.length === 0) {
      throw new Error("Select at least one service, product or package.");
    }
    for (const [index, itemId] of targets.entries()) {
      const scope = appliesTo === "EMPLOYEE" ? "MEMBER" : itemSelection === "CATEGORY" ? "CATEGORY" : itemId ? "ITEM" : "ALL";
      const scopeId = scope === "MEMBER" ? membershipId : scope === "CATEGORY" ? categoryId : itemId;
      await createCommissionRule(context, {
        name: `Commission ${String(sourceType).toLowerCase()} ${scope.toLowerCase()} ${Date.now()}-${index + 1}`,
        sourceType,
        branchId: formData.get("branchId")?.toString() || null,
        scope: scope as never,
        scopeId,
        itemId: scope === "MEMBER" ? itemId : null,
        ruleType: String(formData.get("ruleType")) as never,
        basis: String(formData.get("basis")) as never,
        rateBasisPoints: percentToBasisPoints(formData.get("ratePercent")),
        fixedAmountCents: ringgitToCents(formData.get("fixedAmountRinggit")),
        tiers: parseVisualTiers(formData),
        priority: 0,
        effectiveFrom: formData.get("effectiveFrom"),
        effectiveUntil: formData.get("hasEndDate") === "on" ? formData.get("effectiveUntil") : null,
        reason: "Created through Commission settings.",
      });
    }
    return `${targets.length} commission rule${targets.length === 1 ? "" : "s"} saved.`;
  }, true);
}

export async function reviseCommissionRuleAction(formData: FormData) {
  return run("MANAGE_COMMISSION_RULES", async (context) => {
    await reviseCommissionRule(context, {
      ruleId: String(formData.get("ruleId")),
      expectedRevision: Number(formData.get("expectedRevision")),
      name: formData.get("name"),
      sourceType: String(formData.get("sourceType")) as never,
      branchId: formData.get("branchId")?.toString() || null,
      scope: String(formData.get("scope")) as never,
      scopeId: formData.get("scopeId")?.toString() || null,
      itemId: formData.get("itemId")?.toString() || null,
      ruleType: String(formData.get("ruleType")) as never,
      basis: String(formData.get("basis")) as never,
      rateBasisPoints: percentToBasisPoints(formData.get("ratePercent")),
      fixedAmountCents: ringgitToCents(formData.get("fixedAmountRinggit")),
      tiers: parseVisualTiers(formData),
      priority: formData.get("priority") || 0,
      effectiveFrom: formData.get("effectiveFrom"),
      effectiveUntil: formData.get("hasEndDate") === "on" ? formData.get("effectiveUntil") : null,
      reason: formData.get("reason") || "Commission rate updated.",
    });
    return "Commission rate updated from its new effective date.";
  }, true);
}

export async function calculateCommissionPeriodAction(formData: FormData) {
  return run("CALCULATE_COMMISSION", async (context) => {
    const month = formData.get("commissionMonth")?.toString();
    const dates = month ? monthRange(month) : {
      start: formData.get("earnedPeriodStart"),
      end: formData.get("earnedPeriodEnd"),
    };
    await captureCommissionRefundAdjustments(context);
    await captureCommissionVoidAdjustments(context);
    await calculateCommissionPeriod(context, {
      branchId: formData.get("branchId")?.toString() || null,
      earnedPeriodStart: dates.start,
      earnedPeriodEnd: dates.end,
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
      amountCents: formData.has("amountRinggit")
        ? ringgitToCents(formData.get("amountRinggit"))
        : formData.get("amountCents"),
      reason: formData.get("reason"),
    });
    return "Append-only commission correction queued for a future statement.";
  });
}

async function run(capability: Parameters<typeof requireBusinessUserForModule>[1], work: (context: Awaited<ReturnType<typeof commissionContext>>) => Promise<string>, returnToSettings = false) {
  try {
    const context = await commissionContext(capability);
    done("success", await work(context), returnToSettings);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done("error", friendlyError(error), returnToSettings);
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

function parseVisualTiers(formData: FormData) {
  const starts = formData.getAll("tierFromRinggit").map(String);
  const rates = formData.getAll("tierRatePercent").map(String);
  return starts.map((start, index) => ({
    fromCents: ringgitToCents(start),
    rateBasisPoints: percentToBasisPoints(rates[index]),
  }));
}

function percentToBasisPoints(value: FormDataEntryValue | string | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : value;
}

function ringgitToCents(value: FormDataEntryValue | string | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : value;
}

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Choose a valid commission month.");
  const [year, monthNumber] = month.split("-").map(Number);
  const finalDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(finalDay).padStart(2, "0")}` };
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Commission action failed.";
  if (/overlaps an existing commission period/i.test(message)) return "This month overlaps an existing commission period. Open the existing period instead.";
  if (/explicit staff attribution/i.test(message)) return "Some sales do not have a staff member assigned. Review those sales before calculating commission.";
  if (/no effective rule/i.test(message)) return "Some eligible sales do not have a commission rate for these dates. Update Commission settings first.";
  if (/unique constraint|commission_rules_business_id_name/i.test(message)) return "A commission rule already covers this selection. Change the existing rate instead.";
  if (/already covers this same employee or item/i.test(message)) return message;
  return message.length > 220 || /Prisma|ConnectorError|invocation/i.test(message)
    ? "Commission could not be updated. Check the selected rate and effective date, then try again."
    : message;
}

function done(type: "success" | "error", message: string, settings = false): never {
  revalidatePath("/team/approvals");
  revalidatePath("/team/commission");
  revalidatePath("/staff/commission");
  redirect(`/team/commission?${settings ? "view=settings&" : ""}type=${type}&message=${encodeURIComponent(message)}`);
}
