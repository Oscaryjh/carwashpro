export function parsePayrollMonth(value: string | undefined) {
  const normalized = value?.trim() || new Date().toISOString().slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error("Select a valid payroll month.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) {
    throw new Error("Select a valid payroll month.");
  }
  return {
    value: normalized,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
