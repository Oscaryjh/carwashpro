import type {
  AllStoresBusinessKpi,
  AllStoresKpi,
} from "@/lib/business-groups/all-stores-kpi";

type GroupStorePerformanceSortable = Pick<
  AllStoresBusinessKpi,
  "businessId" | "businessName"
> & {
  current: Pick<AllStoresKpi, "grossSalesCents" | "netSalesCents">;
};

export type RankedGroupStorePerformance<
  T extends GroupStorePerformanceSortable = AllStoresBusinessKpi,
> = {
  business: T;
  rank: number;
};

export function rankGroupStorePerformance<T extends GroupStorePerformanceSortable>(
  businesses: readonly T[],
): RankedGroupStorePerformance<T>[] {
  return [...businesses]
    .sort(
      (left, right) =>
        right.current.netSalesCents - left.current.netSalesCents ||
        right.current.grossSalesCents - left.current.grossSalesCents ||
        left.businessName.localeCompare(right.businessName) ||
        left.businessId.localeCompare(right.businessId),
    )
    .map((business, index) => ({
      business,
      rank: index + 1,
    }));
}

export function hasGroupStoreActivity(metrics: AllStoresKpi) {
  return (
    metrics.grossSalesCents !== 0 ||
    metrics.netSalesCents !== 0 ||
    metrics.paymentsCollectedCents !== 0 ||
    metrics.refundsCents !== 0 ||
    metrics.transactionCount !== 0
  );
}
