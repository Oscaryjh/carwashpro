import Link from "next/link";
import styles from "@/components/inventory-hub.module.css";
import type { InventoryMovementType, Prisma } from "@prisma/client";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getInventoryReadBranches, resolveInventoryReadScope } from "@/lib/inventory/authorization";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;
const movementLabels: Record<InventoryMovementType, string> = {
  OPENING_BALANCE: "Opening stock", SALE: "Sale", REFUND_RESTOCK: "Returned to stock",
  STOCK_IN: "Stock added", STOCK_OUT: "Stock removed", ADJUSTMENT_IN: "Stock corrected",
  ADJUSTMENT_OUT: "Stock corrected", TRANSFER_IN: "Transfer in", TRANSFER_OUT: "Transfer out",
  VOID_REVERSAL: "Voided sale reversal", SYSTEM_CORRECTION: "System correction",
};
const movementTypes: InventoryMovementType[] = ["OPENING_BALANCE", "SALE", "REFUND_RESTOCK", "STOCK_IN", "STOCK_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "TRANSFER_OUT", "TRANSFER_IN", "VOID_REVERSAL", "SYSTEM_CORRECTION"];
type MovementPageProps = { searchParams: Promise<{ branchId?: string; dateFrom?: string; dateTo?: string; movementType?: string; page?: string; q?: string }> };

export default async function MovementPage({ searchParams }: MovementPageProps) {
  const { businessId, access } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams; await resolveInventoryReadScope(businessId, access, params.branchId);
  const branches = await getInventoryReadBranches(businessId, access);
  const allowedBranchIds = branches.map((branch) => branch.id);
  const selectedBranchId = allowedBranchIds.includes(params.branchId ?? "") ? params.branchId! : null;
  const type = movementTypes.includes(params.movementType as InventoryMovementType) ? params.movementType as InventoryMovementType : null;
  const query = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const createdAt: Prisma.DateTimeFilter = {};
  if (params.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom)) createdAt.gte = new Date(`${params.dateFrom}T00:00:00+08:00`);
  if (params.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo)) {
    const exclusiveEnd = new Date(`${params.dateTo}T00:00:00+08:00`);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    createdAt.lt = exclusiveEnd;
  }
  const where: Prisma.InventoryMovementWhereInput = {
    businessId,
    branchId: { in: selectedBranchId ? [selectedBranchId] : allowedBranchIds },
    ...(type ? { type } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(query ? { OR: [
      { product: { name: { contains: query, mode: "insensitive" } } },
      { product: { sku: { contains: query, mode: "insensitive" } } },
      { reason: { contains: query, mode: "insensitive" } },
      { reference: { contains: query, mode: "insensitive" } },
    ] } : {}),
  };
  const [rows, count] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: { actor: { select: { name: true } }, branch: { select: { name: true } }, product: { select: { name: true, sku: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const preserved = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value && key !== "page") preserved.set(key, value);
  return (
    <section className={`content ${styles.workflow}`}>
      <div className="page-header"><div><h1>Stock History</h1><p>See why stock changed, who recorded it and the quantity before and after.</p></div><Link className="secondary-link-button" href="/inventory">Back to inventory</Link></div>
      <form className="filter-bar">
        <input name="q" defaultValue={query} placeholder="Product, SKU, reason, reference" />
        {branches.length > 1 ? <select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All stores</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : null}
        <select name="movementType" defaultValue={type ?? ""}><option value="">All changes</option>{movementTypes.map((movementType) => <option key={movementType} value={movementType}>{movementType === "ADJUSTMENT_IN" ? "Stock corrected (increase)" : movementType === "ADJUSTMENT_OUT" ? "Stock corrected (decrease)" : movementLabels[movementType]}</option>)}</select>
        <input aria-label="From date" defaultValue={params.dateFrom ?? ""} name="dateFrom" type="date" />
        <input aria-label="To date" defaultValue={params.dateTo ?? ""} name="dateTo" type="date" />
        <button type="submit">Filter</button>
      </form>
      <div className="panel">
        {rows.length ? <div className={styles.historyTable}><table>
          <thead><tr><th>Date</th><th>Product</th><th>Store</th><th>Change</th><th>Reason</th><th>User</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td>{row.createdAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</td>
            <td>{row.product.name}<small>{row.product.sku ?? ""}</small></td>
            <td>{row.branch.name}</td>
            <td className={styles.change}>{row.quantityDelta > 0 ? "+" : ""}{row.quantityDelta}</td>
            <td><strong>{movementLabels[row.type]}</strong><div>{row.reason}</div>
              <details><summary>Details</summary><dl>
                <dt>Before</dt><dd>{row.quantityBefore}</dd><dt>After</dt><dd>{row.quantityAfter}</dd>
                <dt>Reference</dt><dd>{row.reference ?? "—"}</dd>
                <dt>Source</dt><dd>{row.sourceType === "INVOICE" ? <Link href={`/invoices/${row.sourceId}`}>Invoice</Link> : row.sourceType.replaceAll("_", " ")}</dd>
                <dt>Source ID</dt><dd>{row.sourceId}</dd>
              </dl></details>
            </td><td>{row.actor?.name ?? "System"}</td>
          </tr>)}</tbody>
        </table></div> : <p className="empty-state">No stock history found.</p>}
        <div className="form-actions"><span>Page {Math.min(page, pageCount)} of {pageCount} · {count} changes</span>{page > 1 ? <Link className="secondary-link-button" href={`?${withPage(preserved, page - 1)}`}>Previous</Link> : null}{page < pageCount ? <Link className="secondary-link-button" href={`?${withPage(preserved, page + 1)}`}>Next</Link> : null}</div>
      </div>
    </section>
  );
}

function withPage(params: URLSearchParams, page: number) { const next = new URLSearchParams(params); next.set("page", String(page)); return next.toString(); }
