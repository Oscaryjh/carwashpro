import { Prisma } from "@prisma/client";
import { deriveAndPersistEntryAggregates } from "./component-service";

export async function recordPcbAdjustmentRemoval(tx: Prisma.TransactionClient, businessId: string, entryIds: string[], actorId: string) {
  const lines = await tx.payrollEntryComponent.findMany({ where: { businessId, payrollEntryId: { in: entryIds }, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } });
  for (const line of lines) await tx.payrollPcbSettlementEvent.create({ data: { businessId, correctionId: line.sourceId!,
    state: "UNSETTLED", payrollEntryId: line.payrollEntryId, componentId: line.id, actorId } });
}

async function availableNet(tx: Prisma.TransactionClient, businessId: string, entryId: string) {
  const entry = await tx.payrollEntry.findFirstOrThrow({ where: { id: entryId, businessId }, include: {
    components: { where: { code: "PRIOR_PERIOD_PCB_ADJUSTMENT", type: "EARNING" } },
    claimReimbursementSnapshots: { where: { status: { in: ["READY", "SETTLED"] } } },
  } });
  return entry.grossPay.sub(entry.otherDeductions).sub(entry.epfEmployee).sub(entry.socsoEmployee).sub(entry.eisEmployee)
    .sub(entry.lindung24Employee).sub(entry.pcb).sub(entry.cp38)
    .add(entry.components.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)))
    .add(entry.claimReimbursementSnapshots.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)));
}

export async function validPcbSettlementComponents(tx: Prisma.TransactionClient, businessId: string, correctionIds: string[]) {
  const lines = await tx.payrollEntryComponent.findMany({ where: { businessId, code: "PRIOR_PERIOD_PCB_ADJUSTMENT", sourceId: { in: correctionIds } } });
  const validEntries = new Set<string>();
  for (const entryId of new Set(lines.map((line) => line.payrollEntryId))) {
    if (!(await availableNet(tx, businessId, entryId)).isNegative()) validEntries.add(entryId);
  }
  return lines.filter((line) => validEntries.has(line.payrollEntryId));
}

export async function hasInsufficientPcbAdjustment(tx: Prisma.TransactionClient, businessId: string, entryId: string) {
  if (!await tx.payrollEntryComponent.count({ where: { businessId, payrollEntryId: entryId, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" } })) return false;
  return (await availableNet(tx, businessId, entryId)).isNegative();
}

export async function pendingPcbCorrections(tx: Prisma.TransactionClient, businessId: string, membershipId: string, periodStart: Date) {
  // No historical publication means no correction can exist. This also keeps
  // first-payroll preparation independent of historical publication storage.
  if (!await tx.payrollPayslipPublication.count({ where: { businessId, membershipId, payrollRun: { periodStart: { lt: periodStart } } } })) return [];
  const versions = await tx.payrollPcbPublicationVersion.findMany({ where: { businessId, membershipId, version: { gt: 1 },
    payrollMonth: { lt: periodStart.toISOString().slice(0, 7) }, delta: { not: 0 } }, orderBy: [{ payrollMonth: "asc" }, { version: "asc" }] });
  const applied = await validPcbSettlementComponents(tx, businessId, versions.map((v) => v.id));
  const appliedIds = new Set(applied.map((c) => c.sourceId));
  return versions.filter((v) => !appliedIds.has(v.id));
}

// Called only inside an authorized draft mutation. Review/finalized runs are
// never silently changed; REVIEW is blocked until explicitly returned to draft.
export async function applyPendingPcbCorrections(tx: Prisma.TransactionClient, businessId: string, entryId: string, actorId: string) {
  const entry = await tx.payrollEntry.findFirstOrThrow({ where: { id: entryId, businessId }, include: { payrollRun: true, membership: { select: { status: true } } } });
  if (entry.payrollRun.status !== "DRAFT" || entry.membership.status !== "ACTIVE") return 0;
  const pending = await pendingPcbCorrections(tx, businessId, entry.membershipId, entry.payrollRun.periodStart);
  const eligible = [];
  let count = 0;
  for (const correction of pending) {
    const earliest = await tx.payrollEntry.findFirst({ where: { businessId, membershipId: entry.membershipId,
      payrollRun: { status: { in: ["DRAFT", "REVIEW"] }, periodStart: { gt: new Date(`${correction.payrollMonth}-01T00:00:00Z`) } } }, orderBy: { payrollRun: { periodStart: "asc" } }, select: { id: true } });
    if (earliest?.id !== entry.id) continue;
    eligible.push(correction);
  }
  // Apply the entire outstanding version-chain delta or none of it. Applying
  // only an intermediate refund would pay back a debit that was never taken.
  const live = await tx.payrollEntryComponent.findMany({ where: { businessId, payrollEntryId: entry.id, code: "PRIOR_PERIOD_PCB_ADJUSTMENT" }, select: { sourceId: true } });
  const missing = eligible.filter((correction) => !live.some((line) => line.sourceId === correction.id));
  const netDelta = missing.reduce((sum, row) => sum.add(row.delta), new Prisma.Decimal(0));
  if ((await availableNet(tx, businessId, entry.id)).sub(netDelta).isNegative()) {
    for (const correction of eligible) await tx.payrollPcbSettlementEvent.create({ data: { businessId, correctionId: correction.id, state: "UNSETTLED", actorId } });
    return 0;
  }
  for (const correction of missing) {
    const component = await tx.payrollEntryComponent.create({ data: { businessId, membershipId: entry.membershipId, payrollRunId: entry.payrollRunId, payrollEntryId: entry.id,
      lineKey: `PRIOR_PCB:${correction.id.toUpperCase()}`, code: "PRIOR_PERIOD_PCB_ADJUSTMENT", name: "Prior-period PCB adjustment", type: correction.delta.isPositive() ? "DEDUCTION" : "EARNING",
      amount: correction.delta.abs(), sourceType: "PRIOR_PERIOD_PCB", sourceId: correction.id, sourceVersionId: correction.id, sourceRevision: correction.version,
      origin: "SYSTEM", calculationBasis: "PRIOR_PERIOD_PCB", sourceReason: correction.reason, sortOrder: 9500, createdById: actorId } });
    await tx.payrollPcbSettlementEvent.create({ data: { businessId, correctionId: correction.id, state: "APPLIED_TO_PAYROLL_NOT_PAYMENT", payrollEntryId: entry.id, componentId: component.id, actorId } });
    count++;
  }
  if (count) await deriveAndPersistEntryAggregates(tx, entry, entry.calculationRevision);
  return count;
}
