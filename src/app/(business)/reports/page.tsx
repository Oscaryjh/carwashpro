import Link from "next/link";
import { redirect } from "next/navigation";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { ReportDrawerShell } from "@/components/report-drawer-shell";
import {
  ReportFilterPanel,
  type ReportFilterRange,
} from "@/components/report-filter-panel";
import {
  assertStaffPermission,
  hasStaffPermission,
} from "@/lib/auth/staff-permissions";
import { branchWhere, getActiveBranches } from "@/lib/branches";
import {
  getBusinessDayRange,
  getCurrentBusinessDateValue,
} from "@/lib/business-day";
import {
  addDaysToDateValue,
  formatDateValue,
  startOfBusinessMonth,
} from "@/lib/business-time";
import { getExpenseDashboard } from "@/lib/expense/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import {
  getDailySalesReport,
  resolveReportBranchScope,
  type DailySalesReport,
} from "@/lib/reports/daily-sales";
import {
  formatPaymentShare,
  formatReportMoney as money,
  getVisibleDailySalesDays,
  normalizeReportDateRange,
} from "@/lib/reports/presentation";
import { requireBusinessContext } from "@/lib/tenant";
import { fromCents, toCents } from "@/lib/validation/pos";

type ReportsPageProps = {
  searchParams: Promise<{
    branchId?: string;
    range?: string;
    from?: string;
    to?: string;
    day?: string;
    paymentMethod?: string;
    showEmpty?: string;
  }>;
};

type ReportRange = ReportFilterRange;

const NO_BRANCH_ACCESS_ID = "00000000-0000-0000-0000-000000000000";

const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  BANK_TRANSFER: "Bank transfer",
  FOREIGN_CURRENCY: "Foreign currency",
  CRYPTO: "Crypto asset",
  PACKAGE: "Package use",
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const context = await requireBusinessContext({ capability: "VIEW_REPORTS" });
  if (context.access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(context.user, "REPORTS");
  }

  if (!context.businessId) {
    throw new Error("Business context is required.");
  }

  const businessId = context.businessId;
  const params = await searchParams;
  const [business, branches] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId } }),
    getActiveBranches(businessId),
  ]);
  if (!business) {
    return (
      <section className="content">
        <div className="panel">
          <h1>Business not found, please login again</h1>
          <Link href="/login">Back to login</Link>
        </div>
      </section>
    );
  }

  const selectedRange = getReportRange(params.range);
  const showEmptyDays = params.showEmpty === "1";
  const currentBusinessDateValue = getCurrentBusinessDateValue(
    new Date(),
    business.timezone,
    business.businessDayCutoffTime,
  );
  const { defaultFrom, defaultTo } = getDefaultDateRange(
    selectedRange === "custom" ? "today" : selectedRange,
    currentBusinessDateValue,
  );
  const hasCustomDates = isDateInput(params.from) || isDateInput(params.to);
  const activeRange: ReportRange =
    selectedRange === "custom" || hasCustomDates ? "custom" : selectedRange;
  const requestedFromValue = getDateInput(params.from, defaultFrom);
  const requestedToValue = getDateInput(params.to, defaultTo);
  const { fromValue, toValue } = normalizeReportDateRange(
    requestedFromValue,
    requestedToValue,
  );
  if (
    activeRange === "custom" &&
    (fromValue !== requestedFromValue || toValue !== requestedToValue)
  ) {
    const normalizedParams = new URLSearchParams({
      from: fromValue,
      to: toValue,
    });
    if (params.branchId) normalizedParams.set("branchId", params.branchId);
    if (params.showEmpty === "1") normalizedParams.set("showEmpty", "1");
    redirect(`/reports?${normalizedParams.toString()}`);
  }
  const businessDayRange = getBusinessDayRange({
    fromDateValue: fromValue,
    toDateValue: toValue,
    timezone: business.timezone,
    businessDayCutoffTime: business.businessDayCutoffTime,
  });
  const { fromDate, toDateExclusive } = businessDayRange;

  const canViewAllBranches =
    context.access.source === "GROUP_ACCESS" ||
    hasStaffPermission(context.user, "ALL_BRANCHES");
  const staffBranch = context.user.branchId
    ? branches.find((branch) => branch.id === context.user.branchId)
    : null;
  const selectableBranches = canViewAllBranches ? branches : staffBranch ? [staffBranch] : [];
  const branchScope = resolveReportBranchScope({
    canViewAllBranches,
    requestedBranchId: params.branchId,
    staffBranchId: context.user.branchId,
    activeBranchIds: branches.map((branch) => branch.id),
  });
  const selectedBranchId = branchScope.hasAccess
    ? branchScope.branchId
    : NO_BRANCH_ACCESS_ID;
  const selectedBranch = branchScope.branchId
    ? branches.find((branch) => branch.id === branchScope.branchId) ?? null
    : null;
  const selectedBranchWhere = branchWhere(selectedBranchId);

  const [
    dailySalesReport,
    serviceSales,
    serviceRefunds,
    packageUses,
    packageUseRefunds,
    voidedPayments,
    jobsByStatus,
    invoicesByStatus,
    packageSales,
    packageSaleRefunds,
    topServices,
    topCustomerGroups,
    recentPayments,
    recentRefunds,
    taxSummary,
    creditNoteTaxSummary,
  ] = await Promise.all([
    getDailySalesReport({
      businessId,
      branchId: selectedBranchId,
      range: businessDayRange,
      selectedDay: isDateInput(params.day) ? params.day : undefined,
      selectedPaymentMethod: getSafeTextParam(params.paymentMethod),
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        workOrderId: { not: null },
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.paymentRefund.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        method: { not: "PACKAGE" },
        workOrderId: { not: null },
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: "PACKAGE",
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true, packageUses: true },
    }),
    prisma.paymentRefund.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        method: "PACKAGE",
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true, packageUsesRestored: true },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "VOID",
        voidedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.workOrder.groupBy({
      by: ["status"],
      where: {
        businessId,
        ...selectedBranchWhere,
        createdAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { total: true, balance: true },
      orderBy: { _count: { status: "desc" } },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: {
        businessId,
        ...selectedBranchWhere,
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { total: true, paidAmount: true, balance: true },
      orderBy: { _count: { status: "desc" } },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        customerPackageId: { not: null },
        workOrderId: null,
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.paymentRefund.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        method: { not: "PACKAGE" },
        payment: {
          customerPackageId: { not: null },
          workOrderId: null,
        },
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.workOrderItem.groupBy({
      by: ["name"],
      where: {
        businessId,
        ...(selectedBranchId
          ? {
              workOrder: {
                branchId: selectedBranchId,
              },
            }
          : {}),
        createdAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 10,
    }),
    prisma.workOrder.groupBy({
      by: ["customerId"],
      where: {
        businessId,
        ...selectedBranchWhere,
        status: { not: "CANCELLED" },
        createdAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { total: true, paidAmount: true, balance: true },
      orderBy: { _sum: { total: "desc" } },
      take: 10,
    }),
    prisma.payment.findMany({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      include: {
        customerPackage: {
          include: {
            customer: true,
            package: true,
          },
        },
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
            invoice: true,
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 12,
    }),
    prisma.paymentRefund.findMany({
      where: {
        businessId,
        ...selectedBranchWhere,
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      include: {
        payment: {
          include: {
            businessPaymentMethod: {
              select: { label: true },
            },
            customerPackage: {
              include: {
                customer: true,
                package: true,
              },
            },
          },
        },
        invoice: {
          select: {
            invoiceNumber: true,
            customer: { select: { name: true } },
          },
        },
        processedBy: {
          select: { name: true },
        },
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
          },
        },
      },
      orderBy: { refundedAt: "desc" },
      take: 12,
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: { not: "VOID" },
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { taxAmount: true },
    }),
    prisma.creditNote.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { taxAmount: true },
    }),
  ]);

  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      id: { in: topCustomerGroups.map((group) => group.customerId) },
    },
    select: { id: true, name: true, phone: true },
  });
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const jobCount = jobsByStatus.reduce((total, row) => total + row._count, 0);
  const invoiceCount = invoicesByStatus.reduce((total, row) => total + row._count, 0);
  const outstanding = invoicesByStatus.reduce(
    (total, row) => total + Number(row._sum.balance ?? 0),
    0,
  );
  const taxCollectedCents = Math.max(
    0,
    toCents(taxSummary._sum.taxAmount ?? 0) -
      toCents(creditNoteTaxSummary._sum.taxAmount ?? 0),
  );
  const netServiceSalesCents =
    toCents(serviceSales._sum.amount ?? 0) -
    toCents(serviceRefunds._sum.amount ?? 0);
  const netPackageSalesCents =
    toCents(packageSales._sum.amount ?? 0) -
    toCents(packageSaleRefunds._sum.amount ?? 0);
  const netPackageUses =
    Number(packageUses._sum.packageUses ?? 0) -
    Number(packageUseRefunds._sum.packageUsesRestored ?? 0);
  const salonReport =
    context.industryType === "SALON_BEAUTY"
      ? await getSalonReportData({
          businessId,
          branchId: selectedBranchId,
          fromDate,
          toDateExclusive,
        })
      : null;
  const moduleContext = await loadBusinessModuleContext(businessId);
  const expenseSummary = moduleContext.enabledModules.has("EXPENSE") ? await getExpenseDashboard({
    allowedBranchIds: selectedBranchId ? [selectedBranchId] : selectableBranches.map((branch) => branch.id),
    branchId: selectedBranchId,
    businessId,
    dateFrom: fromValue,
    dateTo: toValue,
    includeBusinessWide: canViewAllBranches && !selectedBranchId,
  }) : null;

  return (
    <>
      <section className="content report-content">
        <div className="page-header report-header">
          <div>
            <h1>Reports</h1>
            <p>
              {context.industryType === "SALON_BEAUTY"
                ? "Appointments, service, staff, and revenue performance for "
                : "Sales, jobs, invoices, packages, and service performance for "}
              {selectedBranch ? selectedBranch.name : business.name}.
            </p>
          </div>
          <div className="report-period">
            <span>Period</span>
            <strong>{formatReportPeriod(fromValue, toValue)}</strong>
          </div>
        </div>

        <ReportFilterPanel
          activeRange={activeRange}
          fromValue={fromValue}
          selectedBranchId={selectedBranchId}
          toValue={toValue}
        />

        <ReportSummary
          dailySales={dailySalesReport}
          salon={salonReport}
        />

        <DailySalesSection
          report={dailySalesReport}
          branchId={selectedBranchId}
          range={activeRange}
          fromValue={fromValue}
          toValue={toValue}
          showEmptyDays={showEmptyDays}
        />

        <PaymentsCollectedSection
          branchId={selectedBranchId}
          fromValue={fromValue}
          range={activeRange}
          report={dailySalesReport}
          showEmptyDays={showEmptyDays}
          toValue={toValue}
        />

        {salonReport ? <SalonReportSections data={salonReport} /> : null}

        {!salonReport ? <div className="report-kpis report-secondary-kpis">
          <Metric label="Service Sales" value={money(fromCents(netServiceSalesCents))} />
          <Metric label="SST / Tax" value={money(fromCents(taxCollectedCents))} />
          <Metric
            label="Package Sales"
            value={`${packageSales._count} / ${money(fromCents(netPackageSalesCents))}`}
          />
          <Metric label="Package Uses" value={`${netPackageUses} uses`} />
          <Metric label="Jobs" value={jobCount} />
          <Metric label="Invoices" value={invoiceCount} />
          <Metric label="Outstanding" value={money(outstanding)} />
          <Metric
            label="Voided Payments"
            value={`${voidedPayments._count} / ${money(voidedPayments._sum.amount)}`}
          />
        </div> : null}

        {!salonReport ? <section className="report-grid">
          <ReportCard title="Jobs by Status">
            {jobsByStatus.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Jobs</th>
                    <th>Total</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsByStatus.map((row) => (
                    <tr key={row.status}>
                      <td>
                        <span className="status">{formatStatus(row.status)}</span>
                      </td>
                      <td>{row._count}</td>
                      <td>{money(row._sum.total)}</td>
                      <td>{money(row._sum.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No jobs in this period.</p>
            )}
          </ReportCard>

          <ReportCard title="Invoices by Status">
            {invoicesByStatus.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Invoices</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invoicesByStatus.map((row) => (
                    <tr key={row.status}>
                      <td>
                        <span className="status">{formatStatus(row.status)}</span>
                      </td>
                      <td>{row._count}</td>
                      <td>{money(row._sum.total)}</td>
                      <td>{money(row._sum.paidAmount)}</td>
                      <td>{money(row._sum.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No invoices in this period.</p>
            )}
          </ReportCard>

          <ReportCard title="Top Services">
            {topServices.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Service</th>
                    <th>Qty</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {topServices.map((row, index) => (
                    <tr key={row.name}>
                      <td className="table-number">{index + 1}</td>
                      <td>{row.name}</td>
                      <td>{row._sum.quantity ?? 0}</td>
                      <td>{money(row._sum.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No service sales in this period.</p>
            )}
          </ReportCard>

          <ReportCard title="Top Customers">
            {topCustomerGroups.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Customer</th>
                    <th>Jobs</th>
                    <th>Total</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomerGroups.map((row, index) => {
                    const customer = customerById.get(row.customerId);
                    return (
                      <tr key={row.customerId}>
                        <td className="table-number">{index + 1}</td>
                        <td>
                          {customer ? (
                            <Link href={`/crm/customers/${customer.id}`}>
                              <strong>{customer.name}</strong>
                            </Link>
                          ) : (
                            <strong>Unknown customer</strong>
                          )}
                          <div className="muted">{customer?.phone ?? ""}</div>
                        </td>
                        <td>{row._count}</td>
                        <td>{money(row._sum.total)}</td>
                        <td>{money(row._sum.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No customer activity in this period.</p>
            )}
          </ReportCard>

          <ReportCard title="Recent Payments">
            {recentPayments.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Paid at</th>
                    <th>Customer</th>
                    <th>Related</th>
                    <th>Method</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDateTime(payment.paidAt)}</td>
                      <td>
                        {payment.workOrder?.customer.name ??
                          payment.customerPackage?.customer.name ??
                          "No customer"}
                      </td>
                      <td>
                        {payment.workOrder ? (
                          <Link href={`/work-orders/${payment.workOrder.id}`}>
                            {payment.workOrder.vehicle.plateNumber}
                          </Link>
                        ) : payment.customerPackage ? (
                          <Link href={`/crm/customers/${payment.customerPackage.customerId}`}>
                            {payment.customerPackage.package.name}
                          </Link>
                        ) : (
                          "Payment"
                        )}
                      </td>
                      <td>{paymentMethodLabels[payment.method]}</td>
                      <td>{money(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No recent payments in this period.</p>
            )}
          </ReportCard>

          <ReportCard title="Recent Refunds">
            {recentRefunds.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Refunded at</th>
                    <th>Customer</th>
                    <th>Related</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Processed by</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRefunds.map((refund) => (
                    <tr key={refund.id}>
                      <td>{formatDateTime(refund.refundedAt)}</td>
                      <td>
                        {refund.invoice?.customer?.name ??
                          refund.workOrder?.customer.name ??
                          refund.payment.customerPackage?.customer.name ??
                          "No customer"}
                        <div className="muted">{refund.reason}</div>
                      </td>
                      <td>
                        {refund.invoiceId ? (
                          <Link href={`/invoices/${refund.invoiceId}`}>
                            {refund.invoice?.invoiceNumber ?? "View invoice"}
                          </Link>
                        ) : refund.workOrder ? (
                          <Link href={`/work-orders/${refund.workOrder.id}`}>
                            {refund.workOrder.vehicle.plateNumber}
                          </Link>
                        ) : refund.payment.customerPackage ? (
                          <Link
                            href={`/crm/customers/${refund.payment.customerPackage.customerId}`}
                          >
                            {refund.payment.customerPackage.package.name}
                          </Link>
                        ) : (
                          "Refund"
                        )}
                      </td>
                      <td>{refund.payment.businessPaymentMethod?.label ?? refund.payment.paymentMethodLabel ?? paymentMethodLabels[refund.method]}</td>
                      <td>
                        {refund.method === "PACKAGE"
                          ? `${refund.packageUsesRestored} use${refund.packageUsesRestored === 1 ? "" : "s"} restored`
                          : `-${money(refund.amount)}`}
                      </td>
                      <td>{refund.processedBy?.name ?? "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No refunds in this period.</p>
            )}
          </ReportCard>
        </section> : null}

        {expenseSummary ? <section className="report-grid report-last-section" aria-label="Business performance and expense settlement">
          <ReportCard title="Business Performance">
            <MetricList items={[
              { label: "Net Sales", value: money(fromCents(dailySalesReport.summary.netSalesCents)) },
              { label: "Confirmed Expenses", value: money(expenseSummary.recorded) },
              { label: "Simple Operating Balance", value: money(Number(fromCents(dailySalesReport.summary.netSalesCents)) - Number(expenseSummary.recorded)) },
              { label: "One-off Expenses", value: money(expenseSummary.oneOff) },
              { label: "Recurring Expenses", value: money(expenseSummary.recurring) },
            ]} />
            <p className="report-note">Confirmed expenses follow Expense Date. Simple Operating Balance is not accounting profit.</p>
          </ReportCard>
          <ReportCard title="Expense Settlement">
            <MetricList items={[
              { label: "Payments in Period", value: money(expenseSummary.paymentsInPeriod) },
              { label: "Paid against selected expenses", value: money(expenseSummary.paid) },
              { label: "Outstanding selected expenses", value: money(expenseSummary.unpaid) },
            ]} />
            <p className="report-note">Payments follow Payment Date and do not recognise spending again. Cash does not imply POS drawer funding.</p>
          </ReportCard>
        </section> : null}

        {dailySalesReport.selectedDay ? (
          <DayTransactionsDrawer
            report={dailySalesReport}
            closeHref={buildReportHref({
              range: activeRange,
              branchId: selectedBranchId,
              fromValue,
              toValue,
              showEmptyDays,
            })}
            timezone={business.timezone}
          />
        ) : dailySalesReport.selectedPaymentMethod ? (
          <PaymentMethodDrawer
            closeHref={buildReportHref({
              range: activeRange,
              branchId: selectedBranchId,
              fromValue,
              toValue,
              showEmptyDays,
            })}
            report={dailySalesReport}
            timezone={business.timezone}
          />
        ) : null}
      </section>
    </>
  );
}

function ReportSummary({
  dailySales,
  salon,
}: {
  dailySales: DailySalesReport;
  salon: SalonReportData | null;
}) {
  return (
    <section className="report-summary" aria-labelledby="report-summary-title">
      <div className="report-section-heading">
        <div>
          <span className="report-eyebrow">Sales overview</span>
          <h2 id="report-summary-title">Summary</h2>
        </div>
        <p>Sales follow invoice date; refunds follow refund date.</p>
      </div>
      <div className="report-summary-group">
        <h3>Sales Summary</h3>
        <div className="report-kpis report-summary-primary">
          <Metric label="Net Sales" value={money(fromCents(dailySales.summary.netSalesCents))} />
          <Metric label="Transactions" value={dailySales.summary.transactionCount} />
          <Metric label="Average Sale" value={money(fromCents(dailySales.summary.averageSaleCents))} />
          <Metric label="Refunds" value={money(fromCents(dailySales.summary.refundsCents))} />
          <Metric label="Discounts" value={money(fromCents(dailySales.summary.discountsCents))} />
        </div>
      </div>
      {salon ? (
        <div className="report-summary-group report-summary-appointments">
          <h3>Appointment Summary</h3>
          <div className="report-kpis report-summary-secondary">
            <Metric label="Appointments" value={salon.totalAppointments} />
            <Metric label="Completed" value={salon.completedAppointments} />
            <Metric label="Cancelled" value={salon.cancelledAppointments} />
            <Metric label="No-show" value={salon.noShowAppointments} />
            <Metric label="Repeat Visits" value={salon.repeatCustomers} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DailySalesSection({
  report,
  branchId,
  range,
  fromValue,
  toValue,
  showEmptyDays,
}: {
  report: DailySalesReport;
  branchId: string | null;
  range: ReportRange;
  fromValue: string;
  toValue: string;
  showEmptyDays: boolean;
}) {
  const visibleDays = getVisibleDailySalesDays(report.days, showEmptyDays);
  const toggleHref = buildReportHref({
    range,
    branchId,
    fromValue,
    toValue,
    showEmptyDays: !showEmptyDays,
  });

  return (
    <section className="panel report-feature-card" aria-labelledby="daily-sales-title">
      <div className="report-section-heading report-section-heading-bordered">
        <div>
          <span className="report-eyebrow">Business-day view</span>
          <h2 id="daily-sales-title">Daily Sales</h2>
        </div>
        <div className="report-section-actions">
          <p>Select a day to review its invoices and payment mix.</p>
          <Link
            aria-checked={showEmptyDays}
            className={`report-empty-days-toggle${showEmptyDays ? " is-active" : ""}`}
            href={toggleHref}
            role="switch"
          >
            <span aria-hidden="true">{showEmptyDays ? "✓" : ""}</span>
            Show empty days
          </Link>
        </div>
      </div>
      {visibleDays.length ? (
        <>
          <div className="report-table-shell report-desktop-table">
            <table className="table report-daily-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Net Sales</th>
                  <th>Transactions</th>
                  <th>Avg Sale</th>
                  <th>Refunds</th>
                  <th>Discounts</th>
                  <th>Payment Mix</th>
                </tr>
              </thead>
              <tbody>
                {visibleDays.map((row) => {
                  const dayHref = buildReportHref({
                    range,
                    branchId,
                    fromValue,
                    toValue,
                    day: row.dateValue,
                    showEmptyDays,
                  });
                  return (
                    <tr key={row.dateValue}>
                      <td>
                        <Link className="report-day-cell-link report-day-link" href={dayHref}>
                          <strong>{formatReportDate(row.dateValue)}</strong>
                        </Link>
                      </td>
                      <td><Link className="report-day-cell-link" href={dayHref}>{money(fromCents(row.netSalesCents))}</Link></td>
                      <td><Link className="report-day-cell-link" href={dayHref}>{row.transactionCount}</Link></td>
                      <td><Link className="report-day-cell-link" href={dayHref}>{money(fromCents(row.averageSaleCents))}</Link></td>
                      <td><Link className="report-day-cell-link" href={dayHref}>{money(fromCents(row.refundsCents))}</Link></td>
                      <td><Link className="report-day-cell-link" href={dayHref}>{money(fromCents(row.discountsCents))}</Link></td>
                      <td className="report-payment-mix-cell">
                        <Link className="report-day-cell-link" href={dayHref}>
                          {formatPaymentMix(row.paymentMethods)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th>{money(fromCents(report.summary.netSalesCents))}</th>
                  <th>{report.summary.transactionCount}</th>
                  <th>{money(fromCents(report.summary.averageSaleCents))}</th>
                  <th>{money(fromCents(report.summary.refundsCents))}</th>
                  <th>{money(fromCents(report.summary.discountsCents))}</th>
                  <th aria-label="Payment mix total">—</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="report-mobile-list" aria-label="Daily sales mobile list">
            {visibleDays.map((row) => (
              <Link
                className="report-mobile-day-card"
                href={buildReportHref({
                  range,
                  branchId,
                  fromValue,
                  toValue,
                  day: row.dateValue,
                  showEmptyDays,
                })}
                key={row.dateValue}
              >
                <div>
                  <strong>{formatReportDate(row.dateValue)}</strong>
                  <span>{row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"}</span>
                </div>
                <b>{money(fromCents(row.netSalesCents))}</b>
                <dl>
                  <div><dt>Average</dt><dd>{money(fromCents(row.averageSaleCents))}</dd></div>
                  {row.refundsCents ? <div className="report-negative-metric"><dt>Refunds</dt><dd>{money(fromCents(row.refundsCents))}</dd></div> : null}
                  {row.discountsCents ? <div className="report-negative-metric"><dt>Discounts</dt><dd>{money(fromCents(row.discountsCents))}</dd></div> : null}
                </dl>
                <div className="report-mobile-payment-mix">
                  <span>Payment</span>
                  <strong>{formatPaymentMix(row.paymentMethods)}</strong>
                </div>
                <small className="report-mobile-detail-link">View details →</small>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="report-empty-state">
          <span aria-hidden="true">▤</span>
          <strong>No sales in this period</strong>
          <p>Try another date range.</p>
        </div>
      )}
    </section>
  );
}

function PaymentsCollectedSection({
  branchId,
  fromValue,
  range,
  report,
  showEmptyDays,
  toValue,
}: {
  branchId: string | null;
  fromValue: string;
  range: ReportRange;
  report: DailySalesReport;
  showEmptyDays: boolean;
  toValue: string;
}) {
  return (
    <section className="panel report-feature-card" aria-labelledby="payments-collected-title">
      <div className="report-section-heading report-section-heading-bordered">
        <div>
          <span className="report-eyebrow">Payment view</span>
          <h2 id="payments-collected-title">Payments Collected</h2>
        </div>
        <div className="report-collected-total">
          <span>Net collected</span>
          <strong>{money(fromCents(report.summary.netCollectionsCents))}</strong>
        </div>
      </div>
      <p className="report-note report-definition-note">
        Sales are recognised from invoices. Collections show when money was received, including split payments and refunds.
      </p>
      {report.paymentMethods.length ? (
        <div className="report-payment-grid">
          {report.paymentMethods.map((method) => {
            const displayShare = report.summary.netCollectionsCents > 0
              ? (method.netCents / report.summary.netCollectionsCents) * 100
              : 0;
            const displayShareLabel = formatPaymentShare(displayShare);
            return (
            <Link
              aria-label={`View ${method.label} payment details`}
              className="report-payment-card"
              href={buildReportHref({
                range,
                branchId,
                fromValue,
                toValue,
                paymentMethod: method.label,
                showEmptyDays,
              })}
              key={method.label}
            >
              <div className="report-payment-card-heading">
                <strong>{method.label}</strong>
                <b>{money(fromCents(method.netCents))}</b>
              </div>
              <div className="report-payment-card-meta">
                <span>{method.paymentCount} payment{method.paymentCount === 1 ? "" : "s"}</span>
                <span>{displayShareLabel}</span>
              </div>
              <div className="report-payment-share" aria-label={`${displayShareLabel} of net collections`}>
                <span style={{ width: `${displayShare < 0.1 ? 0 : Math.max(0, Math.min(100, displayShare))}%` }} />
              </div>
              <small>Gross {money(fromCents(method.grossCents))}{method.refundCents ? ` · Refunds ${money(fromCents(method.refundCents))}` : ""}</small>
              <span className="report-payment-card-action">View payments →</span>
            </Link>
            );
          })}
        </div>
      ) : (
        <div className="report-empty-state report-empty-state-compact">
          <strong>No payments collected</strong>
          <p>There are no monetary payments in this period.</p>
        </div>
      )}
    </section>
  );
}

function DayTransactionsDrawer({
  report,
  closeHref,
  timezone,
}: {
  report: DailySalesReport;
  closeHref: string;
  timezone: string;
}) {
  const selectedDay = report.selectedDay!;
  const day = report.days.find((row) => row.dateValue === selectedDay.dateValue);
  return (
    <ReportDrawerShell ariaLabelledBy="day-detail-title" closeHref={closeHref}>
        <header>
          <div>
            <span className="report-eyebrow">Daily transactions</span>
            <h2 id="day-detail-title">{formatReportDate(selectedDay.dateValue)}</h2>
            <p>{day?.transactionCount ?? 0} transaction{day?.transactionCount === 1 ? "" : "s"} · {money(fromCents(day?.netSalesCents ?? 0))} net sales</p>
          </div>
          <Link className="report-drawer-close" href={closeHref} aria-label="Close">×</Link>
        </header>
        <dl className="report-drawer-summary">
          <div><dt>Net Sales</dt><dd>{money(fromCents(day?.netSalesCents ?? 0))}</dd></div>
          <div><dt>Transactions</dt><dd>{day?.transactionCount ?? 0}</dd></div>
          <div><dt>Refunds</dt><dd>{money(fromCents(day?.refundsCents ?? 0))}</dd></div>
          <div><dt>Discounts</dt><dd>{money(fromCents(day?.discountsCents ?? 0))}</dd></div>
        </dl>
        {selectedDay.transactions.length ? (
          <>
            <div className="report-table-shell report-desktop-table">
              <table className="table report-transaction-table">
                <thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th>Staff</th><th>Subtotal</th><th>Discount</th><th>Net</th><th>Payment</th><th>Status</th></tr></thead>
                <tbody>
                  {selectedDay.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{formatTimeInZone(transaction.issuedAt, timezone)}</td>
                      <td><Link href={`/invoices/${transaction.id}`}>{transaction.invoiceNumber}</Link></td>
                      <td>{transaction.customerName}</td>
                      <td>{transaction.staffName}</td>
                      <td>{money(fromCents(transaction.subtotalCents))}</td>
                      <td>{transaction.discountCents ? `-${money(fromCents(transaction.discountCents))}` : money(0)}</td>
                      <td>{money(fromCents(transaction.totalCents))}</td>
                      <td>{transaction.paymentLabel}</td>
                      <td><span className="status">{formatStatus(transaction.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="report-mobile-list">
              {selectedDay.transactions.map((transaction) => (
                <article className="report-mobile-transaction" key={transaction.id}>
                  <div><Link href={`/invoices/${transaction.id}`}>{transaction.invoiceNumber}</Link><b>{money(fromCents(transaction.totalCents))}</b></div>
                  <p>{formatTimeInZone(transaction.issuedAt, timezone)} · {transaction.customerName}</p>
                  <small>Subtotal {money(fromCents(transaction.subtotalCents))} · Discount {transaction.discountCents ? `-${money(fromCents(transaction.discountCents))}` : money(0)}</small>
                  <small>{transaction.staffName} · {transaction.paymentLabel} · {formatStatus(transaction.status)}</small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="report-empty-state"><strong>No invoices for this day</strong><p>Sales may be empty even when a later refund was recorded.</p></div>
        )}
    </ReportDrawerShell>
  );
}

function PaymentMethodDrawer({
  closeHref,
  report,
  timezone,
}: {
  closeHref: string;
  report: DailySalesReport;
  timezone: string;
}) {
  const method = report.selectedPaymentMethod!;
  return (
    <ReportDrawerShell ariaLabelledBy="payment-detail-title" closeHref={closeHref}>
      <header>
        <div>
          <span className="report-eyebrow">Payment details</span>
          <h2 id="payment-detail-title">{method.label}</h2>
          <p>{method.paymentCount} payment{method.paymentCount === 1 ? "" : "s"} in this period</p>
        </div>
        <Link className="report-drawer-close" href={closeHref} aria-label="Close">×</Link>
      </header>
      <dl className="report-drawer-summary report-payment-drawer-summary">
        <div><dt>Gross collected</dt><dd>{money(fromCents(method.grossCents))}</dd></div>
        <div><dt>Refunds</dt><dd>{money(fromCents(method.refundCents))}</dd></div>
        <div><dt>Net collected</dt><dd>{money(fromCents(method.netCents))}</dd></div>
      </dl>
      {method.rows.length ? (
        <>
          <div className="report-table-shell report-desktop-table">
            <table className="table report-payment-detail-table">
              <thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th>Gross</th><th>Refund</th><th>Net</th></tr></thead>
              <tbody>
                {method.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>{formatTimeInZone(row.occurredAt, timezone)}</td>
                    <td>{row.invoiceId ? <Link href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber ?? "View invoice"}</Link> : "—"}</td>
                    <td>{row.customerName}</td>
                    <td>{money(fromCents(row.grossCents))}</td>
                    <td>{row.refundCents ? `-${money(fromCents(row.refundCents))}` : money(0)}</td>
                    <td className={row.netCents < 0 ? "report-negative-value" : undefined}>{row.netCents < 0 ? `-${money(fromCents(Math.abs(row.netCents)))}` : money(fromCents(row.netCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="report-mobile-list">
            {method.rows.map((row) => (
              <article className="report-mobile-transaction" key={`${row.kind}-${row.id}`}>
                <div>
                  {row.invoiceId ? <Link href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber ?? "View invoice"}</Link> : <strong>{row.kind === "REFUND" ? "Refund" : "Payment"}</strong>}
                  <b className={row.netCents < 0 ? "report-negative-value" : undefined}>{row.netCents < 0 ? `-${money(fromCents(Math.abs(row.netCents)))}` : money(fromCents(row.netCents))}</b>
                </div>
                <p>{formatTimeInZone(row.occurredAt, timezone)} · {row.customerName}</p>
                <small>Gross {money(fromCents(row.grossCents))} · Refund {row.refundCents ? `-${money(fromCents(row.refundCents))}` : money(0)}</small>
                {row.reason ? <small>Reason: {row.reason}{row.processorName ? ` · Processed by ${row.processorName}` : ""}</small> : null}
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="report-empty-state"><strong>No payment records</strong><p>No matching payment or refund records were found in this period.</p></div>
      )}
    </ReportDrawerShell>
  );
}

type SalonServiceReportRow = {
  name: string;
  quantity: number;
  amount: number;
};

type SalonStaffReportRow = {
  id: string;
  name: string;
  appointments: number;
  amount: number;
};

type SalonStatusReportRow = {
  status: string;
  appointments: number;
};

type SalonReportData = {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  repeatCustomers: number;
  serviceSales: SalonServiceReportRow[];
  staffSales: SalonStaffReportRow[];
  statusRows: SalonStatusReportRow[];
};

async function getSalonReportData({
  businessId,
  branchId,
  fromDate,
  toDateExclusive,
}: {
  businessId: string;
  branchId: string | null;
  fromDate: Date;
  toDateExclusive: Date;
}): Promise<SalonReportData> {
  const branchFilter = branchWhere(branchId);
  const appointmentWhere: Prisma.AppointmentWhereInput = {
    businessId,
    ...branchFilter,
    scheduledAt: { gte: fromDate, lt: toDateExclusive },
  };
  const validAppointmentWhere: Prisma.AppointmentWhereInput = {
    ...appointmentWhere,
    status: { notIn: ["CANCELLED", "NO_SHOW"] },
  };
  const salonInvoiceLink = {
    OR: [
      { appointmentId: { not: null } },
      { workOrderId: { not: null } },
    ],
  } satisfies Prisma.InvoiceWhereInput;

  const [
    appointmentsByStatus,
    repeatCustomerGroups,
    invoices,
    staffAppointmentGroups,
  ] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["status"],
      where: appointmentWhere,
      _count: true,
      orderBy: { _count: { status: "desc" } },
    }),
    prisma.appointment.groupBy({
      by: ["customerId"],
      where: validAppointmentWhere,
      _count: true,
    }),
    prisma.invoice.findMany({
      where: {
        businessId,
        ...branchFilter,
        ...salonInvoiceLink,
        status: { not: "VOID" },
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      select: {
        items: {
          select: { name: true, quantity: true, lineTotal: true },
        },
        appointment: {
          select: {
            assignedStaffId: true,
            assignedStaff: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.appointment.groupBy({
      by: ["assignedStaffId"],
      where: validAppointmentWhere,
      _count: true,
    }),
  ]);

  const assignedStaffIds = staffAppointmentGroups
    .map((row) => row.assignedStaffId)
    .filter((id): id is string => Boolean(id));
  const staffUsers = assignedStaffIds.length
    ? await prisma.user.findMany({
        where: { businessId, id: { in: assignedStaffIds } },
        select: { id: true, name: true },
      })
    : [];
  const staffNames = new Map(staffUsers.map((staff) => [staff.id, staff.name]));

  const serviceMap = new Map<string, { quantity: number; amount: number }>();
  const staffAmountMap = new Map<string, { name: string; amount: number }>();
  for (const invoice of invoices) {
    const staffId = invoice.appointment?.assignedStaffId ?? "unassigned";
    const staffName =
      invoice.appointment?.assignedStaff?.name ?? staffNames.get(staffId) ?? "Unassigned";
    const staffEntry = staffAmountMap.get(staffId) ?? { name: staffName, amount: 0 };

    for (const item of invoice.items) {
      const serviceEntry = serviceMap.get(item.name) ?? { quantity: 0, amount: 0 };
      serviceEntry.quantity += item.quantity;
      serviceEntry.amount += Number(item.lineTotal);
      serviceMap.set(item.name, serviceEntry);
      staffEntry.amount += Number(item.lineTotal);
    }

    staffAmountMap.set(staffId, staffEntry);
  }

  const staffSales = Array.from(
    new Set([
      ...staffAppointmentGroups.map((row) => row.assignedStaffId ?? "unassigned"),
      ...staffAmountMap.keys(),
    ]),
  )
    .map((id) => {
      const appointmentGroup = staffAppointmentGroups.find(
        (row) => (row.assignedStaffId ?? "unassigned") === id,
      );
      const amount = staffAmountMap.get(id);
      return {
        id,
        name:
          amount?.name ??
          (id === "unassigned" ? "Unassigned" : staffNames.get(id) ?? "Staff"),
        appointments: appointmentGroup?._count ?? 0,
        amount: amount?.amount ?? 0,
      };
    })
    .sort((left, right) => right.amount - left.amount);

  const statusCountMap = new Map<string, number>();
  for (const row of appointmentsByStatus) {
    const status = ["CONFIRMED", "ARRIVED", "IN_SERVICE"].includes(row.status)
      ? "SCHEDULED"
      : row.status;
    statusCountMap.set(status, (statusCountMap.get(status) ?? 0) + row._count);
  }
  const statusRows = Array.from(statusCountMap.entries())
    .map(([status, appointments]) => ({ status, appointments }))
    .sort((left, right) => right.appointments - left.appointments);
  const countForStatus = (status: string) =>
    statusRows.find((row) => row.status === status)?.appointments ?? 0;
  const totalAppointments = statusRows.reduce((total, row) => total + row.appointments, 0);
  return {
    totalAppointments,
    completedAppointments: countForStatus("COMPLETED"),
    cancelledAppointments: countForStatus("CANCELLED"),
    noShowAppointments: countForStatus("NO_SHOW"),
    repeatCustomers: repeatCustomerGroups.filter((row) => row._count > 1).length,
    serviceSales: Array.from(serviceMap.entries())
      .map(([name, row]) => ({ name, ...row }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 10),
    staffSales,
    statusRows,
  };
}

function SalonReportSections({ data }: { data: SalonReportData }) {
  return (
      <section className="report-grid report-operational-grid">
        <ReportCard title="Service Sales">
          {data.serviceSales.length ? (
            <table className="table compact-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.serviceSales.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.quantity}</td>
                    <td>{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No service sales in this period.</p>
          )}
        </ReportCard>

        <ReportCard title="Staff Activity">
          {data.staffSales.length ? (
            <table className="table compact-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Appointments</th>
                  <th>Attributed Sales</th>
                </tr>
              </thead>
              <tbody>
                {data.staffSales.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.appointments}</td>
                    <td>{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No staff activity in this period.</p>
          )}
        </ReportCard>

        <ReportCard title="Appointments by Status">
          {data.statusRows.length ? (
            <table className="table compact-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Appointments</th>
                </tr>
              </thead>
              <tbody>
                {data.statusRows.map((row) => (
                  <tr key={row.status}>
                    <td>
                      <span className="status">{formatStatus(row.status)}</span>
                    </td>
                    <td>{row.appointments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No appointments in this period.</p>
          )}
        </ReportCard>
      </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="report-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricList({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="report-metric-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel report-card">
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function getReportRange(value: string | undefined): ReportRange {
  if (value === "today" || value === "7days" || value === "month" || value === "custom") {
    return value;
  }

  return "today";
}

function getDefaultDateRange(
  range: Exclude<ReportRange, "custom">,
  todayValue: string,
) {
  return {
    defaultFrom:
      range === "today"
        ? todayValue
        : range === "7days"
          ? addDaysToDateValue(todayValue, -6)
          : startOfBusinessMonth(todayValue),
    defaultTo: todayValue,
  };
}

function isDateInput(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getDateInput(value: string | undefined, fallback: string) {
  return isDateInput(value) ? value ?? fallback : fallback;
}

function buildReportHref({
  range,
  branchId,
  fromValue,
  toValue,
  day,
  paymentMethod,
  showEmptyDays,
}: {
  range: ReportRange;
  branchId: string | null;
  fromValue: string;
  toValue: string;
  day?: string;
  paymentMethod?: string;
  showEmptyDays?: boolean;
}) {
  const params = new URLSearchParams();
  if (range === "custom") {
    params.set("from", fromValue);
    params.set("to", toValue);
  } else {
    params.set("range", range);
  }
  if (branchId && branchId !== NO_BRANCH_ACCESS_ID) {
    params.set("branchId", branchId);
  }
  if (day) {
    params.set("day", day);
  }
  if (paymentMethod) {
    params.set("paymentMethod", paymentMethod);
  }
  if (showEmptyDays) {
    params.set("showEmpty", "1");
  }
  return `/reports?${params.toString()}`;
}

function formatStatus(status: string) {
  const normalized = status.toLowerCase().replaceAll("_", "-");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getSafeTextParam(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length <= 100 ? normalized : undefined;
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReportDate(value: string) {
  return formatDateValue(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatReportPeriod(fromValue: string, toValue: string) {
  return fromValue === toValue
    ? formatReportDate(fromValue)
    : `${formatReportDate(fromValue)} - ${formatReportDate(toValue)}`;
}

function formatPaymentMix(
  methods: readonly DailySalesReport["days"][number]["paymentMethods"][number][],
) {
  if (!methods.length) {
    return "—";
  }

  const visibleMethods = methods.slice(0, 2);
  const hiddenCount = methods.length - visibleMethods.length;
  const visibleLabel = visibleMethods
    .map((method) => `${method.label} ${money(fromCents(method.netCents))}`)
    .join(" · ");
  return hiddenCount > 0 ? `${visibleLabel} · +${hiddenCount} more` : visibleLabel;
}

function formatTimeInZone(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(value);
}
