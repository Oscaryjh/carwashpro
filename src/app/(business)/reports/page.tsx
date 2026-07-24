import Link from "next/link";
import type { PaymentMethod, Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  hasStaffPermission,
} from "@/lib/auth/staff-permissions";
import { branchWhere, getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { fromCents, toCents } from "@/lib/validation/pos";

type ReportsPageProps = {
  searchParams: Promise<{
    branchId?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
};

type ReportRange = "today" | "7days" | "month" | "custom";

const NO_BRANCH_ACCESS_ID = "00000000-0000-0000-0000-000000000000";

const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  BANK_TRANSFER: "Bank transfer",
  PACKAGE: "Package use",
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const context = await requireBusinessContext();
  assertStaffPermission(context.user, "REPORTS");

  if (!context.businessId) {
    throw new Error("Business context is required.");
  }

  const businessId = context.businessId;
  const params = await searchParams;
  const selectedRange = getReportRange(params.range);
  const { defaultFrom, defaultTo } = getDefaultDateRange(selectedRange);
  const hasCustomDates = isDateInput(params.from) || isDateInput(params.to);
  const activeRange: ReportRange = hasCustomDates ? "custom" : selectedRange;
  const fromValue = getDateInput(params.from, defaultFrom);
  const toValue = getDateInput(params.to, defaultTo);
  const { fromDate, toDateExclusive } = getDateRange(fromValue, toValue);

  const branches = await getActiveBranches(businessId);
  const canViewAllBranches = hasStaffPermission(context.user, "ALL_BRANCHES");
  const staffBranch = context.user.branchId
    ? branches.find((branch) => branch.id === context.user.branchId)
    : null;
  const selectableBranches = canViewAllBranches ? branches : staffBranch ? [staffBranch] : [];
  const selectedBranch = canViewAllBranches
    ? branches.find((branch) => branch.id === params.branchId)
    : staffBranch;
  const selectedBranchId = canViewAllBranches
    ? selectedBranch?.id ?? null
    : staffBranch?.id ?? NO_BRANCH_ACCESS_ID;
  const selectedBranchWhere = branchWhere(selectedBranchId);

  const [
    business,
    totalSales,
    totalRefunds,
    serviceSales,
    serviceRefunds,
    packageUses,
    packageUseRefunds,
    paymentMethods,
    refundMethods,
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
    prisma.business.findUnique({ where: { id: businessId } }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
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
    prisma.payment.groupBy({
      by: ["method"],
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
    prisma.paymentRefund.groupBy({
      by: ["method"],
      where: {
        businessId,
        ...selectedBranchWhere,
        method: { not: "PACKAGE" },
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
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
            customerPackage: {
              include: {
                customer: true,
                package: true,
              },
            },
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
  const grossSalesCents = toCents(totalSales._sum.amount ?? 0);
  const refundedSalesCents = toCents(totalRefunds._sum.amount ?? 0);
  const netSalesCents = grossSalesCents - refundedSalesCents;
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
  const refundMethodByMethod = new Map(
    refundMethods.map((row) => [row.method, row]),
  );
  const paymentMethodSummary = Array.from(
    new Set([...paymentMethods.map((row) => row.method), ...refundMethods.map((row) => row.method)]),
  )
    .map((method) => {
      const payment = paymentMethods.find((row) => row.method === method);
      const refund = refundMethodByMethod.get(method);
      const grossCents = toCents(payment?._sum.amount ?? 0);
      const refundCents = toCents(refund?._sum.amount ?? 0);

      return {
        count: payment?._count ?? 0,
        grossCents,
        method,
        netCents: grossCents - refundCents,
        refundCents,
      };
    })
    .sort((left, right) => right.netCents - left.netCents);

  const salonReport =
    context.industryType === "SALON_BEAUTY"
      ? await getSalonReportData({
          businessId,
          branchId: selectedBranchId,
          fromDate,
          toDateExclusive,
        })
      : null;

  if (!business) {
    return (
      <>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </>
    );
  }

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
            <strong>
              {formatDisplayDate(fromDate)} - {formatDisplayDate(addDays(toDateExclusive, -1))}
            </strong>
          </div>
        </div>

        <div className="panel report-filter-panel">
          <div className="filter-tabs report-range-tabs">
            {[
              { label: "Today", value: "today" },
              { label: "7 days", value: "7days" },
              { label: "Month", value: "month" },
            ].map((range) => (
              <Link
                key={range.value}
                className={activeRange === range.value ? "active" : ""}
                href={reportRangeHref(range.value, selectedBranchId)}
              >
                {range.label}
              </Link>
            ))}
            {activeRange === "custom" ? <span className="custom-range-chip">Custom</span> : null}
          </div>
          <form className="report-filter-form" action="/reports">
            <label>
              <span>From</span>
              <input type="date" name="from" defaultValue={fromValue} />
            </label>
            <label>
              <span>To</span>
              <input type="date" name="to" defaultValue={toValue} />
            </label>
            {canViewAllBranches ? (
              <label>
                <span>Branch</span>
                <select name="branchId" defaultValue={selectedBranchId ?? ""}>
                  <option value="">All branches</option>
                  {selectableBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span>Branch</span>
                <div className="report-branch-lock">
                  {staffBranch?.name ?? "No active branch assigned"}
                </div>
              </label>
            )}
            <button type="submit">Run report</button>
          </form>
        </div>

        {salonReport ? <SalonReportSections data={salonReport} /> : null}

        {!salonReport ? <div className="report-kpis">
          <Metric label="Gross Sales" value={money(fromCents(grossSalesCents))} />
          <Metric label="Refunds" value={money(fromCents(refundedSalesCents))} />
          <Metric label="Net Sales" value={money(fromCents(netSalesCents))} />
          <Metric label="Service Sales" value={money(fromCents(netServiceSalesCents))} />
          <Metric label="SST / Tax" value={money(fromCents(taxCollectedCents))} />
          <Metric
            label="Package Sales"
            value={`${packageSales._count} / ${money(fromCents(netPackageSalesCents))}`}
          />
          <Metric
            label="Package Uses"
            value={`${netPackageUses} uses`}
          />
          <Metric label="Payments" value={totalSales._count} />
          <Metric label="Refund Transactions" value={totalRefunds._count} />
          <Metric label="Jobs" value={jobCount} />
          <Metric label="Invoices" value={invoiceCount} />
          <Metric label="Outstanding" value={money(outstanding)} />
          <Metric
            label="Voided Payments"
            value={`${voidedPayments._count} / ${money(voidedPayments._sum.amount)}`}
          />
        </div> : null}

        {!salonReport ? <section className="report-grid">
          <ReportCard title="Payment Methods">
            {paymentMethodSummary.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Count</th>
                    <th>Gross</th>
                    <th>Refunds</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethodSummary.map((row) => (
                    <tr key={row.method}>
                      <td>{paymentMethodLabels[row.method]}</td>
                      <td>{row.count}</td>
                      <td>{money(fromCents(row.grossCents))}</td>
                      <td>{money(fromCents(row.refundCents))}</td>
                      <td>{money(fromCents(row.netCents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No payments in this period.</p>
            )}
          </ReportCard>

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
                        {refund.workOrder?.customer.name ??
                          refund.payment.customerPackage?.customer.name ??
                          "No customer"}
                        <div className="muted">{refund.reason}</div>
                      </td>
                      <td>
                        {refund.workOrder && refund.invoiceId ? (
                          <Link href={`/invoices/${refund.invoiceId}`}>
                            {refund.workOrder.vehicle.plateNumber}
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
                      <td>{paymentMethodLabels[refund.method]}</td>
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
      </section>
    </>
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
  grossRevenueCents: number;
  refundCents: number;
  netRevenueCents: number;
  discountCents: number;
  depositCents: number;
  tipCents: number;
  sstCollectedCents: number;
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
  const salonRevenueLink = {
    OR: [
      { appointmentId: { not: null } },
      { workOrderId: { not: null } },
    ],
  } satisfies Prisma.PaymentWhereInput;
  const salonInvoiceLink = {
    OR: [
      { appointmentId: { not: null } },
      { workOrderId: { not: null } },
    ],
  } satisfies Prisma.InvoiceWhereInput;

  const [
    appointmentsByStatus,
    repeatCustomerGroups,
    paymentTotals,
    refundTotals,
    taxSummary,
    creditNoteTaxSummary,
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
    prisma.payment.aggregate({
      where: {
        businessId,
        ...branchFilter,
        ...salonRevenueLink,
        status: "ACTIVE",
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { amount: true },
    }),
    prisma.paymentRefund.aggregate({
      where: {
        businessId,
        ...branchFilter,
        payment: salonRevenueLink,
        refundedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        ...branchFilter,
        ...salonInvoiceLink,
        status: { not: "VOID" },
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { taxAmount: true },
    }),
    prisma.creditNote.aggregate({
      where: {
        businessId,
        ...branchFilter,
        invoice: salonInvoiceLink,
        issuedAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { taxAmount: true },
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
        discountAmount: true,
        depositAmount: true,
        tipAmount: true,
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
  let discountCents = 0;
  let depositCents = 0;
  let tipCents = 0;
  for (const invoice of invoices) {
    discountCents += toCents(invoice.discountAmount);
    depositCents += toCents(invoice.depositAmount);
    tipCents += toCents(invoice.tipAmount);
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
  const grossRevenueCents = toCents(paymentTotals._sum.amount ?? 0);
  const refundCents = toCents(refundTotals._sum.amount ?? 0);
  const sstCollectedCents = Math.max(
    0,
    toCents(taxSummary._sum.taxAmount ?? 0) -
      toCents(creditNoteTaxSummary._sum.taxAmount ?? 0),
  );

  return {
    grossRevenueCents,
    refundCents,
    netRevenueCents: grossRevenueCents - refundCents,
    discountCents,
    depositCents,
    tipCents,
    sstCollectedCents,
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
    <>
      <div className="report-kpis salon-report-kpis">
        <Metric label="Revenue" value={money(fromCents(data.grossRevenueCents))} />
        <Metric label="Refunds" value={money(fromCents(data.refundCents))} />
        <Metric label="Net revenue" value={money(fromCents(data.netRevenueCents))} />
        <Metric label="SST / Tax" value={money(fromCents(data.sstCollectedCents))} />
        <Metric label="Discounts" value={money(fromCents(data.discountCents))} />
        <Metric label="Deposits" value={money(fromCents(data.depositCents))} />
        <Metric label="Tips" value={money(fromCents(data.tipCents))} />
        <Metric label="Appointments" value={data.totalAppointments} />
        <Metric label="Completed" value={data.completedAppointments} />
        <Metric label="Cancelled" value={data.cancelledAppointments} />
        <Metric label="No-show" value={data.noShowAppointments} />
        <Metric label="Repeat customers" value={data.repeatCustomers} />
      </div>

      <section className="report-grid">
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

        <ReportCard title="Staff Sales">
          {data.staffSales.length ? (
            <table className="table compact-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Appointments</th>
                  <th>Amount</th>
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
    </>
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

function getReportRange(value: string | undefined): Exclude<ReportRange, "custom"> {
  if (value === "today" || value === "7days" || value === "month") {
    return value;
  }

  return "today";
}

function getDefaultDateRange(range: Exclude<ReportRange, "custom">) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate =
    range === "today" ? today : range === "7days" ? addDays(today, -6) : monthStart;

  return {
    defaultFrom: formatDateInput(fromDate),
    defaultTo: formatDateInput(today),
  };
}

function reportRangeHref(range: string, branchId: string | null) {
  const params = new URLSearchParams({ range });

  if (branchId) {
    params.set("branchId", branchId);
  }

  return `/reports?${params.toString()}`;
}

function getDateRange(fromValue: string, toValue: string) {
  const fromDate = parseDateInput(fromValue);
  const toDateExclusive = parseDateInput(toValue);
  toDateExclusive.setDate(toDateExclusive.getDate() + 1);

  if (fromDate > toDateExclusive) {
    return {
      fromDate: parseDateInput(toValue),
      toDateExclusive: addDays(parseDateInput(toValue), 1),
    };
  }

  return { fromDate, toDateExclusive };
}

function parseDateInput(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInput(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getDateInput(value: string | undefined, fallback: string) {
  return isDateInput(value) ? value ?? fallback : fallback;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function money(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDisplayDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
