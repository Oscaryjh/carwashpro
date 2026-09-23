import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cents, integer } from "./money";
import { assertPerformanceActor, type PerformanceActor } from "./scope";
import { localPerformanceDate, performancePeriod, performanceTimezone } from "./time";

export type PerformanceReadInput = { year: number; month?: number; asOf: Date };
type Totals = { salesReceived: number; tipsReceived: number; salesRefunds: number; tipsRefunds: number; refunds: number; total: number };
const blank = (): Totals => ({ salesReceived: 0, tipsReceived: 0, salesRefunds: 0, tipsRefunds: 0, refunds: 0, total: 0 });
function add(totals: Totals, sale: number, tip: number, refund: boolean) {
  if (refund) { totals.salesRefunds -= sale; totals.tipsRefunds -= tip; totals.refunds -= sale + tip; }
  else { totals.salesReceived += sale; totals.tipsReceived += tip; }
  totals.total = integer(totals.total + sale + tip);
}

/** Protected backend read contract; Staff self-service routes must add their own membership auth adapter. */
export async function readPerformanceLedger(context: PerformanceActor, input: PerformanceReadInput, database: PrismaClient = prisma) {
  if (!(input.asOf instanceof Date) || !Number.isFinite(input.asOf.getTime())) throw new Error("An explicit valid performance asOf is required.");
  // A statistical event-time cutoff, not a reconstruction of what was known at that past instant.
  // Current source statuses and attribution revisions are read in ONE read-only MVCC snapshot.
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return readSnapshot(context, input, tx);
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

/** Internal composition only: caller owns a RepeatableRead/Serializable transaction; never a public API. */
export async function readSnapshot(context: PerformanceActor, input: PerformanceReadInput, database: Prisma.TransactionClient) {
  const actor = await assertPerformanceActor(database, context);
  if (actor.role !== "BUSINESS_OWNER" && !actor.permissions.some((p) => ["PERFORMANCE_VIEW_TEAM", "PERFORMANCE_MANAGE_TARGETS"].includes(p))) throw new Error("Performance team read permission denied.");
  return readScopedPerformanceSnapshot(context, input, database);
}

/** Server-internal aggregation. Call only AFTER backend/Staff scope authorization, in its same MVCC transaction.
 * Never expose this raw projection as an API response. Staff must project its own minimal DTO.
 */
export async function readScopedPerformanceSnapshot(context: Pick<PerformanceActor, "businessId" | "branchId">, input: PerformanceReadInput, database: Prisma.TransactionClient) {
  const branch = await database.branch.findFirstOrThrow({ where: { id: context.branchId, businessId: context.businessId }, include: { business: { select: { timezone: true } } } });
  const timezone = performanceTimezone(branch.business.timezone);
  const period = performancePeriod(input.year, timezone, input.month);
  const dateStart = `${input.year}-${String(input.month ?? 1).padStart(2, "0")}-01`;
  const dateEnd = input.month && input.month < 12 ? `${input.year}-${String(input.month + 1).padStart(2, "0")}-01` : `${input.year + 1}-01-01`;
  const scope = { businessId: context.businessId, branchId: context.branchId };
  const timeRange = { gte: period.from, lt: period.toExclusive, lte: input.asOf };
  // Include both frozen and currently resolved periods; mismatches remain visible but quarantined.
  const events = await database.performanceReceipt.findMany({ where: { ...scope, occurredAt: { lte: input.asOf }, OR: [
    { localDate: { gte: dateStart, lt: dateEnd } }, { occurredAt: timeRange },
  ] },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: {
      id: true, businessId: true, branchId: true, paymentId: true, refundId: true, invoiceId: true,
      kind: true, quality: true, occurredAt: true, localDate: true, timezone: true, policyVersion: true,
      rawCents: true, salesCents: true, taxCents: true, tipCents: true, unresolvedCents: true,
      contributions: { select: { recipientKey: true, membershipId: true, component: true, amountCents: true } },
      refund: { select: { amount: true, refundedAt: true, branchId: true, businessId: true } },
      payment: { select: { amount: true, paidAt: true, status: true, branchId: true, businessId: true,
        performanceIssues: { select: { code: true } }, invoice: { select: { status: true } } } },
    } });
  const team = blank(), unassigned = blank(), pending = blank();
  const employees: Record<string, Totals> = {};
  let rawNet = 0, taxNet = 0, pendingRaw = 0, excludedPackageNet = 0;
  const details = events.map((event) => {
    const noncash = ["PACKAGE", "RESTORE"].includes(event.kind);
    const issues = event.payment.performanceIssues.map((issue) => issue.code);
    let snapshotTimezone: string | null = null;
    try { snapshotTimezone = performanceTimezone(event.timezone); } catch { /* Invalid immutable evidence is quarantined. */ }
    if (snapshotTimezone !== timezone) issues.push("OPERATING_TIMEZONE_SNAPSHOT_MISMATCH");
    if (snapshotTimezone && localPerformanceDate(event.occurredAt, snapshotTimezone) !== event.localDate) issues.push("LOCAL_DATE_SNAPSHOT_INVALID");
    const source = event.refund ?? event.payment;
    const sourceAt = event.refund?.refundedAt ?? event.payment.paidAt;
    if (Number(event.rawCents) !== cents(source.amount) * (event.refund ? -1 : 1)
      || event.occurredAt.getTime() !== sourceAt.getTime()
      || source.branchId !== event.branchId || source.businessId !== event.businessId) issues.push("SOURCE_SNAPSHOT_CHANGED");
    if (event.payment.status === "VOID" || event.payment.invoice?.status === "VOID") issues.push("VOID_SOURCE_REQUIRES_REVIEW");
    if (event.quality !== "VERIFIED" && !noncash) issues.push(event.quality);
    const verified = !noncash && !issues.length;
    const sale = integer(Number(event.salesCents)), tip = integer(Number(event.tipCents)), raw = integer(Number(event.rawCents));
    const allocations: Record<string, Totals & { membershipId: string | null }> = {};
    for (const entry of event.contributions) {
      const recipient = allocations[entry.recipientKey] ??= { ...blank(), membershipId: entry.membershipId };
      add(recipient, entry.component === "SALE" ? Number(entry.amountCents) : 0, entry.component === "TIP" ? Number(entry.amountCents) : 0, event.kind === "REFUND");
    }
    if (noncash) excludedPackageNet = integer(excludedPackageNet + raw);
    else {
      rawNet = integer(rawNet + raw);
      if (!verified) { pendingRaw = integer(pendingRaw + raw); add(pending, sale, tip, event.kind === "REFUND"); }
      else {
        taxNet = integer(taxNet + Number(event.taxCents));
        add(team, sale, tip, event.kind === "REFUND");
        for (const entry of event.contributions) {
          const recipient = entry.membershipId ? employees[entry.membershipId] ??= blank() : unassigned;
          add(recipient, entry.component === "SALE" ? Number(entry.amountCents) : 0, entry.component === "TIP" ? Number(entry.amountCents) : 0, event.kind === "REFUND");
        }
      }
    }
    return { id: event.id, paymentId: event.paymentId, refundId: event.refundId, invoiceId: event.invoiceId, kind: event.kind, occurredAt: event.occurredAt.toISOString(), localDate: event.localDate, timezone: event.timezone,
      rawCents: raw, salesCents: sale, taxCents: Number(event.taxCents), tipCents: tip, unresolvedCents: Number(event.unresolvedCents), totalCents: noncash ? 0 : sale + tip,
      verified, issues: [...new Set(issues)], policyVersion: event.policyVersion,
      compositionStatus: event.unresolvedCents === 0n ? "CAPTURED_COMPONENTS" : "UNKNOWN",
      qualifiedCents: noncash ? 0 : verified ? sale + tip : null,
      allocations: Object.values(allocations) };
  });
  if (team.total !== unassigned.total + Object.values(employees).reduce((total, employee) => total + employee.total, 0)) throw new Error("Performance team reconciliation failed.");
  if (rawNet !== team.total + taxNet + pendingRaw) throw new Error("Performance cash/component reconciliation failed.");
  // Inspect source tables regardless of the capture feature flag. No guessed coverage start/backfill.
  const payments = await database.payment.findMany({ where: { ...scope, paidAt: timeRange },
    select: { id: true, amount: true, paidAt: true, method: true, status: true, invoice: { select: { status: true } },
      performanceReceipts: { where: { refundId: null }, select: { id: true } } } });
  const refunds = await database.paymentRefund.findMany({ where: { ...scope, refundedAt: timeRange },
    select: { id: true, paymentId: true, amount: true, refundedAt: true, method: true, performanceReceipt: { select: { id: true } },
      payment: { select: { performanceReceipts: { where: { refundId: null }, select: { id: true } } } } } });
  const eventIds = new Set(events.map((event) => event.id));
  const detailsById = new Map(details.map((event) => [event.id, event]));
  const sourceDetails = [
    ...payments.map((row) => ({ sourceKey: `PAYMENT:${row.id}`, paymentId: row.id, refundId: null as string | null,
      occurredAt: row.paidAt.toISOString(), rawCents: cents(row.amount), method: row.method,
      receiptId: row.performanceReceipts[0]?.id ?? null, originalCaptured: true,
      voided: row.status === "VOID" || row.invoice?.status === "VOID" })),
    ...refunds.map((row) => ({ sourceKey: `REFUND:${row.id}`, paymentId: row.paymentId, refundId: row.id,
      occurredAt: row.refundedAt.toISOString(), rawCents: -cents(row.amount), method: row.method,
      receiptId: row.performanceReceipt?.id ?? null, originalCaptured: row.payment.performanceReceipts.length > 0, voided: false })),
  ].map((source) => {
    const excluded = source.method === "PACKAGE";
    const captured = !!source.receiptId && eventIds.has(source.receiptId);
    const detail = source.receiptId ? detailsById.get(source.receiptId) : undefined;
    const hasUnassigned = detail?.allocations.some((entry) => entry.membershipId === null && (entry.salesReceived || entry.tipsReceived || entry.refunds));
    const classification = excluded ? "EXCLUDED_NONCASH" : !captured ? "UNCAPTURED" : detail?.verified
      ? hasUnassigned ? "CAPTURED_VERIFIED_UNASSIGNED" : "CAPTURED_VERIFIED" : "CAPTURED_PENDING";
    return { ...source, classification, compositionStatus: detail && !detail.unresolvedCents ? "CAPTURED_COMPONENTS" : "UNKNOWN",
      salesCents: detail && !detail.unresolvedCents ? detail.salesCents : null,
      taxCents: detail && !detail.unresolvedCents ? detail.taxCents : null, tipCents: detail && !detail.unresolvedCents ? detail.tipCents : null,
      qualifiedCents: excluded ? 0 : detail?.verified ? detail.totalCents : null,
      issues: [...(detail?.issues ?? []), ...(!source.originalCaptured && !excluded ? ["ORIGINAL_PAYMENT_UNCAPTURED"] : []),
        ...(source.voided ? ["VOID_SOURCE_REQUIRES_REVIEW"] : []), ...(source.receiptId && !captured ? ["CAPTURE_SCOPE_OR_DATE_MISMATCH"] : [])] };
  });
  const uncapturedCount = sourceDetails.filter((source) => source.classification === "UNCAPTURED").length;
  const pendingCount = details.filter((event) => !event.verified && !["PACKAGE", "RESTORE"].includes(event.kind)).length;
  const basisGapCount = sourceDetails.filter((source) => source.method !== "PACKAGE" && !source.originalCaptured).length;
  const coverageStatus = uncapturedCount || pendingCount || basisGapCount ? "INCOMPLETE" : "COMPLETE";
  return { businessId: context.businessId, branchId: context.branchId, period, periodStart: period.from.toISOString(), periodEnd: period.toExclusive.toISOString(),
    asOf: input.asOf.toISOString(), cutoffSemantics: "EVENT_TIME_INCLUSIVE_CURRENT_SNAPSHOT", timezoneSource: "BUSINESS_INHERITED",
    periodClosed: input.asOf >= period.toExclusive,
    coverageStatus, uncapturedCount, pendingCount, basisGapCount, sourceCount: sourceDetails.length,
    verifiedCount: details.filter((event) => event.verified).length,
    excludedCount: sourceDetails.filter((source) => source.classification === "EXCLUDED_NONCASH").length,
    unassignedAmount: unassigned.total, totalsAreComplete: coverageStatus === "COMPLETE", sourceDetails,
    team, employees, unassigned, pending, rawNetCents: rawNet, taxNetCents: taxNet, pendingRawCents: pendingRaw, excludedPackageNetCents: excludedPackageNet,
    target: null, targetState: "NOT_IMPLEMENTED", details };
}
