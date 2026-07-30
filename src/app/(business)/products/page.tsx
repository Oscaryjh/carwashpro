import Link from "next/link";
import type { Prisma, ProductStatus } from "@prisma/client";
import { CatalogCategoriesModal } from "@/components/catalog-categories-modal";
import { CatalogPagination } from "@/components/catalog-pagination";
import { DeleteProductForm } from "@/components/delete-product-form";
import { ProductCreateModal } from "@/components/product-create-modal";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createProductAction } from "./actions";
import {
  createProductCategoryAction,
  deleteProductCategoryAction,
  updateProductCategoryAction,
} from "./categories/actions";

type ProductsPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    categoryId?: string;
    modal?: string;
    type?: string;
    message?: string;
    page?: string;
  }>;
};

const CATALOG_PAGE_SIZE = 10;

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { access, user, businessId } =
    await requireBusinessUser("VIEW_INVENTORY");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "PRODUCTS");
  }
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : "";
  const categoryId = params.categoryId ?? "";
  const currentPage = Math.max(1, Number(params.page) || 1);
  const pageSkip = (currentPage - 1) * CATALOG_PAGE_SIZE;
  const productWhere: Prisma.ProductWhereInput = {
    businessId,
    ...(status ? { status: status as ProductStatus } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }, { category: { contains: query, mode: "insensitive" } }] } : {}),
  };
  const [products, matchingCount, categories] = await Promise.all([
    prisma.product.findMany({
      where: productWhere,
      include: { productCategory: true, stocks: { include: { branch: { select: { name: true } } } }, _count: { select: { invoiceItems: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: pageSkip,
      take: CATALOG_PAGE_SIZE,
    }),
    prisma.product.count({ where: productWhere }),
    prisma.productCategory.findMany({
      where: { businessId },
      include: { _count: { select: { products: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);
  const branches = await getActiveBranches(businessId);
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const isCreateOpen = params.modal === "create" || params.type === "create";
  const isCategoriesOpen = params.modal === "categories";
  const hasFilters = Boolean(query || status || categoryId);
  const totalPages = Math.max(1, Math.ceil(matchingCount / CATALOG_PAGE_SIZE));

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Products</h1>
            <p>{hasFilters ? `${matchingCount} product${matchingCount === 1 ? "" : "s"} match this filter.` : "Manage retail products and stock for each branch."}</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/products?modal=categories">
              Categories
            </Link>
            <Link className="button-link" href="/products?modal=create">
              New Product
            </Link>
          </div>
        </div>
        {message && !isCategoriesOpen ? <div className={messageType}>{message}</div> : null}
        <div className="panel">
          <form action="/products" className="search-form product-filter-form">
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
            {hasFilters ? <Link className="secondary-link-button" href="/products">Clear</Link> : null}
          </form>
          {products.length ? (
            <>
            <div className="catalog-table-scroll">
            <table className="table catalog-table catalog-table--products">
              <thead>
                <tr><th>No.</th><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {products.map((product, index) => (
                  <tr key={product.id}>
                    <td className="table-number">{pageSkip + index + 1}</td>
                    <td><Link href={`/products/${product.id}`}><strong>{product.name}</strong></Link></td>
                    <td>{product.sku ?? "-"}</td>
                    <td>RM{Number(product.price).toFixed(2)}</td>
                    <td>{product.stocks.reduce((total, stock) => total + stock.quantity, 0)}</td>
                    <td><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></td>
                    <td>
                      <div className="catalog-table-actions">
                        <Link href={`/products/${product.id}`}>View</Link>
                        <DeleteProductForm
                          compact
                          productId={product.id}
                          productName={product.name}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <CatalogPagination
              basePath="/products"
              currentPage={currentPage}
              pageSize={CATALOG_PAGE_SIZE}
              query={{ q: query, status, categoryId }}
              total={matchingCount}
              totalPages={totalPages}
            />
            </>
          ) : <p className="empty-state">No products yet.</p>}
        </div>
      </section>
      {isCreateOpen ? (
        <ProductCreateModal
          action={createProductAction}
          branches={branches}
          categories={categories.filter((category) => category.status === "ACTIVE")}
        />
      ) : null}
      {isCategoriesOpen ? (
        <CatalogCategoriesModal
          categories={categories.map((category) => ({
            id: category.id,
            itemCount: category._count.products,
            name: category.name,
            status: category.status,
          }))}
          closePath="/products"
          createAction={createProductCategoryAction}
          deleteAction={deleteProductCategoryAction}
          description="Group products so staff can find the right SKU faster at the Cashier."
          itemLabel="product"
          message={message}
          messageType={messageType}
          placeholder="Hair care, retail, accessories"
          title="Product categories"
          updateAction={updateProductCategoryAction}
        />
      ) : null}
    </>
  );
}
