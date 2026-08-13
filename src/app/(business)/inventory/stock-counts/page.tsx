import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";

export default async function StockCountsPage({ searchParams }: { searchParams: Promise<{ branchId?: string; page?: string; q?: string; status?: string }> }) {
  const { businessId, user } = await requireBusinessUserForModule("INVENTORY", "VIEW_STOCK_COUNTS");
  const params = await searchParams; const branches = await getOperationalBranches(businessId, user); const branchIds = branches.map((branch) => branch.id);
  const page = Math.max(1, Number(params.page) || 1); const take = 25; const status = ["DRAFT", "IN_PROGRESS", "SUBMITTED", "APPROVED", "CANCELLED"].includes(params.status ?? "") ? params.status : undefined;
  const selectedBranch = branchIds.includes(params.branchId ?? "") ? params.branchId : undefined; const q = params.q?.trim() ?? "";
  const where = { businessId, branchId: { in: selectedBranch ? [selectedBranch] : branchIds }, ...(status ? { status: status as "DRAFT" } : {}), ...(q ? { countNumber: { contains: q, mode: "insensitive" as const } } : {}) };
  const [sessions, total] = await Promise.all([
    prisma.stockCountSession.findMany({ where, include: { approvedBy: { select: { name: true } }, branch: { select: { name: true } }, createdBy: { select: { name: true } }, lines: { select: { varianceQuantity: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    prisma.stockCountSession.count({ where }),
  ]);
  return <section className="content"><div className="page-header"><div><h1>Stock counts</h1><p>Physical evidence freezes expected stock at count time; only approval posts variance movements.</p></div><div className="form-actions"><Link className="button-link" href="/inventory/stock-counts/new">New stock count</Link><Link className="secondary-link-button" href="/inventory/reorder">Reorder</Link><Link href="/inventory">Inventory</Link></div></div>
    <form className="filter-bar"><input name="q" defaultValue={q} placeholder="Count number" />{branches.length > 1 ? <select name="branchId" defaultValue={selectedBranch ?? ""}><option value="">All branches</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select> : null}<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option>{["DRAFT", "IN_PROGRESS", "SUBMITTED", "APPROVED", "CANCELLED"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select><button>Filter</button></form>
    <div className="panel"><div className="section-header"><h2>Count history</h2><span>{total} session(s)</span></div>{sessions.length ? <div className="table-wrap"><table><thead><tr><th>Count no.</th><th>Branch</th><th>Date</th><th>Products</th><th>Variance lines</th><th>Status</th><th>Counter / creator</th><th>Approver</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td><Link href={`/inventory/stock-counts/${session.id}`}>{session.countNumber}</Link></td><td>{session.branch.name}</td><td>{session.createdAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</td><td>{session.lines.length}</td><td>{session.lines.filter((line) => line.varianceQuantity !== null && line.varianceQuantity !== 0).length}</td><td><span className={`status ${session.status === "APPROVED" ? "active" : session.status === "CANCELLED" ? "inactive" : "warning"}`}>{session.status.replaceAll("_", " ")}</span></td><td>{session.createdBy.name}</td><td>{session.approvedBy?.name ?? "—"}</td></tr>)}</tbody></table></div> : <p className="empty-state">No stock counts in this branch scope.</p>}</div>
    {total > take ? <div className="form-actions">{page > 1 ? <Link href={`?page=${page - 1}`}>Previous</Link> : null}<span>Page {page} of {Math.ceil(total / take)}</span>{page * take < total ? <Link href={`?page=${page + 1}`}>Next</Link> : null}</div> : null}
  </section>;
}
