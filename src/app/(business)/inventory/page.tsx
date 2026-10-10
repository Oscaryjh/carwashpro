import Link from "next/link";
import { InventoryHubNavigation } from "@/components/inventory-hub-navigation";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { outletBranches, outletPresentation, resolveInventoryOutletReadContext } from "@/lib/outlet-ui-context";
import { prisma } from "@/lib/prisma";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
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
  const { businessId, access, user, moduleContext } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams;
  const outletContext = await resolveInventoryOutletReadContext({ businessId, actorUserId: user.userId,
    ...(Object.prototype.hasOwnProperty.call(params, "branchId") ? { explicitBranchInput: params.branchId } : {}),
  });
  if (outletContext.kind === "denied") return <section className="content"><h1>Inventory</h1><p role="alert">You do not have access to stock in this location.</p></section>;
  if (outletContext.kind === "no_location") return <section className="content"><h1>Inventory</h1><p role="status">This business does not have an operating location set up yet.</p><p>{access.effectiveBusinessRole === "BUSINESS_OWNER" ? "Contact the Platform Admin or complete the existing business setup." : "Ask the business owner to complete the setup."}</p></section>;
  const outlet = outletPresentation(outletContext);
  const single = outletContext.kind === "single_outlet";
  const branches = outletBranches(outletContext);
  const allowedBranchIds = branches.map((branch) => branch.id);
  const selectedBranchId = outletContext.kind === "single_outlet" ? outletContext.internalBranchId : allowedBranchIds.includes(params.branchId ?? "")
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
  const canSetUpProducts = access.granted && access.source === "DIRECT_BUSINESS" && moduleContext.enabledModules.has("POS") && hasBusinessCapability(access, "VIEW_CATALOG") && hasStaffPermission(user, "PRODUCTS");

  return (
    <section className={`content ${styles.inventoryPage}`}>
      <header className={styles.hero}>
        <div>
          <h1>Inventory</h1>
          <p>{single ? "See how much stock you have and choose what to do next." : "See what is in store and choose what to do next."}</p>
        </div>
      </header>

      {params.message ? <p className={`form-message ${params.type === "error" ? "error" : "success"}`}>{params.message}</p> : null}

      <InventoryHubNavigation access={access} purchasing={purchasing} branchId={params.branchId} branchCount={branches.length} outlet={outlet} />
      {!purchasing ? <>

      <section className={styles.workspace} aria-labelledby="inventory-overview-heading">
        <div className={styles.workspaceHeader}>
          <div>
            <span className={styles.eyebrow}>Live overview</span>
            <h2 id="inventory-overview-heading">Stock overview</h2>
          </div>
          {!single ? <span className={styles.scopeLabel}>{selectedBranchId ? branches.find((branch) => branch.id === selectedBranchId)?.name : "All accessible stores"}</span> : null}
        </div>

        <form className={styles.filters} key={`${query}:${selectedBranchId ?? "all"}:${stockStatus || "all"}`}>
          <label className={styles.searchField}>
            <span>Product or SKU</span>
            <input name="q" defaultValue={query} placeholder="Search inventory" />
          </label>
          {!single && branches.length > 1 ? (
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
          <article className={styles.metricCard}><span>Out of stock</span><strong>{outOfStock.length}</strong><small>{single ? "Products at zero" : "Product/store balances at zero"}</small></article>
          <article className={styles.metricCard}><span>Low stock</span><strong>{lowStock.length}</strong><small>At or below reorder level, including out of stock</small></article>
          <article className={styles.metricCard}><span>In stock</span><strong>{inStock.length}</strong><small>Above reorder level</small></article>
        </div>
      </section>

      <section className={styles.dataPanel} aria-labelledby="stock-balance-heading">
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>Current position</span><h2 id="stock-balance-heading">Stock balance</h2></div>
          <span className={styles.safetyBadge}>Negative stock blocked</span>
        </div>
        {!branches.length ? (
          <div className={styles.emptyState}><strong>No store stock is available in your current access.</strong><p>Ask the business owner to check your store access or set up an active store. Products and their stock history are kept.</p></div>
        ) : !balances.length && hasFilters ? (
          <div className={styles.emptyState}><strong>No stock matches your current search or filters.</strong><p>{single ? "Try another search or filter." : "Try another search or store."}</p><Link href="/inventory">Clear filters</Link></div>
        ) : !products.length ? (
          <div className={styles.emptyState}>
            <strong>No products are being tracked yet.</strong>
            <p>Turn on Track stock in Products for the items you want to manage.</p>
            {canSetUpProducts ? <Link href="/products">Set up products</Link> : <p>Ask the business owner to set up stock tracking for products.</p>}
          </div>
        ) : balances.length ? (
          <>
            <div className={styles.desktopTable}>
              <table>
                <thead><tr><th>Product</th>{!single ? <th>Store</th> : null}<th>Quantity</th><th>Status</th></tr></thead>
                <tbody>{balances.map(({ product, stock }) => {
                  const state = getStockState(stock.quantity, stock.reorderLevel);
                  return <tr key={stock.id}><td><strong>{product.name}</strong><small>{product.sku ?? "No SKU"}</small>{product.status === "INACTIVE" ? <small>Inactive — stock and history are kept.</small> : null}</td>{!single ? <td>{stock.branch.name}</td> : null}<td className={styles.quantityCell}>{stock.quantity}</td><td><span className={`${styles.stockStatus} ${state.className}`}>{state.label}</span>{canAddStock && product.status === "ACTIVE" && stock.quantity <= stock.reorderLevel ? <Link className={styles.textLink} href={`/inventory/stock-in?${new URLSearchParams({ productId: product.id, branchId: stock.branchId })}`}>Add Stock</Link> : null}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className={styles.mobileBalances}>
              {balances.map(({ product, stock }) => {
                const state = getStockState(stock.quantity, stock.reorderLevel);
                return (
                  <article key={stock.id} className={styles.balanceCard}>
                    <div className={styles.balanceCardHeader}>
                      <div><strong>{product.name}</strong><span>{product.sku ?? "No SKU"}{!single ? ` · ${stock.branch.name}` : ""}</span></div>
                      <span className={`${styles.stockStatus} ${state.className}`}>{state.label}</span>
                    </div>
                    <dl>
                      <div><dt>Quantity</dt><dd>{stock.quantity}</dd></div>
                    </dl>
                    {product.status === "INACTIVE" ? <p>Inactive — stock and history are kept.</p> : null}
                    {canAddStock && product.status === "ACTIVE" && stock.quantity <= stock.reorderLevel ? <Link href={`/inventory/stock-in?${new URLSearchParams({ productId: product.id, branchId: stock.branchId })}`}>Add Stock</Link> : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className={styles.emptyState}><strong>{single ? "No stock quantities are set up yet." : "No stock quantities are set up for these stores yet."}</strong><p>{single ? "The products still exist. Ask the business owner to check their stock setup." : "The products still exist. Ask the business owner to check their stock setup for these stores."}</p></div>
        )}
      </section>

      </> : null}
    </section>
  );
}
