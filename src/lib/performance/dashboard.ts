import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessWallClockToUtc } from "@/lib/business-day";
import { integer } from "./money";
import { readSnapshot } from "./read";
import { assertTargetsEnabled, currentTarget, targetMembers } from "./targets";
import type { PerformanceActor } from "./scope";
import { localPerformanceDate, performancePeriod } from "./time";
import { comparePerformance, progress, teamLevel, type TargetSnapshot } from "./targets-contract";

type Ledger = Awaited<ReturnType<typeof readSnapshot>>;
const blank = () => ({ salesReceived: 0, tipsReceived: 0, salesRefunds: 0, tipsRefunds: 0, refunds: 0, total: 0 });
type Totals = ReturnType<typeof blank>;
const add = (to: Totals, from: Totals) => { for (const key of Object.keys(to) as (keyof Totals)[]) to[key] = integer(to[key] + from[key]); };
/** Sums only Phase 1's verified immutable event/attribution projections; never invoice totals. */
export function slicePerformance(ledger: Ledger, from: Date, to: Date, asOf: Date) {
  const start = localPerformanceDate(from, ledger.period.timezone), end = localPerformanceDate(to, ledger.period.timezone);
  const inRange = (date: string) => new Date(date) >= from && new Date(date) < to && new Date(date) <= asOf;
  const details = ledger.details.filter(e => inRange(e.occurredAt) ||
    (e.localDate >= start && e.localDate < end && new Date(e.occurredAt) <= asOf));
  const sources = ledger.sourceDetails.filter(e => inRange(e.occurredAt));
  const team = blank(), unassigned = blank(), employees: Record<string, Totals> = {};
  let pendingCount = 0, unassignedCount = 0;
  for (const e of details) {
    if (!e.verified) { if (!["PACKAGE", "RESTORE"].includes(e.kind)) pendingCount++; continue; }
    // For intra-month comparisons, frozen-day membership alone must not include later times.
    if (!inRange(e.occurredAt)) continue;
    for (const a of e.allocations) {
      add(team, a);
      add(a.membershipId ? employees[a.membershipId] ??= blank() : unassigned, a);
      if (!a.membershipId && (a.salesReceived || a.tipsReceived || a.refunds)) unassignedCount++;
    }
  }
  const uncapturedCount = sources.filter(s => s.classification === "UNCAPTURED").length;
  const basisGapCount = sources.filter(s => s.method !== "PACKAGE" && !s.originalCaptured).length;
  const complete = !pendingCount && !uncapturedCount && !basisGapCount;
  return { team, employees, unassigned, unassignedCount, complete, pendingCount, uncapturedCount, basisGapCount,
    from: from.toISOString(), toExclusive: to.toISOString(), asOf: asOf.toISOString() };
}
export function comparisonWindow(year: number, month: number, timezone: string, asOf: Date) {
  const current = performancePeriod(year, timezone, month);
  const prevYear = month === 1 ? year - 1 : year, prevMonth = month === 1 ? 12 : month - 1;
  const previous = performancePeriod(prevYear, timezone, prevMonth);
  const ongoing = asOf >= current.from && asOf < current.toExclusive;
  let previousAsOf = new Date(previous.toExclusive.getTime() - 1);
  if (ongoing) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(asOf);
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    const day = Number(part("day")), maxDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    if (day <= maxDay) previousAsOf = new Date(businessWallClockToUtc(`${prevYear}-${String(prevMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`, `${part("hour")}:${part("minute")}`, timezone).getTime() + Number(part("second"))*1000 + asOf.getUTCMilliseconds());
  }
  return { current, previous, previousAsOf, ongoing, future: asOf < current.from, label: ongoing ? "上月同期" : "上月整月" };
}
export async function readPerformanceDashboard(context: PerformanceActor, input: { year: number; month: number; asOf: Date; employeeId?: string; page?: number; status?: string; component?: string; detailRange?: "year" | "month" }, db: PrismaClient = prisma) {
  assertTargetsEnabled();
  if (!(input.asOf instanceof Date) || !Number.isFinite(input.asOf.getTime())) throw new Error("必须指定有效统计截止时间。");
  if (input.status && !["CAPTURED_VERIFIED", "CAPTURED_VERIFIED_UNASSIGNED", "CAPTURED_PENDING", "UNCAPTURED", "EXCLUDED_NONCASH"].includes(input.status)) throw new Error("来源状态无效。");
  if (input.component && !["SALE", "TIP"].includes(input.component)) throw new Error("贡献类型无效。");
  if (!Number.isInteger(input.page ?? 1) || (input.page ?? 1) < 1) throw new Error("页码无效。");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const ledger = await readSnapshot(context, { year: input.year, asOf: input.asOf }, tx);
    const window = comparisonWindow(input.year, input.month, ledger.period.timezone, input.asOf);
    // Exactly one additional bounded source check for January's prior December, never N × 12.
    const prevLedger = input.month === 1 ? await readSnapshot(context, { year: input.year - 1, month: 12, asOf: input.asOf }, tx) : ledger;
    const annual = { ...slicePerformance(ledger, ledger.period.from, ledger.period.toExclusive, input.asOf), started:input.asOf>=ledger.period.from };
    const current = slicePerformance(ledger, window.current.from, window.current.toExclusive, input.asOf);
    const previous = slicePerformance(prevLedger, window.previous.from, window.previous.toExclusive, window.previousAsOf);
    const target = await currentTarget(tx, context, input.year);
    const snapshot = target?.snapshot as TargetSnapshot | undefined;
    const previousTarget = await currentTarget(tx, context, input.year - 1);
    const eligible = await targetMembers(tx, context, input.year);
    const allIds = [...new Set([...eligible.map(m=>m.id), ...Object.keys(annual.employees), ...(snapshot?.people.map(p=>p.membershipId) ?? []),
      ...ledger.details.flatMap(e=>e.allocations.flatMap(a=>a.membershipId ? [a.membershipId] : []))])];
    const identities = await tx.employeeBusinessMembership.findMany({ where: { businessId: context.businessId, id: { in: allIds } },
      select: { id: true, fullName: true, employeeCode: true, status: true }, orderBy: [{ employeeCode: "asc" },{ id: "asc" }] });
    if (input.employeeId && input.employeeId !== "UNASSIGNED" && !allIds.includes(input.employeeId)) throw new Error("员工不在本店业绩范围。");
    const months = Array.from({length:12},(_,i)=>{
      const p=performancePeriod(input.year, ledger.period.timezone, i+1);
      return { month:i+1, future:input.asOf<p.from, ...slicePerformance(ledger,p.from,p.toExclusive,input.asOf) };
    });
    const members = identities.map(m=>{
      const amount=annual.employees[m.id] ?? blank(), goal=snapshot?.people.find(p=>p.membershipId===m.id)?.amount ?? null;
      return { ...m, amount, goal, eligible:eligible.some(e=>e.id===m.id), progress:progress(amount.total,goal,annual.complete && annual.started && !annual.unassignedCount),
        month:current.employees[m.id] ?? blank(), comparison:comparePerformance(current.employees[m.id]?.total??0,previous.employees[m.id]?.total??0,
          current.complete && previous.complete && !current.unassignedCount && !previous.unassignedCount && !window.future),
        months:months.map(p=>({month:p.month,future:p.future,complete:p.complete && !p.unassignedCount,amount:p.employees[m.id]??blank()})) };
    });
    // Only lightweight reconciliation projections above; hydrate invoice/attribution evidence for ONE page.
    const detailMap = new Map(ledger.details.map(e=>[e.id,e]));
    // Frozen dates can belong to this month while a changed operating timezone places the source elsewhere.
    // Keep those quarantined receipts visible here instead of silently hiding an annual coverage issue.
    const sourceReceiptIds = new Set(ledger.sourceDetails.map(s=>s.receiptId));
    const orphanSources = ledger.details.filter(e=>!sourceReceiptIds.has(e.id) && !e.verified).map(e=>({
      sourceKey:e.refundId?`REFUND:${e.refundId}`:`PAYMENT:${e.paymentId}`,paymentId:e.paymentId,refundId:e.refundId,
      occurredAt:e.occurredAt,rawCents:e.rawCents,method:"UNKNOWN",receiptId:e.id,originalCaptured:true,voided:false,
      classification:"CAPTURED_PENDING",compositionStatus:e.compositionStatus,salesCents:e.unresolvedCents?null:e.salesCents,
      taxCents:e.unresolvedCents?null:e.taxCents,tipCents:e.unresolvedCents?null:e.tipCents,qualifiedCents:null,issues:e.issues,
    }));
    const detailPeriod=input.detailRange==="year"?ledger.period:window.current;
    const frozenStart=localPerformanceDate(detailPeriod.from,ledger.period.timezone),frozenEnd=localPerformanceDate(detailPeriod.toExclusive,ledger.period.timezone);
    const rows = [...ledger.sourceDetails,...orphanSources].filter(s=>{
      const d=s.receiptId?detailMap.get(s.receiptId):undefined;
      return (new Date(s.occurredAt)>=detailPeriod.from && new Date(s.occurredAt)<detailPeriod.toExclusive) ||
        (!!d && !d.verified && d.localDate>=frozenStart && d.localDate<frozenEnd);
    })
      .map(s=>({ ...s, detail:s.receiptId ? detailMap.get(s.receiptId) : undefined }))
      .filter(s=>!input.status || s.classification===input.status)
      .filter(s=>!input.employeeId || s.detail?.allocations.some(a=> (input.employeeId==="UNASSIGNED" ? !a.membershipId : a.membershipId===input.employeeId) && (a.total || a.salesReceived || a.tipsReceived || a.refunds)))
      .filter(s=>!input.component || (input.component==="SALE" ? s.salesCents !== 0 : s.tipCents !== 0))
      .sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||a.sourceKey.localeCompare(b.sourceKey));
    const page = input.page ?? 1, pageSize=25;
    const selected=rows.slice((page-1)*pageSize,page*pageSize);
    const paymentIds=selected.map(s=>s.paymentId);
    const payments=await tx.payment.findMany({where:{businessId:context.businessId,branchId:context.branchId,id:{in:paymentIds}},
      select:{id:true,invoice:{select:{id:true,invoiceNumber:true}}}});
    const invoiceIds=payments.flatMap(p=>p.invoice?[p.invoice.id]:[]);
    const attributions=await tx.performanceAttribution.findMany({where:{businessId:context.businessId,branchId:context.branchId,invoiceId:{in:invoiceIds}},
      orderBy:[{createdAt:"asc"},{revision:"asc"}],select:{id:true,invoiceId:true,paymentId:true,component:true,revision:true,reason:true,createdAt:true,
        actorUserId:true,shares:{select:{membershipId:true,employeeName:true,employeeCode:true,basisPoints:true}}}});
    const history=await tx.performanceTargetVersion.findMany({where:{businessId:context.businessId,branchId:context.branchId,year:input.year},
      orderBy:{revision:"desc"},select:{id:true,revision:true,actorName:true,reason:true,createdAt:true,snapshot:true,previousSnapshot:true,preview:true}});
    return { year:input.year, month:input.month, asOf:input.asOf.toISOString(),timezone:ledger.period.timezone,annual,current,previous,
      comparison:{...comparePerformance(current.team.total,previous.team.total,current.complete&&previous.complete&&!window.future),label:window.label,future:window.future},
      target:snapshot??null,revision:target?.revision??0,previousTarget:(previousTarget?.snapshot as TargetSnapshot|undefined)??null,
      progress:progress(annual.team.total,snapshot?.levels[0]??null,annual.complete&&annual.started),level:teamLevel(annual.team.total,snapshot?.levels??null,annual.complete&&annual.started),
      members,history:history.map(h=>({...h,createdAt:h.createdAt.toISOString()})),page,pageSize,totalRows:rows.length,
      details:selected.map(s=>({...s, invoiceNumber:payments.find(p=>p.id===s.paymentId)?.invoice?.invoiceNumber??"无发票",
        attributionHistory:attributions.filter(a=>a.invoiceId===payments.find(p=>p.id===s.paymentId)?.invoice?.id).map(a=>({...a,createdAt:a.createdAt.toISOString()}))})),
    };
  },{isolationLevel:"RepeatableRead",timeout:30_000});
}
