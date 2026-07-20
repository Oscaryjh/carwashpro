import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { CatalogCategoriesModal } from "@/components/catalog-categories-modal";
import { DeleteServiceForm } from "@/components/delete-service-form";
import { ServiceCreateModal } from "@/components/service-create-modal";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { prisma } from "@/lib/prisma";
import { createServiceAction } from "./actions";
import {
  createServiceCategoryAction,
  deleteServiceCategoryAction,
  updateServiceCategoryAction,
} from "./categories/actions";

type ServicesPageProps = {
  searchParams: Promise<{
    q?: string;
    categoryId?: string;
    status?: string;
    branchId?: string;
    modal?: string;
    message?: string;
    type?: string;
  }>;
};

const ALL_BRANCHES_ONLY = "all-branches-only";

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const context = await requireBusinessIndustryContext();
  const { user, businessId } = context;
  assertStaffPermission(user, "SERVICES");
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const params = await searchParams;
  const isCreateOpen = params.modal === "create";
  const isCategoriesOpen = params.modal === "categories";
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";

  const query = params.q?.trim() ?? "";
  const categoryId = isUuid(params.categoryId) ? params.categoryId : "";
  const status =
    params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const branchId =
    params.branchId === ALL_BRANCHES_ONLY || isUuid(params.branchId)
      ? params.branchId
      : "";

  const filters: Prisma.ServiceWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { category: { contains: query, mode: "insensitive" } },
        { serviceCategory: { name: { contains: query, mode: "insensitive" } } },
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

  const [services, categories, branches, staffOptions] = await Promise.all([
    prisma.service.findMany({
      where: {
        businessId,
        ...(filters.length ? { AND: filters } : {}),
      },
      include: {
        branch: true,
        serviceCategory: true,
        staffAssignments: {
          where: { businessId },
          include: { user: { select: { name: true } } },
        },
        _count: { select: { staffAssignments: true } },
      },
      orderBy: [{ status: "asc" }, { category: "asc" }, { name: "asc" }],
    }),
    prisma.serviceCategory.findMany({
      where: { businessId },
      include: { _count: { select: { services: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    getActiveBranches(businessId),
    isSalonBusiness
      ? prisma.user.findMany({
          where: {
            businessId,
            status: "active",
            role: { in: ["BUSINESS_OWNER", "STAFF"] },
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            role: true,
            branch: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const hasFilters = Boolean(query || categoryId || status || branchId);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Services</h1>
            <p>
              {hasFilters
                ? `${services.length} service${services.length === 1 ? "" : "s"} match this filter.`
                : isSalonBusiness
                  ? "Manage treatment pricing, duration, and available staff."
                  : "Service menu for this business."}
            </p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/services?modal=categories">
              Categories
            </Link>
            <Link className="button-link" href="/services?modal=create">
              New Service
            </Link>
          </div>
        </div>

        {message && !isCategoriesOpen ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <form className="search-form service-filter-form" action="/services">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search service, category, or branch"
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
              <Link className="secondary-link-button" href="/services">
                Clear
              </Link>
            ) : null}
          </form>
          {services.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Category</th>
                  <th>Service</th>
                  <th>Price</th>
                  {isSalonBusiness ? <th>Duration</th> : null}
                  {isSalonBusiness ? <th>Staff</th> : null}
                  <th>Status</th>
                  <th>Branch</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service, index) => (
                  <tr key={service.id}>
                    <td className="table-number">{index + 1}</td>
                    <td>{service.serviceCategory?.name ?? service.category ?? "-"}</td>
                    <td>
                      <Link href={`/services/${service.id}`}>
                        <strong>{service.name}</strong>
                      </Link>
                    </td>
                    <td>RM{Number(service.price).toFixed(2)}</td>
                    {isSalonBusiness ? (
                      <td>
                        {service.durationMinutes
                          ? `${service.durationMinutes} min`
                          : "-"}
                      </td>
                    ) : null}
                    {isSalonBusiness ? (
                      <td>
                        {service.staffAssignments.length ? (
                          <div className="service-staff-summary">
                            {service.staffAssignments.map((assignment) => (
                              <span key={assignment.userId}>{assignment.user.name}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">All active staff</span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      <span className={`status ${service.status.toLowerCase()}`}>
                        {service.status}
                      </span>
                    </td>
                    <td>{service.branch?.name ?? "All branches"}</td>
                    <td>
                      <div className="catalog-table-actions">
                        <Link href={`/services/${service.id}`}>View</Link>
                        <DeleteServiceForm
                          compact
                          serviceId={service.id}
                          serviceName={service.name}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No services yet.</p>
          )}
        </div>
      </section>
      {isCreateOpen ? (
        <ServiceCreateModal
          action={createServiceAction}
          branches={branches}
          categories={categories.filter((category) => category.status === "ACTIVE")}
          isSalonBusiness={isSalonBusiness}
          staffOptions={staffOptions.map((staff) => ({
            id: staff.id,
            name: staff.name,
            role: staff.role,
            branchName: staff.branch?.name ?? null,
          }))}
        />
      ) : null}
      {isCategoriesOpen ? (
        <CatalogCategoriesModal
          categories={categories.map((category) => ({
            id: category.id,
            itemCount: category._count.services,
            name: category.name,
            status: category.status,
          }))}
          closePath="/services"
          createAction={createServiceCategoryAction}
          deleteAction={deleteServiceCategoryAction}
          description={
            isSalonBusiness
              ? "Group treatments so staff can find the right service faster."
              : "Group services so staff can find the right service faster."
          }
          itemLabel="service"
          message={message}
          messageType={messageType}
          placeholder={isSalonBusiness ? "Hair services" : "Basic wash"}
          title="Service categories"
          updateAction={updateServiceCategoryAction}
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
