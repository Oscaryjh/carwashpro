import Link from "next/link";
import { ProductCreateModal } from "@/components/product-create-modal";
import { AppShell } from "@/components/app-shell";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createProductAction } from "./actions";

type ProductsPageProps = {
  searchParams: Promise<{ q?: string; status?: string; categoryId?: string; type?: string; message?: string }>;
};

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "PRODUCTS");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const categoryId = params.categoryId ?? "";
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        businessId,
        ...(status ? { status } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } }] } : {}),
      },
      include: { productCategory: true, stocks: { include: { branch: { select: { name: true } } } }, _count: { select: { invoiceItems: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.productCategory.findMany({ where: { businessId }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  ]);
  const branches = await getActiveBranches(businessId);
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const isCreateOpen = params.type === "create";

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Products</h1>
            <p>Manage retail products and stock for each branch.</p>
          </div>
          <div className="inline-actions"><Link className="secondary-link-button" href="/products/categories">Manage categories</Link><Link className="button-link" href="/products?type=create">New product</Link></div>
        </div>
        {message ? <div className={messageType}>{message}</div> : null}
        <div className="panel">
          <form action="/products" className="search-form">
            <input defaultValue={query} name="q" placeholder="Search product, SKU, or category" />
            <select defaultValue={status} name="status" aria-label="Status">
              <option value="">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <select defaultValue={categoryId} name="categoryId" aria-label="Category">
              <option value="">All categories</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.status === "INACTIVE" ? " (inactive)" : ""}</option>)}
            </select>
            <button type="submit">Filter</button>
          </form>
          {products.length ? (
            <table className="table">
              <thead>
                <tr><th>No.</th><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {products.map((product, index) => (
                  <tr key={product.id}>
                    <td className="table-number">{index + 1}</td>
                    <td><Link href={`/products/${product.id}`}><strong>{product.name}</strong></Link>{product.productCategory?.name ?? product.category ? <div className="work-order-subtext">{product.productCategory?.name ?? product.category}</div> : null}</td>
                    <td>{product.sku ?? "-"}</td>
                    <td>RM{Number(product.price).toFixed(2)}</td>
                    <td>{product.stocks.reduce((total, stock) => total + stock.quantity, 0)}</td>
                    <td><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></td>
                    <td><Link href={`/products/${product.id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty-state">No products yet.</p>}
        </div>
      </section>
      {isCreateOpen ? <ProductCreateModal action={createProductAction} branches={branches} categories={categories.filter((category) => category.status === "ACTIVE")} /> : null}
    </AppShell>
  );
}
