import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createRecurringExpenseAction, generateRecurringExpenseAction, updateRecurringExpenseAction } from "../actions";
import styles from "../expense.module.css";

export default async function RecurringExpensesPage({ searchParams }: { searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope, categories, templates] = await Promise.all([
    searchParams,
    resolveExpenseReadScope(context),
    prisma.expenseCategory.findMany({ where: { active: true, businessId: context.businessId }, orderBy: { name: "asc" } }),
    prisma.recurringExpenseTemplate.findMany({ where: { businessId: context.businessId }, include: { branch: { select: { name: true } }, category: { select: { name: true } }, expenses: { select: { generatedPeriod: true, id: true }, orderBy: { generatedPeriod: "desc" }, take: 6 } }, orderBy: { createdAt: "desc" } }),
  ]);
  const currentPeriod = new Date().toISOString().slice(0, 7);
  return <section className="content">
    <div className="page-header"><div><h1>Recurring Expense foundation</h1><p>Monthly templates generate unpaid Draft Expenses. They never auto-pay.</p></div><Link href="/expenses">Expense overview</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <form action={createRecurringExpenseAction} className={`panel ${styles.form}`}>
      <input type="hidden" name="operationKey" value={`CREATE_RECURRING_EXPENSE:${randomUUID()}`} />
      <TemplateFields categories={categories} scope={scope} currentPeriod={currentPeriod} />
      <div className={`${styles.full} ${styles.actions}`}><button>Create Monthly Template</button></div>
    </form>
    <div className={styles.stack}>{templates.map((template) => <article className={`panel ${styles.categoryCard}`} key={template.id}>
      <div className="section-header"><div><h2>{template.defaultDescription}</h2><p>{template.category.name} · {template.branch?.name ?? "Business-wide"} · {template.payeeName ?? "No payee"}</p></div><strong>RM {template.amount.toFixed(2)} / month</strong></div>
      <div className={styles.facts}><div className={styles.fact}><span>Status</span><strong>{template.active ? "ACTIVE" : "INACTIVE"}</strong></div><div className={styles.fact}><span>Effective</span><strong>{iso(template.startDate)} → {template.endDate ? iso(template.endDate) : "Open"}</strong></div><div className={styles.fact}><span>Generated periods</span><strong>{template.expenses.map((expense) => expense.generatedPeriod).filter(Boolean).join(", ") || "None"}</strong></div></div>
      {template.active ? <form action={generateRecurringExpenseAction} className={styles.actions}><input type="hidden" name="templateId" value={template.id} /><input type="hidden" name="operationKey" value={`GENERATE_RECURRING:${template.id}:${currentPeriod}:${randomUUID()}`} /><label>Expense Period<input type="month" name="period" defaultValue={currentPeriod} required /></label><button>Generate Due Expense</button><small>Repeated generation for the same month returns the same canonical Draft.</small></form> : null}
      <details><summary>Revise or deactivate template</summary><form action={updateRecurringExpenseAction} className={styles.form}><input type="hidden" name="templateId" value={template.id} /><input type="hidden" name="expectedRevision" value={template.revision} /><input type="hidden" name="operationKey" value={`UPDATE_RECURRING:${template.id}:${randomUUID()}`} /><label>Start Date<input type="date" name="startDate" required defaultValue={iso(template.startDate)} /></label><label>End Date<input type="date" name="endDate" defaultValue={template.endDate ? iso(template.endDate) : ""} /></label><label>Branch<select name="branchId" required={!scope.includeBusinessWide} defaultValue={template.branchId ?? ""}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label>Category<select name="categoryId" required defaultValue={template.categoryId}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Payee<input name="payeeName" maxLength={160} defaultValue={template.payeeName ?? ""} /></label><label>Monthly Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={template.amount.toFixed(2)} /></label><label className={styles.full}>Description<input name="description" required maxLength={500} defaultValue={template.defaultDescription} /></label><label className={styles.full}>Notes<textarea name="notes" maxLength={2000} defaultValue={template.notes ?? ""} /></label><label><input type="checkbox" name="active" defaultChecked={template.active} /> Active</label><label className={styles.full}>Revision reason<input name="reason" required minLength={5} maxLength={500} /></label><button className={styles.full}>Save template revision</button></form></details>
    </article>)}{!templates.length ? <p className="empty-state">No recurring templates.</p> : null}</div>
  </section>;
}

function TemplateFields({ categories, currentPeriod, scope }: { categories: Array<{ id: string; name: string }>; currentPeriod: string; scope: { branches: Array<{ id: string; name: string }>; includeBusinessWide?: boolean } }) {
  return <><label>Start Date<input type="date" name="startDate" required defaultValue={`${currentPeriod}-01`} /></label><label>End Date<input type="date" name="endDate" /></label><label>Branch<select name="branchId" required={!scope.includeBusinessWide}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label>Category<select name="categoryId" required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Payee<input name="payeeName" maxLength={160} /></label><label>Monthly Amount (MYR)<input name="amount" type="number" min="0.01" step="0.01" required /></label><label className={styles.full}>Default Description<input name="description" required minLength={3} maxLength={500} /></label><label className={styles.full}>Notes<textarea name="notes" maxLength={2000} /></label></>;
}
function iso(value: Date) { return value.toISOString().slice(0, 10); }
