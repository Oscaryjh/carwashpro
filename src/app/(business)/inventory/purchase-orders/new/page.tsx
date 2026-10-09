import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import styles from "@/components/inventory-hub.module.css";
import { createPurchaseOrderAction } from "../../purchasing-actions";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ branchId?: string; message?: string; productId?: string; quantity?: string; type?: string }> }) {
  const { businessId, user, access, moduleContext } = await requireBusinessUserForModule("INVENTORY", "CREATE_PURCHASE_ORDER");
  const query = await searchParams;
  const [branches, suppliers, products] = await Promise.all([
    getOperationalBranches(businessId, user),
    prisma.supplier.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, orderBy: { name: "asc" }, select: { costPrice: true, id: true, name: true, sku: true } }),
  ]);
  const quantity = Number(query.quantity);
  const prefill = branches.some(branch => branch.id === query.branchId) && products.some(product => product.id === query.productId) && Number.isInteger(quantity) && quantity > 0 ? { branchId: query.branchId!, productId: query.productId!, quantity } : undefined;
  const ready = branches.length > 0 && suppliers.length > 0 && products.length > 0;
  const owner = access.granted && access.effectiveBusinessRole === "BUSINESS_OWNER";
  const productSetup = moduleContext.enabledModules.has("POS") && (owner || (access.granted && access.source === "DIRECT_BUSINESS" && access.permissions.includes("PRODUCTS")));
  return <section className={`content ${styles.workflow}`}>
    <div className="page-header"><div><h1>New purchase order</h1><p>Plan what to buy. Saving a draft does not change stock.</p></div><Link href="/inventory/purchase-orders">Back to purchase orders</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <p className="form-message">This purchase order will need approval from another authorized user before stock can be received.</p>
    {!ready ? <section className={styles.setup}><h2>Before creating a purchase order</h2><ul>
      <li>{branches.length ? "✓ Store ready" : "○ An active store is required"}{!branches.length ? owner ? <Link href="/branches">Set up a store</Link> : <p>Ask the business owner to complete this setup.</p> : null}</li>
      <li>{suppliers.length ? "✓ Supplier ready" : "○ Add an active supplier"}{!suppliers.length ? hasBusinessCapability(access, "MANAGE_SUPPLIERS") ? <Link href="/inventory/suppliers">Add a supplier</Link> : <p>Ask the business owner to complete this setup.</p> : null}</li>
      <li>{products.length ? "✓ Inventory products ready" : "○ Set up active inventory-tracked products"}{!products.length ? productSetup ? <Link href="/products">Set up inventory products</Link> : <p>Ask the business owner to complete this setup.</p> : null}</li>
    </ul></section> : <div className="panel">
      {prefill ? <p className="form-message success">Restock suggestion prefilled. Select the supplier and review quantity before saving.</p> : null}
      <p className="field-helper">Supplier / Store → Products / Quantity / Cost → Review &amp; Save</p>
      <PurchaseOrderForm action={createPurchaseOrderAction} branches={branches} operationKey={`CREATE_PURCHASE_ORDER:${randomUUID()}`} prefill={prefill} suppliers={suppliers} products={products.map(product => ({ ...product, costPrice: product.costPrice === null ? null : Number(product.costPrice) }))} />
    </div>}
  </section>;
}
