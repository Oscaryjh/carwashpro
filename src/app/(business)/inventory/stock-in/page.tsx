import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import stockInStyles from "@/components/inventory-stock-in.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertOutletSubmissionSnapshot, outletBranchInput, outletBranches, outletPresentation, resolveInventoryOutletWriteContext } from "@/lib/outlet-ui-context";
import { prisma } from "@/lib/prisma";
import { stockInAction } from "../actions";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export default async function StockInPage({ searchParams }: { searchParams: Promise<{ productId?: string; branchId?: string }> }) {
  const selection = await searchParams;
  const { businessId, user, access, moduleContext } = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY");
  const outletContext = await resolveInventoryOutletWriteContext({ businessId, actorUserId: user.userId, capability: "MANAGE_INVENTORY",
    ...(Object.prototype.hasOwnProperty.call(selection, "branchId") ? { explicitBranchInput: selection.branchId } : {}),
  });
  const outlet = outletPresentation(outletContext, access.effectiveBusinessRole === "BUSINESS_OWNER");
  const snapshot = { ...outlet, businessId };
  if (outletContext.kind === "denied" || outletContext.kind === "no_location") return <section className="content"><h1>Add Stock</h1><InventoryCommandForm action={stockInAction} branches={[]} products={[]} mode="STOCK_IN" outlet={outlet} /><Link href="/inventory">Back to inventory</Link></section>;
  const branches = outletBranches(outletContext);
  const products = await prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { where: { branchId: { in: branches.map(branch => branch.id) } }, select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } });
  async function addWithCurrentOutlet(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUserForModule("INVENTORY", "MANAGE_INVENTORY");
    const current = await resolveInventoryOutletWriteContext({ businessId: fresh.businessId, actorUserId: fresh.user.userId, capability: "MANAGE_INVENTORY", ...outletBranchInput(formData) });
    assertOutletSubmissionSnapshot(snapshot, current);
    if (current.kind === "no_location") throw new Error("No operating location is available.");
    await stockInAction(formData);
  }
  const canSetUpProducts = access.granted && access.source === "DIRECT_BUSINESS" && moduleContext.enabledModules.has("POS") && hasBusinessCapability(access, "VIEW_CATALOG") && hasStaffPermission(user, "PRODUCTS");
  return <section className={`content ${styles.workflow} ${stockInStyles.page}`}>
    <div className="page-header"><div><h1>Add Stock</h1><p>{outlet.kind === "single_outlet" ? "Choose a product and enter the quantity to add." : "Add items received into your store."}</p></div><Link href="/inventory">Back to inventory</Link></div>
    <div className="panel">
      <p className="field-helper">Only active products with Track stock turned on appear here.</p>
      {!products.length ? <div className="empty-state compact-empty-state">
        <strong>No products available to add stock.</strong>
        <p>Go to Products and turn on Track stock for an active product.</p>
        {canSetUpProducts ? <Link href="/products">Set up products</Link> : <p>Ask the business owner to set up stock tracking for products.</p>}
      </div> : null}
      <InventoryCommandForm key={`${selection.productId ?? ""}:${selection.branchId ?? ""}`} initialProductId={selection.productId} initialBranchId={selection.branchId} action={addWithCurrentOutlet} outlet={outlet} branches={branches} mode="STOCK_IN" products={products} />
    </div>
  </section>;
}
