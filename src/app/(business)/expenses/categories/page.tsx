import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createExpenseCategoryAction, updateExpenseCategoryAction } from "../actions";
import styles from "../expense.module.css";

const groups = ["OPERATIONS", "MARKETING", "STAFF", "RENTAL", "FINANCE", "OTHER"] as const;
export default async function ExpenseCategoriesPage({ searchParams }: { searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, categories] = await Promise.all([searchParams, prisma.expenseCategory.findMany({ where: { businessId: context.businessId }, include: { _count: { select: { expenses: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })]);
  return <section className="content"><div className="page-header"><div><h1>Expense categories</h1><p>Business-defined operating-spending labels, not a statutory chart of accounts.</p></div><Link href="/expenses">Expense overview</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <form action={createExpenseCategoryAction} className={`panel ${styles.form}`}><input type="hidden" name="operationKey" value={`CREATE_EXPENSE_CATEGORY:${randomUUID()}`} /><label>Name<input name="name" required maxLength={120} /></label><label>Code<input name="code" maxLength={40} /></label><label>Group<select name="group" defaultValue="OTHER">{groups.map((group) => <option key={group}>{group}</option>)}</select></label><label>Sort order<input name="sortOrder" type="number" min="0" defaultValue="100" required /></label><label className={styles.full}>Description<input name="description" maxLength={500} /></label><label><input name="requiresReceipt" type="checkbox" /> Receipt required for confirmation</label><div className={`${styles.full} ${styles.actions}`}><button>Create category</button></div></form>
    <div className={styles.stack}>{categories.map((category) => <form action={updateExpenseCategoryAction} className={styles.categoryCard} key={category.id}><input type="hidden" name="categoryId" value={category.id} /><input type="hidden" name="operationKey" value={`UPDATE_EXPENSE_CATEGORY:${category.id}:${randomUUID()}`} /><div className={styles.form}><label>Name<input name="name" defaultValue={category.name} required maxLength={120} /></label><label>Code<input name="code" defaultValue={category.code ?? ""} maxLength={40} /></label><label>Group<select name="group" defaultValue={category.group}>{groups.map((group) => <option key={group}>{group}</option>)}</select></label><label>Sort order<input name="sortOrder" type="number" min="0" defaultValue={category.sortOrder} required /></label><label className={styles.full}>Description<input name="description" defaultValue={category.description ?? ""} maxLength={500} /></label><label><input name="requiresReceipt" type="checkbox" defaultChecked={category.requiresReceipt} /> Receipt required</label><label><input name="active" type="checkbox" defaultChecked={category.active} /> Active</label><div className={`${styles.full} ${styles.actions}`}><button>Save</button><span>{category._count.expenses} historical Expense(s) · used categories are never hard deleted</span></div></div></form>)}</div>
  </section>;
}
