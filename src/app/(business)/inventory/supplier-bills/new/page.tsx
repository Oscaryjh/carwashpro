import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { purchaseOrderTrace } from "@/lib/inventory/supplier-ap-service";
import { prisma } from "@/lib/prisma";
import { createSupplierBillAction } from "../../supplier-ap-actions";

export default async function NewSupplierBillPage({ searchParams }: { searchParams: Promise<{ message?: string; purchaseOrderId?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("INVENTORY", "CREATE_SUPPLIER_BILL");
  const query = await searchParams;
  const branches = await getOperationalBranches(context.businessId, context.user);
  const branchIds = branches.map((branch) => branch.id);
  const orders = await prisma.purchaseOrder.findMany({ where: { businessId: context.businessId, branchId: { in: branchIds }, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } }, include: { supplier: true, branch: true }, orderBy: { createdAt: "desc" }, take: 100 });
  const selected = query.purchaseOrderId && orders.some((order) => order.id === query.purchaseOrderId) ? await prisma.purchaseOrder.findFirst({ where: { id: query.purchaseOrderId, businessId: context.businessId, branchId: { in: branchIds } }, include: { supplier: true, branch: true, lines: { include: { product: true }, orderBy: { createdAt: "asc" } } } }) : null;
  const trace = selected ? await purchaseOrderTrace({ businessId: context.businessId, purchaseOrderId: selected.id }) : [];
  const billable = trace.filter((line) => line.received - line.billed > 0);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(); due.setUTCDate(due.getUTCDate() + 30);
  return <section className="content">
    <div className="page-header"><div><h1>New supplier bill</h1><p>Select a PO, then bill only quantities supported by net goods receipts. Saving creates a draft and does not create AP.</p></div><Link href="/inventory/supplier-bills">Back to supplier bills</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <div className="panel"><form className="filter-bar"><select name="purchaseOrderId" defaultValue={selected?.id ?? ""} required><option value="">Select received purchase order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.poNumber} · {order.supplier.name} · {order.branch.name}</option>)}</select><button type="submit">Load ordered / received / billed facts</button></form></div>
    {selected ? <div className="panel"><div className="section-header"><div><h2>{selected.poNumber} · {selected.supplier.name}</h2><p>{selected.branch.name}. Goods receipt remains the only inventory effect.</p></div><Link href={`/inventory/purchase-orders/${selected.id}`}>Open PO</Link></div>
      {!billable.length ? <p className="form-message error">No net received quantity remains available for billing.</p> : <form action={createSupplierBillAction} className="stacked-form">
        <input type="hidden" name="operationKey" value={`CREATE_SUPPLIER_BILL:${randomUUID()}`} /><input type="hidden" name="purchaseOrderId" value={selected.id} /><input type="hidden" name="branchId" value={selected.branchId} />
        <div className="form-grid"><label><span>Supplier invoice number</span><input name="supplierInvoiceNumber" maxLength={120} required /></label><label><span>Invoice date</span><input name="invoiceDate" type="date" defaultValue={today} required /></label><label><span>Due date</span><input name="dueDate" type="date" defaultValue={due.toISOString().slice(0, 10)} required /></label><label><span>Notes</span><input name="notes" maxLength={2000} /></label></div>
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Net received</th><th>Already billed</th><th>Available</th><th>Bill quantity</th><th>Unit price (MYR)</th></tr></thead><tbody>{billable.map((line) => <tr key={line.purchaseOrderLineId}><td>{line.productName}<input type="hidden" name="purchaseOrderLineId" value={line.purchaseOrderLineId} /></td><td>{line.ordered}</td><td>{line.received}</td><td>{line.billed}</td><td>{line.received - line.billed}</td><td><input name="billedQuantity" type="number" min="1" max={line.received - line.billed} defaultValue={line.received - line.billed} required /></td><td><input name="unitPrice" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={line.expectedUnitCost.toFixed(2)} required /></td></tr>)}</tbody></table></div>
        <p className="form-message">Draft bill → AP RM0.00 · Stock unchanged · Business Expense unchanged.</p><button type="submit">Save draft supplier bill</button>
      </form>}
    </div> : null}
  </section>;
}
