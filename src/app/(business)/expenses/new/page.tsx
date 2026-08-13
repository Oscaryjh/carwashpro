import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { createExpenseAction } from "../actions";
import styles from "../expense.module.css";

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "CREATE_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope, categories] = await Promise.all([searchParams, resolveExpenseReadScope(context), prisma.expenseCategory.findMany({ where: { active: true, businessId: context.businessId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })]);
  return <section className="content"><div className="page-header"><div><h1>Add Business Expense</h1><p>Manual business-spending record. Expense date and payment date are separate facts.</p></div><Link href="/expenses">Back to overview</Link></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <div className={styles.notice}>Manual salary, commission, Claim, or purchasing entries may duplicate future canonical adapters. Tetamu cannot perfectly detect deliberately duplicated manual data.</div>
    <form action={createExpenseAction} className={`panel ${styles.form}`}>
      <input type="hidden" name="operationKey" value={`CREATE_EXPENSE:${randomUUID()}`} />
      <label>Expense Date<input name="expenseDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>Branch<select name="branchId" required={!scope.includeBusinessWide}><option value="">{scope.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Category<select name="categoryId" required defaultValue=""><option value="" disabled>Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.requiresReceipt ? " · Receipt required" : ""}</option>)}</select></label>
      <label>Payee<input name="payeeName" maxLength={160} placeholder="Meta, Sabah Electricity, Landlord…" /></label>
      <label>Amount (MYR)<input name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required /></label>
      <label>Payment Status<select name="paymentStatus" defaultValue="UNPAID"><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select></label>
      <label>Payment Method<select name="paymentMethod" defaultValue=""><option value="">Required when Paid</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank Transfer</option><option value="CARD">Card</option><option value="EWALLET">E-wallet</option><option value="OTHER">Other</option></select></label>
      <label>Payment Date<input name="paymentDate" type="date" /></label>
      <label>Payment Reference<input name="paymentReference" maxLength={160} /></label>
      <label className={styles.full}>Description<input name="description" minLength={3} maxLength={500} required /></label>
      <label className={styles.full}>Receipt / Attachment<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><small>Private quarantine storage · JPG/PNG/WebP/PDF · max 10MB. Malware scanner is not configured in Local.</small></label>
      <label className={styles.full}>Notes<textarea name="notes" maxLength={2000} rows={3} /></label>
      <div className={`${styles.full} ${styles.actions}`}><button name="intent" value="CONFIRMED">Create & Confirm</button><button className="secondary-button" name="intent" value="DRAFT">Save Draft</button></div>
    </form>
  </section>;
}
