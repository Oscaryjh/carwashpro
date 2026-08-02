import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunEntryEditor } from "@/lib/payroll/entry-editor";
import {
  payrollRunReturnPath,
} from "@/lib/payroll/runs";
import { updatePayrollEntryAction } from "../../../../actions";
import {
  formatMoney,
  formatMonth,
  PageHeader,
  PayrollRunsAccessDenied,
} from "../../../_components";
import styles from "../../../runs.module.css";

export const dynamic = "force-dynamic";

type PayrollEntryEditorPageProps = {
  params: Promise<{ entryId: string; runId: string }>;
  searchParams: Promise<{ returnPath?: string }>;
};

export default async function PayrollEntryEditorPage({
  params,
  searchParams,
}: PayrollEntryEditorPageProps) {
  const access = await resolvePayrollRunsReadAccess();
  if (!access.granted || !access.actions.canEditEntry) {
    return (
      <PayrollRunsAccessDenied
        scopeRestricted={!access.granted && access.scopeRestricted}
      />
    );
  }

  const [{ entryId, runId }, query] = await Promise.all([params, searchParams]);
  const data = await loadPayrollRunEntryEditor(
    access.businessId,
    runId,
    entryId,
  );
  if (!data) notFound();

  const returnPath =
    payrollRunReturnPath(runId, query.returnPath ?? null) ??
    `/team/payroll/runs/${runId}`;
  const month = data.run.periodStart.toISOString().slice(0, 7);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title={`Edit ${data.entry.fullName}`}
        description={`${formatMonth(data.run.periodStart)} draft entry. This changes only this Payroll Run snapshot.`}
      >
        <Link href={returnPath}>Back to payroll run</Link>
      </PageHeader>

      <section className={styles.editorPanel} aria-labelledby="entry-editor-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Draft employee entry</p>
          <h2 id="entry-editor-heading">{data.entry.fullName}</h2>
          <p>{data.entry.employeeCode} · Manual values are audited and do not edit the employee Salary or Statutory Profile.</p>
        </div>

        <div className={styles.editorSummary}>
          <SummaryMetric label="Basic pay" value={formatMoney(data.entry.basicPay)} />
          <SummaryMetric label="Leave pay" value={formatMoney(data.entry.leavePay)} />
          <SummaryMetric label="Additional time pay" value={formatMoney(data.entry.overtimePay)} />
          <SummaryMetric label="Holiday pay" value={formatMoney(data.entry.publicHolidayPay)} />
          <SummaryMetric label="Unpaid leave deduction" value={formatMoney(data.entry.unpaidLeaveDeduction)} />
          <SummaryMetric label="Current gross" value={formatMoney(data.entry.grossPay)} />
          <SummaryMetric label="Current net" value={formatMoney(data.entry.netPay)} />
          <SummaryMetric label="Run status" value="Draft" />
        </div>

        <form action={updatePayrollEntryAction} className={styles.editorForm}>
          <input name="entryId" type="hidden" value={data.entry.id} />
          <input name="runId" type="hidden" value={data.run.id} />
          <input name="month" type="hidden" value={month} />
          <input name="returnPath" type="hidden" value={returnPath} />
          <input name="epfWageBase" type="hidden" value={moneyValue(data.entry.epfWageBase)} />
          <input name="perkesoWageBase" type="hidden" value={moneyValue(data.entry.perkesoWageBase)} />

          <fieldset className={styles.editorFieldset}>
            <legend>Earnings and other deductions</legend>
            <div className={styles.editorGrid}>
              <MoneyField label="Allowances" name="allowances" value={data.entry.allowances} />
              <MoneyField label="Other deductions" name="otherDeductions" value={data.entry.otherDeductions} />
              <MoneyField label="PCB" name="pcb" value={data.entry.pcb} />
            </div>
          </fieldset>

          <fieldset className={styles.editorFieldset}>
            <legend>Employee statutory deductions</legend>
            <div className={styles.editorGrid}>
              <MoneyField label="EPF employee" name="epfEmployee" value={data.entry.epfEmployee} />
              <MoneyField label="SOCSO employee" name="socsoEmployee" value={data.entry.socsoEmployee} />
              <MoneyField label="EIS employee" name="eisEmployee" value={data.entry.eisEmployee} />
              <MoneyField label="LINDUNG 24 Jam" name="lindung24Employee" value={data.entry.lindung24Employee} />
            </div>
          </fieldset>

          <fieldset className={styles.editorFieldset}>
            <legend>Employer contributions</legend>
            <div className={styles.editorGrid}>
              <MoneyField label="Employer EPF" name="employerEpf" value={data.entry.employerEpf} />
              <MoneyField label="Employer SOCSO" name="employerSocso" value={data.entry.employerSocso} />
              <MoneyField label="Employer EIS" name="employerEis" value={data.entry.employerEis} />
            </div>
          </fieldset>

          <label className={styles.notesField}>
            <span>Payroll notes</span>
            <input
              defaultValue={data.entry.notes}
              maxLength={500}
              name="notes"
              placeholder="Optional note for this employee entry"
            />
          </label>

          <div className={styles.editorFooter}>
            <Link href={returnPath}>Cancel and return</Link>
            <button className={styles.primaryButton} type="submit">Save employee entry</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function MoneyField({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <label className={styles.moneyField}>
      <span>{label}</span>
      <span className={styles.moneyInput}>
        <b>RM</b>
        <input defaultValue={moneyValue(value)} inputMode="decimal" name={name} pattern="\d{1,10}(?:\.\d{1,2})?" required />
      </span>
    </label>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function moneyValue(value: number) {
  return value.toFixed(2);
}
