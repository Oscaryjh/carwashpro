import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

type InventoryPageProps = {
  searchParams: Promise<{ branchId?: string; message?: string; q?: string; status?: string; type?: string }>;
};

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
    <section className="content">
      <div className="page-header">
        <div><h1>Inventory</h1><p>Branch balances materialized from an immutable stock movement ledger.</p></div>
        <div className="form-actions"><Link className="button-link" href="/inventory/accounts-payable">Accounts payable</Link><Link className="button-link" href="/inventory/supplier-bills">Supplier bills</Link><Link className="button-link" href="/inventory/stock-counts">Stock counts</Link><Link className="button-link" href="/inventory/reorder">Reorder</Link><Link className="button-link" href="/inventory/purchase-orders">Purchase orders</Link><Link className="secondary-link-button" href="/inventory/suppliers">Suppliers</Link><Link className="button-link" href="/inventory/stock-in">Stock in</Link><Link className="button-link" href="/inventory/stock-out">Stock out</Link><Link className="button-link" href="/inventory/adjustment">Adjust</Link><Link className="button-link" href="/inventory/transfer">Transfer</Link><Link className="secondary-link-button" href="/inventory/movements">Movements</Link><Link className="secondary-link-button" href="/inventory/reconciliation">Reconcile</Link></div>
      </div>
      {params.message ? <p className={`form-message ${params.type === "error" ? "error" : "success"}`}>{params.message}</p> : null}
      <form className="filter-bar">
        <input name="q" defaultValue={query} placeholder="Search product or SKU" />
        {branches.length > 1 ? <select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : null}
        <select name="status" defaultValue={stockStatus}><option value="">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
        <button type="submit">Filter</button>
      </form>
      <div className="stat-grid">
        <div className="stat-card"><span>Tracked products</span><strong>{products.length}</strong></div>
        <div className="stat-card"><span>Stock on hand</span><strong>{quantityOnHand}</strong></div>
        <div className="stat-card"><span>Low stock</span><strong>{lowStock.length}</strong></div>
        <div className="stat-card"><span>Out of stock</span><strong>{outOfStock.length}</strong></div>
        <div className="stat-card"><span>Inventory selling value</span><strong>RM{sellingValue.toFixed(2)}</strong></div>
        <div className="stat-card"><span>Recent movements</span><strong>{recentMovements.length}</strong></div>
      </div>
      <div className="panel">
        <div className="section-header"><h2>Stock balance</h2><span>Negative stock blocked</span></div>
        {!products.length ? <p className="empty-state">No inventory-tracked products. Enable tracking from Products and enter explicit opening balances.</p> : balances.length ? (
          <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Branch</th><th>On hand</th><th>Reorder</th><th>Selling price</th><th>Revision</th><th>Status</th></tr></thead><tbody>{balances.map(({ product, stock }) => <tr key={stock.id}><td>{product.name}</td><td>{product.sku ?? "—"}</td><td>{stock.branch.name}</td><td>{stock.quantity}</td><td>{stock.reorderLevel}</td><td>RM{Number(product.price).toFixed(2)}</td><td>{stock.revision}</td><td><span className={`status ${stock.quantity <= stock.reorderLevel ? "warning" : "active"}`}>{stock.quantity <= 0 ? "OUT OF STOCK" : stock.quantity <= stock.reorderLevel ? "LOW STOCK" : "IN STOCK"}</span></td></tr>)}</tbody></table></div>
        ) : <p className="empty-state">No balance rows are available for your branch scope.</p>}
      </div>
      <div className="panel">
        <div className="section-header"><h2>Movement ledger</h2><span>Append-only</span></div>
        {recentMovements.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Product</th><th>Branch</th><th>Type</th><th>Delta</th><th>Balance</th><th>Reason</th><th>Actor</th></tr></thead><tbody>{recentMovements.map((movement) => <tr key={movement.id}><td>{movement.createdAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</td><td>{movement.product.name}</td><td>{movement.branch.name}</td><td>{movement.type.replaceAll("_", " ")}</td><td>{movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}</td><td>{movement.quantityAfter}</td><td>{movement.reason}</td><td>{movement.actor?.name ?? "System"}</td></tr>)}</tbody></table></div> : <p className="empty-state">No movements yet.</p>}
      </div>
    </section>
  );
}
