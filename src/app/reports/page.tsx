import Link from "next/link";
import type { PaymentMethod } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import {
  assertStaffPermission,
  hasStaffPermission,
} from "@/lib/auth/staff-permissions";
import { branchWhere, getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";

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
    serviceSales,
    packageUses,
    paymentMethods,
    voidedPayments,
    jobsByStatus,
    invoicesByStatus,
    packageSales,
    topServices,
    topCustomerGroups,
    recentPayments,
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

  if (!business) {
    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell user={context.user}>
      <section className="content report-content">
        <div className="page-header report-header">
          <div>
            <h1>Reports</h1>
            <p>
              Sales, jobs, invoices, packages, and service performance for{" "}
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

        <div className="report-kpis">
          <Metric label="Total Sales" value={money(totalSales._sum.amount)} />
          <Metric label="Service Sales" value={money(serviceSales._sum.amount)} />
          <Metric
            label="Package Sales"
            value={`${packageSales._count} / ${money(packageSales._sum.amount)}`}
          />
          <Metric
            label="Package Uses"
            value={`${packageUses._sum.packageUses ?? 0} uses`}
          />
          <Metric label="Payments" value={totalSales._count} />
          <Metric label="Jobs" value={jobCount} />
          <Metric label="Invoices" value={invoiceCount} />
          <Metric label="Outstanding" value={money(outstanding)} />
          <Metric
            label="Voided Payments"
            value={`${voidedPayments._count} / ${money(voidedPayments._sum.amount)}`}
          />
        </div>

        <section className="report-grid">
          <ReportCard title="Payment Methods">
            {paymentMethods.length ? (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Count</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentMethods.map((row) => (
                    <tr key={row.method}>
                      <td>{paymentMethodLabels[row.method]}</td>
                      <td>{row._count}</td>
                      <td>{money(row._sum.amount)}</td>
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
        </section>
      </section>
    </AppShell>
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

  return "month";
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
