import Link from "next/link";
import type { LoyaltyTransactionType, Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { LoyaltyTabs } from "@/components/loyalty-tabs";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type LoyaltyActivityPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    transactionType?: string;
    range?: string;
  }>;
};

const PAGE_SIZE = 25;
const transactionTypes: LoyaltyTransactionType[] = [
  "EARN",
  "WELCOME_BONUS",
  "REFUND_REVERSAL",
  "MANUAL_ADJUSTMENT",
];
const activityRanges = ["today", "7days", "30days"] as const;
type ActivityRange = (typeof activityRanges)[number];

export default async function LoyaltyActivityPage({ searchParams }: LoyaltyActivityPageProps) {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "LOYALTY");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const transactionType = transactionTypes.includes(params.transactionType as LoyaltyTransactionType)
    ? (params.transactionType as LoyaltyTransactionType)
    : undefined;
  const range = activityRanges.includes(params.range as ActivityRange)
    ? (params.range as ActivityRange)
    : undefined;
  const requestedPage = Math.max(Number(params.page) || 1, 1);
  const where: Prisma.LoyaltyTransactionWhereInput = {
    businessId,
    ...(transactionType ? { type: transactionType } : {}),
    ...(range ? { createdAt: { gte: rangeStart(range) } } : {}),
    ...(query
      ? {
          OR: [
            { customer: { name: { contains: query, mode: "insensitive" } } },
            { customer: { phone: { contains: query } } },
            { description: { contains: query, mode: "insensitive" } },
            { createdBy: { name: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const totalCount = await prisma.loyaltyTransaction.count({ where });
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const currentPage = Math.min(requestedPage, totalPages);
  const activity = await prisma.loyaltyTransaction.findMany({
    where,
    include: { customer: true, createdBy: true },
    orderBy: { createdAt: "desc" },
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const firstItem = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  return (
    <AppShell user={user}>
      <section className="content loyalty-content">
        <div className="page-header">
          <div>
            <h1>Membership</h1>
            <p>Review every point change and the staff member or system process that created it.</p>
          </div>
        </div>

        <LoyaltyTabs
          active="activity"
          showSettings={user.role === "BUSINESS_OWNER"}
        />

        <div className="panel">
          <div className="section-header loyalty-list-header">
            <div>
              <h2>Point activity</h2>
              <p className="muted">
                {totalCount ? `Showing ${firstItem}-${lastItem} of ${totalCount} entries.` : "No point activity found."}
              </p>
            </div>
            <form className="loyalty-filter-form loyalty-activity-filter" action="/loyalty/activity">
              <input name="q" defaultValue={query} placeholder="Customer, phone, staff, or description" />
              <select name="transactionType" defaultValue={transactionType ?? ""} aria-label="Activity type">
                <option value="">All activity types</option>
                {transactionTypes.map((type) => (
                  <option key={type} value={type}>{formatTransactionType(type)}</option>
                ))}
              </select>
              <select name="range" defaultValue={range ?? ""} aria-label="Activity date range">
                <option value="">All dates</option>
                <option value="today">Today</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
              </select>
              <button type="submit">Filter</button>
              {query || transactionType || range ? (
                <Link className="secondary-link-button" href="/loyalty/activity">Clear</Link>
              ) : null}
            </form>
          </div>

          {activity.length ? (
            <div className="loyalty-activity-list">
              <div className="loyalty-activity-columns" aria-hidden="true">
                <span>Member</span>
                <span>Activity</span>
                <span>Points</span>
                <span>Details</span>
              </div>
              {activity.map((entry) => (
                <div className="loyalty-activity-row" key={entry.id}>
                  <div className="loyalty-activity-member">
                    <Link href={`/crm/customers/${entry.customerId}`}>
                      <strong>{entry.customer.name}</strong>
                    </Link>
                    <small>{entry.customer.phone}</small>
                  </div>
                  <span className="loyalty-activity-type">{formatTransactionType(entry.type)}</span>
                  <strong className={entry.points >= 0 ? "points-positive" : "points-negative"}>
                    {entry.points > 0 ? "+" : ""}{entry.points}
                  </strong>
                  <div className="loyalty-activity-detail">
                    <span>{entry.description}</span>
                    <small>{entry.createdAt.toLocaleString("en-MY")} - {entry.createdBy?.name ?? "System"}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No point activity matches these filters.</p>
          )}

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeActivityHref({ q: query, transactionType, range, page: Math.max(currentPage - 1, 1) })}
              >
                Previous
              </Link>
              <span>Page {currentPage} of {totalPages}</span>
              <Link
                className={currentPage >= totalPages ? "disabled" : ""}
                href={makeActivityHref({ q: query, transactionType, range, page: Math.min(currentPage + 1, totalPages) })}
              >
                Next
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}

function rangeStart(range: ActivityRange) {
  const start = new Date();
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  start.setDate(start.getDate() - (range === "7days" ? 7 : 30));
  return start;
}

function formatTransactionType(type: string) {
  return type.toLowerCase().replaceAll("_", " ");
}

function makeActivityHref(input: {
  q: string;
  transactionType?: LoyaltyTransactionType;
  range?: ActivityRange;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.transactionType) params.set("transactionType", input.transactionType);
  if (input.range) params.set("range", input.range);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/loyalty/activity?${query}` : "/loyalty/activity";
}
