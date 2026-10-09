import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import stockInStyles from "@/components/inventory-stock-in.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { stockInAction } from "../actions";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export default async function StockInPage({ searchParams }: { searchParams: Promise<{ productId?: string; branchId?: string }> }) {
  const selection = await searchParams;
  const { businessId, user, access, moduleContext } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY");
  const [branches, products] = await Promise.all([
    getOperationalBranches(businessId, user),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } }),
  ]);
  const canSetUpProducts = access.granted && access.source === "DIRECT_BUSINESS" && moduleContext.enabledModules.has("POS") && hasBusinessCapability(access, "VIEW_CATALOG") && hasStaffPermission(user, "PRODUCTS");
  return <section className={`content ${styles.workflow} ${stockInStyles.page}`}>
    <div className="page-header"><div><h1>Add Stock</h1><p>Add items received into your store.</p></div><Link href="/inventory">Back to inventory</Link></div>
    <div className="panel">
      <p className="field-helper">Only active products with Track stock turned on appear here.</p>
      {!products.length ? <div className="empty-state compact-empty-state">
        <strong>No products available to add stock.</strong>
        <p>Go to Products and turn on Track stock for an active product.</p>
        {canSetUpProducts ? <Link href="/products">Set up products</Link> : <p>Ask the business owner to set up stock tracking for products.</p>}
      </div> : null}
      <InventoryCommandForm key={`${selection.productId ?? ""}:${selection.branchId ?? ""}`} initialProductId={selection.productId} initialBranchId={selection.branchId} action={stockInAction} branches={branches} mode="STOCK_IN" products={products} />
    </div>
  </section>;
}
