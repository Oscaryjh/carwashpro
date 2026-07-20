import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import { createProductCategoryAction, updateProductCategoryAction } from "./actions";

type ProductCategoriesPageProps = {
  searchParams: Promise<{ message?: string; type?: string }>;
};

export default async function ProductCategoriesPage({ searchParams }: ProductCategoriesPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PRODUCTS");
  const params = await searchParams;
  const categories = await prisma.productCategory.findMany({
    where: { businessId },
    include: { _count: { select: { products: true } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Product Categories</h1>
            <p>Group products so staff can find the right SKU faster at the Cashier.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/products?type=create">New product</Link>
            <BackButton fallbackHref="/products" />
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="panel">
          <div className="section-header"><h2>Create category</h2></div>
          <form className="service-category-create-form" action={createProductCategoryAction}>
            <label>
              <span>Category name</span>
              <input name="name" placeholder="Hair care, Retail, Accessories" required />
            </label>
            <button type="submit">Create</button>
          </form>
        </div>

        <div className="panel">
          <div className="section-header"><h2>Categories</h2><span className="muted">{categories.length} total</span></div>
          {categories.length ? (
            <div className="service-category-list">
              {categories.map((category, index) => (
                <form action={updateProductCategoryAction} className="service-category-row" key={category.id}>
                  <input name="categoryId" type="hidden" value={category.id} />
                  <span className="table-number">{index + 1}</span>
                  <label><span>Name</span><input defaultValue={category.name} name="name" required /></label>
                  <label>
                    <span>Status</span>
                    <select defaultValue={category.status} name="status">
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                  <div className="service-category-meta">
                    <span className={`status ${category.status.toLowerCase()}`}>{category.status}</span>
                    <small>{category._count.products} products</small>
                  </div>
                  <button type="submit">Save</button>
                </form>
              ))}
            </div>
          ) : <p className="empty-state">No product categories yet.</p>}
        </div>
      </section>
    </AppShell>
  );
}
