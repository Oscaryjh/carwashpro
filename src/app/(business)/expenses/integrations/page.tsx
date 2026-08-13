import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { reconcileExpenseSources } from "@/lib/expense/source-integration";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import { saveExpenseIntegrationSettingsAction } from "../actions";
import styles from "../expense.module.css";

type Query = { message?: string; type?: string };

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
  return <section className="content">
    <div className="page-header"><div><h1>Expense source integrations</h1><p>Explicit mappings and read-only health for Claims, finalized Payroll and confirmed Supplier Bills.</p></div><Link href="/expenses">Business spending</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <div className={styles.notice}><strong>Domain ownership</strong><div>Claims, Payroll and Supplier Bills remain canonical. Expense stores a read-only spending representation only. PO, Goods Receive, Supplier Payment and Stock Count never create Expense.</div></div>
    <form action={saveExpenseIntegrationSettingsAction} className={`panel ${styles.form}`}>
      {setting ? <input type="hidden" name="expectedRevision" value={setting.revision} /> : null}
      <label>Claims default category<select name="claimDefaultCategoryId" defaultValue={setting?.claimDefaultCategoryId ?? ""} required={claimsEnabled}><option value="">{claimsEnabled ? "Select explicit category" : "Claims module disabled"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Payroll cost category<select name="payrollCategoryId" defaultValue={setting?.payrollCategoryId ?? ""} required={payrollEnabled}><option value="">{payrollEnabled ? "Select explicit category" : "Payroll module disabled"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Inventory Purchase category<select name="inventoryPurchaseCategoryId" defaultValue={setting?.inventoryPurchaseCategoryId ?? ""} required={inventoryEnabled}><option value="">{inventoryEnabled ? "Select explicit category" : "Inventory module disabled"}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <div className={`${styles.full} ${styles.actions}`}><button>Save source mappings</button><span>Revision {setting?.revision ?? 0}</span></div>
    </form>
    <div className="panel"><div className="section-header"><h2>Source health</h2><strong>{health.healthy ? "IN SYNC" : "RECONCILIATION REQUIRED"}</strong></div>
      <p>Repair/backfill is an internal controlled workflow and is never an ordinary user button.</p>
      {health.issues.length ? <div className={styles.stack}>{health.issues.slice(0, 25).map((issue, index) => <div className={styles.barRow} key={`${issue.sourceType}:${issue.sourceId}:${issue.code}:${index}`}><span>{issue.sourceType}</span><strong>{issue.code}</strong></div>)}</div> : <p className="empty-state">No missing, duplicate, stale, amount, branch, revision, settlement or snapshot mismatch detected.</p>}
    </div>
    <div className="panel"><h2>Module matrix</h2><p>Expense: enabled · Claims: {claimsEnabled ? "enabled" : "disabled"} · Payroll: {payrollEnabled ? "enabled" : "disabled"} · Inventory: {inventoryEnabled ? "enabled" : "disabled"}</p><p>Disabling a source module does not delete historical Expense representations. Re-enabling Expense allows controlled reconciliation to recover missing representations.</p></div>
  </section>;
}
