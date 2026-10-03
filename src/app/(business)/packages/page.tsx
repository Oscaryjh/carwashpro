import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { CatalogCategoriesModal } from "@/components/catalog-categories-modal";
import { CatalogPagination } from "@/components/catalog-pagination";
import { DeletePackageForm } from "@/components/delete-package-form";
import { PackageCreateModal } from "@/components/package-create-modal";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { authorizedCustomerPackageBranchWhere, canAccessOperationalBranch, getActiveBranches } from "@/lib/branches";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { createPackageAction } from "./actions";
import {
  createPackageCategoryAction,
  deletePackageCategoryAction,
  updatePackageCategoryAction,
} from "./categories/actions";

type PackagesPageProps = {
  searchParams: Promise<{
    q?: string;
    categoryId?: string;
    status?: string;
    branchId?: string;
    modal?: string;
    message?: string;
    type?: string;
    page?: string;
  }>;
};

const ALL_BRANCHES_ONLY = "all-branches-only";
const CATALOG_PAGE_SIZE = 10;

export default async function PackagesPage({ searchParams }: PackagesPageProps) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("VIEW_CATALOG");
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "PACKAGES");
  }

  const params = await searchParams;
  const isCreateOpen = params.modal === "create";
  const isCategoriesOpen = params.modal === "categories";
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const query = params.q?.trim() ?? "";
  const categoryId = isUuid(params.categoryId) ? (params.categoryId ?? "") : "";
  const status =
    params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const branchId = params.branchId ?? "";
  // Group grants are already resolved for this Business and capability at admission.
  const groupBusinessRead = access.granted && access.source === "GROUP_ACCESS" &&
    access.businessId === businessId && hasBusinessCapability(access, "VIEW_CATALOG");
  const packageBranchScope = groupBusinessRead ? {} : authorizedCustomerPackageBranchWhere(user);
  if (branchId && branchId !== ALL_BRANCHES_ONLY) {
    if (!isUuid(branchId)) throw new Error("Package branch access denied.");
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, businessId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!branch || (!groupBusinessRead && !canAccessOperationalBranch(user, branch.id))) {
      throw new Error("Package branch access denied.");
    }
  }
  const currentPage = Math.max(1, Number(params.page) || 1);
  const pageSkip = (currentPage - 1) * CATALOG_PAGE_SIZE;

  const filters: Prisma.PackageWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { packageCategory: { name: { contains: query, mode: "insensitive" } } },
          { service: { name: { contains: query, mode: "insensitive" } } },
          {
            serviceBenefits: {
              some: { service: { name: { contains: query, mode: "insensitive" } } },
            },
          },
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

  const packageWhere: Prisma.PackageWhereInput = {
    businessId,
    ...packageBranchScope,
    ...(filters.length ? { AND: filters } : {}),
  };

  const [packages, matchingCount, categories, branches, activeServices] = await Promise.all([
    prisma.package.findMany({
      where: packageWhere,
      include: {
        branch: true,
          packageCategory: true,
          service: true,
          serviceBenefits: {
            include: { service: true },
            orderBy: { createdAt: "asc" },
          },
        _count: {
          select: { customerPackages: true },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: pageSkip,
      take: CATALOG_PAGE_SIZE,
    }),
    prisma.package.count({ where: packageWhere }),
    prisma.packageCategory.findMany({
      where: { businessId },
      include: { _count: { select: { packages: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    getActiveBranches(businessId),
    prisma.service.findMany({
      where: { businessId, status: "ACTIVE" },
      include: { serviceCategory: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasFilters = Boolean(query || categoryId || status || branchId);
  const totalPages = Math.max(1, Math.ceil(matchingCount / CATALOG_PAGE_SIZE));

  return (
    <>
      <section className="content packages-list-page">
        <div className="page-header">
          <div>
            <h1>Packages</h1>
            <p>
              {hasFilters
                ? `${matchingCount} package${matchingCount === 1 ? "" : "s"} match this filter.`
                : isSalonBusiness
                  ? "Prepaid service packages and remaining-use tracking."
                  : "Prepaid wash packages and remaining-use tracking."}
            </p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/packages?modal=categories">
              Categories
            </Link>
            <Link className="button-link" href="/packages?modal=create">
              New Package
            </Link>
          </div>
        </div>

        {message && !isCategoriesOpen ? <div className={messageType}>{message}</div> : null}

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
            {branchId ? <input type="hidden" name="branchId" value={branchId} /> : null}
            <button className="button-secondary" type="submit">Filter</button>
            {hasFilters ? (
              <Link className="secondary-link-button" href="/packages">
                Clear
              </Link>
            ) : null}
          </form>
          {packages.length ? (
            <>
            <div className="catalog-table-scroll">
            <table className="table catalog-table catalog-table--packages">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Category</th>
                  <th>Package</th>
                  <th className="packages-numeric">Price</th>
                  <th className="packages-numeric">{isSalonBusiness ? "Uses" : "Washes"}</th>
                    <th>{isSalonBusiness ? "Included services" : "Service"}</th>
                  <th>Status</th>
                  <th className="packages-numeric">Sold</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((packagePlan, index) => (
                  <tr key={packagePlan.id}>
                    <td className="table-number">{pageSkip + index + 1}</td>
                    <td>{packagePlan.packageCategory?.name ?? "-"}</td>
                    <td className="packages-name">
                      <Link href={`/packages/${packagePlan.id}`}>
                        <strong>{packagePlan.name}</strong>
                      </Link>
                    </td>
                    <td className="packages-numeric">RM{Number(packagePlan.price).toFixed(2)}</td>
                    <td className="packages-numeric">{packagePlan.totalUses}</td>
                      <td>
                        <div className="packages-services">
                        <span className="packages-services-text">
                        {packagePlan.serviceBenefits.length
                          ? packagePlan.serviceBenefits
                              .slice(0, 2)
                              .map((benefit) => `${benefit.service.name} × ${benefit.totalUses}`)
                              .join(", ")
                          : packagePlan.service?.name ??
                            (isSalonBusiness ? "No services configured" : "Any wash service")}
                        </span>
                        {packagePlan.serviceBenefits.length > 2 ? <span className="packages-services-more">+{packagePlan.serviceBenefits.length - 2} more</span> : null}
                        </div>
                      </td>
                    <td>
                      <span className={`status ${packagePlan.status.toLowerCase()}`}>
                        {packagePlan.status}
                      </span>
                    </td>
                    <td className="packages-numeric">{packagePlan._count.customerPackages}</td>
                    <td>
                      <div className="catalog-table-actions">
                        <Link href={`/packages/${packagePlan.id}`}>View</Link>
                        <DeletePackageForm
                          compact
                          packageId={packagePlan.id}
                          packageName={packagePlan.name}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {totalPages === 1 ? <div className="packages-list-footer">{matchingCount} result{matchingCount === 1 ? "" : "s"}</div> : <CatalogPagination
              basePath="/packages"
              currentPage={currentPage}
              pageSize={CATALOG_PAGE_SIZE}
              query={{ q: query, categoryId, status, branchId }}
              total={matchingCount}
              totalPages={totalPages}
            />}
            </>
          ) : (
            <p className="empty-state">No packages yet.</p>
          )}
        </div>
      </section>
      {isCreateOpen ? (
        <PackageCreateModal
          action={createPackageAction}
          branches={branches}
          categories={categories.filter((category) => category.status === "ACTIVE")}
          isSalonBusiness={isSalonBusiness}
          services={activeServices}
        />
      ) : null}
      {isCategoriesOpen ? (
        <CatalogCategoriesModal
          categories={categories.map((category) => ({
            id: category.id,
            itemCount: category._count.packages,
            name: category.name,
            status: category.status,
          }))}
          closePath="/packages"
          createAction={createPackageCategoryAction}
          deleteAction={deletePackageCategoryAction}
          description="Group prepaid packages so staff can find and manage plans faster."
          itemLabel="package"
          message={message}
          messageType={messageType}
          placeholder={isSalonBusiness ? "Hair packages" : "Prepaid wash"}
          title="Package categories"
          updateAction={updatePackageCategoryAction}
        />
      ) : null}
    </>
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
