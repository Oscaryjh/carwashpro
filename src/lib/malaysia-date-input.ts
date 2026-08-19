export function formatMalaysiaDateInput(isoValue: string) {
  if (!isIsoDate(isoValue)) return "";
  const [year, month, day] = isoValue.split("-");
  return `${day}/${month}/${year}`;
}

export function parseMalaysiaDateInput(displayValue: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(displayValue);
  if (!match) return null;
  const [, day, month, year] = match;
  const isoValue = `${year}-${month}-${day}`;
  return isIsoDate(isoValue) ? isoValue : null;
}

export function normalizeMalaysiaDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}
