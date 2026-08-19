export function workHoursToMinutesInput(hoursInput: string) {
  const normalized = hoursInput.trim();
  if (!normalized) return "";

  const hours = Number(normalized);
  if (!Number.isFinite(hours) || hours <= 0) return "";

  return String(Math.round(hours * 60));
}
