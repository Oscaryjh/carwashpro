import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { listSupplierBills } from "@/lib/inventory/supplier-ap-service";

export default async function SupplierBillsPage({ searchParams }: { searchParams: Promise<{ message?: string; status?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("INVENTORY", "VIEW_SUPPLIER_BILL");
  const query = await searchParams;
  const statuses = ["DRAFT", "CONFIRMED", "VOID"] as const;
  const status = statuses.includes(query.status as typeof statuses[number]) ? query.status as typeof statuses[number] : undefined;
  const branches = await getOperationalBranches(context.businessId, context.user);
  const bills = await listSupplierBills({ businessId: context.businessId, allowedBranchIds: branches.map((branch) => branch.id), status });
  return <section className="content">
    <div className="page-header"><div><h1>Supplier bills</h1><p>Supplier invoices matched to ordered, net received and previously billed facts. Drafts do not create AP.</p></div><div className="form-actions"><Link href="/inventory/accounts-payable">Accounts payable</Link><Link href="/inventory/purchase-orders">Purchase orders</Link><Link className="button-link" href="/inventory/supplier-bills/new">New supplier bill</Link></div></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <form className="filter-bar"><select name="status" defaultValue={status ?? ""}><option value="">All status</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="submit">Filter</button></form>
    <div className="panel"><div className="section-header"><h2>Bills</h2><span>{bills.length} records</span></div>{bills.length ? <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Supplier invoice</th><th>Supplier</th><th>PO</th><th>Branch</th><th>Due</th><th>Status</th><th>Total</th><th>Outstanding</th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><Link href={`/inventory/supplier-bills/${bill.id}`}>{bill.billNumber}</Link></td><td>{bill.supplierInvoiceNumber}</td><td>{bill.supplier.name}</td><td><Link href={`/inventory/purchase-orders/${bill.purchaseOrderId}`}>{bill.purchaseOrder.poNumber}</Link></td><td>{bill.branch.name}</td><td>{bill.dueDate.toLocaleDateString("en-MY")}</td><td><span className={`status ${bill.status === "CONFIRMED" ? "active" : bill.status === "VOID" ? "inactive" : "warning"}`}>{bill.status}</span></td><td>RM{bill.totalAmount.toFixed(2)}</td><td>RM{bill.outstandingAmount.toFixed(2)}</td></tr>)}</tbody></table></div> : <p className="empty-state">No supplier bills match this filter.</p>}</div>
  </section>;
}
