// Same UTC calendar-month boundaries as the Expenses overview.
export function historyDatePeriods(now = new Date()) {
  const year = now.getUTCFullYear(), month = now.getUTCMonth();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    'this-month': { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(new Date(Date.UTC(year, month + 1, 0))) },
    'last-month': { from: iso(new Date(Date.UTC(year, month - 1, 1))), to: iso(new Date(Date.UTC(year, month, 0))) },
  };
}
