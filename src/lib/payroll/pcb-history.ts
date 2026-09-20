import type { Prisma } from "@prisma/client";

type HistoryDatabase = Pick<Prisma.TransactionClient, "payrollEntry" | "payrollManualPcbConfirmation" | "payrollPcbPublicationVersion">;

// Enumerate finalized entries, not CALCULATED-only snapshots: MANUAL months
// must never silently disappear from YTD or current confirmation bindings.
export async function authoritativePcbHistory(database: HistoryDatabase, businessId: string, membershipId: string, before: Date) {
  const entries = await database.payrollEntry.findMany({ where: { businessId, membershipId,
    payrollRun: { status: "FINALIZED", periodStart: { gte: new Date(Date.UTC(before.getUTCFullYear(), 0, 1)), lt: before } } },
    orderBy: { payrollRun: { periodStart: "asc" } }, include: { payrollRun: { select: { periodStart: true } }, statutorySnapshots: { where: { scheme: "PCB" } } } });
  return Promise.all(entries.map(async (entry) => {
    const version = await database.payrollPcbPublicationVersion.findFirst({ where: { businessId, membershipId, payrollEntryId: entry.id }, orderBy: { version: "desc" } });
    const manual = version ? null : await database.payrollManualPcbConfirmation.findFirst({ where: { businessId, membershipId, payrollEntryId: entry.id, inputRevision: entry.calculationRevision, invalidations: { none: {} } }, orderBy: { sourceVersion: "desc" } });
    const snapshot = entry.statutorySnapshots[0];
    const amount = version?.amount ?? manual?.amount ?? (snapshot?.status === "CALCULATED" ? snapshot.employeeContribution : null);
    return { entryId: entry.id, sourceId: version?.id ?? manual?.id ?? snapshot?.id ?? entry.id,
      sourceVersion: version?.version ?? manual?.sourceVersion ?? 1, month: entry.payrollRun.periodStart,
      amount, inputDigest: version?.inputDigest ?? manual?.inputDigest ?? snapshot?.sourceDigest ?? null,
      calculationMetadata: snapshot?.calculationMetadata ?? null };
  }));
}
