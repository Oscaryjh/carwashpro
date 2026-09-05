import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidateEmployeeSelfServiceScope, type EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { readScopedPerformanceSnapshot } from "@/lib/performance/read";
import { comparisonWindow, slicePerformance } from "@/lib/performance/dashboard";
import { integer } from "@/lib/performance/money";
import { localPerformanceDate, performancePeriod, performanceTimezone } from "@/lib/performance/time";
import { comparePerformance, progress, teamLevel, type TargetSnapshot } from "@/lib/performance/targets-contract";
import { staffPerformanceEnabled, staffPerformanceScopeKey, StaffPerformanceAccessError } from "./performance-access";

export const staffPerformanceQuery = z.object({
  view: z.enum(["card", "mine", "team", "member", "auto"]).default("auto"),
  year: z.coerce.number().int().min(2001).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  member: z.string().uuid().optional(),
  search: z.string().max(100).default(""),
}).strict();
const blank = () => ({ salesReceived: 0, tipsReceived: 0, salesRefunds: 0, tipsRefunds: 0, refunds: 0, total: 0 });
type Totals = ReturnType<typeof blank>;
const sum = (rows: Totals[]) => rows.reduce((a, b) => {
  for (const k of Object.keys(a) as (keyof Totals)[]) a[k] = integer(a[k] + b[k]);
  return a;
}, blank());

/** Staff-specific read-only adapter. No backend actor is synthesized and no raw ledger escapes this boundary. */
export async function readStaffPerformance(auth: EmployeeAuthContext, value: unknown, db: PrismaClient = prisma, asOf = new Date()) {
  if (!staffPerformanceEnabled()) throw new StaffPerformanceAccessError(404, "PERFORMANCE_DISABLED");
  const input = staffPerformanceQuery.parse(value);
  if (!Number.isFinite(asOf.getTime())) throw new StaffPerformanceAccessError(400, "INVALID_PERIOD");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // Revalidate at request time (not historical asOf), including revoked devices and workplace switches.
    const scope = await revalidateEmployeeSelfServiceScope(auth, tx);
    const business = await tx.business.findUniqueOrThrow({ where: { id: scope.businessId }, select: { timezone: true } });
    const timezone = performanceTimezone(business.timezone);
    const today = localPerformanceDate(asOf, timezone);
    const year = input.year ?? Number(today.slice(0, 4)), month = input.month ?? Number(today.slice(5, 7));
    const period = performancePeriod(year, timezone), window = comparisonWindow(year, month, timezone, asOf);
    const identity = await tx.employeeBusinessMembership.findFirstOrThrow({ where: { id: scope.membershipId, businessId: scope.businessId },
      select: { id: true, fullName: true, employeeCode: true, staffUser: { select: { businessId: true, branchId: true, role: true, status: true, loginEnabled: true, permissions: true } } } });
    const user = identity.staffUser;
    // Same direct-business branch boundary as Phase 2; approvals/title/target-manager/clock-in are irrelevant.
    const canViewTeam = !!user && user.businessId === scope.businessId && user.status === "active" && user.loginEnabled &&
      (user.role === "BUSINESS_OWNER" || (user.branchId === scope.branch.id &&
        user.permissions.some(p => ["PERFORMANCE_VIEW_TEAM", "PERFORMANCE_MANAGE_TARGETS"].includes(p))));
    if ((input.member || input.view === "member") && (!canViewTeam || !input.member || input.view !== "member")) {
      throw new StaffPerformanceAccessError(403, "PERFORMANCE_SCOPE_DENIED");
    }
    const mode = input.view === "auto" ? canViewTeam ? "team" : "mine" : input.view;
    // Discover only this identity's evidence, including transferred staff and historical targets.
    const contributionBranches = await tx.performanceReceipt.findMany({ where: { contributions: { some: { membershipId: scope.membershipId, businessId: scope.businessId } },
      businessId: scope.businessId, OR: [
        { occurredAt: { gte: period.from, lt: period.toExclusive, lte: asOf } },
        { localDate: { gte: `${year}-01-01`, lt: `${year + 1}-01-01` } },
      ] }, distinct: ["branchId"], select: { branchId: true } });
    const targetBranches = await tx.performanceTargetVersion.findMany({ where: { businessId: scope.businessId, year,
      snapshot: { path: ["people"], array_contains: [{ membershipId: scope.membershipId }] } }, distinct: ["branchId"], select: { branchId: true } });
    if (contributionBranches.some(b => !b.branchId)) throw new StaffPerformanceAccessError(409, "PERFORMANCE_SCOPE_INCOMPLETE");
    const personalBranchIds = [...new Set([
      ...scope.assignments.filter(a => a.businessId === scope.businessId && a.effectiveFrom < period.toExclusive &&
        (!a.effectiveUntil || a.effectiveUntil >= period.from)).map(a => a.branchId),
      ...contributionBranches.flatMap(a => a.branchId ? [a.branchId] : []), ...targetBranches.map(a => a.branchId),
    ])];
    const priorBranches = month === 1 ? await tx.performanceReceipt.findMany({ where: { businessId: scope.businessId,
      contributions: { some: { businessId: scope.businessId, membershipId: scope.membershipId } },
      occurredAt: { gte: window.previous.from, lt: window.previous.toExclusive, lte: asOf } }, distinct: ["branchId"], select: { branchId: true } }) : [];
    if (priorBranches.some(b => !b.branchId)) throw new StaffPerformanceAccessError(409, "PERFORMANCE_SCOPE_INCOMPLETE");
    const comparisonBranchIds = month === 1 ? [...new Set([...personalBranchIds, ...priorBranches.flatMap(b => b.branchId ? [b.branchId] : []),
      ...scope.assignments.filter(a => a.businessId === scope.businessId && a.effectiveFrom < window.previous.toExclusive &&
        (!a.effectiveUntil || a.effectiveUntil >= window.previous.from)).map(a => a.branchId)])] : personalBranchIds;
    const branchIds = [...new Set([...personalBranchIds, ...comparisonBranchIds, scope.branch.id])];
    const branches = await tx.branch.findMany({ where: { businessId: scope.businessId, id: { in: branchIds } }, select: { id: true, name: true } });
    if (branches.length !== branchIds.length) throw new StaffPerformanceAccessError(409, "PERFORMANCE_SCOPE_INCOMPLETE");
    const bundles = [];
    for (const branch of branches) {
      const context = { businessId: scope.businessId, branchId: branch.id };
      const ledger = await readScopedPerformanceSnapshot(context, { year, asOf }, tx);
      const previousLedger = month === 1 ? await readScopedPerformanceSnapshot(context, { year: year - 1, month: 12, asOf }, tx) : ledger;
      const target = await tx.performanceTargetVersion.findFirst({ where: { ...context, year }, orderBy: { revision: "desc" }, select: { snapshot: true, revision: true } });
      bundles.push({ branch, ledger, target: target?.snapshot as TargetSnapshot | undefined, revision: target?.revision ?? 0,
        annual: slicePerformance(ledger, period.from, period.toExclusive, asOf),
        current: slicePerformance(ledger, window.current.from, window.current.toExclusive, asOf),
        previous: slicePerformance(previousLedger, window.previous.from, window.previous.toExclusive, window.previousAsOf) });
    }
    type Bundle = typeof bundles[number];
    const ownBundles = bundles.filter(b => personalBranchIds.includes(b.branch.id));
    const currentBranch = bundles.find(b => b.branch.id === scope.branch.id)!;
    const started = asOf >= period.from;
    const makeSummary = (selected: Bundle[], memberId: string | null, compareSelected = selected) => {
      const amount = (b: Bundle, part: "annual" | "current" | "previous") => memberId ? b[part].employees[memberId] ?? blank() : b[part].team;
      const annual = sum(selected.map(b => amount(b, "annual"))), current = sum(selected.map(b => amount(b, "current"))), previous = sum(compareSelected.map(b => amount(b, "previous")));
      const complete = selected.length > 0 && selected.every(b => b.annual.complete);
      const attributionComplete = selected.every(b => !b.annual.unassignedCount);
      const goals = selected.map(b => memberId ? b.target?.people.find(p => p.membershipId === memberId)?.amount ?? null : b.target?.levels[0] ?? null);
      const targetComplete = goals.length > 0 && goals.every(g => g !== null && g > 0);
      const knownTarget = integer(goals.reduce<number>((s, g) => s + (g ?? 0), 0));
      const goal = targetComplete ? knownTarget : null;
      const confirmed = complete && started && (!memberId || attributionComplete);
      const p = progress(annual.total, goal, confirmed);
      const comparable = !window.future && selected.length > 0 && selected.every(b => b.current.complete && (!memberId || !b.current.unassignedCount)) &&
        compareSelected.every(b => b.previous.complete && (!memberId || !b.previous.unassignedCount));
      return { annual, current, previous, complete, attributionComplete, started, goal, knownTarget, targetComplete,
        progress: { percent: p.percent, gap: confirmed ? p.gap : null },
        comparison: { ...comparePerformance(current.total, previous.total, comparable), ongoing: window.ongoing, future: window.future,
          from: window.current.from.toISOString(), to: new Date(Math.min(asOf.getTime(), window.current.toExclusive.getTime() - 1)).toISOString(),
          previousFrom: window.previous.from.toISOString(), previousTo: window.previousAsOf.toISOString() } };
    };
    const ownComparisonBundles = bundles.filter(b => comparisonBranchIds.includes(b.branch.id));
    const personal = makeSummary(ownBundles, scope.membershipId, ownComparisonBundles);
    const team = { ...makeSummary([currentBranch], null), levels: currentBranch.target?.levels ?? null,
      ...teamLevel(currentBranch.annual.team.total, currentBranch.target?.levels ?? null, started && currentBranch.annual.complete),
      unassigned: currentBranch.annual.unassigned };
    const base = { mode, canViewTeam, scopeKey: staffPerformanceScopeKey(auth), year, month, asOf: asOf.toISOString(), timezone,
      periodStart: period.from.toISOString(), periodEnd: period.toExclusive.toISOString(), branchName: scope.branch.name,
      personalBranchCount: ownBundles.length, personal, team };
    if (mode === "card") return { ...base, detail: null };
    const assignedMembers = canViewTeam ? await tx.employeeBranchAssignment.findMany({ where: { businessId: scope.businessId, branchId: scope.branch.id,
      effectiveFrom: { lt: period.toExclusive }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: period.from } }] }, select: { membershipId: true } }) : [];
    const memberIds = [...new Set([...assignedMembers.map(a => a.membershipId), ...(currentBranch.target?.people.map(p => p.membershipId) ?? []),
      ...Object.keys(currentBranch.annual.employees),
      ...currentBranch.ledger.details.flatMap(e => e.allocations.flatMap(a => a.membershipId ? [a.membershipId] : []))])];
    if (input.member && !memberIds.includes(input.member)) throw new StaffPerformanceAccessError(403, "PERFORMANCE_SCOPE_DENIED");
    const memberId = mode === "member" ? input.member! : scope.membershipId;
    const selected = mode === "mine" ? ownBundles : [currentBranch];
    const isTeam = mode === "team";
    const subject = makeSummary(selected, isTeam ? null : memberId, mode === "mine" ? ownComparisonBundles : selected);
    const members = isTeam && canViewTeam ? await tx.employeeBusinessMembership.findMany({ where: { businessId: scope.businessId, id: { in: memberIds },
      ...(input.search ? { OR: [{ fullName: { contains: input.search, mode: "insensitive" as const } }, { employeeCode: { contains: input.search, mode: "insensitive" as const } }] } : {}) },
      select: { id: true, fullName: true, employeeCode: true, status: true }, orderBy: [{ employeeCode: "asc" }, { id: "asc" }] }) : [];
    const selectedIdentity = mode === "member" ? await tx.employeeBusinessMembership.findFirstOrThrow({ where: { id: memberId, businessId: scope.businessId }, select: { fullName: true, employeeCode: true, status: true } }) : null;
    const months = Array.from({ length: 12 }, (_, i) => {
      const p = performancePeriod(year, timezone, i + 1);
      const parts = selected.map(b => slicePerformance(b.ledger, p.from, p.toExclusive, asOf));
      return { month: i + 1, future: asOf < p.from, complete: parts.every(p => p.complete && (isTeam || !p.unassignedCount)),
        amount: sum(parts.map(p => isTeam ? p.team : p.employees[memberId] ?? blank())) };
    });
    // Ordinary team tab contains aggregates only; events are ALWAYS restricted to the selected, authorized member.
    const rows = isTeam ? [] : selected.flatMap(b => b.ledger.details.flatMap(e => {
      const allocation = e.allocations.find(a => a.membershipId === memberId);
      const inMonth = (new Date(e.occurredAt) >= window.current.from && new Date(e.occurredAt) < window.current.toExclusive) ||
        (!e.verified && e.localDate >= localPerformanceDate(window.current.from, timezone) && e.localDate < localPerformanceDate(window.current.toExclusive, timezone));
      return allocation && inMonth && !["PACKAGE", "RESTORE"].includes(e.kind) ? [{ event: e, allocation, branch: b.branch }] : [];
    })).sort((a, b) => b.event.occurredAt.localeCompare(a.event.occurredAt) || a.event.id.localeCompare(b.event.id));
    const pageSize = 20, pageRows = rows.slice((input.page - 1) * pageSize, input.page * pageSize);
    const invoices = await tx.invoice.findMany({ where: { businessId: scope.businessId, branchId: { in: selected.map(b => b.branch.id) },
      id: { in: pageRows.flatMap(r => r.event.invoiceId ? [r.event.invoiceId] : []) } }, select: { id: true, invoiceNumber: true } });
    return { ...base, detail: {
      subject, selectedIdentity, months,
      branches: mode === "mine" ? ownBundles.map(b => ({ name: b.branch.name, revision: b.revision,
        goal: b.target?.people.find(p => p.membershipId === memberId)?.amount || null,
        amount: b.annual.employees[memberId] ?? blank(), complete: b.annual.complete, attributionComplete: !b.annual.unassignedCount })) : [],
      members: members.map(m => ({ ...m, summary: makeSummary([currentBranch], m.id) })),
      page: input.page, pageSize, totalRows: rows.length,
      events: pageRows.map(({ event: e, allocation: a, branch }) => ({ id: e.id, orderNumber: invoices.find(i => i.id === e.invoiceId)?.invoiceNumber ?? null,
        branchName: branch.name, occurredAt: e.occurredAt, kind: e.kind, verified: e.verified,
        amount: e.verified ? { salesReceived: a.salesReceived, tipsReceived: a.tipsReceived, salesRefunds: a.salesRefunds, tipsRefunds: a.tipsRefunds, refunds: a.refunds, total: a.total } : null })),
    } };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

export type StaffPerformanceDTO = Awaited<ReturnType<typeof readStaffPerformance>>;
