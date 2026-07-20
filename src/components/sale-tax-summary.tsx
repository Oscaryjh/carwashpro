import type { TaxCalculation } from "@/lib/tax/calculator";

type SaleTaxSummaryProps = {
  itemLabel: string;
  sstEnabled: boolean;
  tax: TaxCalculation;
};

export function SaleTaxSummary({ itemLabel, sstEnabled, tax }: SaleTaxSummaryProps) {
  return (
    <div className="product-sale-summary">
      <span className="product-sale-summary-count">{itemLabel}</span>
      <div className="product-sale-summary-breakdown">
        <span>
          <small>Subtotal</small>
          <b>{formatMoney(tax.subtotal)}</b>
        </span>
        {sstEnabled ? (
          <span>
            <small>{formatTaxLabel(tax.taxLabel, tax.taxRate)}</small>
            <b>{formatMoney(tax.tax)}</b>
          </span>
        ) : null}
        <span className="is-total">
          <small>Total</small>
          <strong>{formatMoney(tax.total)}</strong>
        </span>
      </div>
    </div>
  );
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}

function formatTaxLabel(label: string, rate: number) {
  if (rate <= 0) return label;
  const formattedRate = Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${label} (${formattedRate}%)`;
}
