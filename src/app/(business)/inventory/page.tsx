import Link from "next/link";
import { InventoryHubNavigation } from "@/components/inventory-hub-navigation";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getInventoryReadBranches, resolveInventoryReadScope } from "@/lib/inventory/authorization";
import { prisma } from "@/lib/prisma";
import styles from "./inventory.module.css";

type InventoryPageProps = {
  searchParams: Promise<{ branchId?: string; message?: string; q?: string; status?: string; type?: string; view?: string }>;
};

function getStockState(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return { className: styles.outOfStock, label: "Out of stock" };
  if (quantity <= reorderLevel) return { className: styles.lowStock, label: "Low stock" };
  return { className: styles.inStock, label: "In stock" };
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const { businessId, access } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams; await resolveInventoryReadScope(businessId, access, params.branchId);
  const branches = await getInventoryReadBranches(businessId, access);
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
  const inStock = allBalances.filter(({ stock }) => stock.quantity > stock.reorderLevel);
  const purchasing = params.view === "purchasing";
  /* History is available on its dedicated route. */
  const canAddStock = access.granted && access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY" && access.effectiveBusinessRole !== "PLATFORM_ADMIN" && hasBusinessCapability(access, "MANAGE_INVENTORY");

  return (
    <section className={`content ${styles.inventoryPage}`}>
      <header className={styles.hero}>
        <div>
          <h1>Inventory</h1>
          <p>See what is in store and choose what to do next.</p>
        </div>
      </header>

      {params.message ? <p className={`form-message ${params.type === "error" ? "error" : "success"}`}>{params.message}</p> : null}

      <InventoryHubNavigation access={access} purchasing={purchasing} branchId={params.branchId} branchCount={branches.length} />
      {!purchasing ? <>

      <section className={styles.workspace} aria-labelledby="inventory-overview-heading">
        <div className={styles.workspaceHeader}>
          <div>
            <span className={styles.eyebrow}>Live overview</span>
            <h2 id="inventory-overview-heading">Stock overview</h2>
          </div>
          <span className={styles.scopeLabel}>{selectedBranchId ? branches.find((branch) => branch.id === selectedBranchId)?.name : "All accessible stores"}</span>
        </div>

        <form className={styles.filters} key={`${query}:${selectedBranchId ?? "all"}:${stockStatus || "all"}`}>
          <label className={styles.searchField}>
            <span>Product or SKU</span>
            <input name="q" defaultValue={query} placeholder="Search inventory" />
          </label>
          {branches.length > 1 ? (
            <label>
              <span>Store</span>
              <select name="branchId" defaultValue={selectedBranchId ?? ""}>
                <option value="">All stores</option>
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
          <article className={styles.metricCard}><span>Out of stock</span><strong>{outOfStock.length}</strong><small>Product/store balances at zero</small></article>
          <article className={styles.metricCard}><span>Low stock</span><strong>{lowStock.length}</strong><small>At or below reorder level, including out of stock</small></article>
          <article className={styles.metricCard}><span>In stock</span><strong>{inStock.length}</strong><small>Above reorder level</small></article>
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
                <thead><tr><th>Product</th><th>Store</th><th>Quantity</th><th>Status</th></tr></thead>
                <tbody>{balances.map(({ product, stock }) => {
                  const state = getStockState(stock.quantity, stock.reorderLevel);
                  return <tr key={stock.id}><td><strong>{product.name}</strong><small>{product.sku ?? "No SKU"}</small></td><td>{stock.branch.name}</td><td className={styles.quantityCell}>{stock.quantity}</td><td><span className={`${styles.stockStatus} ${state.className}`}>{state.label}</span>{canAddStock && stock.quantity <= stock.reorderLevel ? <Link className={styles.textLink} href={`/inventory/stock-in?${new URLSearchParams({ productId: product.id, branchId: stock.branchId })}`}>Add Stock</Link> : null}</td></tr>;
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
                      <div><dt>Quantity</dt><dd>{stock.quantity}</dd></div>
                    </dl>
                    {canAddStock && stock.quantity <= stock.reorderLevel ? <Link href={`/inventory/stock-in?${new URLSearchParams({ productId: product.id, branchId: stock.branchId })}`}>Add Stock</Link> : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.emptyState}><strong>No matching stock balances</strong><p>Try changing the search, branch or stock status filter.</p></div>
        )}
      </section>

      </> : null}
    </section>
  );
}
