import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { createStockCountAction } from "../../stock-count-actions";

export default async function NewStockCountPage({ searchParams }: { searchParams: Promise<{ message?: string; type?: string }> }) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "CREATE_STOCK_COUNT"); const query = await searchParams;
  const [branches, products] = await Promise.all([getOperationalBranches(businessId, user), prisma.product.findMany({ where: { businessId, status: "ACTIVE", trackInventory: true }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true } })]);
  return <section className="content"><div className="page-header"><div><h1>New stock count</h1><p>Create a branch-scoped physical count. No stock changes until a different authorised user approves variance.</p></div><Link href="/inventory/stock-counts">Back to counts</Link></div>{query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <div className="panel"><form action={createStockCountAction} className="form-grid"><input type="hidden" name="operationKey" value={`STOCK_COUNT_CREATE:${randomUUID()}`} /><label>Branch<select name="branchId" required defaultValue={branches[0]?.id}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Count scope<select name="countType" defaultValue="FULL_BRANCH_COUNT"><option value="FULL_BRANCH_COUNT">Full branch count</option><option value="SELECTED_PRODUCTS">Selected products</option></select></label><label className="full-width">Notes<textarea name="notes" rows={3} maxLength={2000} /></label><fieldset className="full-width"><legend>Products for selected-product count</legend><p className="help-text">Ignored for a full branch count. Services never appear.</p><div className="checkbox-grid">{products.map((product) => <label key={product.id}><input type="checkbox" name="productIds" value={product.id} /> {product.name}{product.sku ? ` (${product.sku})` : ""}</label>)}</div></fieldset><div className="form-actions full-width"><button disabled={!branches.length || !products.length}>Create draft count</button></div></form></div>
  </section>;
}
