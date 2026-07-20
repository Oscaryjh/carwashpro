import Link from "next/link";
import type { BusinessIndustry, BusinessStatus, Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  BUSINESS_INDUSTRY_OPTIONS,
  getBusinessIndustryLabel,
} from "@/lib/business-industry";

type BusinessesPageProps = {
  searchParams: Promise<{
    q?: string;
    industry?: string;
    status?: string;
    page?: string;
  }>;
};

const PAGE_SIZE = 10;

export default async function BusinessesPage({ searchParams }: BusinessesPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const industry = isBusinessIndustry(params.industry) ? params.industry : "";
  const status = isBusinessStatus(params.status) ? params.status : "";
  const requestedPage = parsePage(params.page);

  const filters: Prisma.BusinessWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
        { companyNo: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  if (industry) {
    filters.push({ industryType: industry });
  }

  if (status) {
    filters.push({ status });
  }

  const where: Prisma.BusinessWhereInput = filters.length ? { AND: filters } : {};
  const totalCount = await prisma.business.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);

  const businesses = await prisma.business.findMany({
    where,
    include: {
      _count: {
        select: { users: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const rangeStart = totalCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalCount);
  const hasFilters = Boolean(query || industry || status);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Businesses</h1>
            <p>Create and manage companies across supported industries.</p>
          </div>
          <Link className="button-link" href="/admin/businesses/new">
            Create Company
          </Link>
        </div>

        <div className="panel">
          <div className="list-toolbar">
            <div>
              <h2>All companies</h2>
              <span className="muted">
                Showing {rangeStart}-{rangeEnd} of {totalCount}
              </span>
            </div>
            {hasFilters ? <Link href="/admin/businesses">Clear filters</Link> : null}
          </div>
          <form className="search-form" action="/admin/businesses">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search company, slug, no., phone, or email"
            />
            <select name="industry" defaultValue={industry} aria-label="Industry">
              <option value="">All industries</option>
              {BUSINESS_INDUSTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={status} aria-label="Status">
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button type="submit">Filter</button>
          </form>
          {businesses.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Company No.</th>
                  <th>Industry</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Users</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => (
                  <tr key={business.id}>
                    <td>
                      <strong>{business.name}</strong>
                      <div className="muted">{business.slug}</div>
                    </td>
                    <td>{business.companyNo || "No company no."}</td>
                    <td>{getBusinessIndustryLabel(business.industryType)}</td>
                    <td>
                      <div>{business.phone || "No phone"}</div>
                      <div className="muted">{business.email || "No email"}</div>
                    </td>
                    <td>
                      <span className={`status ${business.status}`}>
                        {business.status}
                      </span>
                    </td>
                    <td>{business._count.users}</td>
                    <td>{business.createdAt.toLocaleDateString()}</td>
                    <td>
                      <Link href={`/admin/businesses/${business.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">
              {hasFilters ? "No companies match these filters." : "No companies yet."}
            </p>
          )}
          {totalPages > 1 ? (
            <div className="pagination">
              <Link
                className={currentPage === 1 ? "disabled" : undefined}
                href={buildPageHref({ query, industry, status, page: currentPage - 1 })}
                aria-disabled={currentPage === 1}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                className={currentPage === totalPages ? "disabled" : undefined}
                href={buildPageHref({ query, industry, status, page: currentPage + 1 })}
                aria-disabled={currentPage === totalPages}
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

function isBusinessIndustry(value?: string): value is BusinessIndustry {
  return BUSINESS_INDUSTRY_OPTIONS.some((option) => option.value === value);
}

function isBusinessStatus(value?: string): value is BusinessStatus {
  return value === "active" || value === "inactive";
}

function parsePage(value?: string) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildPageHref({
  query,
  industry,
  status,
  page,
}: {
  query: string;
  industry: string;
  status: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (industry) params.set("industry", industry);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return queryString ? `/admin/businesses?${queryString}` : "/admin/businesses";
}
