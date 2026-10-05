import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { reconcileExpenseSources } from "@/lib/expense/source-integration";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import { saveExpenseIntegrationSettingsAction } from "../actions";
import styles from "../expense.module.css";

type Query = { message?: string; type?: string };

const sourceNames: Record<string, string> = { CLAIM: "Staff Claims", PAYROLL: "Payroll Costs", INVENTORY_PURCHASE: "Inventory Purchases" };
const issueDescriptions: Record<string, string> = {
  MISSING_EXPENSE: "An expense is missing.",
  DUPLICATE_ACTIVE_EXPENSE: "An expense appears more than once.",
  STALE_SOURCE_EXPENSE: "An expense no longer matches its source.",
  WRONG_AMOUNT: "An expense amount needs review.",
  WRONG_BRANCH: "An expense branch needs review.",
  WRONG_SOURCE_REVISION: "An expense needs the latest source information.",
  WRONG_PAYMENT_STATE: "An expense payment status needs review.",
  MISSING_SOURCE_SNAPSHOT: "Supporting expense information is missing.",
  MISSING_SETTLEMENT_PROJECTION: "Expense payment information is missing.",
  WRONG_PAID_AMOUNT: "An expense paid amount needs review.",
  WRONG_OUTSTANDING_AMOUNT: "An expense outstanding amount needs review.",
  SOURCE_AP_MATCH_ISSUE: "A supplier bill payment needs review.",
  LEGACY_CONFIRMATION_REVISION_REQUIRED: "An older purchase needs review.",
};

export default async function ExpenseIntegrationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "MANAGE_EXPENSE_CATEGORY");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, categories, setting, modules, health] = await Promise.all([
    searchParams,
    prisma.expenseCategory.findMany({ where: { active: true, businessId: context.businessId }, orderBy: [{ group: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.expenseIntegrationSetting.findUnique({ where: { businessId: context.businessId } }),
    loadBusinessModuleContext(context.businessId),
    reconcileExpenseSources({ businessId: context.businessId }),
  ]);
  const claimsEnabled = modules.enabledModules.has("CLAIMS");
  const payrollEnabled = modules.enabledModules.has("PAYROLL");
  const inventoryEnabled = modules.enabledModules.has("INVENTORY");
  const sources = [
    { name: "claimDefaultCategoryId", title: "Staff Claims", description: "Approved staff claims will use this expense category.", enabled: claimsEnabled, unavailable: "Staff Claims is not enabled for this business.", value: setting?.claimDefaultCategoryId ?? "" },
    { name: "payrollCategoryId", title: "Payroll Costs", description: "Payroll costs will use this expense category.", enabled: payrollEnabled, unavailable: "Payroll is not enabled for this business.", value: setting?.payrollCategoryId ?? "" },
    { name: "inventoryPurchaseCategoryId", title: "Inventory Purchases", description: "Confirmed inventory purchases will use this expense category.", enabled: inventoryEnabled, unavailable: "Inventory is not enabled for this business.", value: setting?.inventoryPurchaseCategoryId ?? "" },
  ];
  return <section className={`content ${styles.expenseSourcesPage}`}>
    <div className={`page-header ${styles.sourceHeader}`}><div><h1>Expense Sources</h1><p>Choose which category to use for expenses created from other Tetamu modules.</p></div><Link className={styles.sourceBackLink} href="/expenses">Back to Expenses</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.type === "error" ? "Unable to save expense source categories. Check your category selections, refresh the page and try again." : "Expense source categories updated."}</p> : null}
    <form action={saveExpenseIntegrationSettingsAction} className={`panel ${styles.sourceMappings}`}>
      {setting ? <input type="hidden" name="expectedRevision" value={setting.revision} /> : null}
      {sources.map((source) => <section key={source.name} className={styles.sourceMappingRow} aria-labelledby={`${source.name}-heading`}>
        <div><h2 id={`${source.name}-heading`}>{source.title}</h2><p>{source.description}</p>{!source.enabled ? <p id={`${source.name}-unavailable`}>{source.unavailable}</p> : null}
          {!source.enabled && source.value && !categories.some((category) => category.id === source.value) ? <p>Reactivate the saved category in <Link href="/expenses/categories">Expense Categories</Link> before saving.</p> : null}
        </div>
        <label>Category<select name={source.name} defaultValue={source.value} required={source.enabled} disabled={!source.enabled} aria-describedby={!source.enabled ? `${source.name}-unavailable` : undefined}>
          <option value="">Select category</option>
          {source.value && !categories.some((category) => category.id === source.value) ? <option value={source.value}>Saved category (unavailable)</option> : null}
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        {/* Disabled selects are not submitted; preserve their saved mappings. */}
        {!source.enabled ? <input type="hidden" name={source.name} value={source.value} /> : null}
      </section>)}
      <div className={styles.sourceSave}><button>Save changes</button></div>
    </form>
    {health.issues.length > 0 ? <aside className={styles.sourceWarning} role="status">
      <strong>Expense sync needs attention</strong>
      <p>Some expenses from another module could not be reflected correctly.</p>
      <details><summary>View details</summary><ul>{health.issues.slice(0, 25).map((issue, index) => <li key={`${issue.sourceType}:${issue.sourceId}:${issue.code}:${index}`}>{sourceNames[issue.sourceType] ?? "Other expenses"}: {issueDescriptions[issue.code] ?? "An expense needs review."}</li>)}</ul></details>
    </aside> : null}
  </section>;
}
