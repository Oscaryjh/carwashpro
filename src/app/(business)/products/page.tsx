import Link from "next/link";
import type { Prisma, ProductStatus } from "@prisma/client";
import { CatalogCategoriesModal } from "@/components/catalog-categories-modal";
import { CatalogPagination } from "@/components/catalog-pagination";
import { DeleteProductForm } from "@/components/delete-product-form";
import { ProductCreateModal } from "@/components/product-create-modal";
import { ProductSettingsMenu } from "@/components/products/product-settings-menu";
import styles from "@/components/products/products-hub.module.css";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser, requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertOutletSubmissionSnapshot, assertProductStockFields, outletBranchInput, outletBranches, outletPresentation, resolveProductsOutletContext } from "@/lib/outlet-ui-context";
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
    branchId?: string;
  }>;
};

const CATALOG_PAGE_SIZE = 10;

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const { access, user, businessId, moduleContext } =
    await requireBusinessUser("VIEW_CATALOG");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "PRODUCTS");
  }
  const params = await searchParams;
  const outletContext = await resolveProductsOutletContext({ businessId, actorUserId: user.userId,
    ...(Object.prototype.hasOwnProperty.call(params, "branchId") ? { explicitBranchInput: params.branchId } : {}),
  });
  if (outletContext.kind === "denied") return <section className="content"><p role="alert">You do not have access to these products.</p></section>;
  const outlet = outletPresentation(outletContext, access.effectiveBusinessRole === "BUSINESS_OWNER");
  const snapshot = { ...outlet, businessId };
  const single = outletContext.kind === "single_outlet";
  async function createWithCurrentOutlet(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUserForModule("POS");
    assertStaffPermission(fresh.user, "PRODUCTS");
    const current = await resolveProductsOutletContext({ businessId: fresh.businessId, actorUserId: fresh.user.userId, ...outletBranchInput(formData) });
    assertOutletSubmissionSnapshot(snapshot, current);
    assertProductStockFields(formData, current);
    await createProductAction(formData);
  }
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
      include: { productCategory: true, stocks: { ...(outletContext.kind === "single_outlet" ? { where: { branchId: outletContext.internalBranchId } } : outletContext.kind === "no_location" ? { where: { branchId: { in: [] } } } : {}), include: { branch: { select: { name: true } } } }, _count: { select: { invoiceItems: true } } },
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
  const branches = outletBranches(outletContext);
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const isCreateOpen = params.modal === "create" || params.type === "create";
  const companyTax = isCreateOpen
    ? await prisma.business.findUnique({ where: { id: businessId }, select: { sstRate: true } })
    : null;
  const isCategoriesOpen = params.modal === "categories";
  const hasFilters = Boolean(query || status || categoryId);
  const totalPages = Math.max(1, Math.ceil(matchingCount / CATALOG_PAGE_SIZE));

  return (
    <>
      <section className={`content ${styles.hub}`}>
        <div className={`page-header ${styles.header}`}>
          <div>
            <h1>Products</h1>
            <p>{hasFilters ? `${matchingCount} product${matchingCount === 1 ? "" : "s"} match this filter.` : "Manage your product catalog."}</p>
          </div>
          <div className={styles.headerActions}>
            <ProductSettingsMenu />
            <Link className="button-link" href="/products?modal=create">
              New Product
            </Link>
          </div>
        </div>
        {message && !isCategoriesOpen ? <div className={messageType}>{message}</div> : null}
        <div className={`panel ${styles.panel}`}>
          <form key={JSON.stringify([query, status, categoryId])} action="/products" className={styles.toolbar}>
            <input aria-label="Search products" defaultValue={query} name="q" placeholder="Search product, SKU, or category" />
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
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Products list">
            <table className={`table ${styles.table}`}>
              <colgroup>
                <col className={styles.colNo} />
                <col className={styles.colProduct} />
                <col className={styles.colSku} />
                <col className={styles.colPrice} />
                <col className={styles.colStock} />
                <col className={styles.colStatus} />
                <col className={styles.colActions} />
              </colgroup>
              <thead>
                <tr>
                  <th className={styles.colNo}>No.</th>
                  <th className={styles.colProduct}>Product</th>
                  <th className={styles.colSku}>SKU</th>
                  <th className={styles.colPrice}>Price</th>
                  <th className={styles.colStock}>{single ? "Stock" : <>Total stock<small className={styles.trackingHint}>Across stores</small></>}</th>
                  <th className={styles.colStatus}>Status</th>
                  <th className={styles.colActions}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, index) => (
                  <tr key={product.id}>
                    <td className={`table-number ${styles.colNo}`}><div className={styles.cellPrimaryRow}>{pageSkip + index + 1}</div></td>
                    <td className={styles.colProduct}>
                      <div className={styles.cellPrimaryRow}><Link href={`/products/${product.id}`}><strong>{product.name}</strong></Link></div>
                      <small className={styles.productMeta}>
                        {product.sku ? <span className={styles.tabletSku}>{product.sku}{" • "}</span> : null}
                        {product.productCategory?.name || product.category ? <>{product.productCategory?.name ?? product.category}{" • "}</> : null}
                        Stock tracking {product.trackInventory ? "on" : "off"}
                      </small>
                    </td>
                    <td className={styles.colSku}><div className={styles.cellPrimaryRow}>{product.sku ?? "-"}</div></td>
                    <td className={styles.colPrice}><div className={styles.cellPrimaryRow}>RM{Number(product.price).toFixed(2)}</div></td>
                    <td className={styles.colStock}><div className={styles.cellPrimaryRow}>{product.trackInventory ? outletContext.kind === "single_outlet" ? product.stocks.find(stock => stock.branchId === outletContext.internalBranchId)?.quantity ?? 0 : product.stocks.reduce((total, stock) => total + stock.quantity, 0) : "Not tracked"}</div></td>
                    <td className={styles.colStatus}><div className={`${styles.cellPrimaryRow} ${styles.statusCell}`}><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></div></td>
                    <td className={styles.colActions}>
                      <div className={`catalog-table-actions ${styles.cellPrimaryRow} ${styles.rowActions}`}>
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
          action={createWithCurrentOutlet}
          outlet={outlet}
          branches={branches}
          categories={categories.filter((category) => category.status === "ACTIVE")}
          inventoryEnabled={moduleContext.enabledModules.has("INVENTORY")}
          companySstRate={companyTax?.sstRate == null ? null : Number(companyTax.sstRate)}
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
