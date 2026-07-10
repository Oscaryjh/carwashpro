import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { branchWhere, getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";

type DashboardPageProps = {
  searchParams: Promise<{
    branchId?: string;
    range?: string;
  }>;
};

type DashboardRange = "today" | "7days" | "month";

const NO_BRANCH_ACCESS_ID = "00000000-0000-0000-0000-000000000000";

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const context = await getBusinessContext();

  if (context.isPlatformAdmin) {
    const [businessCount, activeBusinessCount, userCount] = await Promise.all([
      prisma.business.count(),
      prisma.business.count({ where: { status: "active" } }),
      prisma.user.count(),
    ]);

    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="page-header">
            <div>
              <h1>Platform dashboard</h1>
            </div>
          </div>
          <div className="dashboard-kpis">
            <Metric label="Companies" value={businessCount} />
            <Metric label="Active Companies" value={activeBusinessCount} />
            <Metric label="Users" value={userCount} />
          </div>
        </section>
      </AppShell>
    );
  }

  const businessId = context.businessId;

  if (!businessId) {
    throw new Error("Business context is required.");
  }

  const params = await searchParams;
  const activeRange = getActiveRange(params.range);
  const now = new Date();
  const { fromDate, toDateExclusive, label: rangeLabel } = getRangeDates(activeRange, now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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
    serviceSales,
    packageSales,
    jobsInRange,
    carsCompletedInRange,
    readyForPickup,
    unpaidPartialInvoices,
    packageUsesInRange,
    whatsAppOpenedInRange,
    whatsAppManualSentInRange,
    newCustomersThisMonth,
    inProgressJobs,
    topServices,
    recentJobs,
    recentPayments,
    lowPackageBalanceCustomers,
  ] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId } }),
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
        method: { not: "PACKAGE" },
        customerPackageId: { not: null },
        workOrderId: null,
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        createdAt: { gte: fromDate, lt: toDateExclusive },
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "COMPLETED",
        pickedUpAt: { gte: fromDate, lt: toDateExclusive },
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "READY_FOR_PICKUP",
      },
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: { in: ["UNPAID", "PARTIAL"] },
      },
      _count: true,
      _sum: { balance: true },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: "PACKAGE",
        paidAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { packageUses: true },
      _count: true,
    }),
    prisma.whatsAppMessage.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "OPENED",
        openedAt: { gte: fromDate, lt: toDateExclusive },
      },
    }),
    prisma.whatsAppMessage.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "SENT_MANUALLY",
        sentAt: { gte: fromDate, lt: toDateExclusive },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        createdAt: { gte: monthStart, lt: nextMonthStart },
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "IN_PROGRESS",
      },
    }),
    prisma.workOrderItem.groupBy({
      by: ["name"],
      where: {
        businessId,
        ...(selectedBranchId ? { workOrder: { branchId: selectedBranchId } } : {}),
        createdAt: { gte: fromDate, lt: toDateExclusive },
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 5,
    }),
    prisma.workOrder.findMany({
      where: { businessId, ...selectedBranchWhere },
      include: {
        customer: true,
        vehicle: true,
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.payment.findMany({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        method: { not: "PACKAGE" },
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
      take: 6,
    }),
    prisma.customerPackage.findMany({
      where: {
        businessId,
        ...selectedBranchWhere,
        status: "ACTIVE",
        remainingUses: { lte: 2 },
      },
      include: {
        customer: true,
        package: true,
      },
      orderBy: [{ remainingUses: "asc" }, { purchasedAt: "asc" }],
      take: 6,
    }),
  ]);

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

  const totalSales =
    Number(serviceSales._sum.amount ?? 0) + Number(packageSales._sum.amount ?? 0);

  return (
    <AppShell user={context.user}>
      <section className="content dashboard-content">
        <div className="page-header dashboard-header">
          <div>
            <h1>{business.name}</h1>
          </div>
          {canViewAllBranches ? (
            <form className="dashboard-branch-filter" action="/dashboard">
              <input type="hidden" name="range" value={activeRange} />
              <select name="branchId" defaultValue={selectedBranchId ?? ""}>
                <option value="">All branches</option>
                {selectableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              <button type="submit">Filter</button>
            </form>
          ) : (
            <div className="dashboard-branch-lock">
              {staffBranch?.name ?? "No active branch assigned"}
            </div>
          )}
        </div>

        <div className="dashboard-range-tabs">
          {(["today", "7days", "month"] as DashboardRange[]).map((range) => (
            <Link
              className={activeRange === range ? "active" : ""}
              href={makeDashboardHref(range, selectedBranchId)}
              key={range}
            >
              {rangeLabelText(range)}
            </Link>
          ))}
        </div>

        <div className="dashboard-kpis">
          <Metric
            label={`${rangeLabel} Sales`}
            value={money(totalSales)}
            href="/reports"
            tone="sales"
          />
          <Metric label="Service Sales" value={money(serviceSales._sum.amount)} />
          <Metric label="Package Sales" value={money(packageSales._sum.amount)} />
          <Metric
            label="Outstanding"
            value={money(unpaidPartialInvoices._sum.balance)}
            subValue={`${unpaidPartialInvoices._count} invoices`}
            href="/invoices"
            tone="warning"
          />
          <Metric label={`${rangeLabel} Jobs`} value={jobsInRange} href="/work-orders" />
          <Metric label="Completed Cars" value={carsCompletedInRange} />
          <Metric
            label="Ready Pickup"
            value={readyForPickup}
            href="/work-orders?filter=ready"
            tone="ready"
          />
          <Metric label="In Progress" value={inProgressJobs} href="/work-orders?filter=active" />
          <Metric
            label="Package Uses"
            value={packageUsesInRange._sum.packageUses ?? 0}
            subValue={`${packageUsesInRange._count} jobs`}
          />
          <Metric label="WhatsApp Opened" value={whatsAppOpenedInRange} href="/whatsapp" />
          <Metric
            label="Manual WhatsApp Sent"
            value={whatsAppManualSentInRange}
            href="/whatsapp"
          />
          <Metric label="New Customers" value={newCustomersThisMonth} subValue="This month" href="/crm" />
        </div>

        <section className="dashboard-panels">
          <DashboardPanel title="Top Services" href="/services">
            {topServices.length ? (
              <div className="dashboard-list">
                {topServices.map((service, index) => (
                  <div className="dashboard-list-row" key={service.name}>
                    <div className="dashboard-rank">{index + 1}</div>
                    <div className="dashboard-list-main">
                      <strong>{service.name}</strong>
                      <span>{service._sum.quantity ?? 0} sold</span>
                    </div>
                    <strong>{money(service._sum.lineTotal)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No service sales yet.</p>
            )}
          </DashboardPanel>

          <DashboardPanel title="Recent Jobs" href="/work-orders">
            {recentJobs.length ? (
              <div className="dashboard-list">
                {recentJobs.map((job) => (
                  <div className="dashboard-list-row" key={job.id}>
                    <div className="dashboard-list-main">
                      <div className="dashboard-row-title">
                        <Link href={`/work-orders/${job.id}`}>{job.vehicle.plateNumber}</Link>
                        <span className="status">{formatStatus(job.status)}</span>
                      </div>
                      <span>{job.customer.name} / {vehicleLabel(job.vehicle)}</span>
                    </div>
                    <strong>{money(job.total)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No jobs yet.</p>
            )}
          </DashboardPanel>

          <DashboardPanel title="Recent Payments" href="/invoices">
            {recentPayments.length ? (
              <div className="dashboard-list">
                {recentPayments.map((payment) => (
                  <div className="dashboard-list-row" key={payment.id}>
                    <div className="dashboard-list-main">
                      <div className="dashboard-row-title">
                        <strong>
                          {payment.workOrder?.vehicle.plateNumber ??
                            payment.customerPackage?.package.name ??
                            "Payment"}
                        </strong>
                        <span>{formatStatus(payment.method)}</span>
                      </div>
                      <span>
                        {payment.workOrder?.customer.name ??
                          payment.customerPackage?.customer.name ??
                          "No customer"}
                      </span>
                    </div>
                    <div className="dashboard-row-side">
                      <strong>{money(payment.amount)}</strong>
                      {payment.workOrder?.invoice ? (
                        <Link href={`/invoices/${payment.workOrder.invoice.id}`}>
                          Invoice
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No payments yet.</p>
            )}
          </DashboardPanel>

          <DashboardPanel title="Low Package Balance" href="/crm">
            {lowPackageBalanceCustomers.length ? (
              <div className="dashboard-list">
                {lowPackageBalanceCustomers.map((customerPackage) => (
                  <div className="dashboard-list-row" key={customerPackage.id}>
                    <div className="dashboard-list-main">
                      <div className="dashboard-row-title">
                        <Link href={`/crm/customers/${customerPackage.customer.id}`}>
                          {customerPackage.customer.name}
                        </Link>
                        <span className="status">
                          {customerPackage.remainingUses}/{customerPackage.totalUses}
                        </span>
                      </div>
                      <span>{customerPackage.package.name}</span>
                    </div>
                    <strong>{customerPackage.customer.phone}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No low package balances.</p>
            )}
          </DashboardPanel>
        </section>
      </section>
    </AppShell>
  );
}

function DashboardPanel({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="panel dashboard-card">
      <div className="section-header">
        <h2>{title}</h2>
        <Link href={href}>View</Link>
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  subValue,
  href,
  tone = "default",
}: {
  label: string;
  value: string | number;
  subValue?: string;
  href?: string;
  tone?: "default" | "sales" | "warning" | "ready" | "danger";
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </>
  );

  if (href) {
    return (
      <Link className={`dashboard-kpi-card ${tone}`} href={href}>
        {content}
      </Link>
    );
  }

  return <div className={`dashboard-kpi-card ${tone}`}>{content}</div>;
}

function getActiveRange(value?: string): DashboardRange {
  return value === "7days" || value === "month" ? value : "today";
}

function getRangeDates(range: DashboardRange, now: Date) {
  const todayStart = startOfDay(now);

  if (range === "7days") {
    return {
      fromDate: addDays(todayStart, -6),
      toDateExclusive: addDays(todayStart, 1),
      label: "7 Days",
    };
  }

  if (range === "month") {
    return {
      fromDate: new Date(now.getFullYear(), now.getMonth(), 1),
      toDateExclusive: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      label: "Month",
    };
  }

  return {
    fromDate: todayStart,
    toDateExclusive: addDays(todayStart, 1),
    label: "Today",
  };
}

function rangeLabelText(range: DashboardRange) {
  if (range === "7days") {
    return "7 Days";
  }

  if (range === "month") {
    return "Month";
  }

  return "Today";
}

function makeDashboardHref(range: DashboardRange, branchId: string | null) {
  const params = new URLSearchParams({ range });

  if (branchId) {
    params.set("branchId", branchId);
  }

  return `/dashboard?${params.toString()}`;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
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

function vehicleLabel(vehicle: {
  brand: string | null;
  model: string | null;
  color: string | null;
}) {
  return [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ") ||
    "No vehicle details";
}
