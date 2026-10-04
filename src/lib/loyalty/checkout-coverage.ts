import { calculateTax, type TaxLineInput } from "../tax/calculator";
import { calculateLoyaltyRedemption } from "./rules";

export type CoveredCheckoutLine = TaxLineInput & { quantity?: number; coveredQuantity?: number };
type Input = Omit<Parameters<typeof calculateTax>[0], "lines"> & { lines: CoveredCheckoutLine[] };
const cents = (amount: number) => Math.round(amount * 100);

/** Manual/catalog allocation is the existing calculator's baseline. A selected
 * service balance covers one unit; no client-provided monetary coverage is used. */
export function prepareCheckoutCoverage(input: Input) {
  const baseline = calculateTax(input);
  const coveredBaseCents: number[] = [];
  const coveredTaxCents: number[] = [];
  const coverageCents = input.lines.map((line, index) => {
    const quantity = line.quantity ?? 1;
    const count = line.coveredQuantity ?? 0;
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(count) || count < 0 || count > quantity) {
      throw new Error("Package coverage exceeds the selected service quantity.");
    }
    const base = Math.max(0, cents(line.lineTotal) - cents(baseline.lineDiscount[index]));
    const tax = cents(baseline.lineTax[index]);
    // Preserve the historical per-unit voucher valuation. Any partial-quantity
    // rounding remainder belongs to the uncovered/payable part, never Points.
    const unitBase = Math.max(0, Math.round(cents(line.lineTotal) / quantity) - Math.round(cents(baseline.lineDiscount[index]) / quantity));
    const unitTax = Math.round(tax / quantity);
    let coveredBase = 0;
    let coveredTax = 0;
    const units = Array.from({ length: count }, (_, unit) => {
      const lastFullyCovered = count === quantity && unit === count - 1;
      const b = lastFullyCovered ? base - coveredBase : Math.min(unitBase, base - coveredBase);
      const t = lastFullyCovered ? tax - coveredTax : Math.min(unitTax, tax - coveredTax);
      coveredBase += b;
      coveredTax += t;
      return b + t;
    });
    coveredBaseCents.push(coveredBase);
    coveredTaxCents.push(coveredTax);
    return units;
  });
  const eligibleLineCents = input.lines.map((line, i) => Math.max(0,
    cents(line.lineTotal) - cents(baseline.lineDiscount[i]) - coveredBaseCents[i]));
  return { baseline, coverageCents, coveredBaseCents, coveredTaxCents, eligibleLineCents,
    eligibleCents: eligibleLineCents.reduce((a,b)=>a+b,0) };
}

export function redeemCheckoutPoints(input: Parameters<typeof calculateLoyaltyRedemption>[0]) {
  // No monetary benefit: do not burn points or write a zero-value redemption.
  if (input.maximumDiscountCents === 0) return { points: 0, discountCents: 0 };
  const result = calculateLoyaltyRedemption(input);
  return result.discountCents > 0 ? result : { points: 0, discountCents: 0 };
}

export function calculateCoveredCheckoutTax(input: Input, loyaltyDiscountCents: number) {
  const prepared = prepareCheckoutCoverage(input);
  if (!Number.isSafeInteger(loyaltyDiscountCents) || loyaltyDiscountCents < 0 || loyaltyDiscountCents > prepared.eligibleCents) {
    throw new Error("Points discount exceeds uncovered eligible value.");
  }
  const { baseline, coverageCents, eligibleLineCents } = prepared;
  if (!input.lines.some(line => (line.coveredQuantity ?? 0) > 0)) {
    const tax = calculateTax({ ...input, discount: baseline.discount + loyaltyDiscountCents / 100 });
    return { tax, coverageCents, loyaltyLineDiscountCents: tax.lineDiscount.map((d,i)=>cents(d)-cents(baseline.lineDiscount[i])) };
  }
  // Cumulative integer allocation reconciles every cent; zero eligible lines
  // always receive zero, including a covered last line.
  let cumulativeBase = 0;
  let allocated = 0;
  const loyaltyLineDiscountCents = eligibleLineCents.map(value => {
    cumulativeBase += value;
    const target = prepared.eligibleCents ? Math.floor(loyaltyDiscountCents * cumulativeBase / prepared.eligibleCents) : 0;
    const result = target - allocated;
    allocated = target;
    return result;
  });
  const lineDiscount = baseline.lineDiscount.map((d,i)=>(cents(d)+loyaltyLineDiscountCents[i])/100);
  let taxableSubtotal = 0;
  const lineTax = input.lines.map((line,i)=>{
    const base = Math.max(0,cents(line.lineTotal)-cents(lineDiscount[i]));
    const rate = input.sstEnabled && line.taxable ? Math.max(0,Number(line.taxRate ?? input.sstRate)||0) : 0;
    if (rate > 0) taxableSubtotal += base;
    // Existing line-level SST rounding, with its residual on the uncovered
    // portion. Covered SST is frozen before Points and cannot be reduced.
    return Math.max(prepared.coveredTaxCents[i],Math.round(base*rate/100))/100;
  });
  const taxCents = lineTax.reduce((sum,value)=>sum+cents(value),0);
  const discountCents = cents(baseline.discount)+loyaltyDiscountCents;
  return { coverageCents, loyaltyLineDiscountCents, tax: { ...baseline, lineDiscount, lineTax,
    taxableSubtotal: taxableSubtotal/100, discount: discountCents/100, tax: taxCents/100,
    total: (cents(baseline.subtotal)-discountCents+taxCents+cents(baseline.tip))/100 } };
}
