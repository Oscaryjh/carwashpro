// Presentation only. Amounts/coverage/permissions are supplied by the existing Staff DTO.
export const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatPerformanceMoney = (value: number) => `${value < 0 ? "−" : ""}RM${new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value) / 100)}`;
export const formatPerformancePercent = (value: number) => `${new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 }).format(value)}%`;
export const formatRefund = (value: number) => formatPerformanceMoney(-Math.abs(value));
export function shortPeriod(from: string, to: string, timezone: string) {
  const parts = (value: string) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).formatToParts(new Date(value));
    const get = (key: string) => p.find(v => v.type === key)!.value;
    return { month: get("month"), day: get("day"), year: get("year") };
  };
  const a = parts(from), b = parts(to);
  if (a.year !== b.year) return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`;
  return a.month === b.month ? `${a.month} ${a.day}–${b.day}` : `${a.month} ${a.day} – ${b.month} ${b.day}`;
}
export type ChartMonth = { month: number; future: boolean; complete: boolean; amount: { total: number } };
export function monthlyChartGeometry(months: ChartMonth[], height = 140) {
  const known = months.filter(m => !m.future && m.complete).map(m => m.amount.total);
  const max = Math.max(0, ...known), min = Math.min(0, ...known), span = max - min || 1;
  const zero = max / span * height;
  return { max, min, zero, points: months.map(m => {
    const status = m.future ? "future" : !m.complete ? "pending" : "complete";
    const value = status === "complete" ? m.amount.total : null;
    // No artificial minimum bar. Unknown/future months do not become zero receipts.
    return { month: m.month, status, value, y: value === null ? zero : Math.min(zero, (max - value) / span * height), height: value === null ? 0 : Math.abs(value) / span * height };
  }) };
}
