import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LoyaltyTabs } from "@/components/loyalty-tabs";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type LoyaltyPageProps = {
  searchParams: Promise<{
    type?: string;
    message?: string;
  }>;
};

export default async function LoyaltyPage({ searchParams }: LoyaltyPageProps) {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "LOYALTY");
  const params = await searchParams;

  const [memberCount, activeCount, totals, recentActivity] =
    await Promise.all([
      prisma.customerMembership.count({ where: { businessId } }),
      prisma.customerMembership.count({ where: { businessId, status: "ACTIVE" } }),
      prisma.customerMembership.aggregate({
        where: { businessId },
        _sum: {
          pointsBalance: true,
          lifetimePointsEarned: true,
          lifetimePointsReversed: true,
        },
      }),
      prisma.loyaltyTransaction.findMany({
        where: { businessId },
        include: { customer: true, createdBy: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  return (
    <AppShell user={user}>
      <section className="content loyalty-content">
        <div className="page-header">
          <div>
            <h1>Membership</h1>
            <p>Member point balances and an auditable loyalty history.</p>
          </div>
        </div>

        {params.message ? (
          <div className={params.type === "error" ? "alert error" : "alert success"}>
            {params.message}
          </div>
        ) : null}

        <LoyaltyTabs
          active="overview"
          showSettings={user.role === "BUSINESS_OWNER"}
        />

        <div className="loyalty-metrics">
          <LoyaltyMetric label="Members" value={memberCount} />
          <LoyaltyMetric label="Active" value={activeCount} />
          <LoyaltyMetric label="Points outstanding" value={totals._sum.pointsBalance ?? 0} />
          <LoyaltyMetric label="Lifetime earned" value={totals._sum.lifetimePointsEarned ?? 0} />
          <LoyaltyMetric label="Refund reversals" value={totals._sum.lifetimePointsReversed ?? 0} />
        </div>

        <div className="panel">
          <div className="section-header">
            <div>
              <h2>Recent point activity</h2>
              <p className="muted">The latest changes across all members.</p>
            </div>
            <Link href="/loyalty/activity">View all</Link>
          </div>
          {recentActivity.length ? (
            <div className="loyalty-activity-list">
              {recentActivity.map((activity) => (
                <div className="loyalty-activity-row" key={activity.id}>
                  <div className="loyalty-activity-member">
                    <Link href={`/crm/customers/${activity.customerId}`}>
                      <strong>{activity.customer.name}</strong>
                    </Link>
                    <span>{formatTransactionType(activity.type)}</span>
                  </div>
                  <strong className={activity.points >= 0 ? "points-positive" : "points-negative"}>
                    {activity.points > 0 ? "+" : ""}{activity.points}
                  </strong>
                  <div className="loyalty-activity-detail">
                    <span>{activity.description}</span>
                    <small>
                      {activity.createdAt.toLocaleString("en-MY")} - {activity.createdBy?.name ?? "System"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No point activity yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function LoyaltyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="customer-info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTransactionType(type: string) {
  return type.toLowerCase().replaceAll("_", " ");
}
