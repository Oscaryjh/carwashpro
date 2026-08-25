import { randomUUID } from "node:crypto";
import type {
  PayrollAdjustmentCategory,
  PayrollEntryComponentType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import type { AuditJsonValue } from "@/lib/audit/sanitize";
import { writeSensitiveAuditLog } from "@/lib/audit/payroll-sensitive";
import {
  calculatePayrollComponentAggregates,
  PAYROLL_COMPONENT_RECONCILIATION_FAILED,
  normalizeManualAdjustmentText,
  parsePayrollComponentAmount,
  reconcilePayrollEntryComponents,
  type PayrollComponentLine,
} from "@/lib/payroll/component-calculation";
import { prisma } from "@/lib/prisma";

type PayrollActor = Pick<AppSession, "userId" | "name" | "email">;
type ComponentContext = {
  businessId: string;
  actor: PayrollActor;
  request?: AuditRequestContext;
};

export async function addManualPayrollAdjustment(
  context: ComponentContext & {
    entryId: string;
    expectedRevision: number;
    type: PayrollEntryComponentType;
    category?: PayrollAdjustmentCategory;
    name: unknown;
    amount: unknown;
    reason: unknown;
  },
  database: PrismaClient = prisma,
) {
  const text = normalizeManualAdjustmentText(context);
  const amountCents = parsePayrollComponentAmount(context.amount);
  return database.$transaction(async (transaction) => {
    const entry = await loadEditableEntry(
      transaction,
      context.businessId,
      context.entryId,
      context.expectedRevision,
    );
    const id = randomUUID();
    const created = await transaction.payrollEntryComponent.create({
      data: {
        id,
        businessId: context.businessId,
        payrollRunId: entry.payrollRunId,
        payrollEntryId: entry.id,
        membershipId: entry.membershipId,
        lineKey: `MANUAL:${id.toUpperCase()}`,
        type: context.type,
        code: "MANUAL_ADJUSTMENT",
        name: text.name,
        amount: centsToMoney(amountCents),
        currency: "MYR",
        sourceType: "MANUAL_ADJUSTMENT",
        calculationBasis: "MANUAL_FIXED_AMOUNT",
        origin: "MANUAL",
        adjustmentCategory: context.category ?? "OTHER",
        reason: text.reason,
        sortOrder: 9000,
        createdById: context.actor.userId,
      },
    });
    await deriveAndPersistEntryAggregates(
      transaction,
      entry,
      context.expectedRevision,
    );
    await writeComponentAudit(
      transaction,
      context,
      "PAYROLL_COMPONENT_MANUAL_ADDED",
      created.id,
      entry.fullNameSnapshot,
      context.type,
      { after: { description: text.name, reasonRecorded: true } },
    );
    return created;
  }, { isolationLevel: "Serializable" });
}

export async function editManualPayrollAdjustment(
  context: ComponentContext & {
    entryId: string;
    componentId: string;
    expectedRevision: number;
    name: unknown;
    amount: unknown;
    reason: unknown;
  },
  database: PrismaClient = prisma,
) {
  const text = normalizeManualAdjustmentText(context);
  const amountCents = parsePayrollComponentAmount(context.amount);
  return database.$transaction(async (transaction) => {
    const entry = await loadEditableEntry(
      transaction,
      context.businessId,
      context.entryId,
      context.expectedRevision,
    );
    const before = await transaction.payrollEntryComponent.findFirst({
      where: {
        id: context.componentId,
        businessId: context.businessId,
        payrollEntryId: entry.id,
        origin: "MANUAL",
      },
    });
    if (!before) throw new Error("The manual payroll adjustment was not found.");
    const updated = await transaction.payrollEntryComponent.update({
      where: { id: before.id },
      data: {
        name: text.name,
        amount: centsToMoney(amountCents),
        reason: text.reason,
      },
    });
    await deriveAndPersistEntryAggregates(
      transaction,
      entry,
      context.expectedRevision,
    );
    await writeComponentAudit(
      transaction,
      context,
      "PAYROLL_COMPONENT_MANUAL_EDITED",
      before.id,
      entry.fullNameSnapshot,
      before.type,
      {
        before: { description: before.name, amount: "[REDACTED]", reasonRecorded: Boolean(before.reason) },
        after: { description: text.name, amount: "[REDACTED]", reasonRecorded: true },
      },
    );
    return updated;
  }, { isolationLevel: "Serializable" });
}

export async function removeManualPayrollAdjustment(
  context: ComponentContext & {
    entryId: string;
    componentId: string;
    expectedRevision: number;
    reason: unknown;
  },
  database: PrismaClient = prisma,
) {
  const removalReason = String(context.reason ?? "").trim();
  if (removalReason.length < 5 || removalReason.length > 500) {
    throw new Error("Removal reason must be 5 to 500 characters.");
  }
  return database.$transaction(async (transaction) => {
    const entry = await loadEditableEntry(
      transaction,
      context.businessId,
      context.entryId,
      context.expectedRevision,
    );
    const component = await transaction.payrollEntryComponent.findFirst({
      where: {
        id: context.componentId,
        businessId: context.businessId,
        payrollEntryId: entry.id,
        origin: "MANUAL",
      },
    });
    if (!component) throw new Error("The manual payroll adjustment was not found.");
    await transaction.payrollEntryComponent.delete({ where: { id: component.id } });
    await deriveAndPersistEntryAggregates(
      transaction,
      entry,
      context.expectedRevision,
    );
    await writeComponentAudit(
      transaction,
      context,
      "PAYROLL_COMPONENT_MANUAL_REMOVED",
      component.id,
      entry.fullNameSnapshot,
      component.type,
      {
        before: { description: component.name, amount: "[REDACTED]", reasonRecorded: Boolean(component.reason) },
        after: { removed: true, removalReasonRecorded: true },
      },
    );
    return component;
  }, { isolationLevel: "Serializable" });
}

export async function assertPayrollRunComponentReconciliation(
  transaction: Prisma.TransactionClient,
  input: { businessId: string; runId: string },
) {
  const failures = await getPayrollRunComponentReconciliationFailures(
    transaction,
    input,
  );
  if (failures.length) {
    throw new Error(PAYROLL_COMPONENT_RECONCILIATION_FAILED);
  }
}

export async function getPayrollRunComponentReconciliationFailures(
  transaction: Prisma.TransactionClient | PrismaClient,
  input: { businessId: string; runId: string },
) {
  const entries = await transaction.payrollEntry.findMany({
    where: { businessId: input.businessId, payrollRunId: input.runId },
    include: {
      components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
      claimReimbursementSnapshots: { where: { status: { in: ["READY", "SETTLED"] } }, select: { amount: true } },
    },
  });
  const failures: string[] = [];
  for (const entry of entries) {
    try {
      const lines = entry.components.map(toDomainLine);
      reconcilePayrollEntryComponents(
        lines,
        statutoryFromEntry(entry),
        {
          grossPayCents: moneyToCents(entry.grossPay),
          nonStatutoryDeductionsCents: moneyToCents(entry.otherDeductions),
          allowancesCents: moneyToCents(entry.allowances),
          recurringAllowancesCents: moneyToCents(entry.recurringAllowancesSnapshot),
          recurringDeductionsCents: moneyToCents(entry.recurringDeductionsSnapshot),
          netPayCents: moneyToCents(entry.netPay),
        },
        entry.claimReimbursementSnapshots.reduce((sum, snapshot) => sum + moneyToCents(snapshot.amount), 0),
      );
    } catch {
      failures.push(entry.id);
    }
  }
  return failures;
}

export async function deriveAndPersistEntryAggregates(
  transaction: Prisma.TransactionClient,
  entry: EntryAmounts,
  expectedRevision: number,
) {
  const components = await transaction.payrollEntryComponent.findMany({
    where: { businessId: entry.businessId, payrollEntryId: entry.id },
    orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }],
  });
  const reimbursements = await transaction.payrollClaimReimbursementSnapshot.findMany({
    where: { businessId: entry.businessId, payrollEntryId: entry.id, status: { in: ["READY", "SETTLED"] } },
    select: { amount: true },
  });
  const totals = calculatePayrollComponentAggregates(
    components.map(toDomainLine),
    statutoryFromEntry(entry),
    reimbursements.reduce((sum, item) => sum + moneyToCents(item.amount), 0),
  );
  const result = await transaction.payrollEntry.updateMany({
    where: {
      id: entry.id,
      businessId: entry.businessId,
      calculationRevision: expectedRevision,
      payrollRun: { status: "DRAFT" },
    },
    data: {
      allowances: centsToMoney(totals.allowancesCents),
      otherDeductions: centsToMoney(totals.nonStatutoryDeductionsCents),
      recurringAllowancesSnapshot: centsToMoney(totals.recurringAllowancesCents),
      recurringDeductionsSnapshot: centsToMoney(totals.recurringDeductionsCents),
      grossPay: centsToMoney(totals.grossPayCents),
      netPay: centsToMoney(totals.netPayCents),
      calculationRevision: { increment: 1 },
    },
  });
  if (result.count !== 1) {
    throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
  }
  return totals;
}

type EntryAmounts = {
  id: string;
  businessId: string;
  payrollRunId: string;
  membershipId: string;
  fullNameSnapshot: string;
  calculationRevision: number;
  epfEmployee: { toString(): string };
  socsoEmployee: { toString(): string };
  eisEmployee: { toString(): string };
  lindung24Employee: { toString(): string };
  pcb: { toString(): string };
  cp38: { toString(): string };
};

async function loadEditableEntry(
  transaction: Prisma.TransactionClient,
  businessId: string,
  entryId: string,
  expectedRevision: number,
) {
  const entry = await transaction.payrollEntry.findFirst({
    where: { id: entryId, businessId, payrollRun: { status: "DRAFT" } },
  });
  if (!entry) throw new Error("The editable payroll entry was not found.");
  if (entry.calculationRevision !== expectedRevision) {
    throw new Error("Payroll entry changed after this page was loaded. Reload and try again.");
  }
  return entry;
}

function statutoryFromEntry(entry: EntryAmounts) {
  return {
    epfEmployeeCents: moneyToCents(entry.epfEmployee),
    socsoEmployeeCents: moneyToCents(entry.socsoEmployee),
    eisEmployeeCents: moneyToCents(entry.eisEmployee),
    lindung24EmployeeCents: moneyToCents(entry.lindung24Employee),
    pcbCents: moneyToCents(entry.pcb),
    cp38Cents: moneyToCents(entry.cp38),
  };
}

function toDomainLine(line: {
  lineKey: string;
  type: PayrollEntryComponentType;
  code: string;
  name: string;
  amount: { toString(): string };
  currency: string;
  sourceType: PayrollComponentLine["sourceType"];
  sourceId: string | null;
  sourceVersionId: string | null;
  sourceRevision: number | null;
  effectiveFromMonth: Date | null;
  calculationBasis: string;
  origin: PayrollComponentLine["origin"];
  reason: string | null;
  sortOrder: number;
}): PayrollComponentLine {
  return {
    ...line,
    amountCents: moneyToCents(line.amount),
    currency: "MYR",
  };
}

async function writeComponentAudit(
  transaction: Prisma.TransactionClient,
  context: ComponentContext,
  action: string,
  componentId: string,
  employeeName: string,
  type: PayrollEntryComponentType,
  change: { before?: AuditJsonValue; after?: AuditJsonValue },
) {
  await writeSensitiveAuditLog(
    {
      businessId: context.businessId,
      actor: context.actor,
      request: context.request,
      action,
      entityType: "PayrollEntryComponent",
      entityId: componentId,
      summary: `${type === "EARNING" ? "Earning" : "Deduction"} adjustment changed for ${employeeName}.`,
      before: change.before,
      after: change.after,
      metadata: { amount: "[REDACTED]", componentType: type },
    },
    transaction,
  );
}

function moneyToCents(value: { toString(): string }) {
  const [whole, fractional = ""] = value.toString().split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Payroll money snapshot is outside the supported range.");
  }
  return cents;
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}
