import Link from "next/link";
import { hasBusinessCapability, type ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import styles from "./inventory-hub.module.css";
import type { OutletPresentation } from "@/lib/outlet-ui-context";

export function InventoryHubNavigation({ access, purchasing, branchId, branchCount = 0, outlet }: { access: ResolvedBusinessAccess; purchasing: boolean; branchId?: string; branchCount?: number; outlet?: OutletPresentation }) {
  const can = (capability: Parameters<typeof hasBusinessCapability>[1]) => hasBusinessCapability(access, capability);
  const writable = access.granted && access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY" && access.effectiveBusinessRole !== "PLATFORM_ADMIN";
  const manage = writable && can("MANAGE_INVENTORY");
  const createPO = writable && can("CREATE_PURCHASE_ORDER");
  const transfer = outlet?.kind !== "single_outlet" && branchCount > 1 && writable && access.granted && access.effectiveBusinessRole === "BUSINESS_OWNER" && can("TRANSFER_INVENTORY");
  const href = (view?: string) => {
    const query = new URLSearchParams();
    if (view) query.set("view", view);
    if (branchId) query.set("branchId", branchId);
    return `/inventory${query.size ? `?${query}` : ""}`;
  };
  return <>
    <div className={styles.actions} aria-label="Stock actions">
      {manage ? <Link href="/inventory/stock-in">Add Stock</Link> : null}
      {manage ? <Link href="/inventory/stock-out">Use / Remove</Link> : null}
      {writable && can("ADJUST_INVENTORY") ? <Link href="/inventory/adjustment">Quick Count</Link> : null}
    </div>
    <nav className={styles.navigation} aria-label="Inventory sections">
      <Link href={href()} aria-current={!purchasing ? "page" : undefined}>Stock</Link>
      <Link href="/inventory/movements">Stock History</Link>
      <details className={styles.more}><summary>More</summary><div>
        {transfer ? <Link href="/inventory/transfer">Transfer</Link> : null}
        {can("VIEW_INVENTORY") || can("VIEW_PURCHASE_ORDERS") || createPO || can("VIEW_SUPPLIERS") || can("VIEW_SUPPLIER_BILL") || can("VIEW_ACCOUNTS_PAYABLE") ? <Link href={href("purchasing")} aria-current={purchasing ? "page" : undefined}>Advanced Purchasing</Link> : null}
        {can("VIEW_INVENTORY") || can("VIEW_STOCK_COUNTS") ? <div role="group" aria-label="Advanced Controls"><strong>Advanced Controls</strong>
          {can("VIEW_STOCK_COUNTS") ? <Link href="/inventory/stock-counts">Advanced Stock Counts</Link> : null}
          {can("VIEW_INVENTORY") ? <Link href="/inventory/reconciliation">Check stock records</Link> : null}
        </div> : null}
      </div></details>
    </nav>
    {purchasing ? <section className={styles.purchasing} aria-label="Purchasing">
      {can("VIEW_INVENTORY") ? <article><h2>Restocking</h2><Link href="/inventory/reorder">Restock suggestions</Link></article> : null}
      {can("VIEW_PURCHASE_ORDERS") || createPO ? <article><h2>Purchase Orders</h2>{can("VIEW_PURCHASE_ORDERS") ? <Link href="/inventory/purchase-orders">Purchase Orders</Link> : null}{createPO ? <Link href="/inventory/purchase-orders/new">New purchase order</Link> : null}</article> : null}
      {can("VIEW_SUPPLIERS") ? <article><h2>Suppliers</h2><Link href="/inventory/suppliers">Suppliers</Link></article> : null}
      {can("VIEW_SUPPLIER_BILL") || can("VIEW_ACCOUNTS_PAYABLE") ? <article><h2>Bills</h2>{can("VIEW_SUPPLIER_BILL") ? <Link href="/inventory/supplier-bills">Supplier invoices</Link> : null}{can("VIEW_ACCOUNTS_PAYABLE") ? <Link href="/inventory/accounts-payable">Unpaid supplier bills</Link> : null}</article> : null}
    </section> : null}
  </>;
}
