import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  DEFAULT_PAYROLL_SETTING,
  parsePayrollMonth,
} from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";
import {
  addPayrollHolidayAction,
  deletePayrollHolidayAction,
  finalizePayrollRunAction,
  generatePayrollRunAction,
  savePayrollSettingAction,
  updatePayrollEntryAction,
} from "./actions";
import styles from "./payroll.module.css";

type PayrollPageProps = {
  searchParams: Promise<{
    month?: string;
    message?: string;
    type?: string;
  }>;
};

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const { access, businessId } = await requireBusinessUser("VIEW_PAYROLL");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const period = parsePayrollMonth(params.month);
  const branches = await prisma.branch.findMany({
    where: { businessId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (
    scope.allowedBranchIds.length !== branches.length ||
    (access.effectiveBusinessRole === "STAFF" &&
      !access.permissions.includes("ALL_BRANCHES"))
  ) {
    redirect("/team?type=error&message=Payroll%20requires%20all-branch%20access.");
  }
  const canManage =
    access.effectiveBusinessRole !== "STAFF" ||
    access.permissions.includes("PAYROLL_MANAGE");
  const [storedSetting, run, holidays, recentRuns] = await Promise.all([
    prisma.payrollSetting.findUnique({ where: { businessId } }),
    prisma.payrollRun.findUnique({
      where: {
        businessId_periodStart_periodEnd: {
          businessId,
          periodStart: period.start,
          periodEnd: period.end,
        },
      },
      include: {
        entries: { orderBy: [{ fullNameSnapshot: "asc" }] },
      },
    }),
    prisma.payrollHoliday.findMany({
      where: {
        businessId,
        workDate: { gte: period.start, lt: period.end },
      },
      include: { branch: { select: { name: true } } },
      orderBy: [{ workDate: "asc" }, { branch: { name: "asc" } }],
    }),
    prisma.payrollRun.findMany({
      where: { businessId },
      orderBy: { periodStart: "desc" },
      take: 12,
      select: { id: true, periodStart: true, status: true },
    }),
  ]);
  const setting = storedSetting ?? DEFAULT_PAYROLL_SETTING;
  const entries = run?.entries ?? [];
  const totalGross = entries.reduce((sum, entry) => sum + Number(entry.grossPay), 0);
  const totalNet = entries.reduce((sum, entry) => sum + Number(entry.netPay), 0);
  const totalEmployer = entries.reduce(
    (sum, entry) =>
      sum +
      Number(entry.employerEpf) +
      Number(entry.employerSocso) +
      Number(entry.employerEis),
    0,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>TEAM / PAYROLL</p>
          <h1>Monthly payroll</h1>
          <p>Attendance-based Malaysian payroll worksheet with auditable finalization.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className="secondary-light-button" href="/team/attendance">
            Attendance
          </Link>
          <Link className="secondary-light-button" href="/team?section=people">
            People
          </Link>
        </div>
      </header>

      {params.message ? (
        <div className={params.type === "error" ? "error" : "success"}>
          {params.message}
        </div>
      ) : null}

      <section className={styles.toolbar}>
        <form action="/team/payroll" className={styles.monthForm}>
          <label>
            <span>Payroll month</span>
            <input defaultValue={period.value} name="month" type="month" />
          </label>
          <button type="submit">View month</button>
        </form>
        {canManage ? (
          <form action={generatePayrollRunAction}>
            <input name="month" type="hidden" value={period.value} />
            <button type="submit">
              {run?.status === "DRAFT" ? "Regenerate draft" : "Generate payroll"}
            </button>
          </form>
        ) : null}
      </section>

      <section className={styles.metrics}>
        <Metric label="Employees" value={String(entries.length)} note={run ? run.status : "No run"} />
        <Metric label="Gross payroll" value={formatMoney(totalGross)} note="Basic + OT + holiday + allowance" />
        <Metric label="Net payroll" value={formatMoney(totalNet)} note="After employee deductions" emphasis />
        <Metric label="Employer statutory" value={formatMoney(totalEmployer)} note="EPF + SOCSO + EIS entered" />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>CALCULATION POLICY</p>
            <h2>Company payroll settings</h2>
          </div>
          <span className={styles.badge}>Malaysia foundation</span>
        </div>
        <form action={savePayrollSettingAction} className={styles.settingsForm}>
          <input name="month" type="hidden" value={period.value} />
          <Field label="Normal working days / month" name="workingDaysPerMonth" value={setting.workingDaysPerMonth} min="1" max="31" disabled={!canManage} />
          <Field label="Paid work minutes / day" name="normalWorkMinutesPerDay" value={setting.normalWorkMinutesPerDay} min="1" max="1440" disabled={!canManage} />
          <Field label="Target break minutes" name="breakMinutesPerDay" value={setting.breakMinutesPerDay} min="0" max="720" disabled={!canManage} />
          <Field label="Normal-day OT multiplier" name="overtimeMultiplier" value={String(setting.overtimeMultiplier)} min="1" max="10" step="0.01" disabled={!canManage} />
          <Field label="Public holiday extra multiplier" name="publicHolidayExtraMultiplier" value={String(setting.publicHolidayExtraMultiplier)} min="0" max="10" step="0.01" disabled={!canManage} />
          <label>
            <span>State / holiday calendar label</span>
            <input defaultValue={"stateCode" in setting ? setting.stateCode ?? "" : ""} disabled={!canManage} name="stateCode" placeholder="e.g. Sabah" />
          </label>
          {canManage ? <button type="submit">Save settings</button> : null}
        </form>
        <p className={styles.policyNote}>
          Monthly ordinary rate uses monthly salary / configured working days (default 26), then / paid daily hours. A 9-hour span with a 1-hour break remains 480 paid minutes.
        </p>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>PUBLIC HOLIDAYS</p>
            <h2>Branch holiday calendar</h2>
          </div>
          <span className={styles.badge}>{holidays.length} this month</span>
        </div>
        {canManage ? (
          <form action={addPayrollHolidayAction} className={styles.holidayForm}>
            <input name="month" type="hidden" value={period.value} />
            <label><span>Branch</span><select name="branchId" required>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label><span>Date</span><input name="workDate" required type="date" /></label>
            <label><span>Holiday name</span><input name="name" placeholder="Public holiday" required /></label>
            <button type="submit">Add holiday</button>
          </form>
        ) : null}
        <div className={styles.holidayList}>
          {holidays.length ? holidays.map((holiday) => (
            <div key={holiday.id}>
              <span><strong>{holiday.name}</strong><small>{holiday.branch.name} - {formatDate(holiday.workDate)}</small></span>
              {canManage ? <form action={deletePayrollHolidayAction}><input name="holidayId" type="hidden" value={holiday.id} /><input name="month" type="hidden" value={period.value} /><button className="secondary-light-button" type="submit">Remove</button></form> : null}
            </div>
          )) : <p className={styles.empty}>No public holidays configured for this month.</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>PAYROLL RUN</p>
            <h2>{formatMonth(period.start)} payroll</h2>
          </div>
          <span className={run?.status === "FINALIZED" ? styles.finalized : styles.badge}>{run?.status ?? "NOT GENERATED"}</span>
        </div>
        {!run ? (
          <p className={styles.empty}>Generate a draft after Attendance for the month is ready.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Employee</th><th>Basis</th><th>Days</th><th>Worked</th><th>OT</th><th>Holiday</th><th>Gross</th><th>Net</th></tr></thead>
                <tbody>
                  {entries.map((entry) => (
                    <PayrollEntryRows key={entry.id} entry={entry} month={period.value} editable={canManage && run.status === "DRAFT"} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.runFooter}>
              <p>Only completed Attendance with no pending/rejected approval is included. Regenerating a draft refreshes Attendance values and clears manual deductions.</p>
              {canManage && run.status === "DRAFT" ? (
                <form action={finalizePayrollRunAction}>
                  <input name="month" type="hidden" value={period.value} />
                  <input name="runId" type="hidden" value={run.id} />
                  <button className={styles.finalizeButton} type="submit">Finalize & lock payroll</button>
                </form>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className={styles.complianceNote}>
        <strong>Statutory contribution safety</strong>
        <p>Enter KWSP, SOCSO, EIS and PCB amounts from the current official schedules or portals. They are intentionally not estimated by a flat percentage because official wage bands and employee tax/profile data are required.</p>
      </section>

      {recentRuns.length ? <nav className={styles.history} aria-label="Recent payroll months"><strong>Recent runs</strong>{recentRuns.map((item) => { const value = item.periodStart.toISOString().slice(0, 7); return <Link className={value === period.value ? styles.activeMonth : ""} href={`/team/payroll?month=${value}`} key={item.id}>{value} - {item.status}</Link>; })}</nav> : null}
    </main>
  );
}

function PayrollEntryRows({ entry, month, editable }: { entry: PayrollEntryRow; month: string; editable: boolean }) {
  return (
    <>
      <tr>
        <td><strong>{entry.fullNameSnapshot}</strong><small>{entry.employeeCodeSnapshot}</small></td>
        <td>{entry.payBasisSnapshot}<small>{formatMoney(entry.baseRateSnapshot)}</small></td>
        <td>{entry.attendanceDays}</td>
        <td>{formatMinutes(entry.regularMinutes)}</td>
        <td>{formatMinutes(entry.overtimeMinutes)}</td>
        <td>{formatMinutes(entry.publicHolidayMinutes)}</td>
        <td>{formatMoney(entry.grossPay)}</td>
        <td><strong>{formatMoney(entry.netPay)}</strong></td>
      </tr>
      <tr className={styles.detailRow}><td colSpan={8}>
        <details open={editable}>
          <summary>Pay details & statutory entries</summary>
          <form action={updatePayrollEntryAction} className={styles.entryForm}>
            <input name="entryId" type="hidden" value={entry.id} /><input name="month" type="hidden" value={month} />
            <MoneyField label="Basic" name="basic" value={entry.basicPay} disabled />
            <MoneyField label="OT pay" name="overtime" value={entry.overtimePay} disabled />
            <MoneyField label="Holiday pay" name="holiday" value={entry.publicHolidayPay} disabled />
            <MoneyField label="Allowances" name="allowances" value={entry.allowances} disabled={!editable} />
            <MoneyField label="Other deductions" name="otherDeductions" value={entry.otherDeductions} disabled={!editable} />
            <MoneyField label="EPF employee" name="epfEmployee" value={entry.epfEmployee} disabled={!editable} />
            <MoneyField label="SOCSO employee" name="socsoEmployee" value={entry.socsoEmployee} disabled={!editable} />
            <MoneyField label="EIS employee" name="eisEmployee" value={entry.eisEmployee} disabled={!editable} />
            <MoneyField label="PCB" name="pcb" value={entry.pcb} disabled={!editable} />
            <MoneyField label="Employer EPF" name="employerEpf" value={entry.employerEpf} disabled={!editable} />
            <MoneyField label="Employer SOCSO" name="employerSocso" value={entry.employerSocso} disabled={!editable} />
            <MoneyField label="Employer EIS" name="employerEis" value={entry.employerEis} disabled={!editable} />
            <label className={styles.notes}><span>Notes</span><input defaultValue={entry.notes ?? ""} disabled={!editable} maxLength={500} name="notes" /></label>
            {editable ? <button type="submit">Save entry</button> : null}
          </form>
        </details>
      </td></tr>
    </>
  );
}

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) { return <article className={emphasis ? `${styles.metric} ${styles.metricEmphasis}` : styles.metric}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Field({ label, name, value, disabled, ...props }: { label: string; name: string; value: string | number; disabled: boolean; min?: string; max?: string; step?: string }) { return <label><span>{label}</span><input defaultValue={value} disabled={disabled} name={name} type="number" {...props} /></label>; }
function MoneyField({ label, name, value, disabled }: { label: string; name: string; value: unknown; disabled: boolean }) { return <label><span>{label} (RM)</span><input defaultValue={Number(value).toFixed(2)} disabled={disabled} min="0" name={name} step="0.01" type="number" /></label>; }
function formatMoney(value: unknown) { return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value)); }
function formatMinutes(value: number) { return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function formatMonth(value: Date) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(value); }

type PayrollEntryRow = {
  id: string; employeeCodeSnapshot: string; fullNameSnapshot: string; payBasisSnapshot: string; baseRateSnapshot: unknown;
  attendanceDays: number; regularMinutes: number; overtimeMinutes: number; publicHolidayMinutes: number;
  basicPay: unknown; overtimePay: unknown; publicHolidayPay: unknown; allowances: unknown; otherDeductions: unknown;
  epfEmployee: unknown; socsoEmployee: unknown; eisEmployee: unknown; pcb: unknown; employerEpf: unknown; employerSocso: unknown; employerEis: unknown;
  grossPay: unknown; netPay: unknown; notes: string | null;
};
