import type {
  InvoiceStatus,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import {
  addDaysToDateValue,
} from "@/lib/business-time";
import {
  buildBusinessPeriods,
  calculateAllStoresKpis,
  getCurrentBusinessDateValue,
  moneyToCents,
  normalizeRange,
  sumKpis,
  validateCustomRange,
  type AllStoresKpi,
  type AllStoresRange,
  type PeriodPair,
} from "@/lib/business-groups/all-stores-kpi";
import {
  resolveAuthorizedGroupReportingScope,
  type AuthorizedGroupReportingContext,
} from "@/lib/business-groups/all-stores-access";
import { prisma } from "@/lib/prisma";

export const GROUP_REPORT_PAGE_SIZE = 25;
export const GROUP_REPORT_EXPORT_LIMIT = 5_000;
export const GROUP_REPORT_PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "DUITNOW",
  "EWALLET",
  "BANK_TRANSFER",
] as const satisfies readonly PaymentMethod[];
export const GROUP_REPORT_INVOICE_STATUSES = [
  "PAID",
  "PARTIAL",
  "UNPAID",
  "REFUNDED",
  "VOID",
] as const satisfies readonly InvoiceStatus[];

export type GroupReportPaymentMethod =
  (typeof GROUP_REPORT_PAYMENT_METHODS)[number];
export type GroupReportInvoiceStatus =
  (typeof GROUP_REPORT_INVOICE_STATUSES)[number];

export type GroupReportFilters = {
  range: AllStoresRange;
  from: string | null;
  to: string | null;
  storeId: string | null;
  paymentMethod: GroupReportPaymentMethod | null;
  status: GroupReportInvoiceStatus | null;
  page: number;
};

export type GroupReportInvoiceRow = {
  id: string;
  invoiceNumber: string;
  businessId: string;
  businessName: string;
  businessDate: string;
  issuedAt: Date;
  timezone: string;
  customerName: string | null;
  grossAmountCents: number;
  discountCents: number;
  tipCents: number;
  packageRedemptionCents: number;
  netInvoiceAmountCents: number;
  paidAmountCents: number;
  refundAmountCents: number;
  balanceCents: number;
  paymentStatus: InvoiceStatus;
  invoiceStatus: InvoiceStatus;
  paymentMethods: GroupReportPaymentMethod[];
};

export type GroupReportTrendPoint = AllStoresKpi & {
  businessDate: string;
};

export type GroupReportBusinessPerformance = {
  rank: number;
  businessId: string;
  businessName: string;
  industryType: AuthorizedGroupReportingContext["businesses"][number]["industryType"];
  metrics: AllStoresKpi;
};

export type GroupReportCatalogRanking = {
  name: string;
  quantity: number;
  salesCents: number;
  storeCount: number;
};

export type GroupReportsResult = {
  groupId: string;
  groupName: string;
  role: AuthorizedGroupReportingContext["role"];
  authorizedBusinesses: AuthorizedGroupReportingContext["businesses"];
  filters: GroupReportFilters;
  summary: AllStoresKpi;
  trend: GroupReportTrendPoint[];
  businessPerformance: GroupReportBusinessPerformance[];
  catalogRankings: {
    services: GroupReportCatalogRanking[];
    products: GroupReportCatalogRanking[];
    packages: GroupReportCatalogRanking[];
  };
  rows: GroupReportInvoiceRow[];
  totalRows: number;
  totalPages: number;
};

type GroupReportsDatabase = Pick<
  Prisma.TransactionClient,
  "invoice" | "payment" | "paymentRefund"
>;

type ResolveScope = typeof resolveAuthorizedGroupReportingScope;

type GroupReportsDependencies = {
  now?: Date;
  pageSize?: number;
  resolveScope?: ResolveScope;
};

export type GroupReportsInput = {
  userId: string;
  groupId: string;
  activeBusinessId: string;
  range?: string;
  from?: string;
  to?: string;
  store?: string;
  paymentMethod?: string;
  status?: string;
  page?: string;
};

const optionalUuid = z.string().uuid();

export class GroupReportsInputError extends Error {}
export class GroupReportsExportLimitError extends Error {}

export async function getGroupReports(
  input: GroupReportsInput,
  database: GroupReportsDatabase = prisma,
  dependencies: GroupReportsDependencies = {},
): Promise<GroupReportsResult | null> {
  const resolveScope =
    dependencies.resolveScope ?? resolveAuthorizedGroupReportingScope;
  const scope = await resolveScope(
    input.userId,
    input.groupId,
    input.activeBusinessId,
  );
  if (!scope?.canViewAllStores) return null;

  const filters = parseGroupReportFilters(input, scope);
  const pageSize = dependencies.pageSize ?? GROUP_REPORT_PAGE_SIZE;
  const businesses = filters.storeId
    ? scope.businesses.filter((business) => business.id === filters.storeId)
    : scope.businesses;
  const now = dependencies.now ?? new Date();
  const periods = new Map(
    businesses.map((business) => [
      business.id,
      buildBusinessPeriods({
        range: filters.range,
        from: filters.from,
        to: filters.to,
        now,
        timezone: business.timezone,
        businessDayCutoffTime: business.businessDayCutoffTime,
      }),
    ]),
  );
  const currentRanges = businesses.map((business) => {
    const period = periods.get(business.id)!;
    return {
      businessId: business.id,
      gte: period.current.fromDate,
      lt: period.current.toDateExclusive,
    };
  });

  const invoiceSummaryWhere = buildSummaryInvoiceWhere(
    currentRanges,
    filters,
  );
  const paymentWhere = buildPaymentWhere(currentRanges, filters);
  const refundWhere = buildRefundWhere(currentRanges, filters);
  const detailWhere = buildDetailInvoiceWhere(currentRanges, filters);

  const [summaryInvoices, summaryPayments, summaryRefunds, totalRows, invoices] =
    await Promise.all([
      database.invoice.findMany({
        where: invoiceSummaryWhere,
        select: {
          businessId: true,
          discountAmount: true,
          id: true,
          issuedAt: true,
          loyaltyDiscountAmount: true,
          payments: {
            where: { method: "PACKAGE", status: "ACTIVE" },
            select: { amount: true },
          },
          items: {
            select: {
              businessId: true,
              customerPackageId: true,
              lineTotal: true,
              name: true,
              productId: true,
              quantity: true,
              serviceId: true,
            },
          },
          tipAmount: true,
          total: true,
        },
      }),
      database.payment.findMany({
        where: paymentWhere,
        select: { amount: true, businessId: true, paidAt: true },
      }),
      database.paymentRefund.findMany({
        where: refundWhere,
        select: { amount: true, businessId: true, refundedAt: true },
      }),
      database.invoice.count({ where: detailWhere }),
      database.invoice.findMany({
        where: detailWhere,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          businessId: true,
          invoiceNumber: true,
          issuedAt: true,
          total: true,
          discountAmount: true,
          loyaltyDiscountAmount: true,
          tipAmount: true,
          balance: true,
          status: true,
          customer: { select: { name: true } },
          payments: {
            where: { status: "ACTIVE" },
            select: {
              amount: true,
              method: true,
              paidAt: true,
            },
          },
          refunds: {
            select: {
              amount: true,
              method: true,
              refundedAt: true,
            },
          },
        },
      }),
    ]);

  const calculated = calculateAllStoresKpis({
    businessIds: businesses.map((business) => business.id),
    periods,
    invoices: summaryInvoices,
    payments: summaryPayments,
    refunds: summaryRefunds,
  });
  const summary = sumKpis(
    businesses.map((business) => calculated.get(business.id)!.current),
  );
  const trend = buildGroupReportTrend({
    businesses,
    periods,
    invoices: summaryInvoices,
    payments: summaryPayments,
    refunds: summaryRefunds,
  });
  const businessPerformance = businesses
    .map((business) => ({
      rank: 0,
      businessId: business.id,
      businessName: business.name,
      industryType: business.industryType,
      metrics: calculated.get(business.id)!.current,
    }))
    .sort(
      (left, right) =>
        right.metrics.netSalesCents - left.metrics.netSalesCents ||
        right.metrics.grossSalesCents - left.metrics.grossSalesCents ||
        left.businessName.localeCompare(right.businessName) ||
        left.businessId.localeCompare(right.businessId),
    )
    .map((business, index) => ({ ...business, rank: index + 1 }));
  const catalogRankings = buildGroupCatalogRankings(
    summaryInvoices.flatMap((invoice) => invoice.items),
  );
  const businessById = new Map(
    businesses.map((business) => [business.id, business]),
  );

  return {
    groupId: scope.groupId,
    groupName: scope.groupName,
    role: scope.role,
    authorizedBusinesses: scope.businesses,
    filters,
    summary,
    trend,
    businessPerformance,
    catalogRankings,
    rows: invoices.map((invoice) =>
      toGroupReportInvoiceRow(
        invoice,
        businessById.get(invoice.businessId)!,
        periods.get(invoice.businessId)!,
        filters.paymentMethod,
      ),
    ),
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
  };
}

export async function getGroupReportExportData(
  input: GroupReportsInput,
  database: GroupReportsDatabase = prisma,
  dependencies: GroupReportsDependencies = {},
) {
  const report = await getGroupReports(
    { ...input, page: "1" },
    database,
    {
      ...dependencies,
      pageSize: GROUP_REPORT_EXPORT_LIMIT + 1,
    },
  );
  if (report && report.totalRows > GROUP_REPORT_EXPORT_LIMIT) {
    throw new GroupReportsExportLimitError(
      `Export is limited to ${GROUP_REPORT_EXPORT_LIMIT.toLocaleString("en-MY")} transactions. Narrow the filters and try again.`,
    );
  }
  return report;
}

type TrendInvoiceRow = {
  businessId: string;
  discountAmount: unknown;
  issuedAt: Date;
  loyaltyDiscountAmount: unknown;
  payments: Array<{ amount: unknown }>;
  tipAmount: unknown;
  total: unknown;
};

type CatalogRankingRow = {
  businessId: string;
  customerPackageId: string | null;
  lineTotal: unknown;
  name: string;
  productId: string | null;
  quantity: number;
  serviceId: string | null;
};

type TrendPaymentRow = {
  amount: unknown;
  businessId: string;
  paidAt: Date;
};

type TrendRefundRow = {
  amount: unknown;
  businessId: string;
  refundedAt: Date;
};

export function buildGroupReportTrend(input: {
  businesses: AuthorizedGroupReportingContext["businesses"];
  periods: Map<string, PeriodPair>;
  invoices: TrendInvoiceRow[];
  payments: TrendPaymentRow[];
  refunds: TrendRefundRow[];
}): GroupReportTrendPoint[] {
  const dateValues = new Set<string>();
  for (const business of input.businesses) {
    const range = input.periods.get(business.id)?.current;
    if (!range) continue;
    for (let index = 0; index < range.dayCount; index += 1) {
      dateValues.add(addDaysToDateValue(range.fromDateValue, index));
    }
  }
  const points = new Map(
    [...dateValues]
      .sort()
      .map((businessDate) => [businessDate, emptyTrendPoint(businessDate)]),
  );
  const businessById = new Map(
    input.businesses.map((business) => [business.id, business]),
  );

  for (const invoice of input.invoices) {
    const business = businessById.get(invoice.businessId);
    const period = input.periods.get(invoice.businessId);
    if (!business || !period || !inCurrentPeriod(invoice.issuedAt, period)) {
      continue;
    }
    const point = points.get(
      getCurrentBusinessDateValue(
        invoice.issuedAt,
        business.timezone,
        business.businessDayCutoffTime,
      ),
    );
    if (!point) continue;
    const packageRedemptionCents = invoice.payments.reduce(
      (sum, payment) => sum + moneyToCents(payment.amount),
      0,
    );
    const discountCents =
      moneyToCents(invoice.discountAmount) +
      moneyToCents(invoice.loyaltyDiscountAmount);
    const discountedSalesCents =
      moneyToCents(invoice.total) -
      moneyToCents(invoice.tipAmount) -
      packageRedemptionCents;
    point.grossSalesCents += discountedSalesCents + discountCents;
    point.netSalesCents += discountedSalesCents;
    point.transactionCount += 1;
  }

  for (const payment of input.payments) {
    addEventToTrend(
      points,
      businessById,
      input.periods,
      payment.businessId,
      payment.paidAt,
      (point) => {
        point.paymentsCollectedCents += moneyToCents(payment.amount);
      },
    );
  }

  for (const refund of input.refunds) {
    addEventToTrend(
      points,
      businessById,
      input.periods,
      refund.businessId,
      refund.refundedAt,
      (point) => {
        const amount = moneyToCents(refund.amount);
        point.refundsCents += amount;
        point.netSalesCents -= amount;
      },
    );
  }

  return [...points.values()].map((point) => ({
    ...point,
    averageTransactionValueCents: point.transactionCount
      ? Math.round(point.netSalesCents / point.transactionCount)
      : null,
  }));
}

function addEventToTrend(
  points: Map<string, GroupReportTrendPoint>,
  businessById: Map<
    string,
    AuthorizedGroupReportingContext["businesses"][number]
  >,
  periods: Map<string, PeriodPair>,
  businessId: string,
  occurredAt: Date,
  apply: (point: GroupReportTrendPoint) => void,
) {
  const business = businessById.get(businessId);
  const period = periods.get(businessId);
  if (!business || !period || !inCurrentPeriod(occurredAt, period)) return;
  const point = points.get(
    getCurrentBusinessDateValue(
      occurredAt,
      business.timezone,
      business.businessDayCutoffTime,
    ),
  );
  if (point) apply(point);
}

function emptyTrendPoint(businessDate: string): GroupReportTrendPoint {
  return {
    businessDate,
    grossSalesCents: 0,
    netSalesCents: 0,
    paymentsCollectedCents: 0,
    refundsCents: 0,
    transactionCount: 0,
    averageTransactionValueCents: null,
  };
}

export function buildGroupCatalogRankings(
  items: CatalogRankingRow[],
  limit = 10,
) {
  const rankings = {
    services: new Map<string, GroupReportCatalogRanking & { stores: Set<string> }>(),
    products: new Map<string, GroupReportCatalogRanking & { stores: Set<string> }>(),
    packages: new Map<string, GroupReportCatalogRanking & { stores: Set<string> }>(),
  };

  for (const item of items) {
    const bucket = item.customerPackageId
      ? rankings.packages
      : item.productId
        ? rankings.products
        : item.serviceId
          ? rankings.services
          : null;
    const name = item.name.trim();
    if (!bucket || !name || item.quantity <= 0) continue;
    const key = name.toLocaleLowerCase("en");
    const existing = bucket.get(key) ?? {
      name,
      quantity: 0,
      salesCents: 0,
      storeCount: 0,
      stores: new Set<string>(),
    };
    existing.quantity += item.quantity;
    existing.salesCents += moneyToCents(item.lineTotal);
    existing.stores.add(item.businessId);
    existing.storeCount = existing.stores.size;
    bucket.set(key, existing);
  }

  return {
    services: finalizeCatalogRanking(rankings.services, limit),
    products: finalizeCatalogRanking(rankings.products, limit),
    packages: finalizeCatalogRanking(rankings.packages, limit),
  };
}

function finalizeCatalogRanking(
  ranking: Map<
    string,
    GroupReportCatalogRanking & { stores: Set<string> }
  >,
  limit: number,
) {
  return [...ranking.values()]
    .sort(
      (left, right) =>
        right.salesCents - left.salesCents ||
        right.quantity - left.quantity ||
        left.name.localeCompare(right.name),
    )
    .slice(0, limit)
    .map((item) => ({
      name: item.name,
      quantity: item.quantity,
      salesCents: item.salesCents,
      storeCount: item.storeCount,
    }));
}

export function parseGroupReportFilters(
  input: Omit<GroupReportsInput, "userId" | "groupId" | "activeBusinessId">,
  scope: AuthorizedGroupReportingContext,
): GroupReportFilters {
  const range = normalizeRange(input.range);
  const customRange = validateCustomRange(range, input.from, input.to);
  const storeValue = input.store?.trim();
  let storeId: string | null = null;
  if (storeValue && storeValue !== "all") {
    if (
      !optionalUuid.safeParse(storeValue).success ||
      !scope.businesses.some((business) => business.id === storeValue)
    ) {
      throw new GroupReportsInputError("Select an authorized store.");
    }
    storeId = storeValue;
  }

  const paymentMethod = normalizeEnumFilter(
    input.paymentMethod,
    GROUP_REPORT_PAYMENT_METHODS,
    "payment method",
  );
  const status = normalizeEnumFilter(
    input.status,
    GROUP_REPORT_INVOICE_STATUSES,
    "transaction status",
  );
  const pageValue = input.page?.trim() || "1";
  if (!/^[1-9]\d*$/.test(pageValue)) {
    throw new GroupReportsInputError("Select a valid report page.");
  }
  const page = Number.parseInt(pageValue, 10);
  if (!Number.isSafeInteger(page)) {
    throw new GroupReportsInputError("Select a valid report page.");
  }

  return {
    range,
    from: customRange?.from ?? null,
    to: customRange?.to ?? null,
    storeId,
    paymentMethod,
    status,
    page,
  };
}

type CurrentRange = { businessId: string; gte: Date; lt: Date };

function buildSummaryInvoiceWhere(
  ranges: CurrentRange[],
  filters: GroupReportFilters,
): Prisma.InvoiceWhereInput {
  return {
    AND: [
      { status: { not: "VOID" } },
      ...(filters.status ? [{ status: filters.status }] : []),
      {
        OR: ranges.map(({ businessId, gte, lt }) => ({
          businessId,
          issuedAt: { gte, lt },
          ...(filters.paymentMethod
            ? {
                OR: [
                  {
                    payments: {
                      some: {
                        method: filters.paymentMethod,
                        status: "ACTIVE",
                        paidAt: { gte, lt },
                      },
                    },
                  },
                  {
                    refunds: {
                      some: {
                        method: filters.paymentMethod,
                        refundedAt: { gte, lt },
                      },
                    },
                  },
                ],
              }
            : {}),
        })),
      },
    ],
  };
}

function buildPaymentWhere(
  ranges: CurrentRange[],
  filters: GroupReportFilters,
): Prisma.PaymentWhereInput {
  if (filters.status === "VOID") {
    return { id: { in: [] } };
  }
  return {
    status: "ACTIVE",
    method: filters.paymentMethod ?? { not: "PACKAGE" },
    AND: [
      {
        OR: ranges.map(({ businessId, gte, lt }) => ({
          businessId,
          paidAt: { gte, lt },
        })),
      },
      filters.status
        ? { invoice: { status: filters.status } }
        : {
            OR: [
              { invoiceId: null },
              { invoice: { status: { not: "VOID" } } },
            ],
          },
    ],
  };
}

function buildRefundWhere(
  ranges: CurrentRange[],
  filters: GroupReportFilters,
): Prisma.PaymentRefundWhereInput {
  if (filters.status === "VOID") {
    return { id: { in: [] } };
  }
  return {
    method: filters.paymentMethod ?? { not: "PACKAGE" },
    AND: [
      {
        OR: ranges.map(({ businessId, gte, lt }) => ({
          businessId,
          refundedAt: { gte, lt },
        })),
      },
      filters.status
        ? { invoice: { status: filters.status } }
        : {
            OR: [
              { invoiceId: null },
              { invoice: { status: { not: "VOID" } } },
            ],
          },
    ],
  };
}

function buildDetailInvoiceWhere(
  ranges: CurrentRange[],
  filters: GroupReportFilters,
): Prisma.InvoiceWhereInput {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    OR: ranges.map(({ businessId, gte, lt }) => ({
      businessId,
      OR: filters.paymentMethod
        ? [
            {
              payments: {
                some: {
                  method: filters.paymentMethod,
                  status: "ACTIVE",
                  paidAt: { gte, lt },
                },
              },
            },
            {
              refunds: {
                some: {
                  method: filters.paymentMethod,
                  refundedAt: { gte, lt },
                },
              },
            },
          ]
        : [
            { issuedAt: { gte, lt } },
            {
              payments: {
                some: {
                  method: { not: "PACKAGE" },
                  status: "ACTIVE",
                  paidAt: { gte, lt },
                },
              },
            },
            {
              refunds: {
                some: {
                  method: { not: "PACKAGE" },
                  refundedAt: { gte, lt },
                },
              },
            },
          ],
    })),
  };
}

type DetailInvoice = Prisma.InvoiceGetPayload<{
  select: {
    id: true;
    businessId: true;
    invoiceNumber: true;
    issuedAt: true;
    total: true;
    discountAmount: true;
    loyaltyDiscountAmount: true;
    tipAmount: true;
    balance: true;
    status: true;
    customer: { select: { name: true } };
    payments: {
      select: { amount: true; method: true; paidAt: true };
    };
    refunds: {
      select: { amount: true; method: true; refundedAt: true };
    };
  };
}>;

function toGroupReportInvoiceRow(
  invoice: DetailInvoice,
  business: AuthorizedGroupReportingContext["businesses"][number],
  periods: PeriodPair,
  paymentMethod: GroupReportPaymentMethod | null,
): GroupReportInvoiceRow {
  const packageRedemptionCents = invoice.payments
    .filter((payment) => payment.method === "PACKAGE")
    .reduce((sum, payment) => sum + moneyToCents(payment.amount), 0);
  const periodPayments = invoice.payments.filter(
    (payment) =>
      payment.method !== "PACKAGE" &&
      (!paymentMethod || payment.method === paymentMethod) &&
      inCurrentPeriod(payment.paidAt, periods),
  );
  const periodRefunds = invoice.refunds.filter(
    (refund) =>
      refund.method !== "PACKAGE" &&
      (!paymentMethod || refund.method === paymentMethod) &&
      inCurrentPeriod(refund.refundedAt, periods),
  );
  const discountCents =
    moneyToCents(invoice.discountAmount) +
    moneyToCents(invoice.loyaltyDiscountAmount);
  const netInvoiceAmountCents =
    moneyToCents(invoice.total) -
    moneyToCents(invoice.tipAmount) -
    packageRedemptionCents;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    businessId: invoice.businessId,
    businessName: business.name,
    businessDate: getCurrentBusinessDateValue(
      invoice.issuedAt,
      business.timezone,
      business.businessDayCutoffTime,
    ),
    issuedAt: invoice.issuedAt,
    timezone: business.timezone,
    customerName: invoice.customer?.name ?? null,
    grossAmountCents: netInvoiceAmountCents + discountCents,
    discountCents,
    tipCents: moneyToCents(invoice.tipAmount),
    packageRedemptionCents,
    netInvoiceAmountCents,
    paidAmountCents: periodPayments.reduce(
      (sum, payment) => sum + moneyToCents(payment.amount),
      0,
    ),
    refundAmountCents: periodRefunds.reduce(
      (sum, refund) => sum + moneyToCents(refund.amount),
      0,
    ),
    balanceCents: moneyToCents(invoice.balance),
    paymentStatus: invoice.status,
    invoiceStatus: invoice.status,
    paymentMethods: [
      ...new Set(
        periodPayments.map(
          (payment) => payment.method as GroupReportPaymentMethod,
        ),
      ),
    ],
  };
}

function normalizeEnumFilter<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  label: string,
): T[number] | null {
  if (!value || value === "all") return null;
  const normalized = value.trim().toUpperCase();
  if (!allowed.includes(normalized as T[number])) {
    throw new GroupReportsInputError(`Select a valid ${label}.`);
  }
  return normalized as T[number];
}

function inCurrentPeriod(value: Date, periods: PeriodPair) {
  return (
    value >= periods.current.fromDate &&
    value < periods.current.toDateExclusive
  );
}
