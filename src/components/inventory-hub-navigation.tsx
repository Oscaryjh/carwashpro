import Link from "next/link";
import { hasBusinessCapability, type ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import styles from "./inventory-hub.module.css";

export function InventoryHubNavigation({ access, purchasing, branchId }: { access: ResolvedBusinessAccess; purchasing: boolean; branchId?: string }) {
  const can = (capability: Parameters<typeof hasBusinessCapability>[1]) => hasBusinessCapability(access, capability);
  const writable = access.granted && access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY" && access.effectiveBusinessRole !== "PLATFORM_ADMIN";
  const manage = writable && can("MANAGE_INVENTORY");
  const receive = writable && can("RECEIVE_PURCHASE_ORDER") && can("VIEW_PURCHASE_ORDERS");
  const createPO = writable && can("CREATE_PURCHASE_ORDER");
  const transfer = writable && access.granted && access.effectiveBusinessRole === "BUSINESS_OWNER" && can("TRANSFER_INVENTORY");
  const href = (view?: string) => {
    const query = new URLSearchParams();
    if (view) query.set("view", view);
    if (branchId) query.set("branchId", branchId);
    return `/inventory${query.size ? `?${query}` : ""}`;
  };
  return <>
    <div className={styles.actions} aria-label="Stock actions">
      {manage || receive || createPO ? <details className={styles.chooser}>
        <summary>Receive stock</summary>
        <div className={styles.choices}>
          <strong>How would you like to receive stock?</strong>
          {receive ? <Link href="/inventory/purchase-orders"><b>From an existing purchase order</b><span>Receive items from an existing purchase order.</span></Link> : null}
          {manage ? <Link href="/inventory/stock-in"><b>Add quantity only</b><span>Add stock quantity without creating supplier payable records.</span></Link> : null}
          {createPO ? <Link href="/inventory/purchase-orders/new"><b>Create a purchase order</b><span>Track receiving, supplier invoice and unpaid balance. Each step requires its existing permission.</span></Link> : null}
        </div>
      </details> : null}
      {manage ? <Link href="/inventory/stock-out">Record used, damaged or lost</Link> : null}
      {can("VIEW_STOCK_COUNTS") ? <Link href="/inventory/stock-counts">Count stock</Link> : null}
    </div>
    <nav className={styles.navigation} aria-label="Inventory sections">
      <Link href={href()} aria-current={!purchasing ? "page" : undefined}>Stock</Link>
      <Link href={href("purchasing")} aria-current={purchasing ? "page" : undefined}>Purchasing</Link>
      <Link href="/inventory/movements">Stock History</Link>
      <details className={styles.more}><summary>More</summary><div>
        {can("VIEW_STOCK_COUNTS") ? <Link href="/inventory/stock-counts">Count stock</Link> : null}
        {transfer ? <Link href="/inventory/transfer">Move between stores</Link> : null}
        {writable && can("ADJUST_INVENTORY") ? <Link href="/inventory/adjustment">Correct stock quantity</Link> : null}
        <Link href="/inventory/reconciliation">Check stock records</Link>
      </div></details>
    </nav>
    {purchasing ? <section className={styles.purchasing} aria-label="Purchasing">
      <article><h2>Need stock</h2><Link href="/inventory/reorder">Restock suggestions</Link></article>
      {can("VIEW_PURCHASE_ORDERS") ? <article><h2>Orders</h2><Link href="/inventory/purchase-orders">Purchase orders</Link>{createPO ? <Link href="/inventory/purchase-orders/new">New purchase order</Link> : null}</article> : null}
      {can("VIEW_SUPPLIERS") ? <article><h2>Suppliers</h2><Link href="/inventory/suppliers">Suppliers</Link></article> : null}
      {can("VIEW_SUPPLIER_BILL") || can("VIEW_ACCOUNTS_PAYABLE") ? <article><h2>Bills</h2>{can("VIEW_SUPPLIER_BILL") ? <Link href="/inventory/supplier-bills">Supplier invoices</Link> : null}{can("VIEW_ACCOUNTS_PAYABLE") ? <Link href="/inventory/accounts-payable">Unpaid supplier bills</Link> : null}</article> : null}
    </section> : null}
  </>;
}
