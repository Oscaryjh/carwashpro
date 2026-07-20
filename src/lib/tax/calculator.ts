export type TaxLineInput = {
  lineTotal: number;
  taxable: boolean;
  taxRate?: number | null;
};

export type TaxCalculation = {
  subtotal: number;
  discount: number;
  taxableSubtotal: number;
  tax: number;
  tip: number;
  total: number;
  taxRate: number;
  taxLabel: string;
  lineDiscount: number[];
  lineTax: number[];
};

export type TaxDisplaySettings = {
  enabled: boolean;
  label: string;
  rate: number;
};

function cents(value: number | null | undefined) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

function money(value: number) {
  return value / 100;
}

export function calculateTax(input: {
  sstEnabled: boolean;
  sstLabel?: string | null;
  sstRate?: number | null;
  lines: TaxLineInput[];
  discount?: number | null;
  tip?: number | null;
}): TaxCalculation {
  const lineCents = input.lines.map((line) => cents(line.lineTotal));
  const subtotalCents = lineCents.reduce((sum, value) => sum + value, 0);
  const discountCents = Math.min(cents(input.discount), subtotalCents);
  const tipCents = cents(input.tip);
  const taxRate = Math.max(0, Number(input.sstRate) || 0);
  const taxLabel = input.sstLabel?.trim() || "SST";
  const lineDiscount: number[] = [];
  const lineTax: number[] = [];

  let taxableSubtotalCents = 0;
  let taxCents = 0;
  let allocatedDiscount = 0;

  lineCents.forEach((lineCentsValue, index) => {
    const isLast = index === lineCents.length - 1;
    const allocatedLineDiscount = subtotalCents === 0
      ? 0
      : isLast
        ? discountCents - allocatedDiscount
        : Math.round(discountCents * lineCentsValue / subtotalCents);
    allocatedDiscount += allocatedLineDiscount;
    lineDiscount.push(money(allocatedLineDiscount));
    const taxableBase = Math.max(0, lineCentsValue - allocatedLineDiscount);
    const line = input.lines[index];
    const lineRate = line.taxable && input.sstEnabled
      ? Math.max(0, Number(line.taxRate ?? taxRate) || 0)
      : 0;
    const lineTaxCents = Math.round(taxableBase * lineRate / 100);
    if (lineRate > 0) taxableSubtotalCents += taxableBase;
    taxCents += lineTaxCents;
    lineTax.push(money(lineTaxCents));
  });

  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents + tipCents);
  return {
    subtotal: money(subtotalCents),
    discount: money(discountCents),
    taxableSubtotal: money(taxableSubtotalCents),
    tax: money(taxCents),
    tip: money(tipCents),
    total: money(totalCents),
    taxRate: input.sstEnabled ? taxRate : 0,
    taxLabel,
    lineDiscount,
    lineTax,
  };
}

export function calculatePackageTax(input: {
  price: number;
  taxable?: boolean;
  taxRate?: number | null;
  sstEnabled: boolean;
  sstLabel?: string | null;
  sstRate?: number | null;
}): TaxCalculation {
  return calculateTax({
    sstEnabled: input.sstEnabled,
    sstLabel: input.sstLabel,
    sstRate: input.sstRate,
    lines: [
      {
        lineTotal: input.price,
        taxable: input.taxable ?? true,
        taxRate: input.taxRate,
      },
    ],
  });
}

export function calculateCreditNoteAmounts(input: {
  invoiceSubtotal: number;
  invoiceTax: number;
  invoiceTotal: number;
  refundTotal: number;
}) {
  const invoiceTotalCents = cents(input.invoiceTotal);
  const refundTotalCents = Math.min(
    cents(input.refundTotal),
    invoiceTotalCents,
  );
  const invoiceTaxCents = Math.min(cents(input.invoiceTax), invoiceTotalCents);
  const taxCents = invoiceTotalCents === 0
    ? 0
    : Math.min(
        refundTotalCents,
        Math.round(refundTotalCents * invoiceTaxCents / invoiceTotalCents),
      );
  const subtotalCents = refundTotalCents - taxCents;

  return {
    subtotal: money(subtotalCents),
    taxableSubtotal: taxCents > 0 ? money(subtotalCents) : 0,
    tax: money(taxCents),
    total: money(refundTotalCents),
  };
}
