import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  createServiceCategoryAction,
  updateServiceCategoryAction,
} from "./actions";

type ServiceCategoriesPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function ServiceCategoriesPage({
  searchParams,
}: ServiceCategoriesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "SERVICES");

  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const categories = await prisma.serviceCategory.findMany({
    where: { businessId },
    include: {
      _count: {
        select: { services: true },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Service Categories</h1>
            <p>Group services so staff can find the right wash menu faster.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/services/new">
              New Service
            </Link>
            <BackButton fallbackHref="/services" />
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <div className="section-header">
            <h2>Create category</h2>
          </div>
          <form className="service-category-create-form" action={createServiceCategoryAction}>
            <label>
              <span>Category name</span>
              <input name="name" placeholder="Basic Wash" required />
            </label>
            <button type="submit">Create</button>
          </form>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Categories</h2>
            <span className="muted">{categories.length} total</span>
          </div>
          {categories.length ? (
            <div className="service-category-list">
              {categories.map((category, index) => (
                <form
                  action={updateServiceCategoryAction}
                  className="service-category-row"
                  key={category.id}
                >
                  <input type="hidden" name="categoryId" value={category.id} />
                  <span className="table-number">{index + 1}</span>
                  <label>
                    <span>Name</span>
                    <input name="name" defaultValue={category.name} required />
                  </label>
                  <label>
                    <span>Status</span>
                    <select name="status" defaultValue={category.status}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                  <div className="service-category-meta">
                    <span className={`status ${category.status.toLowerCase()}`}>
                      {category.status}
                    </span>
                    <small>{category._count.services} services</small>
                  </div>
                  <button type="submit">Save</button>
                </form>
              ))}
            </div>
          ) : (
            <p className="empty-state">No categories yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
