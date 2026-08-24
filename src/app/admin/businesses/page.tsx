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
import styles from "../admin-directory.module.css";

type BusinessesPageProps = {
  searchParams: Promise<{
    q?: string;
    industry?: string;
    status?: string;
    page?: string;
  }>;
};

const PAGE_SIZE = 10;

export default async function BusinessesPage({
  searchParams,
}: BusinessesPageProps) {
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

  const where: Prisma.BusinessWhereInput = filters.length
    ? { AND: filters }
    : {};
  const [totalCount, statusCounts] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
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
  const totalBusinesses = statusCounts.reduce(
    (sum, item) => sum + item._count._all,
    0,
  );
  const activeBusinesses =
    statusCounts.find((item) => item.status === "active")?._count._all ?? 0;
  const inactiveBusinesses = totalBusinesses - activeBusinesses;

  return (
    <AppShell user={user}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Platform administration</p>
            <h1>Businesses</h1>
            <p className={styles.heroDescription}>
              Create companies, review their access status and open the correct
              workspace from one directory.
            </p>
          </div>
          <Link className={styles.primaryAction} href="/admin/businesses/new">
            + New business
          </Link>
        </header>

        <section className={styles.metrics} aria-label="Business summary">
          <article className={styles.metric}>
            <span>All businesses</span>
            <strong>{totalBusinesses}</strong>
            <small>Across every industry</small>
          </article>
          <article className={styles.metric}>
            <span>Active</span>
            <strong>{activeBusinesses}</strong>
            <small>Available to operate</small>
          </article>
          <article className={styles.metric}>
            <span>Inactive</span>
            <strong>{inactiveBusinesses}</strong>
            <small>Access is paused</small>
          </article>
          <article className={styles.metric}>
            <span>Matching results</span>
            <strong>{totalCount}</strong>
            <small>
              {hasFilters ? "Using current filters" : "No filters applied"}
            </small>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Business directory</h2>
              <p>
                Showing {rangeStart}-{rangeEnd} of {totalCount} matching
                businesses.
              </p>
            </div>
            <span className={styles.countBadge}>
              {totalCount} result{totalCount === 1 ? "" : "s"}
            </span>
          </div>
          <form className={styles.toolbar} action="/admin/businesses">
            <label className={styles.field}>
              <span>Search</span>
              <input
                name="q"
                defaultValue={query}
                placeholder="Name, company no., phone or email"
              />
            </label>
            <label className={styles.field}>
              <span>Industry</span>
              <select name="industry" defaultValue={industry}>
                <option value="">All industries</option>
                {BUSINESS_INDUSTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Status</span>
              <select name="status" defaultValue={status}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button type="submit">Apply filters</button>
          </form>
          {hasFilters ? (
            <div className={styles.panelBody}>
              <Link className={styles.clearLink} href="/admin/businesses">
                Clear all filters
              </Link>
            </div>
          ) : null}
          {businesses.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
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
                        <div className={styles.subtext}>{business.slug}</div>
                      </td>
                      <td>{business.companyNo || "No company no."}</td>
                      <td>{getBusinessIndustryLabel(business.industryType)}</td>
                      <td>
                        <div>{business.phone || "No phone"}</div>
                        <div className={styles.subtext}>
                          {business.email || "No email"}
                        </div>
                      </td>
                      <td>
                        <span className={`status ${business.status}`}>
                          {business.status}
                        </span>
                      </td>
                      <td>{business._count.users}</td>
                      <td>{business.createdAt.toLocaleDateString("en-MY")}</td>
                      <td>
                        <Link
                          className={styles.rowAction}
                          href={`/admin/businesses/${business.id}`}
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.emptyState}>
              {hasFilters
                ? "No companies match these filters."
                : "No companies yet."}
            </p>
          )}
          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <Link
                className={currentPage === 1 ? "disabled" : undefined}
                href={buildPageHref({
                  query,
                  industry,
                  status,
                  page: currentPage - 1,
                })}
                aria-disabled={currentPage === 1}
              >
                Previous
              </Link>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Link
                className={currentPage === totalPages ? "disabled" : undefined}
                href={buildPageHref({
                  query,
                  industry,
                  status,
                  page: currentPage + 1,
                })}
                aria-disabled={currentPage === totalPages}
              >
                Next
              </Link>
            </div>
          ) : null}
        </section>
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
