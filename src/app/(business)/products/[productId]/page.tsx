import { notFound } from "next/navigation";
import Link from "next/link";
import styles from "@/components/products/products-hub.module.css";
import { ProductForm } from "@/components/product-form";
import { DeleteProductForm } from "@/components/delete-product-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { deactivateProductAction, updateProductAction } from "../actions";

export default async function ProductDetailsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { user, businessId, moduleContext, access } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const { productId } = await params;
  const [product, branches, categories] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, businessId }, include: { stocks: true } }),
    getActiveBranches(businessId),
    prisma.productCategory.findMany({ where: { businessId }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
  ]);
  if (!product) notFound();
  const canViewInventory = moduleContext.enabledModules.has("INVENTORY") && hasBusinessCapability(access, "VIEW_INVENTORY");
  const productForForm = {
    ...product,
    price: Number(product.price),
    costPrice: product.costPrice == null ? null : Number(product.costPrice),
    taxRate: product.taxRate == null ? null : Number(product.taxRate),
  };

  return (
    <>
      <section className={`content ${styles.hub}`}>
        <div className={`page-header ${styles.header}`}><div><h1>{product.name}</h1><p>Edit product details and inventory tracking.</p></div><Link className="secondary-link-button" href="/products">Back to Products</Link></div>
        <div className="panel">
          <div className="section-header"><h2>Edit product</h2><span className={`status ${product.status.toLowerCase()}`}>{product.status}</span></div>
          <div className={styles.stockGuidance}>
            <strong>{product.trackInventory ? "Stock tracking is on" : "Stock tracking is off"}</strong>
            <p>{product.trackInventory ? "Stock quantities are managed in Inventory." : product.status === "ACTIVE" ? "This product can still be sold, but Tetamu POS will not track its quantity." : "This product is inactive. Its existing stock history is kept."}</p>
            {product.trackInventory && canViewInventory ? <Link href="/inventory">Open Inventory</Link> : null}
          </div>
          <ProductForm action={updateProductAction} branches={branches} categories={categories} inventoryEnabled={moduleContext.enabledModules.has("INVENTORY")} canViewInventory={canViewInventory} product={productForForm} submitLabel="Save product" />
          <p className="field-helper">Making this product inactive stops new sales. Its stock and history are kept.</p>
          <div className="form-actions service-action-row"><form action={deactivateProductAction}><input name="productId" type="hidden" value={product.id} /><button className="danger-button" type="submit">Deactivate product</button></form><DeleteProductForm productId={product.id} productName={product.name} label="Delete product" /></div>
        </div>
      </section>
    </>
  );
}
