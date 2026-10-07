import { z } from "zod";
import { getBusinessDayRange, getCurrentBusinessDateValue, type BusinessTimeSettings } from "@/lib/business-day";
import { addDaysToDateValue, startOfBusinessMonth, isValidDateValue, formatDateValue } from "@/lib/business-time";
export const packageViews = ["overview", "activity", "sales", "customers"] as const;
export const packageRanges = ["today", "month", "last-month", "custom"] as const;
export type PackageHubQuery = { view: typeof packageViews[number]; range: typeof packageRanges[number]; branchId?: string; from?: string; to?: string; q: string; packageSearch: string; type?: "PURCHASED" | "USED" | "RESTORED" | "CANCELLED"; status?: "ACTIVE" | "USED_UP" | "PENDING_PAYMENT" | "CANCELLED"; cursor?: string; back: string[] };
export function parsePackageHubQuery(params: Record<string, string | string[] | undefined>): PackageHubQuery {
  const scalar = (key: string) => { const v = params[key]; if (Array.isArray(v)) throw Error("Duplicate Package filter."); return v; };
  const view = z.enum(packageViews).catch("overview").parse(scalar("view")), range = z.enum(packageRanges).catch("month").parse(scalar("range"));
  const branch = scalar("branchId"), branchId = branch === "all" ? undefined : branch;
  if (branchId !== undefined) z.string().uuid().parse(branchId);
  const from = scalar("from"), to = scalar("to");
  if (range === "custom" && (!from || !to || !isValidDateValue(from) || !isValidDateValue(to))) throw Error("Select valid Package dates.");
  const back = scalar("back");
  return { view, range, branchId, ...(range === "custom" ? { from, to } : {}),
    q: view === "overview" ? "" : z.string().trim().max(160).parse(scalar("q") ?? ""), packageSearch: view === "overview" ? "" : z.string().trim().max(160).parse(scalar("packageSearch") ?? ""),
    type: view === "activity" ? z.enum(["PURCHASED", "USED", "RESTORED", "CANCELLED"]).optional().parse(scalar("type") || undefined) : undefined,
    status: view === "customers" ? z.enum(["ACTIVE", "USED_UP", "PENDING_PAYMENT", "CANCELLED"]).optional().parse(scalar("status") || undefined) : undefined,
    cursor: z.string().max(2048).optional().parse(scalar("cursor") || undefined),
    back: back ? z.array(z.string().max(2048)).max(20).parse(JSON.parse(z.string().max(16000).parse(back))) : [] };
}
export function packageHubHref(query: PackageHubQuery, change: Partial<PackageHubQuery> = {}) {
  const q = { ...query, ...change }, p = new URLSearchParams({ view: q.view, range: q.range });
  for (const key of ["branchId", "q", "packageSearch", "cursor"] as const) if (q[key]) p.set(key, q[key]!);
  if (q.range === "custom") { if (q.from) p.set("from", q.from); if (q.to) p.set("to", q.to); }
  if (q.view === "activity" && q.type) p.set("type", q.type);
  if (q.view === "customers" && q.status) p.set("status", q.status);
  if (q.back.length) p.set("back", JSON.stringify(q.back));
  return `/package-hub?${p}`;
}
export function nextPackageHubQuery(q: PackageHubQuery, cursor: string): PackageHubQuery { return { ...q, cursor, back: [...q.back, q.cursor ?? ""].slice(-20) }; }
export function previousPackageHubQuery(q: PackageHubQuery): PackageHubQuery | null { return q.back.length ? { ...q, cursor: q.back.at(-1) || undefined, back: q.back.slice(0, -1) } : null; }
export function resolvePackageHubPeriod(q: PackageHubQuery, business: BusinessTimeSettings, now = new Date()) {
  const today = getCurrentBusinessDateValue(now, business.timezone, business.businessDayCutoffTime);
  let from = today, to = today;
  if (q.range === "month") from = startOfBusinessMonth(today);
  if (q.range === "last-month") { to = addDaysToDateValue(startOfBusinessMonth(today), -1); from = startOfBusinessMonth(to); }
  if (q.range === "custom") { from = q.from!; to = q.to!; }
  return { ...getBusinessDayRange({ ...business, fromDateValue: from, toDateValue: to }), label: q.range === "today" ? "Today" : q.range === "month" ? "This Month" : q.range === "last-month" ? "Last Month" : `${formatDateValue(from, { dateStyle: "medium" })} – ${formatDateValue(to, { dateStyle: "medium" })}` };
}
