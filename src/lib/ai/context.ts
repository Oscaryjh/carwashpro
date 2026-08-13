import { createHash } from "node:crypto";
import type { PerformanceReadModel } from "@/lib/business-performance/read-model";
import { AI_CONTEXT_VERSION, type AllowedAiMetricKey } from "./schema";

type Metric = { metricKey: AllowedAiMetricKey; value: string | number; available: boolean };

export function buildBusinessAiContext(model: PerformanceReadModel) {
  const spending = model.businessSpending;
  const source = (key: string) => spending?.bySource.find((row) => row.sourceType === key)?.amount ?? null;
  const metrics: Metric[] = [
    metric("NET_SALES", model.sales ? cents(model.sales.netSalesCents) : null),
    metric("GROSS_SALES", model.sales ? cents(model.sales.grossSalesCents) : null),
    metric("REFUNDS", model.sales ? cents(model.sales.refundsCents) : null),
    metric("TRANSACTIONS", model.sales?.transactions ?? null),
    metric("AVERAGE_TRANSACTION", model.sales ? cents(model.sales.averageTransactionValueCents) : null),
    metric("PREVIOUS_NET_SALES", model.sales ? cents(model.sales.previousNetSalesCents) : null),
    metric("RECORDED_BUSINESS_SPENDING", spending?.recorded ?? null),
    metric("INCOME_VS_RECORDED_SPENDING", spending?.incomeVsRecordedSpending ?? null),
    metric("MANUAL_SPENDING", source("MANUAL")),
    metric("CLAIM_SPENDING", source("CLAIM")),
    metric("PAYROLL_SPENDING", source("PAYROLL")),
    metric("INVENTORY_PURCHASE_SPENDING", source("INVENTORY_PURCHASE")),
    metric("TRACKED_PRODUCTS", model.inventory?.trackedProducts ?? null),
    metric("LOW_STOCK_COUNT", model.inventory?.lowStock ?? null),
    metric("OUT_OF_STOCK_COUNT", model.inventory?.outOfStock ?? null),
    metric("INVENTORY_SELLING_VALUE", model.inventory?.sellingValue ?? null),
    metric("OUTSTANDING_AP", model.accountsPayable?.totalOutstanding ?? null),
    metric("AP_DUE_SOON", model.accountsPayable?.dueSoon ?? null),
    metric("AP_OVERDUE", model.accountsPayable?.overdue ?? null),
    metric("AP_OPEN_BILLS", model.accountsPayable?.openBills ?? null),
  ];
  const context = {
    version: AI_CONTEXT_VERSION,
    scope: {
      type: "BUSINESS" as const,
      name: model.scope.businessName,
      branch: model.scope.selectedBranchId ? "Selected authorised branch" : "All authorised branches",
      authorisedBranchCount: model.scope.branchIds.length,
    },
    period: model.dateRange,
    metrics,
    salesTrend: model.sales?.trend.slice(-31) ?? null,
    branchPerformance: model.branchPerformance.slice(0, 10).map((row) => ({
      name: row.branchName,
      netSales: cents(row.netSalesCents),
      transactions: row.transactions,
      averageTransaction: cents(row.averageTransactionValueCents),
      recordedSpending: row.recordedSpending,
    })),
    topServices: model.topServices.slice(0, 10),
    topProducts: model.topProducts.slice(0, 10),
    coverage: model.coverage,
    reconciliationHealth: model.reconciliationHealth,
    accountingBoundaries: {
      accountingProfitAvailable: false,
      cogsAvailable: false,
      inventoryPurchasesAreCogs: false,
      incomeVsRecordedSpendingIsNetProfit: false,
    },
  };
  return withDigest(context);
}

export function buildGroupAiContext(input: {
  groupName: string;
  businesses: Array<{ name: string; context: ReturnType<typeof buildBusinessAiContext> }>;
}) {
  const context = {
    version: AI_CONTEXT_VERSION,
    scope: { type: "GROUP" as const, name: input.groupName, authorisedBusinessCount: input.businesses.length },
    businesses: input.businesses.map((item) => ({ name: item.name, ...item.context.payload })),
    coverage: {
      missingDataIsZero: false,
      completeAcrossBusinesses: input.businesses.every((item) =>
        item.context.payload.coverage.sales && item.context.payload.coverage.recordedSpending,
      ),
    },
    accountingBoundaries: {
      accountingProfitAvailable: false,
      cogsAvailable: false,
      inventoryPurchasesAreCogs: false,
      incomeVsRecordedSpendingIsNetProfit: false,
    },
  };
  return withDigest(context);
}

function metric(metricKey: AllowedAiMetricKey, value: string | number | null): Metric {
  return { metricKey, value: value ?? "NOT_AVAILABLE", available: value !== null };
}

function cents(value: number) { return (value / 100).toFixed(2); }

function withDigest<T>(payload: T) {
  const normalized = JSON.stringify(payload);
  return {
    payload,
    digest: createHash("sha256").update(normalized).digest("hex"),
    approximateInputTokens: Math.ceil(normalized.length / 4),
  };
}
