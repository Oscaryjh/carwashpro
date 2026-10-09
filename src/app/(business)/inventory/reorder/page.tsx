import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getInventoryReadBranches, resolveInventoryReadScope } from "@/lib/inventory/authorization";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getReorderView } from "@/lib/inventory/stock-count-service";
import { setReorderSettingsAction } from "../stock-count-actions";

export default async function ReorderPage({ searchParams }: { searchParams: Promise<{ branchId?: string; message?: string; page?: string; q?: string; status?: string; type?: string }> }) {
  const { businessId, access } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY"); const params = await searchParams; await resolveInventoryReadScope(businessId, access, params.branchId); const branches = await getInventoryReadBranches(businessId, access); const allBranchIds = branches.map((branch) => branch.id); const selectedBranch = allBranchIds.includes(params.branchId ?? "") ? params.branchId! : null;
  const filter = ["needs", "out", "low"].includes(params.status ?? "") ? params.status : "";
  const result = await getReorderView({ branchIds: selectedBranch ? [selectedBranch] : allBranchIds, businessId, page: Number(params.page) || 1, pageSize: 50, query: params.q, status: filter });
  const rows = result.rows;
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (selectedBranch) query.set("branchId", selectedBranch);
    if (filter) query.set("status", filter);
    query.set("page", String(page));
    return `?${query}`;
  };
  const can = (capability: Parameters<typeof hasBusinessCapability>[1]) => hasBusinessCapability(access, capability);
  return <section className="content"><div className="page-header"><div><h1>Restock suggestions</h1><p>Review stock on hand and incoming orders before buying more. Suggestions do not place orders.</p></div><div className="form-actions">{can("VIEW_STOCK_COUNTS") ? <Link className="secondary-link-button" href="/inventory/stock-counts">Stock counts</Link> : null}<Link href="/inventory">Inventory</Link></div></div>{params.message ? <p className={`form-message ${params.type === "error" ? "error" : "success"}`}>{params.message}</p> : null}
    <form className="filter-bar"><input name="q" defaultValue={params.q ?? ""} placeholder="Product or SKU" />{branches.length > 1 ? <select name="branchId" defaultValue={selectedBranch ?? ""}><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : null}<select name="status" defaultValue={filter}><option value="">All products</option><option value="needs">Needs reorder</option><option value="out">Out of stock</option><option value="low">Low stock</option></select><button>Filter</button></form>
    <div className="panel"><div className="section-header"><h2>Purchase suggestions</h2><span>{result.total} branch/product row(s)</span></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Branch</th><th>On hand</th><th>Reorder level</th><th>On order</th><th>Projected</th><th>Target</th><th>Suggested qty</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.branchId}:${row.productId}`}><td>{row.productName}<br /><small>{row.sku ?? "No SKU"}</small></td><td>{row.branchName}</td><td>{row.onHand}</td><td>{row.reorderLevel}</td><td>{row.onOrderQuantity}</td><td>{row.projectedStock}</td><td>{row.targetStockLevel ?? "Not configured"}</td><td>{row.suggestedQuantity ?? "Not configured"}</td><td><div className="form-actions">{can("MANAGE_REORDER_SETTINGS") ? <details><summary>Settings</summary><form action={setReorderSettingsAction} className="form-grid"><input type="hidden" name="operationKey" value={`REORDER_SETTINGS:${randomUUID()}`} /><input type="hidden" name="branchId" value={row.branchId} /><input type="hidden" name="productId" value={row.productId} /><input type="hidden" name="expectedRevision" value={row.revision} /><label>Reorder<input name="reorderLevel" type="number" min="0" step="1" required defaultValue={row.reorderLevel} /></label><label>Target<input name="targetStockLevel" type="number" min="0" step="1" defaultValue={row.targetStockLevel ?? ""} placeholder="Not configured" /></label><button>Save</button></form></details> : null}{row.suggestedQuantity !== null && row.suggestedQuantity > 0 && can("CREATE_PURCHASE_ORDER") ? <Link className="button-link" href={`/inventory/purchase-orders/new?branchId=${row.branchId}&productId=${row.productId}&quantity=${row.suggestedQuantity}`}>Create PO</Link> : null}</div></td></tr>)}</tbody></table></div> : <p className="empty-state">No reorder rows match this filter.</p>}</div>
    {result.total > result.pageSize ? <div className="form-actions">{result.page > 1 ? <Link href={pageHref(result.page - 1)}>Previous</Link> : null}<span>Page {result.page} of {Math.ceil(result.total / result.pageSize)}</span>{result.page * result.pageSize < result.total ? <Link href={pageHref(result.page + 1)}>Next</Link> : null}</div> : null}
  </section>;
}
