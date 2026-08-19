import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ExpenseCategoryReorder } from "@/components/expense-category-reorder";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createExpenseCategoryAction, updateExpenseCategoryAction } from "../actions";
import styles from "../expense.module.css";

const groups = ["OPERATIONS", "MARKETING", "STAFF", "RENTAL", "FINANCE", "OTHER"] as const;

type CategoryGroup = (typeof groups)[number];
type SearchParams = Promise<{ group?: string; message?: string; q?: string; status?: string; type?: string }>;

function groupLabel(group: CategoryGroup) {
  return group.charAt(0) + group.slice(1).toLowerCase();
}

export default async function ExpenseCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);

  const [query, allCategories] = await Promise.all([
    searchParams,
    prisma.expenseCategory.findMany({
      where: { businessId: context.businessId },
      include: { _count: { select: { expenses: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const keyword = query.q?.trim().toLowerCase() ?? "";
  const selectedGroup = groups.includes(query.group as CategoryGroup) ? (query.group as CategoryGroup) : "";
  const selectedStatus = query.status === "active" || query.status === "inactive" ? query.status : "";
  const categories = allCategories.filter((category) => {
    const matchesKeyword = !keyword || [category.name, category.code, category.description].some((value) => value?.toLowerCase().includes(keyword));
    const matchesGroup = !selectedGroup || category.group === selectedGroup;
    const matchesStatus = !selectedStatus || (selectedStatus === "active" ? category.active : !category.active);
    return matchesKeyword && matchesGroup && matchesStatus;
  });

  const activeCount = allCategories.filter((category) => category.active).length;
  const receiptCount = allCategories.filter((category) => category.requiresReceipt).length;
  const hasFilters = Boolean(keyword || selectedGroup || selectedStatus);
  const nextSortOrder = (allCategories.at(-1)?.sortOrder ?? 0) + 10;

  return (
    <section className={`content ${styles.expensePage} ${styles.categoryPage}`}>
      <header className={`page-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>Expense setup</span>
          <h1>Expense categories</h1>
          <p>Organise spending with clear business labels. These categories support reporting; they are not a statutory chart of accounts.</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.exportLink} href="/expenses">Expense overview</Link>
          <Link className="button" href="/expenses/new">Add expense</Link>
        </div>
      </header>

      {query.message ? (
        <p className={`form-message ${query.type === "error" ? "error" : "success"}`} role={query.type === "error" ? "alert" : "status"}>
          {query.message}
        </p>
      ) : null}

      <div className={styles.categorySummaryGrid} aria-label="Category summary">
        <article className={styles.categoryMetric}>
          <span>Total categories</span>
          <strong>{allCategories.length}</strong>
          <small>Across {new Set(allCategories.map((category) => category.group)).size} groups</small>
        </article>
        <article className={styles.categoryMetric}>
          <span>Active</span>
          <strong>{activeCount}</strong>
          <small>Available when recording an expense</small>
        </article>
        <article className={styles.categoryMetric}>
          <span>Receipt required</span>
          <strong>{receiptCount}</strong>
          <small>Confirmation is blocked without a receipt</small>
        </article>
      </div>

      <section className={`panel ${styles.categoryCreatePanel}`} aria-labelledby="add-category-heading">
        <div className={styles.sectionTitle}>
          <div>
            <h2 id="add-category-heading">Add a category</h2>
            <p className={styles.sectionDescription}>Create a reusable label for future business expenses.</p>
          </div>
          <span>Required fields are marked *</span>
        </div>
        <form action={createExpenseCategoryAction} className={styles.form}>
          <input type="hidden" name="operationKey" value={`CREATE_EXPENSE_CATEGORY:${randomUUID()}`} />
          <label>
            Category name *
            <input name="name" required maxLength={120} placeholder="e.g. Cleaning supplies" autoComplete="off" />
          </label>
          <label>
            Short code
            <input name="code" maxLength={40} placeholder="e.g. CLEANING" autoComplete="off" />
          </label>
          <label>
            Group *
            <select name="group" defaultValue="OTHER">
              {groups.map((group) => <option key={group} value={group}>{groupLabel(group)}</option>)}
            </select>
          </label>
          <input name="sortOrder" type="hidden" value={nextSortOrder} />
          <label className={styles.full}>
            Description
            <input name="description" maxLength={500} placeholder="Optional guidance for your team" />
          </label>
          <div className={`${styles.full} ${styles.categoryCreateFooter}`}>
            <label className={styles.checkboxField}>
              <input name="requiresReceipt" type="checkbox" />
              <span><strong>Require a receipt</strong><small>Staff must attach a receipt before confirming an expense.</small></span>
            </label>
            <button type="submit">Create category</button>
          </div>
        </form>
      </section>

      <section className={`panel ${styles.categoryWorkspace}`} aria-labelledby="manage-categories-heading">
        <div className={styles.sectionTitle}>
          <div>
            <h2 id="manage-categories-heading">Manage categories</h2>
            <p className={styles.sectionDescription}>Search the list, then open only the category you want to edit.</p>
          </div>
          <span>{categories.length} of {allCategories.length} shown</span>
        </div>

        <form className={styles.categoryFilterGrid} method="get" aria-label="Filter expense categories">
          <label>
            Search
            <input type="search" name="q" defaultValue={query.q ?? ""} placeholder="Name, code or description" />
          </label>
          <label>
            Group
            <select name="group" defaultValue={selectedGroup}>
              <option value="">All groups</option>
              {groups.map((group) => <option key={group} value={group}>{groupLabel(group)}</option>)}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={selectedStatus}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button className={styles.applyButton} type="submit">Apply filters</button>
          {hasFilters ? <Link href="/expenses/categories">Clear filters</Link> : null}
        </form>

        {categories.length === 0 ? (
          <div className={styles.categoryEmpty}>
            <strong>No matching categories</strong>
            <p>Try a different name, group or status.</p>
            <Link href="/expenses/categories">Clear filters</Link>
          </div>
        ) : (
          <ExpenseCategoryReorder canReorder={!hasFilters} categories={categories.map((category) => ({ active: category.active, group: category.group, id: category.id, name: category.name }))} operationKey={`REORDER_EXPENSE_CATEGORIES:${randomUUID()}`}>
          <div className={styles.categoryList}>
            {categories.map((category) => (
              <details className={styles.categoryCard} key={category.id}>
                <summary aria-label={`Edit ${category.name}`}>
                  <div className={styles.categoryIdentity}>
                    <div>
                      <h3>{category.name}</h3>
                      <span>{category.code || "No short code"}</span>
                    </div>
                    <div className={styles.categoryBadges}>
                      <span className={styles.groupBadge}>{groupLabel(category.group)}</span>
                      <span className={category.active ? styles.activeBadge : styles.inactiveBadge}>{category.active ? "Active" : "Inactive"}</span>
                      {category.requiresReceipt ? <span className={styles.receiptBadge}>Receipt required</span> : null}
                    </div>
                  </div>
                  <div className={styles.categoryUsage}>
                    <span>{category._count.expenses} historical {category._count.expenses === 1 ? "expense" : "expenses"}</span>
                    <strong>Edit</strong>
                  </div>
                </summary>

                <form action={updateExpenseCategoryAction} className={styles.categoryEditor}>
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="operationKey" value={`UPDATE_EXPENSE_CATEGORY:${category.id}:${randomUUID()}`} />
                  <div className={styles.form}>
                    <label>
                      Category name *
                      <input name="name" defaultValue={category.name} required maxLength={120} />
                    </label>
                    <label>
                      Short code
                      <input name="code" defaultValue={category.code ?? ""} maxLength={40} />
                    </label>
                    <label>
                      Group *
                      <select name="group" defaultValue={category.group}>
                        {groups.map((group) => <option key={group} value={group}>{groupLabel(group)}</option>)}
                      </select>
                    </label>
                    <input name="sortOrder" type="hidden" value={category.sortOrder} />
                    <label className={styles.full}>
                      Description
                      <input name="description" defaultValue={category.description ?? ""} maxLength={500} placeholder="Optional guidance for your team" />
                    </label>
                    <div className={`${styles.full} ${styles.categoryOptions}`}>
                      <label className={styles.checkboxField}>
                        <input name="requiresReceipt" type="checkbox" defaultChecked={category.requiresReceipt} />
                        <span><strong>Require a receipt</strong><small>Needed before this expense can be confirmed.</small></span>
                      </label>
                      <label className={styles.checkboxField}>
                        <input name="active" type="checkbox" defaultChecked={category.active} />
                        <span><strong>Active</strong><small>Available for new expenses.</small></span>
                      </label>
                    </div>
                    <div className={`${styles.full} ${styles.categoryActions}`}>
                      <p>Used categories are kept for historical reporting and are never hard deleted.</p>
                      <button type="submit">Save changes</button>
                    </div>
                  </div>
                </form>
              </details>
            ))}
          </div>
          </ExpenseCategoryReorder>
        )}
      </section>
    </section>
  );
}
