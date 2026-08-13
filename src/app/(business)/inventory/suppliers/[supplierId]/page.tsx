import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getOperationalBranches } from "@/lib/branches";
import { getAccountsPayableOverview } from "@/lib/inventory/supplier-ap-service";
import { prisma } from "@/lib/prisma";
import { updateSupplierAction } from "../../purchasing-actions";

export default async function SupplierDetailPage({ params, searchParams }: { params: Promise<{ supplierId: string }>; searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("INVENTORY", "VIEW_SUPPLIERS");
  const { supplierId } = await params; const query = await searchParams;
  const supplier = await prisma.supplier.findFirst({ where: { businessId: context.businessId, id: supplierId }, include: { purchaseOrders: { orderBy: { createdAt: "desc" }, take: 25, include: { branch: { select: { name: true } } } } } });
  if (!supplier) notFound();
  const canViewAp = hasBusinessCapability(context.access, "VIEW_ACCOUNTS_PAYABLE");
  const ap = canViewAp ? await getAccountsPayableOverview({ businessId: context.businessId, allowedBranchIds: (await getOperationalBranches(context.businessId, context.user)).map((branch) => branch.id) }) : null;
  const supplierAp = ap?.suppliers.find((item) => item.supplierId === supplier.id);
  return <section className="content"><div className="page-header"><div><h1>{supplier.name}</h1><p>{supplier.code ?? "No supplier code"} · {supplier.status}</p></div><div className="form-actions"><Link href="/inventory/suppliers">Suppliers</Link>{canViewAp ? <Link href="/inventory/accounts-payable">Accounts payable</Link> : null}<Link className="button-link" href="/inventory/purchase-orders/new">New PO</Link></div></div>{query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    {canViewAp ? <div className="stat-grid"><div className="stat-card"><span>Supplier outstanding</span><strong>RM{supplierAp?.outstanding.toFixed(2) ?? "0.00"}</strong></div><div className="stat-card"><span>Open AP bills</span><strong>{ap?.bills.filter((bill) => bill.supplierId === supplier.id).length ?? 0}</strong></div></div> : null}
    <div className="panel"><h2>Supplier details</h2><form action={updateSupplierAction} className="form-grid"><input type="hidden" name="supplierId" value={supplier.id} /><input type="hidden" name="operationKey" value={`UPDATE_SUPPLIER:${randomUUID()}`} /><label>Name<input name="name" required defaultValue={supplier.name} /></label><label>Code<input name="code" defaultValue={supplier.code ?? ""} /></label><label>Contact person<input name="contactPerson" defaultValue={supplier.contactPerson ?? ""} /></label><label>Phone<input name="phone" defaultValue={supplier.phone ?? ""} /></label><label>Email<input name="email" type="email" defaultValue={supplier.email ?? ""} /></label><label>Status<select name="status" defaultValue={supplier.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label className="full-width">Address<textarea name="address" defaultValue={supplier.address ?? ""} /></label><label className="full-width">Notes<textarea name="notes" defaultValue={supplier.notes ?? ""} /></label><div className="form-actions full-width"><button type="submit">Save supplier</button></div></form></div>
    <div className="panel"><div className="section-header"><h2>Purchase history</h2><span>{supplier.purchaseOrders.length} recent</span></div>{supplier.purchaseOrders.length ? <div className="table-wrap"><table><thead><tr><th>PO</th><th>Branch</th><th>Date</th><th>Status</th><th>Expected total</th></tr></thead><tbody>{supplier.purchaseOrders.map((po) => <tr key={po.id}><td><Link href={`/inventory/purchase-orders/${po.id}`}>{po.poNumber}</Link></td><td>{po.branch.name}</td><td>{po.orderDate.toLocaleDateString("en-MY")}</td><td>{po.status.replaceAll("_", " ")}</td><td>RM{Number(po.subtotal).toFixed(2)}</td></tr>)}</tbody></table></div> : <p className="empty-state">No purchase orders for this supplier.</p>}</div>
  </section>;
}
