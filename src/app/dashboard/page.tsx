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

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    todayPayments,
    packageSales,
    completedTodayCount,
    paidWorkOrdersToday,
    topServiceItems,
    todayWorkOrders,
    pendingPickupCount,
    outstandingPayments,
    todayWhatsAppCount,
    sentWhatsAppTodayCount,
    newCustomersThisMonth,
  ] = await Promise.all([
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
    prisma.customerPackage.aggregate({
      where: {
        businessId,
        purchasedAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      _sum: { purchasePrice: true },
      _count: true,
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
    prisma.workOrder.findMany({
      where: {
        businessId,
        paymentStatus: "PAID",
        updatedAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: {
        total: true,
      },
    }),
    prisma.workOrderItem.groupBy({
      by: ["name"],
      where: {
        businessId,
        createdAt: {
          gte: todayStart,
          lt: tomorrowStart,
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
      where: {
        businessId,
        status: {
          not: "CANCELLED",
        },
        createdAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: {
        customerId: true,
        total: true,
      },
    }),
    prisma.workOrder.count({
      where: {
        businessId,
        status: "READY_FOR_PICKUP",
      },
    }),
    prisma.workOrder.aggregate({
      where: {
        businessId,
        status: {
          not: "CANCELLED",
        },
        paymentStatus: {
          not: "PAID",
        },
      },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.whatsAppMessage.count({
      where: {
        businessId,
        createdAt: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
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
        },
      },
    }),
  ]);

  const topCustomers = await getTopCustomers({
    businessId,
    todayStart,
    tomorrowStart,
  });
  const returningCustomerPercent = await getReturningCustomerPercent(
    businessId,
    todayWorkOrders.map((workOrder) => workOrder.customerId),
  );
  const averageTicket =
    paidWorkOrdersToday.length > 0
      ? paidWorkOrdersToday.reduce(
          (total, workOrder) => total + Number(workOrder.total),
          0,
        ) / paidWorkOrdersToday.length
      : 0;

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{business.name}</h1>
            <p>Today store performance and operational follow-up.</p>
          </div>
        </div>
        <div className="grid">
          <Metric label="Today's Sales" value={money(todayPayments._sum.amount)} />
          <Metric label="Cars Washed Today" value={completedTodayCount} />
          <Metric label="Average Ticket" value={money(averageTicket)} />
          <Metric
            label="Package Sales"
            value={`${money(packageSales._sum.purchasePrice)} / ${
              packageSales._count
            } sold`}
          />
          <Metric label="Pending Pickup" value={pendingPickupCount} />
          <Metric
            label="Outstanding Payments"
            value={`${money(outstandingPayments._sum.balance)} / ${
              outstandingPayments._count
            } orders`}
          />
          <Metric
            label="Today's WhatsApp"
            value={`${todayWhatsAppCount} logs / ${sentWhatsAppTodayCount} sent`}
          />
          <Metric
            label="Returning Customer %"
            value={`${returningCustomerPercent.toFixed(0)}%`}
          />
          <Metric label="New Customers This Month" value={newCustomersThisMonth} />
        </div>
        <section className="dashboard-panels">
          <Leaderboard
            title="Top Services"
            emptyLabel="No services sold today."
            rows={topServiceItems.map((item) => ({
              label: item.name,
              meta: `${item._sum.quantity ?? 0} sold`,
              value: money(item._sum.lineTotal),
            }))}
          />
          <Leaderboard
            title="Top Customers"
            emptyLabel="No customer sales today."
            rows={topCustomers.map((customer) => ({
              label: customer.name,
              meta: `${customer.orderCount} orders`,
              value: money(customer.total),
            }))}
          />
        </section>
      </section>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={compact ? { fontSize: 15, overflowWrap: "anywhere" } : undefined}>
        {value}
      </strong>
    </div>
  );
}

type TopCustomersInput = {
  businessId: string;
  todayStart: Date;
  tomorrowStart: Date;
};

async function getTopCustomers({
  businessId,
  todayStart,
  tomorrowStart,
}: TopCustomersInput) {
  const customerSales = await prisma.workOrder.groupBy({
    by: ["customerId"],
    where: {
      businessId,
      status: {
        not: "CANCELLED",
      },
      createdAt: {
        gte: todayStart,
        lt: tomorrowStart,
      },
    },
    _sum: {
      total: true,
    },
    _count: true,
    orderBy: {
      _sum: {
        total: "desc",
      },
    },
    take: 5,
  });

  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      id: {
        in: customerSales.map((sale) => sale.customerId),
      },
    },
    select: {
      id: true,
      name: true,
    },
  });
  const customerNameById = new Map(
    customers.map((customer) => [customer.id, customer.name]),
  );

  return customerSales.map((sale) => ({
    name: customerNameById.get(sale.customerId) ?? "Customer",
    total: sale._sum.total,
    orderCount: sale._count,
  }));
}

async function getReturningCustomerPercent(
  businessId: string,
  todayCustomerIds: string[],
) {
  const uniqueTodayCustomerIds = [...new Set(todayCustomerIds)];

  if (!uniqueTodayCustomerIds.length) {
    return 0;
  }

  const historicalCounts = await prisma.workOrder.groupBy({
    by: ["customerId"],
    where: {
      businessId,
      customerId: {
        in: uniqueTodayCustomerIds,
      },
      status: {
        not: "CANCELLED",
      },
    },
    _count: true,
  });
  const returningCount = historicalCounts.filter(
    (customer) => customer._count > 1,
  ).length;

  return (returningCount / uniqueTodayCustomerIds.length) * 100;
}

function Leaderboard({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { label: string; meta: string; value: string }[];
  emptyLabel: string;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Count</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.meta}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">{emptyLabel}</p>
      )}
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
