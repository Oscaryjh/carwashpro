import type { Prisma } from "@prisma/client";
import { getBusinessDayRange, getBusinessDayRangeWithPrevious, getCurrentBusinessDateValue } from "@/lib/business-day";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
  isValidDateValue,
  startOfBusinessMonth,
} from "@/lib/business-time";
import { calculateFinancialMetrics } from "@/lib/financial-metrics";
import { getExpenseDashboard } from "@/lib/expense/service";
import { reconcileExpenseSources } from "@/lib/expense/source-integration";
import { getAccountsPayableOverview, reconcileAccountsPayable } from "@/lib/inventory/supplier-ap-service";
import { reconcileInventory } from "@/lib/inventory/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import type { ModuleKey } from "@/lib/modules/registry";
import { prisma } from "@/lib/prisma";

export type PerformanceRange = "today" | "yesterday" | "this_week" | "last_week" | "month" | "last_month" | "custom";

export type PerformanceReadModel = Awaited<ReturnType<typeof getBusinessPerformanceReadModel>>;

type ReadDatabase = Pick<Prisma.TransactionClient,
  "business" | "branch" | "invoice" | "payment" | "paymentRefund" | "invoiceItem" |
  "product" | "productStock" | "businessExpense" | "expenseSourceSettlement" |
  "supplierBill" | "employeeClaim" | "payrollRun" | "businessModuleEntitlement">;
type SalesInvoiceRow = { branchId: string | null; issuedAt: Date; total: unknown; tipAmount: unknown; discountAmount: unknown; loyaltyDiscountAmount: unknown; payments: Array<{ amount: unknown }> };
type SalesPaymentRow = { amount: unknown; branchId: string | null; paidAt: Date };
type SalesRefundRow = { amount: unknown; branchId: string | null; refundedAt: Date };
type TopLineRow = { name: string; serviceId: string | null; productId: string | null; _sum: { lineTotal: unknown; quantity: number | null } };

export async function getBusinessPerformanceReadModel(input: {
  businessId: string;
  allowedBranchIds: readonly string[];
  includeBusinessWide: boolean;
  selectedBranchId?: string | null;
  range?: string;
  from?: string;
  to?: string;
  now?: Date;
}, database: ReadDatabase = prisma) {
  const business = await database.business.findUniqueOrThrow({
    where: { id: input.businessId },
    select: { id: true, name: true, timezone: true, businessDayCutoffTime: true, industryType: true },
  });
  const modules = await loadBusinessModuleContext(input.businessId, { database: database as never, now: input.now });
  const enabled = modules.enabledModules;
  const selectedBranchId = input.selectedBranchId && input.allowedBranchIds.includes(input.selectedBranchId)
    ? input.selectedBranchId
    : null;
  const branchIds = selectedBranchId ? [selectedBranchId] : [...new Set(input.allowedBranchIds)];
  const branches = await database.branch.findMany({
    where: { businessId: input.businessId, id: { in: branchIds }, status: "ACTIVE" },
    orderBy: { name: "asc" }, select: { id: true, name: true },
  });
  const periods = resolvePerformancePeriods({
    range: input.range, from: input.from, to: input.to, now: input.now ?? new Date(),
    timezone: business.timezone, businessDayCutoffTime: business.businessDayCutoffTime,
  });
  const branchFilter = { branchId: { in: branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"] } };
  const completeWindow = { gte: periods.previous.fromDate, lt: periods.current.toDateExclusive };
  const [invoices, payments, refunds] = enabled.has("POS") ? await Promise.all([
    database.invoice.findMany({ where: { businessId: input.businessId, ...branchFilter, status: { not: "VOID" }, issuedAt: completeWindow },
      select: { id: true, branchId: true, issuedAt: true, total: true, tipAmount: true, discountAmount: true, loyaltyDiscountAmount: true,
        payments: { where: { method: "PACKAGE", status: "ACTIVE" }, select: { amount: true } } } }),
    database.payment.findMany({ where: { businessId: input.businessId, ...branchFilter, status: "ACTIVE", method: { not: "PACKAGE" }, paidAt: completeWindow,
      OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }] }, select: { amount: true, branchId: true, paidAt: true } }),
    database.paymentRefund.findMany({ where: { businessId: input.businessId, ...branchFilter, method: { not: "PACKAGE" }, refundedAt: completeWindow,
      OR: [{ invoiceId: null }, { invoice: { status: { not: "VOID" } } }] }, select: { amount: true, branchId: true, refundedAt: true } }),
  ]) : [[], [], []];
  const currentSales = salesForPeriod(invoices, payments, refunds, periods.current.fromDate, periods.current.toDateExclusive);
  const previousSales = salesForPeriod(invoices, payments, refunds, periods.previous.fromDate, periods.previous.toDateExclusive);
  const trend = buildSalesTrend(invoices, refunds, periods.current.fromDateValue, periods.current.toDateValue, business.timezone, business.businessDayCutoffTime);

  const expenseScope = { allowedBranchIds: branchIds, includeBusinessWide: input.includeBusinessWide && !selectedBranchId };
  const spending = enabled.has("EXPENSE") ? await getExpenseDashboard({
    businessId: input.businessId, ...expenseScope, branchId: selectedBranchId,
    dateFrom: periods.current.fromDateValue, dateTo: periods.current.toDateValue,
  }, database as never) : null;
  const previousSpending = enabled.has("EXPENSE") ? await getExpenseDashboard({
    businessId: input.businessId, ...expenseScope, branchId: selectedBranchId,
    dateFrom: periods.previous.fromDateValue, dateTo: periods.previous.toDateValue,
  }, database as never) : null;

  const [inventory, accountsPayable, topLines] = await Promise.all([
    enabled.has("INVENTORY") ? inventorySummary(input.businessId, branchIds, database) : null,
    enabled.has("INVENTORY") ? getAccountsPayableOverview({ businessId: input.businessId, allowedBranchIds: branchIds, now: input.now }) : null,
    enabled.has("POS") ? database.invoiceItem.groupBy({ by: ["name", "serviceId", "productId"], where: {
      businessId: input.businessId, invoice: { ...branchFilter, status: { not: "VOID" }, issuedAt: { gte: periods.current.fromDate, lt: periods.current.toDateExclusive } },
    }, _sum: { lineTotal: true, quantity: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: 20 }) : [],
  ]);

  const branchPerformance = branches.map((branch) => {
    const sales = salesForPeriod(invoices.filter((row) => row.branchId === branch.id), payments.filter((row) => row.branchId === branch.id), refunds.filter((row) => row.branchId === branch.id), periods.current.fromDate, periods.current.toDateExclusive);
    const branchSpend = spending?.byBranch.find((row) => row.branchId === branch.id)?.amount ?? (spending ? "0.00" : null);
    return { branchId: branch.id, branchName: branch.name, ...sales, recordedSpending: branchSpend,
      incomeVsSpending: branchSpend === null ? null : centsToMoney(sales.netSalesCents - moneyToCents(branchSpend)) };
  }).sort((a, b) => b.netSalesCents - a.netSalesCents);

  const health = await performanceHealth({ businessId: input.businessId, branchId: selectedBranchId, enabled, branchIds });
  const recordedCents = spending ? moneyToCents(spending.recorded) : null;
  return {
    scope: { businessId: business.id, businessName: business.name, branchIds, selectedBranchId },
    dateRange: { range: periods.range, from: periods.current.fromDateValue, to: periods.current.toDateValue,
      previousFrom: periods.previous.fromDateValue, previousTo: periods.previous.toDateValue,
      timezone: business.timezone, businessDayCutoffTime: business.businessDayCutoffTime },
    sales: enabled.has("POS") ? { ...currentSales, previousNetSalesCents: previousSales.netSalesCents,
      change: comparePeriods(currentSales.netSalesCents, previousSales.netSalesCents), trend } : null,
    businessSpending: spending ? { ...spending, previousRecorded: previousSpending!.recorded,
      incomeVsRecordedSpending: centsToMoney(currentSales.netSalesCents - recordedCents!) } : null,
    inventory,
    accountsPayable: accountsPayable ? { totalOutstanding: accountsPayable.totalOutstanding.toFixed(2), dueSoon: accountsPayable.dueSoon.length,
      overdue: accountsPayable.overdue.length, openBills: accountsPayable.bills.length } : null,
    branchPerformance,
    topServices: topLines.filter((row) => row.serviceId).slice(0, 5).map(lineRow),
    topProducts: topLines.filter((row) => row.productId).slice(0, 5).map(lineRow),
    coverage: {
      sales: enabled.has("POS"), recordedSpending: enabled.has("EXPENSE"), inventory: enabled.has("INVENTORY"),
      accountsPayable: enabled.has("INVENTORY"), accountingProfit: false, cogs: false,
      enabledModules: [...enabled].sort(), unallocatedBusinessWideSpending: spending?.byBranch.find((row) => row.branchId === null)?.amount ?? null,
    },
    reconciliationHealth: health,
  };
}

export function resolvePerformancePeriods(input: { range?: string; from?: string; to?: string; now: Date; timezone: string; businessDayCutoffTime: string }) {
  const today = getCurrentBusinessDateValue(input.now, input.timezone, input.businessDayCutoffTime);
  const range = normalizeRange(input.range);
  let from = today; let to = today;
  if (range === "yesterday") from = to = addDaysToDateValue(today, -1);
  else if (range === "this_week") from = weekStart(today);
  else if (range === "last_week") { to = addDaysToDateValue(weekStart(today), -1); from = addDaysToDateValue(to, -6); }
  else if (range === "month") from = startOfBusinessMonth(today);
  else if (range === "last_month") { to = addDaysToDateValue(startOfBusinessMonth(today), -1); from = startOfBusinessMonth(to); }
  else if (range === "custom" && input.from && input.to && isValidDateValue(input.from) && isValidDateValue(input.to)) { from = input.from; to = input.to; }
  const pair = getBusinessDayRangeWithPrevious({ fromDateValue: from, toDateValue: to, timezone: input.timezone, businessDayCutoffTime: input.businessDayCutoffTime });
  return { range, ...pair };
}

export function comparePeriods(current: number, previous: number) {
  if (previous === 0) return current === 0 ? { kind: "NO_CHANGE" as const } : { kind: "NEW" as const };
  return { kind: "PERCENT" as const, percentage: Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 };
}

function normalizeRange(value?: string): PerformanceRange { return ["yesterday", "this_week", "last_week", "month", "last_month", "custom"].includes(value ?? "") ? value as PerformanceRange : "today"; }
function weekStart(value: string) { const date = dateValueToUtcDate(value); const day = date.getUTCDay(); return addDaysToDateValue(value, day === 0 ? -6 : 1 - day); }
function inPeriod(value: Date, from: Date, to: Date) { return value >= from && value < to; }
function moneyToCents(value: unknown) { return Math.round(Number(value ?? 0) * 100); }
function centsToMoney(value: number) { return (value / 100).toFixed(2); }
function salesForPeriod(invoices: SalesInvoiceRow[], payments: SalesPaymentRow[], refunds: SalesRefundRow[], from: Date, to: Date) {
  const metrics = calculateFinancialMetrics({
    invoices: invoices.filter((row) => inPeriod(row.issuedAt, from, to)).map((row) => ({ totalCents: moneyToCents(row.total), tipCents: moneyToCents(row.tipAmount), discountCents: moneyToCents(row.discountAmount), loyaltyDiscountCents: moneyToCents(row.loyaltyDiscountAmount), packageVoucherCents: row.payments.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0) })),
    payments: payments.filter((row) => inPeriod(row.paidAt, from, to)).map((row) => ({ amountCents: moneyToCents(row.amount), isPackage: false })),
    refunds: refunds.filter((row) => inPeriod(row.refundedAt, from, to)).map((row) => ({ amountCents: moneyToCents(row.amount), isPackage: false })),
  });
  return { grossSalesCents: metrics.grossSalesCents, netSalesCents: metrics.netSalesCents, refundsCents: metrics.refundsCents, transactions: metrics.transactionCount, averageTransactionValueCents: metrics.averageTransactionValueCents ?? 0 };
}
function buildSalesTrend(invoices: SalesInvoiceRow[], refunds: SalesRefundRow[], from: string, to: string, timezone: string, businessDayCutoffTime: string) {
  const points = []; for (let day = from; day <= to; day = addDaysToDateValue(day, 1)) {
    const dayRange = getBusinessDayRange({ fromDateValue: day, toDateValue: day, timezone, businessDayCutoffTime });
    const dayInvoices = invoices.filter((row) => inPeriod(row.issuedAt, dayRange.fromDate, dayRange.toDateExclusive));
    const recognized = dayInvoices.reduce((sum, row) => sum + moneyToCents(row.total) - moneyToCents(row.tipAmount) - row.payments.reduce((paymentSum, payment) => paymentSum + moneyToCents(payment.amount), 0), 0);
    const refunded = refunds.filter((row) => inPeriod(row.refundedAt, dayRange.fromDate, dayRange.toDateExclusive)).reduce((sum, row) => sum + moneyToCents(row.amount), 0);
    points.push({ date: day, netSalesCents: recognized - refunded });
  } return points;
}
function lineRow(row: TopLineRow) { return { name: row.name, quantity: row._sum.quantity ?? 0, sales: Number(row._sum.lineTotal ?? 0).toFixed(2) }; }
async function inventorySummary(businessId: string, branchIds: string[], database: ReadDatabase) {
  const products = await database.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, price: true, stocks: { where: { branchId: { in: branchIds } }, select: { quantity: true, reorderLevel: true } } } });
  const balances = products.flatMap((product) => product.stocks.map((stock) => ({ product, stock })));
  return { trackedProducts: products.length, lowStock: balances.filter(({ stock }) => stock.quantity <= stock.reorderLevel).length,
    outOfStock: balances.filter(({ stock }) => stock.quantity <= 0).length,
    sellingValue: balances.reduce((sum, { product, stock }) => sum + Number(product.price) * stock.quantity, 0).toFixed(2) };
}
async function performanceHealth(input: { businessId: string; branchId: string | null; enabled: ReadonlySet<ModuleKey>; branchIds: string[] }) {
  const [expense, ap, inventory] = await Promise.all([
    input.enabled.has("EXPENSE") ? reconcileExpenseSources({ businessId: input.businessId }) : null,
    input.enabled.has("INVENTORY") ? reconcileAccountsPayable({ businessId: input.businessId, allowedBranchIds: input.branchIds }) : null,
    input.enabled.has("INVENTORY") ? reconcileInventory(input.businessId, input.branchId) : null,
  ]);
  const issues = (expense?.issues.length ?? 0) + (ap?.issues.length ?? 0) + (inventory && !inventory.ok ? 1 : 0);
  return { status: issues ? "NEEDS_REVIEW" as const : "HEALTHY" as const, issues,
    domains: { sales: "CANONICAL", expense: expense ? (expense.healthy ? "MATCH" : "ISSUES") : "NOT_INCLUDED", ap: ap ? ap.status : "NOT_INCLUDED", inventory: inventory ? (inventory.ok ? "MATCH" : "ISSUES") : "NOT_INCLUDED" } };
}

export async function getAuthorizedGroupSpending(input: { businessIds: readonly string[]; from: string; to: string }, database: ReadDatabase = prisma) {
  const rows = await Promise.all([...new Set(input.businessIds)].map(async (businessId) => {
    const modules = await loadBusinessModuleContext(businessId, { database: database as never });
    if (!modules.enabledModules.has("EXPENSE")) return { businessId, available: false as const, recorded: null };
    const branches = await database.branch.findMany({ where: { businessId, status: "ACTIVE" }, select: { id: true } });
    const dashboard = await getExpenseDashboard({ businessId, allowedBranchIds: branches.map((b) => b.id), includeBusinessWide: true, dateFrom: input.from, dateTo: input.to }, database as never);
    return { businessId, available: true as const, recorded: dashboard.recorded };
  }));
  return { rows, knownTotal: rows.filter((r) => r.available).reduce((sum, r) => sum + Number(r.recorded), 0).toFixed(2), completeCoverage: rows.every((r) => r.available) };
}

export async function getAuthorizedGroupPerformanceSpending(input: {
  businesses: readonly { businessId: string; from: string; to: string }[];
}, database: ReadDatabase = prisma) {
  const unique = [...new Map(input.businesses.map((row) => [row.businessId, row])).values()];
  const rows = await Promise.all(unique.map(async (item) => {
    const modules = await loadBusinessModuleContext(item.businessId, { database: database as never });
    if (!modules.enabledModules.has("EXPENSE")) return { ...item, available: false as const, recorded: null };
    const branches = await database.branch.findMany({ where: { businessId: item.businessId, status: "ACTIVE" }, select: { id: true } });
    const dashboard = await getExpenseDashboard({ businessId: item.businessId, allowedBranchIds: branches.map((branch) => branch.id), includeBusinessWide: true, dateFrom: item.from, dateTo: item.to }, database as never);
    return { ...item, available: true as const, recorded: dashboard.recorded };
  }));
  return { rows, knownTotal: rows.filter((row) => row.available).reduce((sum, row) => sum + Number(row.recorded), 0).toFixed(2), completeCoverage: rows.every((row) => row.available) };
}
