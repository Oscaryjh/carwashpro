import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";

export default async function DashboardPage() {
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
              <p>System-wide SaaS setup status.</p>
            </div>
          </div>
          <div className="grid">
            <Metric label="Businesses" value={businessCount} />
            <Metric label="Active businesses" value={activeBusinessCount} />
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

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    business,
    todayPayments,
    carsWashedToday,
    workOrdersToday,
    readyForPickup,
    unpaidPartialInvoices,
    packageUsesToday,
    whatsAppSentToday,
    newCustomersThisMonth,
    topServicesThisMonth,
    recentWorkOrders,
    recentPayments,
    lowPackageBalanceCustomers,
  ] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        paidAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      _sum: { amount: true },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        status: "COMPLETED",
        updatedAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        createdAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        status: "READY_FOR_PICKUP",
      },
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        status: {
          in: ["UNPAID", "PARTIAL"],
        },
      },
      _count: true,
      _sum: { balance: true },
    }),
    prisma.payment.aggregate({
      where: {
        businessId,
        method: "PACKAGE",
        paidAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      _sum: { packageUses: true },
      _count: true,
    }),
    prisma.whatsAppMessage.count({
      where: {
        businessId,
        sentAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        createdAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
    }),
    prisma.workOrderItem.groupBy({
      by: ["name"],
      where: {
        businessId,
        createdAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      _sum: {
        quantity: true,
        lineTotal: true,
      },
      orderBy: {
        _sum: {
          lineTotal: "desc",
        },
      },
      take: 5,
    }),
    prisma.workOrder.findMany({
      where: { businessId },
      include: {
        customer: true,
        vehicle: true,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.payment.findMany({
      where: { businessId },
      include: {
        workOrder: {
          include: {
            customer: true,
            vehicle: true,
            invoice: true,
          },
        },
      },
      orderBy: { paidAt: "desc" },
      take: 8,
    }),
    prisma.customerPackage.findMany({
      where: {
        businessId,
        status: "ACTIVE",
        remainingUses: {
          lte: 2,
        },
      },
      include: {
        customer: true,
        package: true,
      },
      orderBy: [{ remainingUses: "asc" }, { purchasedAt: "asc" }],
      take: 8,
    }),
  ]);

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{business.name}</h1>
            <p>Today and month-to-date store analytics.</p>
          </div>
        </div>

        <div className="grid">
          <Metric label="Today Sales" value={money(todayPayments._sum.amount)} />
          <Metric label="Cars Washed Today" value={carsWashedToday} />
          <Metric label="Work Orders Today" value={workOrdersToday} />
          <Metric label="Ready for Pickup" value={readyForPickup} />
          <Metric
            label="Unpaid / Partial Invoices"
            value={`${unpaidPartialInvoices._count} / ${money(
              unpaidPartialInvoices._sum.balance,
            )}`}
          />
          <Metric
            label="Package Uses Today"
            value={`${packageUsesToday._sum.packageUses ?? 0} uses / ${
              packageUsesToday._count
            } orders`}
          />
          <Metric label="WhatsApp Sent Today" value={whatsAppSentToday} />
          <Metric
            label="New Customers This Month"
            value={newCustomersThisMonth}
          />
        </div>

        <section className="dashboard-panels">
          <div className="panel">
            <h2>Top Services This Month</h2>
            {topServicesThisMonth.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Qty</th>
                    <th>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {topServicesThisMonth.map((service) => (
                    <tr key={service.name}>
                      <td>{service.name}</td>
                      <td>{service._sum.quantity ?? 0}</td>
                      <td>{money(service._sum.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No services sold this month.</p>
            )}
          </div>

          <div className="panel">
            <h2>Recent Work Orders</h2>
            {recentWorkOrders.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Vehicle</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentWorkOrders.map((workOrder) => (
                    <tr key={workOrder.id}>
                      <td>
                        <Link href={`/work-orders/${workOrder.id}`}>
                          {workOrder.orderNumber}
                        </Link>
                      </td>
                      <td>{workOrder.customer.name}</td>
                      <td>{workOrder.vehicle.plateNumber}</td>
                      <td>{formatStatus(workOrder.status)}</td>
                      <td>{money(workOrder.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No work orders yet.</p>
            )}
          </div>

          <div className="panel">
            <h2>Recent Payments</h2>
            {recentPayments.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Paid At</th>
                    <th>Customer</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{payment.paidAt.toLocaleString()}</td>
                      <td>{payment.workOrder.customer.name}</td>
                      <td>{formatStatus(payment.method)}</td>
                      <td>{money(payment.amount)}</td>
                      <td>
                        {payment.workOrder.invoice ? (
                          <Link href={`/invoices/${payment.workOrder.invoice.id}`}>
                            Invoice
                          </Link>
                        ) : (
                          <Link href={`/work-orders/${payment.workOrder.id}`}>
                            Work order
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No payments yet.</p>
            )}
          </div>

          <div className="panel">
            <h2>Low Package Balance Customers</h2>
            {lowPackageBalanceCustomers.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Package</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lowPackageBalanceCustomers.map((customerPackage) => (
                    <tr key={customerPackage.id}>
                      <td>
                        <Link href={`/crm/customers/${customerPackage.customer.id}`}>
                          {customerPackage.customer.name}
                        </Link>
                      </td>
                      <td>{customerPackage.package.name}</td>
                      <td>
                        {customerPackage.remainingUses}/
                        {customerPackage.totalUses} washes
                      </td>
                      <td>{formatStatus(customerPackage.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">No low package balances.</p>
            )}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
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
