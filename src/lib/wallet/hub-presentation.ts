import { z } from "zod";
import { getBusinessDayRange, getCurrentBusinessDateValue, type BusinessTimeSettings } from "@/lib/business-day";
import { addDaysToDateValue, startOfBusinessMonth, isValidDateValue, formatDateValue } from "@/lib/business-time";
import type { WalletHubActivityType } from "./hub-read-model";

export const hubViews = ["overview", "transactions", "top-ups", "balances"] as const;
export const hubRanges = ["today", "month", "last-month", "custom"] as const;
export const activityLabels: Record<WalletHubActivityType, string> = { TOP_UP: "Top-up", WALLET_USED: "Wallet Used", WALLET_REFUND: "Wallet Refund", TOP_UP_REVERSAL: "Top-up Reversal", VOID_RESTORE: "VOID Restore" };
export type HubQuery = { view: typeof hubViews[number]; range: typeof hubRanges[number]; from?: string; to?: string; branchId?: string; q: string; type?: WalletHubActivityType; cursor?: string; back: string[] };
export function parseHubQuery(params: Record<string, string | string[] | undefined>): HubQuery {
  const scalar = (key: string) => { const value = params[key]; if (Array.isArray(value)) throw new Error("Duplicate Wallet filter."); return value; };
  const view = z.enum(hubViews).catch("overview").parse(scalar("view"));
  const range = z.enum(hubRanges).catch("month").parse(scalar("range"));
  const branchId = scalar("branchId"); if (branchId !== undefined) z.string().uuid().parse(branchId);
  const q = z.string().trim().max(160).parse(scalar("q") ?? "");
  const type = z.enum(["TOP_UP", "WALLET_USED", "WALLET_REFUND", "TOP_UP_REVERSAL", "VOID_RESTORE"]).optional().parse(scalar("type") || undefined);
  const cursor = z.string().max(2048).optional().parse(scalar("cursor") || undefined);
  const rawBack = scalar("back");
  const back = rawBack ? z.array(z.string().max(2048)).max(20).parse(JSON.parse(z.string().max(16000).parse(rawBack))) : [];
  const from = scalar("from"), to = scalar("to");
  if (range === "custom" && (!from || !to || !isValidDateValue(from) || !isValidDateValue(to))) throw new Error("Select valid Wallet dates.");
  return { view, range, ...(range === "custom" ? { from, to } : {}), ...(branchId ? { branchId } : {}), q, ...(type && view === "transactions" ? { type } : {}), ...(cursor ? { cursor } : {}), back };
}
export function hubHref(query: HubQuery, change: Partial<HubQuery> = {}) {
  const q = { ...query, ...change }; const params = new URLSearchParams({ view: q.view, range: q.range });
  if (q.range === "custom") { if (q.from) params.set("from", q.from); if (q.to) params.set("to", q.to); }
  if (q.branchId) params.set("branchId", q.branchId);
  if (q.q) params.set("q", q.q);
  if (q.view === "transactions" && q.type) params.set("type", q.type);
  if (q.cursor) params.set("cursor", q.cursor);
  if (q.back.length) params.set("back", JSON.stringify(q.back));
  return `/wallet?${params}`;
}
export function nextHubQuery(query: HubQuery, cursor: string): HubQuery {
  return { ...query, cursor, back: [...query.back, query.cursor ?? ""].slice(-20) };
}
export function previousHubQuery(query: HubQuery): HubQuery | null {
  if (!query.back.length) return null;
  const cursor = query.back.at(-1); const { cursor: _old, ...rest } = query;
  void _old;
  return { ...rest, ...(cursor ? { cursor } : {}), back: query.back.slice(0, -1) };
}
export function resolveHubPeriod(query: HubQuery, business: BusinessTimeSettings, now = new Date()) {
  const today = getCurrentBusinessDateValue(now, business.timezone, business.businessDayCutoffTime);
  let from = today, to = today;
  if (query.range === "month") from = startOfBusinessMonth(today);
  if (query.range === "last-month") { to = addDaysToDateValue(startOfBusinessMonth(today), -1); from = startOfBusinessMonth(to); }
  if (query.range === "custom") { from = query.from!; to = query.to!; }
  const period = getBusinessDayRange({ ...business, fromDateValue: from, toDateValue: to });
  const label = query.range === "today" ? "Today" : query.range === "month" ? "This Month" : query.range === "last-month" ? "Last Month" : `${formatDateValue(from, { dateStyle: "medium" })} – ${formatDateValue(to, { dateStyle: "medium" })}`;
  return { ...period, label };
}
export function hubMoney(value: string, signed = false) {
  const negative = value.startsWith("-");
  return `${negative ? "-" : signed && value !== "0.00" ? "+" : ""}RM${negative ? value.slice(1) : value}`;
}
