import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import styles from "./inventory.module.css";

type InventoryPageProps = {
  searchParams: Promise<{ branchId?: string; message?: string; q?: string; status?: string; type?: string }>;
};

function getStockState(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return { className: styles.outOfStock, label: "Out of stock" };
  if (quantity <= reorderLevel) return { className: styles.lowStock, label: "Low stock" };
  return { className: styles.inStock, label: "In stock" };
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams;
  const branches = await getOperationalBranches(businessId, user);
  const allowedBranchIds = branches.map((branch) => branch.id);
  const selectedBranchId = allowedBranchIds.includes(params.branchId ?? "")
    ? params.branchId!
    : branches.length === 1 ? branches[0].id : null;
  const query = params.q?.trim() ?? "";
  const stockStatus = params.status === "low" || params.status === "out" ? params.status : "";
  const hasFilters = Boolean(query || stockStatus || (branches.length > 1 && selectedBranchId));
  const products = await prisma.product.findMany({
    where: {
      businessId,
      trackInventory: true,
      ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }] } : {}),
    },
    include: {
      stocks: {
        where: { branchId: { in: selectedBranchId ? [selectedBranchId] : allowedBranchIds } },
        include: { branch: { select: { name: true } } },
        orderBy: { branch: { name: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });
  const allBalances = products.flatMap((product) => product.stocks.map((stock) => ({ product, stock })));
  const lowStock = allBalances.filter(({ stock }) => stock.quantity <= stock.reorderLevel);
  const outOfStock = allBalances.filter(({ stock }) => stock.quantity <= 0);
  const balances = allBalances.filter(({ stock }) =>
    stockStatus === "out" ? stock.quantity <= 0 : stockStatus === "low" ? stock.quantity <= stock.reorderLevel : true,
  );
  const quantityOnHand = allBalances.reduce((sum, { stock }) => sum + stock.quantity, 0);
  const sellingValue = allBalances.reduce((sum, { product, stock }) => sum + Number(product.price) * stock.quantity, 0);
  const recentMovements = await prisma.inventoryMovement.findMany({
    where: {
      businessId,
      branchId: { in: selectedBranchId ? [selectedBranchId] : allowedBranchIds },
      ...(query ? { product: { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }] } } : {}),
    },
    include: {
      actor: { select: { name: true } },
      branch: { select: { name: true } },
      product: { select: { name: true, sku: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <section className={`content ${styles.inventoryPage}`}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Stock control</span>
          <h1>Inventory</h1>
          <p>See what is on hand, identify stock that needs attention, and record every change through the inventory ledger.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.secondaryAction} href="/inventory/purchase-orders/new">New purchase order</Link>
          <Link className={styles.primaryAction} href="/inventory/stock-in">Stock in</Link>
        </div>
      </header>

      {params.message ? <p className={`form-message ${params.type === "error" ? "error" : "success"}`}>{params.message}</p> : null}

      <nav className={styles.actionGroups} aria-label="Inventory tools">
        <section className={styles.actionGroup}>
          <div><span className={styles.groupNumber}>01</span><h2>Move stock</h2></div>
          <p>Record physical stock changes.</p>
          <div className={styles.actionLinks}>
            <Link href="/inventory/stock-in">Stock in</Link>
            <Link href="/inventory/stock-out">Stock out</Link>
            <Link href="/inventory/adjustment">Adjust</Link>
            <Link href="/inventory/transfer">Transfer</Link>
          </div>
        </section>
        <section className={styles.actionGroup}>
          <div><span className={styles.groupNumber}>02</span><h2>Purchase</h2></div>
          <p>Order, receive, bill and pay suppliers.</p>
          <div className={styles.actionLinks}>
            <Link href="/inventory/reorder">Reorder</Link>
            <Link href="/inventory/purchase-orders">Purchase orders</Link>
            <Link href="/inventory/suppliers">Suppliers</Link>
            <Link href="/inventory/supplier-bills">Supplier bills</Link>
            <Link href="/inventory/accounts-payable">Accounts payable</Link>
          </div>
        </section>
        <section className={styles.actionGroup}>
          <div><span className={styles.groupNumber}>03</span><h2>Control</h2></div>
          <p>Count, audit and reconcile stock.</p>
          <div className={styles.actionLinks}>
            <Link href="/inventory/stock-counts">Stock counts</Link>
            <Link href="/inventory/movements">All movements</Link>
            <Link href="/inventory/reconciliation">Reconcile</Link>
          </div>
        </section>
      </nav>

      <section className={styles.workspace} aria-labelledby="inventory-overview-heading">
        <div className={styles.workspaceHeader}>
          <div>
            <span className={styles.eyebrow}>Live overview</span>
            <h2 id="inventory-overview-heading">Stock overview</h2>
          </div>
          <span className={styles.scopeLabel}>{selectedBranchId ? branches.find((branch) => branch.id === selectedBranchId)?.name : "All accessible branches"}</span>
        </div>

        <form className={styles.filters} key={`${query}:${selectedBranchId ?? "all"}:${stockStatus || "all"}`}>
          <label className={styles.searchField}>
            <span>Product or SKU</span>
            <input name="q" defaultValue={query} placeholder="Search inventory" />
          </label>
          {branches.length > 1 ? (
            <label>
              <span>Branch</span>
              <select name="branchId" defaultValue={selectedBranchId ?? ""}>
                <option value="">All branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>Stock status</span>
            <select name="status" defaultValue={stockStatus}>
              <option value="">All stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit">Apply filters</button>
            {hasFilters ? <Link href="/inventory">Reset</Link> : null}
          </div>
        </form>

        <div className={styles.metrics}>
          <article className={`${styles.metricCard} ${styles.primaryMetric}`}>
            <span>Stock on hand</span>
            <strong>{quantityOnHand}</strong>
            <small>Units across the selected scope</small>
          </article>
          <article className={styles.metricCard}>
            <span>Tracked products</span>
            <strong>{products.length}</strong>
            <small>Products using inventory tracking</small>
          </article>
          <article className={`${styles.metricCard} ${lowStock.length ? styles.warningMetric : ""}`}>
            <span>Low stock</span>
            <strong>{lowStock.length}</strong>
            <small>At or below reorder level</small>
          </article>
          <article className={`${styles.metricCard} ${outOfStock.length ? styles.dangerMetric : ""}`}>
            <span>Out of stock</span>
            <strong>{outOfStock.length}</strong>
            <small>Needs immediate attention</small>
          </article>
          <article className={styles.metricCard}>
            <span>Retail value</span>
            <strong>RM{sellingValue.toFixed(2)}</strong>
            <small>Selling-price estimate, not COGS</small>
          </article>
          <article className={styles.metricCard}>
            <span>Recent movements</span>
            <strong>{recentMovements.length}</strong>
            <small>Latest ledger entries shown below</small>
          </article>
        </div>
      </section>

      <section className={styles.dataPanel} aria-labelledby="stock-balance-heading">
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>Current position</span><h2 id="stock-balance-heading">Stock balance</h2></div>
          <span className={styles.safetyBadge}>Negative stock blocked</span>
        </div>
        {!products.length ? (
          <div className={styles.emptyState}>
            <strong>No inventory-tracked products</strong>
            <p>Enable inventory tracking from Products, then record an explicit opening balance.</p>
          </div>
        ) : balances.length ? (
          <>
            <div className={styles.desktopTable}>
              <table>
                <thead><tr><th>Product</th><th>Branch</th><th>On hand</th><th>Reorder at</th><th>Retail price</th><th>Status</th></tr></thead>
                <tbody>{balances.map(({ product, stock }) => {
                  const state = getStockState(stock.quantity, stock.reorderLevel);
                  return <tr key={stock.id}><td><strong>{product.name}</strong><small>{product.sku ?? "No SKU"}</small></td><td>{stock.branch.name}</td><td className={styles.quantityCell}>{stock.quantity}</td><td>{stock.reorderLevel}</td><td>RM{Number(product.price).toFixed(2)}</td><td><span className={`${styles.stockStatus} ${state.className}`}>{state.label}</span></td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className={styles.mobileBalances}>
              {balances.map(({ product, stock }) => {
                const state = getStockState(stock.quantity, stock.reorderLevel);
                return (
                  <article key={stock.id} className={styles.balanceCard}>
                    <div className={styles.balanceCardHeader}>
                      <div><strong>{product.name}</strong><span>{product.sku ?? "No SKU"} · {stock.branch.name}</span></div>
                      <span className={`${styles.stockStatus} ${state.className}`}>{state.label}</span>
                    </div>
                    <dl>
                      <div><dt>On hand</dt><dd>{stock.quantity}</dd></div>
                      <div><dt>Reorder at</dt><dd>{stock.reorderLevel}</dd></div>
                      <div><dt>Retail price</dt><dd>RM{Number(product.price).toFixed(2)}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.emptyState}><strong>No matching stock balances</strong><p>Try changing the search, branch or stock status filter.</p></div>
        )}
      </section>

      <section className={styles.dataPanel} aria-labelledby="movement-ledger-heading">
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>Audit trail</span><h2 id="movement-ledger-heading">Recent movement ledger</h2></div>
          <Link className={styles.textLink} href="/inventory/movements">View all movements</Link>
        </div>
        {recentMovements.length ? (
          <div className={styles.desktopTable}>
            <table><thead><tr><th>Time</th><th>Product</th><th>Branch</th><th>Type</th><th>Delta</th><th>Balance</th><th>Reason</th><th>Actor</th></tr></thead><tbody>{recentMovements.map((movement) => <tr key={movement.id}><td>{movement.createdAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</td><td><strong>{movement.product.name}</strong><small>{movement.product.sku ?? "No SKU"}</small></td><td>{movement.branch.name}</td><td>{movement.type.replaceAll("_", " ")}</td><td className={movement.quantityDelta > 0 ? styles.positiveDelta : styles.negativeDelta}>{movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}</td><td>{movement.quantityAfter}</td><td>{movement.reason}</td><td>{movement.actor?.name ?? "System"}</td></tr>)}</tbody></table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <strong>No stock movements yet</strong>
            <p>Stock in, stock out, transfers and adjustments will appear here as append-only ledger entries.</p>
            <Link href="/inventory/stock-in">Record first stock in</Link>
          </div>
        )}
      </section>
    </section>
  );
}
