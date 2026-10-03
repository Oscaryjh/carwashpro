/** Read-only presentation hints, never a replacement for transactional refund guards. */
export type PackagePurchaseRefundPresentation = {
  refundableCents: number;
  unavailableReason: string | null;
};
type PackageState = {
  id: string;
  status: string;
  remainingUses: number;
  totalUses: number;
  serviceBalances: {remainingUses: number; totalUses: number}[];
};
type Association = {customerPackageId: string | null; customerPackage: PackageState | null};
export function packageRefundPresentation(
  invoice: Association & {items: Association[]; payments: {method: string; customerPackageId: string | null}[]},
  refundableCents: number,
): PackagePurchaseRefundPresentation | null {
  // PACKAGE payment associates an existing entitlement with a redemption, not a purchase.
  const redeemed = new Set(invoice.payments.filter(p => p.method === "PACKAGE").map(p => p.customerPackageId));
  const purchases = [invoice, ...invoice.items].filter(row => row.customerPackageId && !redeemed.has(row.customerPackageId));
  if (!purchases.length) return null;
  const unavailableReason = purchases.some(row => !row.customerPackage)
    ? "Package purchase details are unavailable. Ask the owner to review this invoice."
    : purchases.some(({customerPackage: pkg}) => pkg!.status !== "ACTIVE" || pkg!.remainingUses !== pkg!.totalUses || pkg!.serviceBalances.some(balance => balance.remainingUses !== balance.totalUses))
      ? "All packages in this invoice must be unused before they can be refunded."
      : refundableCents <= 0 ? "This purchase has no refundable amount remaining." : null;
  return {refundableCents, unavailableReason};
}
