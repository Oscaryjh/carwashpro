export function parseMoneyToCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("COMMERCIAL_MONEY_INVALID");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("COMMERCIAL_MONEY_INVALID");
  return cents;
}

export function formatCents(value: number | null, currency = "MYR") {
  if (value === null) return "Price review required";
  return new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(value / 100);
}

export function percentDiscount(listCents: number, basisPoints: number) {
  if (!Number.isInteger(listCents) || !Number.isInteger(basisPoints)) throw new Error("COMMERCIAL_MONEY_INVALID");
  return Math.min(listCents, Math.round((listCents * basisPoints) / 10_000));
}
