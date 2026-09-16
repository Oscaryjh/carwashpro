/** A calendar month is not an instant in the server's local timezone. */
export function formatHrCalendarMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError("Invalid calendar month");
  return new Intl.DateTimeFormat("en-MY", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}
