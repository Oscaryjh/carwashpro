import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import { InventoryCommandForm } from "@/components/inventory-command-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertOutletSubmissionSnapshot, outletBranchInput, outletBranches, outletPresentation, resolveInventoryOutletWriteContext } from "@/lib/outlet-ui-context";
import { prisma } from "@/lib/prisma";
import { adjustInventoryAction } from "../actions";
export default async function AdjustmentPage({ searchParams }: { searchParams?: Promise<{ productId?: string; branchId?: string }> }) {
  const { businessId, user, access } = await requireBusinessUserForModule("INVENTORY", "ADJUST_INVENTORY");
  const selection = await searchParams ?? {};
  const context = await resolveInventoryOutletWriteContext({ businessId, actorUserId: user.userId, capability: "ADJUST_INVENTORY",
    ...(Object.prototype.hasOwnProperty.call(selection, "branchId") ? { explicitBranchInput: selection.branchId } : {}),
  });
  const outlet = outletPresentation(context, access.effectiveBusinessRole === "BUSINESS_OWNER");
  const snapshot = { ...outlet, businessId };
  const branches = outletBranches(context);
  const products = context.kind === "denied" || context.kind === "no_location" ? [] : await prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, select: { id: true, name: true, sku: true, stocks: { where: { branchId: { in: branches.map(branch => branch.id) } }, select: { branchId: true, quantity: true, revision: true } } }, orderBy: { name: "asc" } });
  async function countWithCurrentOutlet(formData: FormData) {
    "use server";
    const fresh = await requireBusinessUserForModule("INVENTORY", "ADJUST_INVENTORY");
    const current = await resolveInventoryOutletWriteContext({ businessId: fresh.businessId, actorUserId: fresh.user.userId, capability: "ADJUST_INVENTORY", ...outletBranchInput(formData) });
    assertOutletSubmissionSnapshot(snapshot, current);
    if (current.kind === "no_location") throw new Error("No operating location is available.");
    await adjustInventoryAction(formData);
  }
  return <section className={`content ${styles.workflow}`}><div className="page-header"><div><h1>Quick Count</h1><p>Count one item and update its actual quantity.</p></div><Link href="/inventory">Back to inventory</Link></div><div className="panel"><InventoryCommandForm action={countWithCurrentOutlet} outlet={outlet} branches={branches} mode="ADJUSTMENT" products={products} initialProductId={selection.productId} initialBranchId={selection.branchId} /></div></section>;
}
