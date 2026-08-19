import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createRecurringExpenseAction, generateRecurringExpenseAction, updateRecurringExpenseAction } from "../actions";
import styles from "../expense.module.css";

type SearchParams = Promise<{ branchId?: string; categoryId?: string; message?: string; page?: string; q?: string; sort?: string; status?: string; type?: string }>;

export default async function RecurringExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope, categories] = await Promise.all([
    searchParams,
    resolveExpenseReadScope(context),
    prisma.expenseCategory.findMany({ where: { active: true, businessId: context.businessId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const scopedBranches = scope.branches.map((branch) => branch.id);
  const allTemplates = await prisma.recurringExpenseTemplate.findMany({
    where: { businessId: context.businessId, OR: [...(scopedBranches.length ? [{ branchId: { in: scopedBranches } }] : []), ...(scope.includeBusinessWide ? [{ branchId: null }] : [])] },
    include: { branch: { select: { name: true } }, category: { select: { name: true } }, expenses: { select: { generatedPeriod: true, id: true }, orderBy: { generatedPeriod: "desc" }, take: 6 } },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const defaultBranchId = scope.branches.some((branch) => branch.id === context.user.branchId)
    ? context.user.branchId
    : scope.branches.length === 1
      ? scope.branches[0].id
      : null;
  const activeCount = allTemplates.filter((template) => template.active).length;
  const keyword = query.q?.trim().toLowerCase() ?? "";
  const branchId = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId ?? "" : "";
  const categoryId = categories.some((category) => category.id === query.categoryId) ? query.categoryId ?? "" : "";
  const status = query.status === "active" || query.status === "inactive" ? query.status : "";
  const sort = ["name", "amount-high", "amount-low", "newest"].includes(query.sort ?? "") ? query.sort ?? "name" : "name";
  const filteredTemplates = allTemplates.filter((template) => {
    const matchesKeyword = !keyword || [template.defaultDescription, template.payeeName, template.branch?.name, template.category.name].some((value) => value?.toLowerCase().includes(keyword));
    return matchesKeyword && (!branchId || template.branchId === branchId) && (!categoryId || template.categoryId === categoryId) && (!status || template.active === (status === "active"));
  }).sort((a, b) => sort === "amount-high" ? b.amount.comparedTo(a.amount) : sort === "amount-low" ? a.amount.comparedTo(b.amount) : sort === "newest" ? b.createdAt.getTime() - a.createdAt.getTime() : a.defaultDescription.localeCompare(b.defaultDescription));
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredTemplates.length / pageSize));
  const requestedPage = Number.parseInt(query.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), pageCount) : 1;
  const templates = filteredTemplates.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(keyword || branchId || categoryId || status || sort !== "name");

  return <section className={`content ${styles.expensePage} ${styles.recurringPage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}>
        <span className={styles.eyebrow}>Expenses</span>
        <h1>Recurring expenses</h1>
        <p>Prepare regular monthly expenses without re-entering the same details every time.</p>
      </div>
      <div className={styles.heroActions}><Link className={styles.secondaryAction} href="/expenses">Back to overview</Link></div>
    </header>

    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`} role={query.type === "error" ? "alert" : "status"}>{query.message}</p> : null}

    <section className={styles.recurringSafety} aria-label="How recurring expenses work">
      <div><span>1</span><p><strong>Save the monthly details</strong><small>Create one reusable template for rent, subscriptions or other regular costs.</small></p></div>
      <div><span>2</span><p><strong>Create a draft when due</strong><small>Choose the month yourself. Nothing is generated or paid automatically.</small></p></div>
      <div><span>3</span><p><strong>Review before confirming</strong><small>Every generated expense starts as an Unpaid Draft and follows the normal approval flow.</small></p></div>
    </section>

    <details className={`panel ${styles.recurringCreateCard}`} open={allTemplates.length === 0}>
      <summary className={styles.recurringCreateSummary}>
        <span><span className={styles.eyebrow}>New template</span><strong>Add a recurring expense</strong><small>Set the usual amount and details. You can revise or deactivate it later.</small></span>
        <span className={styles.recurringCreateToggle}>{allTemplates.length ? "Add template" : "Set up your first template"}</span>
      </summary>
      <form action={createRecurringExpenseAction} className={styles.recurringForm}>
        <input type="hidden" name="operationKey" value={`CREATE_RECURRING_EXPENSE:${randomUUID()}`} />
        <fieldset className={styles.recurringFieldset}>
          <legend>Schedule & classification</legend>
          <div className={styles.form}>
            <label>Start date *<input type="date" name="startDate" required defaultValue={`${currentPeriod}-01`} /></label>
            <label>End date <span className={styles.optionalLabel}>Optional</span><input type="date" name="endDate" /></label>
            <label>Branch *<select name="branchId" required={!scope.includeBusinessWide} defaultValue={defaultBranchId ?? ""}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><small>Defaults to your current branch.</small></label>
            <label>Category *<select name="categoryId" required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          </div>
        </fieldset>
        <fieldset className={styles.recurringFieldset}>
          <legend>Expense details</legend>
          <div className={styles.form}>
            <label>Payee<input name="payeeName" maxLength={160} placeholder="e.g. Landlord or software provider" /></label>
            <label>Monthly amount (MYR) *<input name="amount" type="number" min="0.01" step="0.01" required inputMode="decimal" placeholder="0.00" /></label>
            <label className={styles.full}>Description *<input name="description" required minLength={3} maxLength={500} placeholder="e.g. Monthly shop rental" /></label>
            <label className={styles.full}>Internal note <span className={styles.optionalLabel}>Optional</span><textarea name="notes" maxLength={2000} placeholder="Visible to authorised team members only" /></label>
          </div>
        </fieldset>
        <div className={styles.recurringCreateFooter}><p><strong>Safe by default</strong><span>This template will not create an expense until someone chooses a month and clicks Create draft expense.</span></p><button type="submit">Save recurring template</button></div>
      </form>
    </details>

    <section className={styles.recurringTemplates} aria-labelledby="recurring-templates-heading">
      <div className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Saved templates</span><h2 id="recurring-templates-heading">Your recurring expenses</h2><p className={styles.sectionDescription}>Create the monthly draft when each expense becomes due.</p></div>
        <span>{activeCount} active · {allTemplates.length} total</span>
      </div>

      {allTemplates.length ? <form className={styles.recurringFilterGrid} aria-label="Filter recurring expenses">
        <label className={styles.recurringSearch}>Search<input type="search" name="q" defaultValue={query.q ?? ""} placeholder="Template, payee, branch or category" /></label>
        <label>Branch<select name="branchId" defaultValue={branchId}><option value="">All branches</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
        <label>Category<select name="categoryId" defaultValue={categoryId}><option value="">All categories</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={status}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <label>Sort by<select name="sort" defaultValue={sort}><option value="name">Name</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option><option value="newest">Newest</option></select></label>
        <div className={styles.recurringFilterActions}><button type="submit">Apply filters</button>{hasFilters ? <Link href="/expenses/recurring">Clear</Link> : null}</div>
      </form> : null}

      {allTemplates.length ? <div className={styles.recurringResultSummary}><span>{filteredTemplates.length} matching template{filteredTemplates.length === 1 ? "" : "s"}</span><span>Page {page} of {pageCount}</span></div> : null}

      {templates.length ? <div className={styles.recurringTemplateList}>{templates.map((template) => {
        const generatedPeriods = template.expenses.map((expense) => expense.generatedPeriod).filter(Boolean) as string[];
        const currentGenerated = generatedPeriods.includes(currentPeriod);
        return <article className={styles.recurringTemplateCard} key={template.id}>
          <header className={styles.recurringTemplateHeader}>
            <div><span className={template.active ? styles.activeBadge : styles.inactiveBadge}>{template.active ? "Active" : "Inactive"}</span><h3>{template.defaultDescription}</h3><p>{template.payeeName ?? "No payee provided"}</p></div>
            <div className={styles.recurringAmount}><strong>RM {template.amount.toFixed(2)}</strong><span>per month</span></div>
          </header>
          <dl className={styles.recurringMeta}>
            <div><dt>Branch</dt><dd>{template.branch?.name ?? "Business-wide"}</dd></div>
            <div><dt>Category</dt><dd>{template.category.name}</dd></div>
            <div><dt>Effective</dt><dd>{formatDate(template.startDate)} – {template.endDate ? formatDate(template.endDate) : "No end date"}</dd></div>
            <div><dt>Latest draft</dt><dd>{generatedPeriods[0] ? formatPeriod(generatedPeriods[0]) : "None created yet"}</dd></div>
          </dl>

          {template.active ? <form action={generateRecurringExpenseAction} className={styles.generateDraftForm}>
            <input type="hidden" name="templateId" value={template.id} />
            <input type="hidden" name="operationKey" value={`GENERATE_RECURRING:${template.id}:${currentPeriod}:${randomUUID()}`} />
            <label>Expense month<input type="month" name="period" defaultValue={currentPeriod} required /></label>
            <div><button type="submit">{currentGenerated ? "Open existing draft" : "Create draft expense"}</button><small>{currentGenerated ? `${formatPeriod(currentPeriod)} already has a draft.` : "Creates one Unpaid Draft for the selected month."}</small></div>
          </form> : <p className={styles.inactiveTemplateNote}>This template is inactive and cannot create new drafts.</p>}

          <details className={styles.templateEditorDisclosure}>
            <summary><span><strong>Edit template</strong><small>Change future defaults or deactivate it</small></span><span aria-hidden="true">+</span></summary>
            <form action={updateRecurringExpenseAction} className={styles.form}>
              <input type="hidden" name="templateId" value={template.id} /><input type="hidden" name="expectedRevision" value={template.revision} /><input type="hidden" name="operationKey" value={`UPDATE_RECURRING:${template.id}:${randomUUID()}`} />
              <label>Start date<input type="date" name="startDate" required defaultValue={iso(template.startDate)} /></label>
              <label>End date<input type="date" name="endDate" defaultValue={template.endDate ? iso(template.endDate) : ""} /></label>
              <label>Branch<select name="branchId" required={!scope.includeBusinessWide} defaultValue={template.branchId ?? ""}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
              <label>Category<select name="categoryId" required defaultValue={template.categoryId}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
              <label>Payee<input name="payeeName" maxLength={160} defaultValue={template.payeeName ?? ""} /></label>
              <label>Monthly amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={template.amount.toFixed(2)} /></label>
              <label className={styles.full}>Description<input name="description" required maxLength={500} defaultValue={template.defaultDescription} /></label>
              <label className={styles.full}>Internal note<textarea name="notes" maxLength={2000} defaultValue={template.notes ?? ""} /></label>
              <label className={`${styles.full} ${styles.checkboxField}`}><input type="checkbox" name="active" defaultChecked={template.active} /><span><strong>Active template</strong><small>Allow new monthly drafts to be created.</small></span></label>
              <label className={styles.full}>Reason for change<input name="reason" required minLength={5} maxLength={500} placeholder="Explain why this template is being changed" /></label>
              <button className={styles.full}>Save template changes</button>
            </form>
          </details>
        </article>;
      })}</div> : <div className={styles.recurringEmpty}><span aria-hidden="true">↻</span><strong>{allTemplates.length ? "No matching templates" : "No recurring expenses yet"}</strong><p>{allTemplates.length ? "Try a different search, branch, category or status." : "Add your first regular monthly expense above. Nothing will be generated automatically."}</p>{allTemplates.length ? <Link href="/expenses/recurring">Clear filters</Link> : null}</div>}

      {filteredTemplates.length > pageSize ? <nav className={styles.recurringPagination} aria-label="Recurring expense pages"><Link aria-disabled={page === 1} className={page === 1 ? styles.paginationDisabled : ""} href={pageHref(query, page - 1)}>Previous</Link><span>Page {page} of {pageCount}</span><Link aria-disabled={page === pageCount} className={page === pageCount ? styles.paginationDisabled : ""} href={pageHref(query, page + 1)}>Next</Link></nav> : null}
    </section>
  </section>;
}

function iso(value: Date) { return value.toISOString().slice(0, 10); }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }); }
function formatPeriod(value: string) { return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-MY", { month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }); }
function pageHref(query: Awaited<SearchParams>, page: number) { const params = new URLSearchParams(); for (const key of ["q", "branchId", "categoryId", "status", "sort"] as const) if (query[key]) params.set(key, query[key]); params.set("page", String(page)); return `/expenses/recurring?${params.toString()}`; }
