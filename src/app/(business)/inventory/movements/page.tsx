import Link from "next/link";
import type { InventoryMovementType, Prisma } from "@prisma/client";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;
const movementTypes: InventoryMovementType[] = ["OPENING_BALANCE", "SALE", "REFUND_RESTOCK", "STOCK_IN", "STOCK_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "TRANSFER_OUT", "TRANSFER_IN", "VOID_REVERSAL", "SYSTEM_CORRECTION"];
type MovementPageProps = { searchParams: Promise<{ branchId?: string; dateFrom?: string; dateTo?: string; movementType?: string; page?: string; q?: string }> };

export default async function MovementPage({ searchParams }: MovementPageProps) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "VIEW_INVENTORY");
  const params = await searchParams;
  const branches = await getOperationalBranches(businessId, user);
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
    <section className="content">
      <div className="page-header"><div><h1>Stock movement ledger</h1><p>Immutable quantity history with source, actor, before, and after values.</p></div><Link className="secondary-link-button" href="/inventory">Back to inventory</Link></div>
      <form className="filter-bar">
        <input name="q" defaultValue={query} placeholder="Product, SKU, reason, reference" />
        {branches.length > 1 ? <select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : null}
        <select name="movementType" defaultValue={type ?? ""}><option value="">All movement types</option>{movementTypes.map((movementType) => <option key={movementType} value={movementType}>{movementType.replaceAll("_", " ")}</option>)}</select>
        <input aria-label="From date" defaultValue={params.dateFrom ?? ""} name="dateFrom" type="date" />
        <input aria-label="To date" defaultValue={params.dateTo ?? ""} name="dateTo" type="date" />
        <button type="submit">Filter</button>
      </form>
      <div className="panel">
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Product</th><th>Type</th><th>Change</th><th>Before</th><th>After</th><th>Source</th><th>Reference</th><th>Actor</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.createdAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</td><td>{row.branch.name}</td><td>{row.product.name}<small>{row.product.sku ? ` · ${row.product.sku}` : ""}</small></td><td>{row.type.replaceAll("_", " ")}</td><td>{row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}</td><td>{row.quantityBefore}</td><td>{row.quantityAfter}</td><td>{row.sourceType === "INVOICE" ? <Link href={`/invoices/${row.sourceId}`}>Invoice</Link> : row.sourceType.replaceAll("_", " ")}</td><td>{row.reference ?? "—"}</td><td>{row.actor?.name ?? "System"}</td><td>{row.reason}</td></tr>)}</tbody></table></div> : <p className="empty-state">No matching stock movements.</p>}
        <div className="form-actions"><span>Page {Math.min(page, pageCount)} of {pageCount} · {count} movements</span>{page > 1 ? <Link className="secondary-link-button" href={`?${withPage(preserved, page - 1)}`}>Previous</Link> : null}{page < pageCount ? <Link className="secondary-link-button" href={`?${withPage(preserved, page + 1)}`}>Next</Link> : null}</div>
      </div>
    </section>
  );
}

function withPage(params: URLSearchParams, page: number) { const next = new URLSearchParams(params); next.set("page", String(page)); return next.toString(); }
