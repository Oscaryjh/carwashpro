import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { getAccountsPayableOverview, reconcileAccountsPayable } from "@/lib/inventory/supplier-ap-service";

export default async function AccountsPayablePage() {
  const context = await requireBusinessUserForModule("INVENTORY", "VIEW_ACCOUNTS_PAYABLE");
  const branches = await getOperationalBranches(context.businessId, context.user);
  const scope = { businessId: context.businessId, allowedBranchIds: branches.map((branch) => branch.id) };
  const [overview, reconciliation] = await Promise.all([getAccountsPayableOverview(scope), reconcileAccountsPayable(scope)]);
  return <section className="content">
    <div className="page-header"><div><h1>Accounts payable</h1><p>Outstanding = confirmed bill amount − valid completed supplier payments. This value is never user-editable.</p></div><div className="form-actions"><Link href="/inventory/supplier-bills">Supplier bills</Link><Link href="/inventory/suppliers">Suppliers</Link></div></div>
    <div className="stat-grid"><div className="stat-card"><span>Total outstanding</span><strong>RM{overview.totalOutstanding.toFixed(2)}</strong></div><div className="stat-card"><span>Open bills</span><strong>{overview.bills.length}</strong></div><div className="stat-card"><span>Due in 7 days</span><strong>{overview.dueSoon.length}</strong></div><div className="stat-card"><span>Overdue</span><strong>{overview.overdue.length}</strong></div><div className="stat-card"><span>Suppliers owed</span><strong>{overview.suppliers.length}</strong></div><div className="stat-card"><span>Reconciliation</span><strong>{reconciliation.status}</strong></div></div>
    <div className="panel"><div className="section-header"><h2>Supplier outstanding balances</h2><span>Canonical completed payments only</span></div>{overview.suppliers.length ? <div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Outstanding</th></tr></thead><tbody>{overview.suppliers.map((supplier) => <tr key={supplier.supplierId}><td><Link href={`/inventory/suppliers/${supplier.supplierId}`}>{supplier.supplierName}</Link></td><td>RM{supplier.outstanding.toFixed(2)}</td></tr>)}</tbody></table></div> : <p className="empty-state">No confirmed unpaid supplier bills.</p>}</div>
    <div className="panel"><div className="section-header"><h2>Open bills</h2><span>Due soon and overdue are derived from due date</span></div>{overview.bills.length ? <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Supplier</th><th>Due</th><th>Payment status</th><th>Total</th><th>Paid</th><th>Outstanding</th></tr></thead><tbody>{overview.bills.map((bill) => <tr key={bill.id}><td><Link href={`/inventory/supplier-bills/${bill.id}`}>{bill.billNumber}</Link></td><td>{bill.supplier.name}</td><td>{bill.dueDate.toLocaleDateString("en-MY")}</td><td>{bill.paymentStatus.replaceAll("_", " ")}</td><td>RM{bill.totalAmount.toFixed(2)}</td><td>RM{bill.validPaidAmount.toFixed(2)}</td><td><strong>RM{bill.outstandingAmount.toFixed(2)}</strong></td></tr>)}</tbody></table></div> : <p className="empty-state">Accounts payable is clear.</p>}</div>
    {reconciliation.issues.length ? <div className="panel"><div className="section-header"><h2>Reconciliation issues</h2><span className="status warning">REVIEW REQUIRED</span></div><ul>{reconciliation.issues.map((issue, index) => <li key={`${issue.entityId}:${issue.code}:${index}`}><strong>{issue.code}</strong>: {issue.detail}</li>)}</ul></div> : null}
  </section>;
}
