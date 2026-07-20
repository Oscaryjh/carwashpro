import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

type PackagesPageProps = {
  searchParams: Promise<{
    q?: string;
    categoryId?: string;
    status?: string;
    branchId?: string;
  }>;
};

const ALL_BRANCHES_ONLY = "all-branches-only";

export default async function PackagesPage({ searchParams }: PackagesPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  assertStaffPermission(user, "PACKAGES");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const categoryId = isUuid(params.categoryId) ? params.categoryId : "";
  const status =
    params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const branchId =
    params.branchId === ALL_BRANCHES_ONLY || isUuid(params.branchId)
      ? params.branchId
      : "";

  const filters: Prisma.PackageWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { packageCategory: { name: { contains: query, mode: "insensitive" } } },
        { service: { name: { contains: query, mode: "insensitive" } } },
        { branch: { name: { contains: query, mode: "insensitive" } } },
      ],
    });
  }

  if (categoryId) {
    filters.push({ categoryId });
  }

  if (status) {
    filters.push({ status });
  }

  if (branchId === ALL_BRANCHES_ONLY) {
    filters.push({ branchId: null });
  } else if (branchId) {
    filters.push({ branchId });
  }

  const [packages, categories, branches] = await Promise.all([
    prisma.package.findMany({
      where: {
        businessId,
        ...(filters.length ? { AND: filters } : {}),
      },
      include: {
        branch: true,
        packageCategory: true,
        service: true,
        _count: {
          select: { customerPackages: true },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.packageCategory.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    getActiveBranches(businessId),
  ]);

  const hasFilters = Boolean(query || categoryId || status || branchId);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Packages</h1>
            <p>
              {hasFilters
                ? `${packages.length} package${packages.length === 1 ? "" : "s"} match this filter.`
                : isSalonBusiness
                  ? "Prepaid service packages and remaining-use tracking."
                  : "Prepaid wash packages and remaining-use tracking."}
            </p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/packages/categories">
              Categories
            </Link>
            <Link className="button-link" href="/packages/new">
              New Package
            </Link>
          </div>
        </div>

        <div className="panel">
          <form className="search-form service-filter-form" action="/packages">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search package, category, service, or branch"
            />
            <select name="categoryId" defaultValue={categoryId} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {category.status === "INACTIVE" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={status} aria-label="Status">
              <option value="">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <select name="branchId" defaultValue={branchId} aria-label="Branch">
              <option value="">All branches</option>
              <option value={ALL_BRANCHES_ONLY}>All branches only</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <button type="submit">Filter</button>
            {hasFilters ? (
              <Link className="secondary-link-button" href="/packages">
                Clear
              </Link>
            ) : null}
          </form>
          {packages.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Category</th>
                  <th>Package</th>
                  <th>Price</th>
                  <th>{isSalonBusiness ? "Uses" : "Washes"}</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Sold</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((packagePlan, index) => (
                  <tr key={packagePlan.id}>
                    <td className="table-number">{index + 1}</td>
                    <td>{packagePlan.packageCategory?.name ?? "-"}</td>
                    <td>
                      <Link href={`/packages/${packagePlan.id}`}>
                        <strong>{packagePlan.name}</strong>
                      </Link>
                      <div className="muted">
                        {packagePlan.branch?.name ?? "All branches"}
                      </div>
                    </td>
                    <td>RM{Number(packagePlan.price).toFixed(2)}</td>
                    <td>{packagePlan.totalUses}</td>
                    <td>
                      {packagePlan.service?.name ??
                        (isSalonBusiness ? "Any service" : "Any wash service")}
                    </td>
                    <td>
                      <span className={`status ${packagePlan.status.toLowerCase()}`}>
                        {packagePlan.status}
                      </span>
                    </td>
                    <td>{packagePlan._count.customerPackages}</td>
                    <td>
                      <Link href={`/packages/${packagePlan.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No packages yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function isUuid(value?: string) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}
