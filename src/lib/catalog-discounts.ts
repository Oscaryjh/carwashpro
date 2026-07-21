export type CatalogDiscountScope = "ALL" | "SERVICES" | "PRODUCTS" | "PACKAGES";
export type CatalogDiscountType = "PERCENTAGE" | "FIXED_AMOUNT";
export type CatalogLineType = "service" | "product" | "package";

export type CatalogDiscountOption = {
  id: string;
  branchId?: string | null;
  name: string;
  discountType: CatalogDiscountType;
  percentage: number | null;
  fixedAmount: number | null;
  scope: CatalogDiscountScope;
  minimumSpend: number;
  maximumDiscount: number | null;
  allowLoyaltyStacking: boolean;
};

export type CatalogDiscountLine = {
  lineTotalCents: number;
  type: CatalogLineType;
};

export function calculateCatalogDiscountCents({
  discount,
  lines,
}: {
  discount: CatalogDiscountOption;
  lines: CatalogDiscountLine[];
}) {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + Math.max(0, Math.round(line.lineTotalCents)),
    0,
  );

  if (subtotalCents < Math.round(discount.minimumSpend * 100)) {
    return 0;
  }

  const eligibleSubtotalCents = lines.reduce((sum, line) => {
    return scopeIncludesType(discount.scope, line.type)
      ? sum + Math.max(0, Math.round(line.lineTotalCents))
      : sum;
  }, 0);
  const calculated = discount.discountType === "FIXED_AMOUNT"
    ? Math.round(Math.max(0, discount.fixedAmount ?? 0) * 100)
    : Math.round(
        eligibleSubtotalCents * (Math.min(100, Math.max(0, discount.percentage ?? 0)) / 100),
      );
  const maximumCents = discount.maximumDiscount == null
    ? calculated
    : Math.round(Math.max(0, discount.maximumDiscount) * 100);

  return Math.min(subtotalCents, eligibleSubtotalCents, calculated, maximumCents);
}

export function formatCatalogDiscountValue(discount: Pick<
  CatalogDiscountOption,
  "discountType" | "fixedAmount" | "percentage"
>) {
  if (discount.discountType === "FIXED_AMOUNT") {
    return `RM${(discount.fixedAmount ?? 0).toFixed(2)}`;
  }

  return `${(discount.percentage ?? 0).toFixed(2).replace(/\.00$/, "")}%`;
}

export function scopeIncludesType(
  scope: CatalogDiscountScope,
  type: CatalogLineType,
) {
  return scope === "ALL" ||
    (scope === "SERVICES" && type === "service") ||
    (scope === "PRODUCTS" && type === "product") ||
    (scope === "PACKAGES" && type === "package");
}

export function formatCatalogDiscountScope(scope: CatalogDiscountScope) {
  const labels: Record<CatalogDiscountScope, string> = {
    ALL: "All catalog items",
    SERVICES: "Services only",
    PRODUCTS: "Products only",
    PACKAGES: "Packages only",
  };

  return labels[scope];
}
