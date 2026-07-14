import Link from "next/link";
import type { MembershipStatus, Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { LoyaltyTabs } from "@/components/loyalty-tabs";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type LoyaltyMembersPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
  }>;
};

const PAGE_SIZE = 20;
const membershipStatuses: MembershipStatus[] = ["ACTIVE", "INACTIVE"];

export default async function LoyaltyMembersPage({ searchParams }: LoyaltyMembersPageProps) {
  const { businessId, user } = await requireBusinessUser();
  assertStaffPermission(user, "LOYALTY");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = membershipStatuses.includes(params.status as MembershipStatus)
    ? (params.status as MembershipStatus)
    : undefined;
  const requestedPage = Math.max(Number(params.page) || 1, 1);
  const where: Prisma.CustomerMembershipWhereInput = {
    businessId,
    ...(status ? { status } : {}),
    ...(query
      ? {
          customer: {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { vehicles: { some: { plateNumber: { contains: query, mode: "insensitive" } } } },
            ],
          },
        }
      : {}),
  };

  const totalCount = await prisma.customerMembership.count({ where });
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const currentPage = Math.min(requestedPage, totalPages);
  const members = await prisma.customerMembership.findMany({
    where,
    include: { customer: true },
    orderBy: [{ pointsBalance: "desc" }, { joinedAt: "desc" }],
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
            <p>Search members and review their current point balances.</p>
          </div>
        </div>

        <LoyaltyTabs
          active="members"
          showSettings={user.role === "BUSINESS_OWNER"}
        />

        <div className="panel">
          <div className="section-header loyalty-list-header">
            <div>
              <h2>Members</h2>
              <p className="muted">
                {totalCount ? `Showing ${firstItem}-${lastItem} of ${totalCount} members.` : "No members found."}
              </p>
            </div>
            <form className="loyalty-filter-form" action="/loyalty/members">
              <input name="q" defaultValue={query} placeholder="Search name, phone, or plate" />
              <select name="status" defaultValue={status ?? ""} aria-label="Membership status">
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
              <button type="submit">Search</button>
              {query || status ? (
                <Link className="secondary-link-button" href="/loyalty/members">
                  Clear
                </Link>
              ) : null}
            </form>
          </div>

          {members.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Balance</th>
                    <th>Earned</th>
                    <th>Reversed</th>
                    <th>Joined</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((membership, index) => (
                    <tr key={membership.id}>
                      <td className="table-number">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td>
                        <strong>{membership.customer.name}</strong>
                        <div className="muted">{membership.customer.phone}</div>
                      </td>
                      <td>
                        <span className={`status ${membership.status.toLowerCase()}`}>
                          {membership.status.toLowerCase()}
                        </span>
                      </td>
                      <td><strong>{membership.pointsBalance}</strong> pts</td>
                      <td>{membership.lifetimePointsEarned}</td>
                      <td>{membership.lifetimePointsReversed}</td>
                      <td>{membership.joinedAt.toLocaleDateString("en-MY")}</td>
                      <td><Link href={`/crm/customers/${membership.customerId}`}>View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">No membership records match these filters.</p>
          )}

          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage <= 1 ? "disabled" : ""}
                href={makeMembersHref({ q: query, status, page: Math.max(currentPage - 1, 1) })}
              >
                Previous
              </Link>
              <span>Page {currentPage} of {totalPages}</span>
              <Link
                className={currentPage >= totalPages ? "disabled" : ""}
                href={makeMembersHref({ q: query, status, page: Math.min(currentPage + 1, totalPages) })}
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

function makeMembersHref(input: { q: string; status?: MembershipStatus; page: number }) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.status) params.set("status", input.status);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/loyalty/members?${query}` : "/loyalty/members";
}
