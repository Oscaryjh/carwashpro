import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { DEFAULT_PAYROLL_SETTING, parsePayrollMonth } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";
import {
  addPayrollHolidayAction,
  deletePayrollHolidayAction,
  savePayrollSettingAction,
} from "../actions";
import styles from "../payroll.module.css";

type PayrollSettingsPageProps = {
  searchParams: Promise<{
    message?: string;
    month?: string;
    type?: string;
  }>;
};

export default async function PayrollSettingsPage({
  searchParams,
}: PayrollSettingsPageProps) {
  const { access, businessId } = await requireBusinessUser("VIEW_PAYROLL_RUN");
  const [scope, branches, params] = await Promise.all([
    resolveAttendanceScope(access),
    prisma.branch.findMany({
      where: { businessId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    searchParams,
  ]);

  if (
    scope.allowedBranchIds.length !== branches.length ||
    (access.effectiveBusinessRole === "STAFF" &&
      !access.permissions.includes("ALL_BRANCHES"))
  ) {
    redirect(
      "/team/payroll/workspace?type=error&message=Payroll%20settings%20require%20all-branch%20access.",
    );
  }

  const period = parsePayrollMonth(params.month);
  const canEditPayroll = hasBusinessCapability(access, "EDIT_PAYROLL_ENTRY");
  const canViewStatutory = hasBusinessCapability(
    access,
    "VIEW_STATUTORY_SUBMISSION",
  );
  const [storedSetting, holidays] = await Promise.all([
    prisma.payrollSetting.findUnique({ where: { businessId } }),
    prisma.payrollHoliday.findMany({
      where: {
        businessId,
        workDate: { gte: period.start, lt: period.end },
      },
      include: { branch: { select: { name: true } } },
      orderBy: [{ workDate: "asc" }, { branch: { name: "asc" } }],
    }),
  ]);
  const setting = storedSetting ?? DEFAULT_PAYROLL_SETTING;
  const notice = sanitizePayrollNotice(params.message, params.type);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={`hr-module-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <p className={`hr-module-eyebrow ${styles.eyebrow}`}>
            HR &amp; PAYROLL
          </p>
          <h1>Payroll settings</h1>
          <p>
            Maintain calculation policy and branch public holidays separately
            from monthly Payroll Runs.
          </p>
        </div>
        <nav
          aria-label="Payroll navigation"
          className={`hr-module-actions ${styles.headerActions}`}
        >
          <Link href="/team/payroll/workspace">Payroll workspace</Link>
          <Link href="/team/payroll/runs">Payroll runs</Link>
          {canViewStatutory ? (
            <Link href={`/team/payroll/statutory?month=${period.value}`}>
              Statutory submissions
            </Link>
          ) : null}
        </nav>
      </header>

      {notice ? (
        <div
          className={
            params.type === "error"
              ? `${styles.notice} ${styles.noticeError}`
              : `${styles.notice} ${styles.noticeSuccess}`
          }
          role={params.type === "error" ? "alert" : "status"}
        >
          {notice}
        </div>
      ) : null}

      <section className={styles.periodPanel}>
        <div className={styles.periodSummary}>
          <span className={styles.periodIcon} aria-hidden="true">
            {period.start.toISOString().slice(5, 7)}
          </span>
          <div>
            <p className={styles.eyebrow}>HOLIDAY CALENDAR PERIOD</p>
            <h2>{formatMonth(period.start)}</h2>
            <p>Calculation policy applies to the business; holidays apply to the selected month and branch.</p>
          </div>
        </div>
        <form action="/team/payroll/settings" className={styles.monthForm}>
          <label>
            <span>Calendar month</span>
            <input defaultValue={period.value} name="month" type="month" />
          </label>
          <button className={styles.secondaryButton} type="submit">
            View month
          </button>
        </form>
      </section>

      <div className={styles.workspaceGrid}>
        <section className={`${styles.panel} ${styles.settingsPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>CALCULATION POLICY</p>
              <h2>Company payroll settings</h2>
              <p>Define the normal work pattern used for this business.</p>
            </div>
            <span className={styles.badge}>Malaysia</span>
          </div>
          <form action={savePayrollSettingAction} className={styles.settingsForm}>
            <input name="month" type="hidden" value={period.value} />
            <Field disabled={!canEditPayroll} hint="Default: 26 days" label="Working days / month" max="31" min="1" name="workingDaysPerMonth" value={setting.workingDaysPerMonth} />
            <Field disabled={!canEditPayroll} hint={`${formatHours(setting.normalWorkMinutesPerDay)} paid hours`} label="Paid minutes / day" max="1440" min="1" name="normalWorkMinutesPerDay" value={setting.normalWorkMinutesPerDay} />
            <Field disabled={!canEditPayroll} hint="Unpaid break target" label="Break minutes" max="720" min="0" name="breakMinutesPerDay" value={setting.breakMinutesPerDay} />
            <Field disabled={!canEditPayroll} hint="Normal working day" label="OT multiplier" max="10" min="1" name="overtimeMultiplier" step="0.01" value={String(setting.overtimeMultiplier)} />
            <Field disabled={!canEditPayroll} hint="Extra on top of ordinary pay" label="Public holiday extra" max="10" min="0" name="publicHolidayExtraMultiplier" step="0.01" value={String(setting.publicHolidayExtraMultiplier)} />
            <label className={styles.formField}>
              <span>State / holiday label</span>
              <input
                defaultValue={"stateCode" in setting ? setting.stateCode ?? "" : ""}
                disabled={!canEditPayroll}
                name="stateCode"
                placeholder="e.g. Sabah"
              />
              <small>Used to identify your holiday calendar</small>
            </label>
            {canEditPayroll ? (
              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="submit">
                  Save payroll settings
                </button>
              </div>
            ) : null}
          </form>
          <div className={styles.policyNote}>
            <span className={styles.infoIcon} aria-hidden="true">i</span>
            <p>
              Monthly rate = salary / {setting.workingDaysPerMonth} working days /
              {" "}{formatHours(setting.normalWorkMinutesPerDay)} paid hours. A
              9-hour shift with a 1-hour break remains 8 paid hours.
            </p>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.holidayPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>PUBLIC HOLIDAYS</p>
              <h2>Branch calendar</h2>
              <p>Mark branch-specific holidays before generating payroll.</p>
            </div>
            <span className={styles.badge}>
              {holidays.length} {holidays.length === 1 ? "day" : "days"}
            </span>
          </div>
          {canEditPayroll ? (
            <form action={addPayrollHolidayAction} className={styles.holidayForm}>
              <input name="month" type="hidden" value={period.value} />
              <label className={styles.formField}>
                <span>Branch</span>
                <select name="branchId" required>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.formField}>
                <span>Date</span>
                <input name="workDate" required type="date" />
              </label>
              <label className={`${styles.formField} ${styles.holidayName}`}>
                <span>Holiday name</span>
                <input name="name" placeholder="e.g. National Day" required />
              </label>
              <button className={styles.secondaryButton} type="submit">Add holiday</button>
            </form>
          ) : null}
          <div className={styles.holidayList}>
            {holidays.length ? (
              holidays.map((holiday) => (
                <div className={styles.holidayItem} key={holiday.id}>
                  <span className={styles.holidayDate} aria-hidden="true">
                    <strong>{holiday.workDate.toISOString().slice(8, 10)}</strong>
                    <small>{new Intl.DateTimeFormat("en-MY", { month: "short", timeZone: "UTC" }).format(holiday.workDate)}</small>
                  </span>
                  <span className={styles.holidayCopy}>
                    <strong>{holiday.name}</strong>
                    <small>{holiday.branch.name}</small>
                  </span>
                  {canEditPayroll ? (
                    <form action={deletePayrollHolidayAction}>
                      <input name="holidayId" type="hidden" value={holiday.id} />
                      <input name="month" type="hidden" value={period.value} />
                      <button className={styles.removeButton} type="submit">Remove</button>
                    </form>
                  ) : null}
                </div>
              ))
            ) : (
              <div className={styles.holidayEmpty}>
                <span aria-hidden="true">31</span>
                <strong>No public holidays added</strong>
                <p>Add only the dates that apply to each branch for {formatMonth(period.start)}.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  value,
  disabled,
  hint,
  ...props
}: {
  label: string;
  name: string;
  value: string | number;
  disabled: boolean;
  hint: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className={styles.formField}>
      <span>{label}</span>
      <input defaultValue={value} disabled={disabled} name={name} type="number" {...props} />
      <small>{hint}</small>
    </label>
  );
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatHours(minutes: number) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
