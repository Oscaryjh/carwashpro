import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ExpenseCategory } from "@prisma/client";
import { ExpenseCategoryDialog, ExpenseCategoryDialogCancel } from "@/components/expense-category-dialog";
import { ExpenseCategoryReorder } from "@/components/expense-category-reorder";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createExpenseCategoryAction, updateExpenseCategoryAction } from "../actions";
import styles from "../expense.module.css";

const groups = ["OPERATIONS", "MARKETING", "STAFF", "RENTAL", "FINANCE", "OTHER"] as const;
type CategoryGroup = (typeof groups)[number];
type SearchParams = Promise<{ group?: string; message?: string; q?: string; status?: string; type?: string }>;
function groupLabel(group: CategoryGroup) { return group.charAt(0) + group.slice(1).toLowerCase(); }

export default async function ExpenseCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, allCategories] = await Promise.all([
    searchParams,
    prisma.expenseCategory.findMany({ where: { businessId: context.businessId }, include: { _count: { select: { expenses: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const keyword = query.q?.trim().toLowerCase() ?? "";
  const selectedGroup = groups.includes(query.group as CategoryGroup) ? (query.group as CategoryGroup) : "";
  const selectedStatus = query.status === "active" || query.status === "inactive" ? query.status : "";
  const categories = allCategories.filter(category => {
    const matchesKeyword = !keyword || [category.name, category.code, category.description].some(value => value?.toLowerCase().includes(keyword));
    const matchesGroup = !selectedGroup || category.group === selectedGroup;
    const matchesStatus = !selectedStatus || (selectedStatus === "active" ? category.active : !category.active);
    return matchesKeyword && matchesGroup && matchesStatus;
  });
  const activeCount = allCategories.filter(category => category.active).length;
  const inactiveCount = allCategories.length - activeCount;
  const hasFilters = Boolean(keyword || selectedGroup || selectedStatus);
  const nextSortOrder = (allCategories.at(-1)?.sortOrder ?? 0) + 10;

  return <section className={`content ${styles.expensePage} ${styles.simpleCategoryPage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}>
        <h1>Expense Categories</h1><p>Manage the categories used when recording expenses.</p>
        <p className={styles.categoryCount} aria-label="Category summary">{allCategories.length} categories · {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}</p>
      </div>
      <div className={styles.heroActions}><Link className="secondary-link-button" href="/expenses">Expense Overview</Link><CreateCategory sortOrder={nextSortOrder} /></div>
    </header>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`} role={query.type === "error" ? "alert" : "status"}>{query.message}</p> : null}
    <form className={styles.compactCategoryFilters} method="get" aria-label="Filter expense categories">
      <label><span className={styles.srOnly}>Search</span><input type="search" name="q" defaultValue={query.q ?? ""} placeholder="Search categories" /></label>
      <label><span className={styles.srOnly}>Group</span><select name="group" defaultValue={selectedGroup}><option value="">All groups</option>{groups.map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select></label>
      <label><span className={styles.srOnly}>Status</span><select name="status" defaultValue={selectedStatus}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <button type="submit">Apply</button>{hasFilters ? <Link href="/expenses/categories">Clear filters</Link> : null}
    </form>
    <section className={styles.compactCategoryWorkspace} aria-label="Manage categories">
      {categories.length === 0 ? <div className={styles.categoryEmpty}>
        <strong>{allCategories.length === 0 ? "No expense categories yet" : "No matching categories"}</strong>
        <p>{allCategories.length === 0 ? "Create your first category to organise expenses." : "Try changing or clearing your filters."}</p>
        {allCategories.length === 0 ? <CreateCategory sortOrder={nextSortOrder} /> : <Link href="/expenses/categories">Clear filters</Link>}
      </div> : <ExpenseCategoryReorder canReorder={!hasFilters} categories={categories.map(category => ({ active: category.active, group: category.group, id: category.id, name: category.name }))} operationKey={`REORDER_EXPENSE_CATEGORIES:${randomUUID()}`}>
        <table className={styles.compactCategoryTable}>
          <caption className={styles.srOnly}>Expense categories</caption>
          <thead><tr><th>Category</th><th>Group</th><th>Receipt</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{categories.map(category => <tr key={category.id}>
            <td><strong>{category.name}</strong>{category._count.expenses > 0 ? <small className={styles.tableMeta}>{category._count.expenses} {category._count.expenses === 1 ? "expense" : "expenses"}</small> : null}</td>
            <td>{groupLabel(category.group)}</td><td>{category.requiresReceipt ? "Required" : "—"}</td>
            <td>{category.active ? <span className={styles.categoryActiveText}>Active</span> : <span className={styles.inactiveBadge}>Inactive</span>}</td>
            <td><ExpenseCategoryDialog label="Edit" title={`Edit ${category.name}`}><CategoryForm category={category} sortOrder={category.sortOrder} /></ExpenseCategoryDialog></td>
          </tr>)}</tbody>
        </table>
      </ExpenseCategoryReorder>}
    </section>
  </section>;
}

function CreateCategory({ sortOrder }: { sortOrder: number }) {
  return <ExpenseCategoryDialog label="+ Add Category" title="Add Category" primary><CategoryForm sortOrder={sortOrder} /></ExpenseCategoryDialog>;
}

function CategoryForm({ category, sortOrder }: { category?: ExpenseCategory; sortOrder: number }) {
  return <form action={category ? updateExpenseCategoryAction : createExpenseCategoryAction} className={styles.categoryDialogForm}>
    <input type="hidden" name="operationKey" value={category ? `UPDATE_EXPENSE_CATEGORY:${category.id}:${randomUUID()}` : `CREATE_EXPENSE_CATEGORY:${randomUUID()}`} />
    {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
    <input type="hidden" name="sortOrder" value={sortOrder} />
    <label>Category name *<input name="name" required maxLength={120} defaultValue={category?.name ?? ""} autoComplete="off" placeholder="e.g. Cleaning supplies" /></label>
    <label>Group *<select name="group" defaultValue={category?.group ?? "OTHER"}>{groups.map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select></label>
    <label className={styles.full}>Description<input name="description" maxLength={500} defaultValue={category?.description ?? ""} placeholder="Optional guidance for your team" /></label>
    <label className={`${styles.checkboxField} ${styles.full}`}><input name="requiresReceipt" type="checkbox" defaultChecked={category?.requiresReceipt ?? false} /><span>Require a receipt</span></label>
    {category ? <label className={`${styles.checkboxField} ${styles.full}`}><input name="active" type="checkbox" defaultChecked={category.active} /><span>Active</span></label> : null}
    <details className={styles.full}><summary>Advanced settings</summary><label>Short code<input name="code" maxLength={40} defaultValue={category?.code ?? ""} autoComplete="off" /></label></details>
    {category ? <p className={styles.full}>Used categories are kept for historical reporting and are never hard deleted.</p> : null}
    <footer className={styles.full}><ExpenseCategoryDialogCancel /><button type="submit">{category ? "Save changes" : "Create Category"}</button></footer>
  </form>;
}
