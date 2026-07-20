export function formatTaxLabel(
  label: string | null | undefined,
  rate: unknown,
) {
  const baseLabel = label?.trim() || "SST";
  const numericRate = Number(rate ?? 0);

  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    return baseLabel;
  }

  const rateText = Number.isInteger(numericRate)
    ? String(numericRate)
    : numericRate.toFixed(2).replace(/\.?0+$/, "");

  return `${baseLabel} (${rateText}%)`;
}
