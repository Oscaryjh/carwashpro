import Link from "next/link";
import { generatePayrollRunAction } from "../actions";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunsList, parsePayrollPage } from "@/lib/payroll/runs";
import {
  formatDate,
  formatMoney,
  formatMonth,
  PageHeader,
  PayrollRunsAccessDenied,
  RunStatusBadge,
} from "./_components";
import styles from "./runs.module.css";

export const dynamic = "force-dynamic";

type PayrollRunsPageProps = {
  searchParams: Promise<{
    message?: string;
    month?: string;
    page?: string;
    type?: string;
  }>;
};

export default async function PayrollRunsPage({ searchParams }: PayrollRunsPageProps) {
  const access = await resolvePayrollRunsReadAccess();
  if (!access.granted) {
    return <PayrollRunsAccessDenied scopeRestricted={access.scopeRestricted} />;
  }

  const params = await searchParams;
  const data = await loadPayrollRunsList(access.businessId, parsePayrollPage(params.page));
  const notice = sanitizePayrollNotice(params.message, params.type);
  const currentMonth = validMonth(params.month)
    ? params.month
    : new Date().toISOString().slice(0, 7);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title="Payroll Runs"
        description="Create, review and continue monthly payroll calculation runs."
      >
        <Link href="/team/payroll/workspace">Payroll workspace</Link>
        <Link href={`/team/payroll/settings?month=${currentMonth}`}>Payroll settings</Link>
      </PageHeader>

      {notice ? (
        <div
          className={`${styles.notice} ${params.type === "error" ? styles.noticeError : styles.noticeSuccess}`}
          role={params.type === "error" ? "alert" : "status"}
        >
          {notice}
        </div>
      ) : null}

      {access.actions.canCreate ? (
        <section className={styles.createPanel} aria-labelledby="create-run-heading">
          <div>
            <p className={styles.eyebrow}>New calculation period</p>
            <h2 id="create-run-heading">Create payroll draft</h2>
            <p>Select a month. If it already exists, the existing run opens without refreshing its entries.</p>
          </div>
          <form action={generatePayrollRunAction} className={styles.createForm}>
            <input name="generationMode" type="hidden" value="CREATE_ONLY" />
            <input name="returnToRun" type="hidden" value="true" />
            <label>
              <span>Payroll month</span>
              <input defaultValue={currentMonth} name="month" required type="month" />
            </label>
            <button className={styles.primaryButton} type="submit">Create draft</button>
          </form>
        </section>
      ) : null}

      <section className={styles.introPanel} aria-labelledby="runs-heading">
        <div>
          <p className={styles.eyebrow}>Calculation history</p>
          <h2 id="runs-heading">Monthly payroll runs</h2>
          <p>Calculation status is separate from payslip, payment and statutory submission status.</p>
        </div>
        <div className={styles.totalMetric}>
          <span>Total runs</span>
          <strong>{data.total}</strong>
        </div>
      </section>

      {data.runs.length ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.runTable}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Calculation status</th>
                  <th>Employees</th>
                  <th>Gross payroll</th>
                  <th>Net payroll</th>
                  <th>Updated</th>
                  <th><span className={styles.visuallyHidden}>Action</span></th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Period"><strong>{formatMonth(run.periodStart)}</strong></td>
                    <td data-label="Calculation status"><RunStatusBadge status={run.status} /></td>
                    <td data-label="Employees">{run.employeeCount}</td>
                    <td data-label="Gross payroll">{formatMoney(run.grossPayroll)}</td>
                    <td data-label="Net payroll"><strong>{formatMoney(run.netPayroll)}</strong></td>
                    <td data-label="Updated">{formatDate(run.updatedAt)}</td>
                    <td className={styles.rowActionCell}>
                      <Link href={`/team/payroll/runs/${run.id}`}>View run</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath="/team/payroll/runs"
            page={data.page}
            totalPages={data.totalPages}
          />
        </>
      ) : (
        <section className={styles.emptyState}>
          <span aria-hidden="true">—</span>
          <div>
            <h2>No payroll runs yet</h2>
            <p>{access.actions.canCreate ? "Select a month above to create the first calculation draft." : "Monthly calculation runs will appear here after an authorized payroll user creates one."}</p>
          </div>
        </section>
      )}
    </main>
  );
}

function validMonth(value?: string): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
}

function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Payroll runs pages">
      {page > 1 ? <Link href={`${basePath}?page=${page - 1}`}>Previous</Link> : <span>Previous</span>}
      <strong>Page {page} of {totalPages}</strong>
      {page < totalPages ? <Link href={`${basePath}?page=${page + 1}`}>Next</Link> : <span>Next</span>}
    </nav>
  );
}
