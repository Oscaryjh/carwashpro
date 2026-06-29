import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createPackageCategoryAction,
  updatePackageCategoryAction,
} from "./actions";

type PackageCategoriesPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function PackageCategoriesPage({
  searchParams,
}: PackageCategoriesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertRole(user, ["BUSINESS_OWNER"]);

  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const categories = await prisma.packageCategory.findMany({
    where: { businessId },
    include: {
      _count: {
        select: { packages: true },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Package Categories</h1>
            <p>Group prepaid packages so owners can manage plans faster.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/packages/new">
              New Package
            </Link>
            <BackButton fallbackHref="/packages" />
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <div className="section-header">
            <h2>Create category</h2>
          </div>
          <form className="service-category-create-form" action={createPackageCategoryAction}>
            <label>
              <span>Category name</span>
              <input name="name" placeholder="Prepaid wash" required />
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
                  action={updatePackageCategoryAction}
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
                    <small>{category._count.packages} packages</small>
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
