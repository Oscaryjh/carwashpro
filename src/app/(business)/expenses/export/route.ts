import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { listBusinessExpenses } from "@/lib/expense/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  const scope = await resolveExpenseReadScope(context);
  const query = new URL(request.url).searchParams;
  const branchId = scope.branches.some((branch) => branch.id === query.get("branchId")) ? query.get("branchId") : null;
  const statusValue = query.get("status");
  const paymentValue = query.get("paymentStatus");
  const sourceValue = query.get("sourceType");
  const rows: Awaited<ReturnType<typeof listBusinessExpenses>>["items"] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await listBusinessExpenses({ businessId: context.businessId, branchId, categoryId: query.get("categoryId"), dateFrom: query.get("from"), dateTo: query.get("to"), page, pageSize: 100, paymentStatus: paymentValue === "PAID" || paymentValue === "UNPAID" ? paymentValue : null, q: query.get("q"), sourceType: sourceValue === "MANUAL" || sourceValue === "CLAIM" || sourceValue === "PAYROLL" || sourceValue === "INVENTORY_PURCHASE" ? sourceValue : null, status: statusValue === "DRAFT" || statusValue === "CONFIRMED" || statusValue === "VOID" ? statusValue : null, ...scope });
    rows.push(...result.items);
    if (rows.length >= result.total) break;
  }
  const headers = ["Expense No.", "Expense Date", "Category", "Payee", "Branch", "Recorded MYR", "Settlement Status", "Paid MYR", "Outstanding MYR", "Source", "Source Status", "Status", "Description"];
  const csv = [headers, ...rows.map((expense) => [expense.expenseNumber, expense.expenseDate.toISOString().slice(0, 10), expense.categoryNameSnapshot, expense.payeeName ?? "", expense.branchNameSnapshot ?? "Business-wide", expense.amount.toFixed(2), expense.sourceSettlement?.settlementStatus ?? expense.paymentStatus, expense.sourceSettlement?.paidAmount.toFixed(2) ?? (expense.paymentStatus === "PAID" ? expense.amount.toFixed(2) : "0.00"), expense.sourceSettlement?.outstandingAmount.toFixed(2) ?? (expense.paymentStatus === "UNPAID" ? expense.amount.toFixed(2) : "0.00"), expense.sourceType, expense.sourceSnapshot?.sourceStatusSnapshot ?? "", expense.status, expense.description])].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`\uFEFF${csv}`, { headers: { "cache-control": "private, no-store", "content-disposition": `attachment; filename="expense-history-${new Date().toISOString().slice(0, 10)}.csv"`, "content-type": "text/csv; charset=utf-8" } });
}
function csvCell(value: string) { return `"${value.replaceAll('"', '""')}"`; }
