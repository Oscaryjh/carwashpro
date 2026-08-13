import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { getBusinessExpenseDetail } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { updateExpenseFactsAction } from "../../actions";
import styles from "../../expense.module.css";

export default async function EditExpensePage({ params, searchParams }: { params: Promise<{ expenseId: string }>; searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "EDIT_EXPENSE_DRAFT");
  const [{ expenseId }, query, scope] = await Promise.all([params, searchParams, resolveExpenseReadScope(context)]);
  const [expense, categories] = await Promise.all([getBusinessExpenseDetail({ businessId: context.businessId, expenseId, ...scope }).catch(() => null), prisma.expenseCategory.findMany({ where: { businessId: context.businessId, OR: [{ active: true }, { expenses: { some: { id: expenseId } } }] }, orderBy: { name: "asc" } })]);
  if (!expense || expense.sourceType !== "MANUAL" || expense.status === "VOID" || expense.paymentStatus === "PAID") notFound();
  return <section className="content"><div className="page-header"><div><h1>{expense.status === "DRAFT" ? "Edit draft" : "Correct confirmed Expense"}</h1><p>{expense.expenseNumber} · expected revision {expense.revision}</p></div><Link href={`/expenses/${expense.id}`}>Back to Expense</Link></div>{query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <form action={updateExpenseFactsAction} className={`panel ${styles.form}`}><input type="hidden" name="expenseId" value={expense.id} /><input type="hidden" name="expectedRevision" value={expense.revision} /><input type="hidden" name="status" value={expense.status} /><input type="hidden" name="operationKey" value={`${expense.status === "DRAFT" ? "UPDATE_DRAFT" : "CORRECT_EXPENSE"}:${expense.id}:${randomUUID()}`} /><label>Expense Date<input name="expenseDate" type="date" required defaultValue={expense.expenseDate.toISOString().slice(0, 10)} /></label><label>Branch<select name="branchId" required={!scope.includeBusinessWide} defaultValue={expense.branchId ?? ""}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label>Category<select name="categoryId" required defaultValue={expense.categoryId}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? "" : " · inactive history only"}</option>)}</select></label><label>Payee<input name="payeeName" defaultValue={expense.payeeName ?? ""} maxLength={160} /></label><label>Amount (MYR)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={expense.amount.toFixed(2)} /></label><label className={styles.full}>Description<input name="description" required maxLength={500} defaultValue={expense.description} /></label><label className={styles.full}>Notes<textarea name="notes" maxLength={2000} defaultValue={expense.notes ?? ""} /></label>{expense.status === "CONFIRMED" ? <label className={styles.full}>Correction reason<input name="reason" required minLength={5} maxLength={500} /></label> : <input type="hidden" name="reason" value="" />}<div className={`${styles.full} ${styles.actions}`}><button>{expense.status === "DRAFT" ? "Save Draft" : "Record Correction"}</button></div></form>
  </section>;
}
