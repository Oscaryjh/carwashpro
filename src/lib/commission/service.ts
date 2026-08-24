import type {
  CommissionBasis,
  CommissionRuleScope,
  CommissionRuleType,
  CommissionSourceType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { toBusinessDateValue } from "@/lib/business-time";
import { prisma } from "@/lib/prisma";
import {
  allocateDiscountCents,
  calculateCommission,
  commissionEligibleAmountCents,
  centsToMoney,
  moneyToCents,
  parseCommissionTiers,
  resolveCommissionRule,
  stableCommissionDigest,
  type CommissionRuleCandidate,
  type CommissionSource,
} from "./calculation";

type CommissionActor = Pick<AppSession, "userId" | "name" | "email">;
export type CommissionWriteContext = {
  businessId: string;
  /** Null/undefined means whole-business; a UUID restricts every operation to that branch. */
  branchId?: string | null;
  actor: CommissionActor;
  capabilities: readonly BusinessCapability[];
  request?: AuditRequestContext;
};

type RuleCommand = {
  name: unknown;
  sourceType: CommissionSourceType;
  branchId?: string | null;
  scope: CommissionRuleScope;
  scopeId?: string | null;
  itemId?: string | null;
  ruleType: CommissionRuleType;
  basis: CommissionBasis;
  rateBasisPoints?: unknown;
  fixedAmountCents?: unknown;
  tiers?: unknown;
  priority?: unknown;
  effectiveFrom: unknown;
  effectiveUntil?: unknown;
  reason: unknown;
};

export async function createCommissionRule(
  context: CommissionWriteContext,
  command: RuleCommand,
  database: PrismaClient = prisma,
) {
  assertCapability(context, "MANAGE_COMMISSION_RULES");
  const input = parseRuleCommand({ ...command, branchId: scopedBranch(context, command.branchId) });
  return database.$transaction(async (transaction) => {
    await validateRuleScope(transaction, context.businessId, input);
    await validateNoParallelRuleOverlap(transaction, context.businessId, input);
    const nestedRevision = revisionValues(context, input, 1);
    const rule = await transaction.commissionRule.create({
      data: {
        businessId: context.businessId,
        createdById: context.actor.userId,
        name: input.name,
        sourceType: input.sourceType,
        revisions: {
          create: nestedRevision,
        },
      },
      include: { revisions: true },
    });
    await audit(transaction, context, "COMMISSION_RULE_CREATED", "CommissionRule", rule.id, {
      sourceType: input.sourceType,
      ruleType: input.ruleType,
      scope: input.scope,
      effectiveFrom: dateKey(input.effectiveFrom),
    });
    return rule;
  }, { isolationLevel: "Serializable" });
}

export async function reviseCommissionRule(
  context: CommissionWriteContext,
  command: RuleCommand & { ruleId: string; expectedRevision: number },
  database: PrismaClient = prisma,
) {
  assertCapability(context, "MANAGE_COMMISSION_RULES");
  const input = parseRuleCommand({ ...command, branchId: scopedBranch(context, command.branchId) });
  return database.$transaction(async (transaction) => {
    const rule = await transaction.commissionRule.findFirst({
      where: { id: command.ruleId, businessId: context.businessId },
      include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
    });
    if (!rule || rule.revisions[0]?.revision !== command.expectedRevision) {
      throw new Error("The commission rule changed. Refresh before creating a revision.");
    }
    if (rule.sourceType !== input.sourceType) {
      throw new Error("A rule source type is immutable; create a new rule instead.");
    }
    await validateRuleScope(transaction, context.businessId, input);
    await validateNoParallelRuleOverlap(transaction, context.businessId, input, rule.id);
    const revision = await transaction.commissionRuleRevision.create({
      data: {
        ...revisionValues(context, input, command.expectedRevision + 1),
        businessId: context.businessId,
        ruleId: rule.id,
      },
    });
    await audit(transaction, context, "COMMISSION_RULE_REVISED", "CommissionRule", rule.id, {
      previousRevision: command.expectedRevision,
      revision: revision.revision,
      reasonRecorded: true,
    });
    return revision;
  }, { isolationLevel: "Serializable" });
}

export async function captureCommissionSourceEvents(
  context: CommissionWriteContext,
  input: { from?: Date; toExclusive?: Date } = {},
  database: PrismaClient = prisma,
) {
  assertAnyCapability(context, ["CALCULATE_COMMISSION", "MANAGE_COMMISSION_RULES"]);
  const invoices = await database.invoice.findMany({
    where: {
      businessId: context.businessId,
      ...(context.branchId ? { branchId: context.branchId } : {}),
      status: "PAID",
      issuedAt: {
        ...(input.from ? { gte: input.from } : {}),
        ...(input.toExclusive ? { lt: input.toExclusive } : {}),
      },
    },
    select: {
      id: true,
      branchId: true,
      appointmentId: true,
      customerPackageId: true,
      discountAmount: true,
      checkoutType: true,
      issuedAt: true,
      items: {
        select: {
          id: true,
          serviceId: true,
          productId: true,
          customerPackageId: true,
          customerPackage: { select: { packageId: true } },
          commissionMembershipId: true,
          quantity: true,
          lineTotal: true,
          service: { select: { categoryId: true } },
          product: { select: { categoryId: true } },
        },
        orderBy: { id: "asc" },
      },
      appointment: {
        select: {
          assignedStaff: { select: { employeeBusinessMembershipId: true } },
        },
      },
    },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
  });
  let discovered = 0;
  const result = await database.$transaction(async (transaction) => {
    for (const invoice of invoices) {
      const gross = invoice.items.map((item) => moneyToCents(item.lineTotal));
      const discounts = allocateDiscountCents(gross, moneyToCents(invoice.discountAmount));
      for (let index = 0; index < invoice.items.length; index += 1) {
        const item = invoice.items[index];
        const sourceType = classifySource(invoice.customerPackageId, item);
        const membershipId = item.commissionMembershipId ??
          (sourceType === "SERVICE"
            ? invoice.appointment?.assignedStaff?.employeeBusinessMembershipId ?? null
            : null);
        const attributionStatus = sourceType === "PACKAGE_REDEMPTION"
          ? "INELIGIBLE_PACKAGE_REDEMPTION"
          : membershipId
            ? "ATTRIBUTED"
            : "REVIEW_REQUIRED";
        const grossBasisOverride = invoice.checkoutType === "TRAINING_COMPLIMENTARY";
        const sourceRevision = stableCommissionDigest({
          invoiceId: invoice.id,
          invoiceItemId: item.id,
          membershipId,
          sourceType,
          quantity: item.quantity,
          grossAmountCents: gross[index],
          discountAmountCents: discounts[index],
          grossBasisOverride,
        });
        const created = await transaction.commissionSourceEvent.createMany({
          data: [{
            businessId: context.businessId,
            branchId: invoice.branchId,
            invoiceId: invoice.id,
            invoiceItemId: item.id,
            membershipId,
            sourceType,
            sourceItemId: item.productId ?? item.serviceId ?? item.customerPackage?.packageId ?? null,
            sourceCategoryId: item.product?.categoryId ?? item.service?.categoryId ?? null,
            sourceRevision,
            attributionStatus,
            attributionReference: membershipId
              ? item.commissionMembershipId ? "INVOICE_ITEM_SNAPSHOT" : "APPOINTMENT_ASSIGNED_STAFF"
              : sourceType === "PACKAGE_REDEMPTION" ? "PACKAGE_REDEMPTION_EXCLUDED" : "NO_EXPLICIT_SALESPERSON",
            businessDate: utcDate(toBusinessDateValue(invoice.issuedAt)),
            eventAt: invoice.issuedAt,
            quantity: item.quantity,
            grossAmountCents: gross[index],
            discountAmountCents: discounts[index],
            netAmountCents: gross[index] - discounts[index],
            grossBasisOverride,
          }],
          skipDuplicates: true,
        });
        discovered += created.count;
      }
    }
    await audit(transaction, context, "COMMISSION_SOURCE_RECOVERY_SCAN", "CommissionSourceEvent", null, {
      invoiceCount: invoices.length,
      insertedEventCount: discovered,
      cashierFallbackUsed: false,
      packageRedemptionPolicy: "EXCLUDED",
    });
    return { invoiceCount: invoices.length, insertedEventCount: discovered };
  }, { isolationLevel: "Serializable" });
  return result;
}

export async function calculateCommissionPeriod(
  context: CommissionWriteContext,
  command: { branchId?: string | null; earnedPeriodStart: unknown; earnedPeriodEnd: unknown },
  database: PrismaClient = prisma,
) {
  assertCapability(context, "CALCULATE_COMMISSION");
  const earnedPeriodStart = parseDate(command.earnedPeriodStart, "Earned period start");
  const earnedPeriodEnd = parseDate(command.earnedPeriodEnd, "Earned period end");
  if (earnedPeriodEnd < earnedPeriodStart) throw new Error("Earned period end cannot be before start.");
  const branchId = scopedBranch(context, command.branchId);
  const toExclusive = nextUtcDay(earnedPeriodEnd);
  await captureCommissionSourceEvents(context, { from: earnedPeriodStart, toExclusive }, database);
  return database.$transaction(async (transaction) => {
    const scopeKey = branchId ? `BRANCH:${branchId}` : "BUSINESS";
    if (branchId) await requireBranch(transaction, context.businessId, branchId);
    const overlappingPeriod = await transaction.commissionPeriod.findFirst({
      where: {
        businessId: context.businessId,
        scopeKey,
        earnedPeriodStart: { lte: earnedPeriodEnd },
        earnedPeriodEnd: { gte: earnedPeriodStart },
        NOT: { earnedPeriodStart, earnedPeriodEnd },
      },
      select: { earnedPeriodStart: true, earnedPeriodEnd: true },
    });
    if (overlappingPeriod) {
      throw new Error(
        `This period overlaps an existing commission period (${dateKey(overlappingPeriod.earnedPeriodStart)} to ${dateKey(overlappingPeriod.earnedPeriodEnd)}).`,
      );
    }
    let period = await transaction.commissionPeriod.findUnique({
      where: { businessId_scopeKey_earnedPeriodStart_earnedPeriodEnd: {
        businessId: context.businessId,
        scopeKey,
        earnedPeriodStart,
        earnedPeriodEnd,
      } },
    });
    if (period?.status === "LOCKED") throw new Error("An approved commission period is immutable.");
    if (!period) {
      period = await transaction.commissionPeriod.create({
        data: { businessId: context.businessId, branchId, scopeKey, earnedPeriodStart, earnedPeriodEnd },
      });
    }
    const sources = await transaction.commissionSourceEvent.findMany({
      where: {
        businessId: context.businessId,
        ...(branchId ? { branchId } : {}),
        invoice: { status: { not: "VOID" } },
        businessDate: { gte: earnedPeriodStart, lte: earnedPeriodEnd },
        attributionStatus: "ATTRIBUTED",
        membershipId: { not: null },
      },
      orderBy: [{ membershipId: "asc" }, { businessDate: "asc" }, { id: "asc" }],
    });
    const blockers = await transaction.commissionSourceEvent.count({
      where: {
        businessId: context.businessId,
        ...(branchId ? { branchId } : {}),
        invoice: { status: { not: "VOID" } },
        businessDate: { gte: earnedPeriodStart, lte: earnedPeriodEnd },
        attributionStatus: "REVIEW_REQUIRED",
      },
    });
    if (blockers > 0) throw new Error(`${blockers} commission source line(s) require explicit staff attribution.`);
    const rules = await transaction.commissionRuleRevision.findMany({
      where: {
        businessId: context.businessId,
        rule: { status: "ACTIVE" },
        effectiveFrom: { lte: earnedPeriodEnd },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: earnedPeriodStart } }],
      },
      include: { rule: { select: { sourceType: true } } },
    });
    const candidates: CommissionRuleCandidate[] = rules.map((revision) => ({
      ...revision,
      sourceType: revision.rule.sourceType,
      tiers: revision.tiers,
    }));
    const resolved = sources.map((row) => {
      const source = sourceShape(row);
      return { row, source, resolution: resolveCommissionRule(source, candidates) };
    });
    const withoutRule = resolved.filter((item) => !item.resolution.rule);
    if (withoutRule.length > 0) {
      throw new Error(`${withoutRule.length} attributed commission source line(s) have no effective rule.`);
    }
    const tierTotals = new Map<string, number>();
    for (const item of resolved) {
      const rule = item.resolution.rule!;
      const eligible = commissionEligibleAmountCents(item.source, rule);
      const key = `${item.row.membershipId}:${rule.id}`;
      tierTotals.set(key, (tierTotals.get(key) ?? 0) + eligible);
    }
    const revision = period.currentRevision + 1;
    const byMembership = new Map<string, typeof resolved>();
    for (const item of resolved) {
      const membershipId = item.row.membershipId!;
      byMembership.set(membershipId, [...(byMembership.get(membershipId) ?? []), item]);
    }
    const sourceDigest = stableCommissionDigest(resolved.map((item) => ({
      source: item.source,
      ruleRevisionId: item.resolution.rule!.id,
    })));
    for (const [membershipId, items] of byMembership) {
      const accrualInputs = items.map((item) => {
        const rule = item.resolution.rule!;
        const result = calculateCommission(
          item.source,
          rule,
          tierTotals.get(`${membershipId}:${rule.id}`),
        );
        return { item, rule, result };
      });
      const adjustmentCents = await approvedFutureAdjustments(transaction, context.businessId, membershipId, earnedPeriodEnd);
      const eligibleSalesCents = accrualInputs.reduce((sum, item) => sum + item.result.eligibleAmountCents, 0);
      const calculatedCommissionCents = accrualInputs.reduce((sum, item) => sum + item.result.commissionAmountCents, 0);
      const finalCommissionCents = calculatedCommissionCents + adjustmentCents;
      if (finalCommissionCents < 0) throw new Error("Commission adjustments exceed the calculated earning; manual review is required.");
      const calculationDigest = stableCommissionDigest({ membershipId, revision, sourceDigest, accrualInputs: accrualInputs.map(({ item, rule, result }) => ({ sourceEventId: item.row.id, ruleRevisionId: rule.id, result })) });
      const statement = await transaction.commissionStatement.create({
        data: {
          businessId: context.businessId,
          periodId: period.id,
          membershipId,
          calculationRevision: revision,
          eligibleSalesCents,
          calculatedCommissionCents,
          adjustmentCents,
          finalCommissionCents,
          calculationDigest,
        },
      });
      await transaction.commissionAccrual.createMany({
        data: accrualInputs.map(({ item, rule, result }) => ({
          businessId: context.businessId,
          statementId: statement.id,
          membershipId,
          sourceEventId: item.row.id,
          ruleRevisionId: rule.id,
          calculationRevision: revision,
          eligibleAmountCents: result.eligibleAmountCents,
          commissionAmountCents: result.commissionAmountCents,
          ruleSnapshot: ruleSnapshot(rule) as Prisma.InputJsonValue,
          calculationTrace: { ...item.resolution.trace, ...result.trace } as Prisma.InputJsonValue,
        })),
      });
    }
    period = await transaction.commissionPeriod.update({
      where: { id: period.id },
      data: { status: "CALCULATED", currentRevision: revision, calculatedById: context.actor.userId, calculatedAt: new Date(), sourceDigest },
    });
    await audit(transaction, context, "COMMISSION_PERIOD_CALCULATED", "CommissionPeriod", period.id, {
      revision,
      sourceCount: sources.length,
      statementCount: byMembership.size,
      sourceDigest,
    });
    return period;
  }, { isolationLevel: "Serializable" });
}

export async function approveCommissionPeriod(
  context: CommissionWriteContext,
  command: { periodId: string; expectedRevision: number; reason: unknown },
  database: PrismaClient = prisma,
) {
  assertCapability(context, "APPROVE_COMMISSION");
  const reason = requiredText(command.reason, "Approval reason", 5, 500);
  return database.$transaction(async (transaction) => {
    const period = await transaction.commissionPeriod.findFirst({
      where: {
        id: command.periodId,
        businessId: context.businessId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        status: "CALCULATED",
        currentRevision: command.expectedRevision,
      },
      include: { statements: { where: { calculationRevision: command.expectedRevision } } },
    });
    if (!period) {
      const canonicalLocked = await transaction.commissionPeriod.findFirst({
        where: {
          id: command.periodId,
          businessId: context.businessId,
          ...(context.branchId ? { branchId: context.branchId } : {}),
          status: "LOCKED",
          currentRevision: command.expectedRevision,
        },
      });
      if (canonicalLocked) return canonicalLocked;
      throw new Error("The commission period was not found, is not calculated, or changed.");
    }
    if (period.calculatedById === context.actor.userId) throw new Error("The calculator cannot approve the same commission period.");
    const actor = await transaction.user.findFirst({ where: { id: context.actor.userId, businessId: context.businessId }, select: { employeeBusinessMembershipId: true } });
    if (actor?.employeeBusinessMembershipId && period.statements.some((statement) => statement.membershipId === actor.employeeBusinessMembershipId)) {
      throw new Error("An approver cannot approve a period containing their own commission statement.");
    }
    if (period.statements.length === 0) throw new Error("A commission period without statements cannot be approved.");
    await transaction.commissionStatement.updateMany({
      where: { periodId: period.id, calculationRevision: command.expectedRevision, status: "CALCULATED" },
      data: { status: "APPROVED", approvedById: context.actor.userId, approvedAt: new Date() },
    });
    for (const statement of period.statements) {
      await transaction.commissionAdjustment.updateMany({
        where: {
          businessId: context.businessId,
          membershipId: statement.membershipId,
          payrollStatus: "FUTURE_PAYROLL_REQUIRED",
          createdAt: { lte: nextUtcDay(period.earnedPeriodEnd) },
        },
        data: {
          payrollStatus: "APPLIED_TO_FUTURE_STATEMENT",
          appliedToStatementId: statement.id,
        },
      });
    }
    const locked = await transaction.commissionPeriod.update({
      where: { id: period.id },
      data: { status: "LOCKED", approvedById: context.actor.userId, approvedAt: new Date(), approvalReason: reason },
    });
    await audit(transaction, context, "COMMISSION_PERIOD_APPROVED", "CommissionPeriod", period.id, {
      calculationRevision: command.expectedRevision,
      statementCount: period.statements.length,
      sourceDigest: period.sourceDigest,
    });
    return locked;
  }, { isolationLevel: "Serializable" });
}

export async function captureCommissionRefundAdjustments(
  context: CommissionWriteContext,
  database: PrismaClient = prisma,
) {
  assertAnyCapability(context, ["CALCULATE_COMMISSION", "APPROVE_COMMISSION"]);
  return database.$transaction(async (transaction) => {
    const refunds = await transaction.paymentRefund.findMany({
      where: {
        businessId: context.businessId,
        ...(context.branchId ? { branchId: context.branchId } : {}),
        invoiceId: { not: null },
      },
      include: {
        invoice: {
          select: {
            id: true,
            paidAmount: true,
            refunds: { select: { amount: true } },
          },
        },
      },
      orderBy: [{ refundedAt: "asc" }, { id: "asc" }],
    });
    let inserted = 0;
    for (const refund of refunds) {
      if (!refund.invoice) continue;
      // Invoice.paidAmount is the remaining paid balance after refunds. Restore
      // the original settled amount so every refund is proportional to the
      // same immutable earning basis, including full and sequential refunds.
      const originalSettledCents = moneyToCents(refund.invoice.paidAmount) +
        refund.invoice.refunds.reduce((sum, item) => sum + moneyToCents(item.amount), 0);
      if (originalSettledCents <= 0) continue;
      const refundCents = Math.min(originalSettledCents, moneyToCents(refund.amount));
      const accruals = await transaction.commissionAccrual.findMany({
        where: {
          businessId: context.businessId,
          sourceEvent: { invoiceId: refund.invoice.id },
        },
        include: { statement: { include: { period: true } } },
      });
      for (const accrual of accruals.filter(
        (candidate) =>
          candidate.calculationRevision === candidate.statement.period.currentRevision,
      )) {
        const eligibleAmountCents = -Math.floor((accrual.eligibleAmountCents * refundCents + Math.floor(originalSettledCents / 2)) / originalSettledCents);
        const commissionAmountCents = -Math.floor((accrual.commissionAmountCents * refundCents + Math.floor(originalSettledCents / 2)) / originalSettledCents);
        const created = await transaction.commissionAdjustment.createMany({
          data: [{
            businessId: context.businessId,
            membershipId: accrual.membershipId,
            statementId: accrual.statementId,
            accrualId: accrual.id,
            paymentRefundId: refund.id,
            type: "REFUND",
            eligibleAmountCents,
            commissionAmountCents,
            reason: `Refund ${refund.id} proportionally reverses the frozen source accrual.`,
            createdById: refund.processedById ?? context.actor.userId,
            payrollStatus: accrual.statement.status === "APPROVED" || accrual.statement.status === "APPLIED_TO_PAYROLL"
              ? "FUTURE_PAYROLL_REQUIRED"
              : "UNLINKED",
          }],
          skipDuplicates: true,
        });
        inserted += created.count;
      }
    }
    await audit(transaction, context, "COMMISSION_REFUND_RECOVERY_SCAN", "CommissionAdjustment", null, { refundCount: refunds.length, insertedAdjustmentCount: inserted });
    return { refundCount: refunds.length, insertedAdjustmentCount: inserted };
  }, { isolationLevel: "Serializable" });
}

export async function createManualCommissionCorrection(
  context: CommissionWriteContext,
  command: { statementId: string; amountCents: unknown; reason: unknown },
  database: PrismaClient = prisma,
) {
  assertCapability(context, "ADJUST_COMMISSION");
  const amountCents = Number(command.amountCents);
  if (!Number.isInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 100_000_000) {
    throw new Error("Manual commission correction must be a non-zero integer-cent amount within the supported range.");
  }
  const reason = requiredText(command.reason, "Correction reason", 5, 500);
  return database.$transaction(async (transaction) => {
    const statement = await transaction.commissionStatement.findFirst({
      where: {
        id: command.statementId,
        businessId: context.businessId,
        status: { in: ["APPROVED", "APPLIED_TO_PAYROLL"] },
        ...(context.branchId ? { period: { branchId: context.branchId } } : {}),
      },
      include: {
        period: true,
        accruals: { orderBy: { id: "asc" }, take: 1 },
      },
    });
    if (!statement || statement.period.status !== "LOCKED" || !statement.accruals[0]) {
      throw new Error("Only a frozen commission statement with source accruals can receive a correction.");
    }
    const actor = await transaction.user.findFirst({
      where: { id: context.actor.userId, businessId: context.businessId },
      select: { employeeBusinessMembershipId: true },
    });
    if (actor?.employeeBusinessMembershipId === statement.membershipId) {
      throw new Error("An employee cannot create their own commission correction.");
    }
    const adjustment = await transaction.commissionAdjustment.create({
      data: {
        businessId: context.businessId,
        membershipId: statement.membershipId,
        statementId: statement.id,
        accrualId: statement.accruals[0].id,
        type: "MANUAL_CORRECTION",
        eligibleAmountCents: 0,
        commissionAmountCents: amountCents,
        reason,
        createdById: context.actor.userId,
        payrollStatus: "FUTURE_PAYROLL_REQUIRED",
      },
    });
    await audit(transaction, context, "COMMISSION_ADJUSTED", "CommissionAdjustment", adjustment.id, {
      statementId: statement.id,
      direction: amountCents > 0 ? "INCREASE" : "DECREASE",
      reasonRecorded: true,
    });
    return adjustment;
  }, { isolationLevel: "Serializable" });
}

export async function captureCommissionVoidAdjustments(
  context: CommissionWriteContext,
  database: PrismaClient = prisma,
) {
  assertAnyCapability(context, ["CALCULATE_COMMISSION", "APPROVE_COMMISSION"]);
  return database.$transaction(async (transaction) => {
    const accruals = await transaction.commissionAccrual.findMany({
      where: {
        businessId: context.businessId,
        sourceEvent: {
          ...(context.branchId ? { branchId: context.branchId } : {}),
          invoice: { status: "VOID" },
        },
        statement: { status: { in: ["APPROVED", "APPLIED_TO_PAYROLL"] } },
      },
      include: { statement: { include: { period: true } } },
      orderBy: { id: "asc" },
    });
    let inserted = 0;
    for (const accrual of accruals.filter(
      (candidate) => candidate.calculationRevision === candidate.statement.period.currentRevision,
    )) {
      const created = await transaction.commissionAdjustment.createMany({
        data: [{
          businessId: context.businessId,
          membershipId: accrual.membershipId,
          statementId: accrual.statementId,
          accrualId: accrual.id,
          type: "VOID",
          eligibleAmountCents: -accrual.eligibleAmountCents,
          commissionAmountCents: -accrual.commissionAmountCents,
          reason: `Voided invoice fully reverses frozen accrual ${accrual.id}.`,
          createdById: context.actor.userId,
          payrollStatus: "FUTURE_PAYROLL_REQUIRED",
        }],
        skipDuplicates: true,
      });
      inserted += created.count;
    }
    await audit(transaction, context, "COMMISSION_VOID_RECOVERY_SCAN", "CommissionAdjustment", null, {
      candidateAccrualCount: accruals.length,
      insertedAdjustmentCount: inserted,
    });
    return { candidateAccrualCount: accruals.length, insertedAdjustmentCount: inserted };
  }, { isolationLevel: "Serializable" });
}

export async function linkApprovedCommissionToPayroll(
  context: CommissionWriteContext,
  command: { statementId: string; targetPayrollMonth: unknown },
  database: PrismaClient = prisma,
) {
  assertCapability(context, "LINK_COMMISSION_TO_PAYROLL");
  const payrollPeriodStart = parseMonth(command.targetPayrollMonth);
  return database.$transaction(async (transaction) => {
    const statement = await transaction.commissionStatement.findFirst({
      where: {
        id: command.statementId,
        businessId: context.businessId,
        ...(context.branchId ? { period: { branchId: context.branchId } } : {}),
      },
      include: { period: true, payrollVariablePay: true },
    });
    if (!statement) throw new Error("The commission statement was not found in this business.");
    if (statement.payrollVariablePay && statement.status === "APPLIED_TO_PAYROLL") {
      return statement.payrollVariablePay;
    }
    if (statement.status !== "APPROVED" || statement.period.status !== "LOCKED") {
      throw new Error("Only an approved statement from a locked commission period can enter payroll.");
    }
    const payrollRun = await transaction.payrollRun.findFirst({
      where: { businessId: context.businessId, periodStart: payrollPeriodStart },
      select: { status: true },
    });
    if (payrollRun && payrollRun.status !== "DRAFT") {
      throw new Error("The target payroll month is already under review or finalized.");
    }
    if (!statement.period.calculatedById || !statement.approvedById || !statement.approvedAt) {
      throw new Error("The frozen commission statement is missing calculator or approver provenance.");
    }
    const sourceReference = `COMMISSION_STATEMENT:${statement.id}:${statement.calculationRevision}`;
    const variablePay = await transaction.payrollVariablePay.create({
      data: {
        businessId: context.businessId,
        membershipId: statement.membershipId,
        type: "COMMISSION",
        code: "COMMISSION",
        name: "Approved commission",
        amount: centsToMoney(statement.finalCommissionCents),
        earnedPeriodStart: statement.period.earnedPeriodStart,
        earnedPeriodEnd: statement.period.earnedPeriodEnd,
        payrollPeriodStart,
        origin: "SYSTEM",
        sourceReference,
        reason: `Frozen commission statement ${statement.calculationDigest}.`,
        status: "APPROVED",
        createdById: statement.period.calculatedById,
        approvedById: statement.approvedById,
        approvedAt: statement.approvedAt,
      },
    });
    await transaction.commissionStatement.update({ where: { id: statement.id }, data: { status: "APPLIED_TO_PAYROLL", payrollVariablePayId: variablePay.id } });
    await audit(transaction, context, "COMMISSION_LINKED_TO_PAYROLL", "CommissionStatement", statement.id, {
      payrollVariablePayId: variablePay.id,
      targetPayrollMonth: dateKey(payrollPeriodStart).slice(0, 7),
      calculationDigest: statement.calculationDigest,
    });
    return variablePay;
  }, { isolationLevel: "Serializable" });
}

function parseRuleCommand(command: RuleCommand) {
  const name = requiredText(command.name, "Rule name", 2, 120);
  const reason = requiredText(command.reason, "Change reason", 5, 500);
  const effectiveFrom = parseDate(command.effectiveFrom, "Effective from");
  const effectiveUntil = optionalDate(command.effectiveUntil, "Effective until");
  if (effectiveUntil && effectiveUntil < effectiveFrom) throw new Error("Effective until cannot be before effective from.");
  const priority = optionalInteger(command.priority, 0);
  const scopeId = command.scope === "ALL" ? null : requiredUuid(command.scopeId, "Rule scope item");
  const itemId = command.itemId === undefined || command.itemId === null || command.itemId === ""
    ? null
    : requiredUuid(command.itemId, "Commission item");
  const rateBasisPoints = command.ruleType === "PERCENTAGE" ? boundedInteger(command.rateBasisPoints, "Rate basis points", 0, 10_000) : null;
  const fixedAmountCents = command.ruleType === "FIXED_AMOUNT" ? boundedInteger(command.fixedAmountCents, "Fixed amount cents", 0, 100_000_000) : null;
  const tiers = command.ruleType === "TIERED_PERCENTAGE" ? parseCommissionTiers(command.tiers) : [];
  if (itemId && command.scope !== "MEMBER") {
    throw new Error("An employee-specific item can only be used with an employee rule.");
  }
  return { ...command, name, reason, effectiveFrom, effectiveUntil, priority, scopeId, itemId, rateBasisPoints, fixedAmountCents, tiers };
}

function scopedBranch(context: CommissionWriteContext, requested: string | null | undefined) {
  if (!context.branchId) return requested ?? null;
  if (requested && requested !== context.branchId) {
    throw new Error("Commission action is outside the authorized branch scope.");
  }
  return context.branchId;
}

function revisionValues(context: CommissionWriteContext, input: ReturnType<typeof parseRuleCommand>, revision: number) {
  return {
    revision,
    branchId: input.branchId ?? null,
    scope: input.scope,
    scopeId: input.scopeId,
    itemId: input.itemId,
    ruleType: input.ruleType,
    basis: input.basis,
    rateBasisPoints: input.rateBasisPoints,
    fixedAmountCents: input.fixedAmountCents,
    tierMode: input.ruleType === "TIERED_PERCENTAGE" ? "WHOLE_PERIOD_RATE" : null,
    tiers: input.tiers as Prisma.InputJsonValue,
    priority: input.priority,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    reason: input.reason,
    createdById: context.actor.userId,
  };
}

async function validateRuleScope(transaction: Prisma.TransactionClient, businessId: string, input: ReturnType<typeof parseRuleCommand>) {
  if (input.branchId) await requireBranch(transaction, businessId, input.branchId);
  if (input.scope === "ITEM") {
    const count = await countSourceItem(transaction, businessId, input.sourceType, input.scopeId!);
    if (count !== 1) throw new Error("The scoped item was not found in this business.");
  }
  if (input.scope === "CATEGORY") {
    const count = input.sourceType === "PRODUCT"
      ? await transaction.productCategory.count({ where: { id: input.scopeId!, businessId } })
      : await transaction.serviceCategory.count({ where: { id: input.scopeId!, businessId } });
    if (count !== 1) throw new Error("The scoped category was not found in this business.");
  }
  if (input.scope === "MEMBER") {
    const count = await transaction.employeeBusinessMembership.count({
      where: { id: input.scopeId!, businessId },
    });
    if (count !== 1) throw new Error("The employee was not found in this business.");
    if (input.itemId) {
      const itemCount = await countSourceItem(transaction, businessId, input.sourceType, input.itemId);
      if (itemCount !== 1) throw new Error("The employee commission item was not found in this business.");
    }
  }
}

async function validateNoParallelRuleOverlap(
  transaction: Prisma.TransactionClient,
  businessId: string,
  input: ReturnType<typeof parseRuleCommand>,
  currentRuleId?: string,
) {
  const overlapping = await transaction.commissionRuleRevision.findFirst({
    where: {
      businessId,
      branchId: input.branchId ?? null,
      scope: input.scope,
      scopeId: input.scopeId,
      itemId: input.itemId,
      effectiveFrom: input.effectiveUntil ? { lte: input.effectiveUntil } : undefined,
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: input.effectiveFrom } }],
      rule: {
        status: "ACTIVE",
        sourceType: input.sourceType,
        ...(currentRuleId ? { id: { not: currentRuleId } } : {}),
      },
    },
    select: { effectiveFrom: true, effectiveUntil: true },
  });
  if (overlapping) {
    const through = overlapping.effectiveUntil ? dateKey(overlapping.effectiveUntil) : "ongoing";
    throw new Error(
      `A commission rate already covers this same employee or item from ${dateKey(overlapping.effectiveFrom)} to ${through}. Change the existing rate instead.`,
    );
  }
}

function countSourceItem(
  transaction: Prisma.TransactionClient,
  businessId: string,
  sourceType: CommissionSourceType,
  itemId: string,
) {
  if (sourceType === "PRODUCT") {
    return transaction.product.count({ where: { id: itemId, businessId } });
  }
  if (sourceType === "PACKAGE_PURCHASE") {
    return transaction.package.count({ where: { id: itemId, businessId } });
  }
  return transaction.service.count({ where: { id: itemId, businessId } });
}

function classifySource(invoiceCustomerPackageId: string | null, item: { serviceId: string | null; productId: string | null; customerPackageId: string | null }): CommissionSourceType {
  if (item.productId) return "PRODUCT";
  if (item.customerPackageId && item.customerPackageId === invoiceCustomerPackageId) return "PACKAGE_PURCHASE";
  if (item.customerPackageId) return "PACKAGE_REDEMPTION";
  return "SERVICE";
}

function sourceShape(row: { id: string; membershipId: string | null; sourceType: CommissionSourceType; branchId: string | null; sourceItemId: string | null; sourceCategoryId: string | null; eventAt: Date; quantity: number; grossAmountCents: number; discountAmountCents: number; netAmountCents: number; grossBasisOverride: boolean }): CommissionSource {
  return { ...row };
}

function ruleSnapshot(rule: CommissionRuleCandidate) {
  return {
    id: rule.id,
    ruleId: rule.ruleId,
    revision: rule.revision,
    sourceType: rule.sourceType,
    branchId: rule.branchId,
    scope: rule.scope,
    scopeId: rule.scopeId,
    itemId: rule.itemId,
    ruleType: rule.ruleType,
    basis: rule.basis,
    rateBasisPoints: rule.rateBasisPoints,
    fixedAmountCents: rule.fixedAmountCents,
    tiers: rule.tiers,
    priority: rule.priority,
    effectiveFrom: dateKey(rule.effectiveFrom),
    effectiveUntil: rule.effectiveUntil ? dateKey(rule.effectiveUntil) : null,
  };
}

async function approvedFutureAdjustments(transaction: Prisma.TransactionClient, businessId: string, membershipId: string, earnedPeriodEnd: Date) {
  const adjustments = await transaction.commissionAdjustment.findMany({
    where: { businessId, membershipId, payrollStatus: "FUTURE_PAYROLL_REQUIRED", createdAt: { lte: nextUtcDay(earnedPeriodEnd) } },
    select: { commissionAmountCents: true },
  });
  return adjustments.reduce((sum, adjustment) => sum + adjustment.commissionAmountCents, 0);
}

async function requireBranch(transaction: Prisma.TransactionClient, businessId: string, branchId: string) {
  const branch = await transaction.branch.findFirst({ where: { id: branchId, businessId }, select: { id: true } });
  if (!branch) throw new Error("The branch was not found in this business.");
}

async function audit(transaction: Prisma.TransactionClient, context: CommissionWriteContext, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown>) {
  await writeSensitiveAuditLog({ businessId: context.businessId, actor: context.actor, request: context.request, action, entityType, entityId, summary: "Commission lifecycle updated.", metadata: metadata as never }, transaction);
}

function assertCapability(context: CommissionWriteContext, capability: BusinessCapability) {
  if (!context.capabilities.includes(capability)) throw new Error(`Commission action requires ${capability}.`);
}

function assertAnyCapability(context: CommissionWriteContext, capabilities: readonly BusinessCapability[]) {
  if (!capabilities.some((capability) => context.capabilities.includes(capability))) throw new Error("Commission recovery scan is not authorized.");
}

function requiredText(value: unknown, label: string, minimum: number, maximum: number) {
  const text = String(value ?? "").trim();
  if (text.length < minimum || text.length > maximum) throw new Error(`${label} must be ${minimum} to ${maximum} characters.`);
  return text;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${label} is outside the supported range.`);
  return number;
}

function optionalInteger(value: unknown, fallback: number) {
  return value === undefined || value === null || value === "" ? fallback : boundedInteger(value, "Priority", -1_000_000, 1_000_000);
}

function requiredUuid(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function parseDate(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = utcDate(text);
  if (dateKey(date) !== text) throw new Error(`${label} is invalid.`);
  return date;
}

function optionalDate(value: unknown, label: string) {
  return value === undefined || value === null || value === "" ? null : parseDate(value, label);
}

function parseMonth(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new Error("Target payroll month must use YYYY-MM.");
  return utcDate(`${text}-01`);
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextUtcDay(value: Date) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
