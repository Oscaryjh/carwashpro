import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import {
  DEFAULT_PAYROLL_SETTING,
  parsePayrollMonth,
} from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";
import {
  addPayrollHolidayAction,
  deletePayrollHolidayAction,
  saveEmployeeStatutoryProfileAction,
  savePayrollSettingAction,
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
  const { access, businessId } = await requireBusinessUser("VIEW_PAYROLL_RUN");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const noticeMessage = sanitizePayrollNotice(params.message, params.type);
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

  const canEditPayroll = hasBusinessCapability(access, "EDIT_PAYROLL_ENTRY");
  const canEditStatutory = hasBusinessCapability(access, "EDIT_STATUTORY_PROFILE");
  const canExportStatutory = hasBusinessCapability(access, "EXPORT_STATUTORY");
  const canViewTeamDirectory = hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const canViewAttendance = hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canViewStatutory =
    hasBusinessCapability(access, "VIEW_STATUTORY_SUBMISSION") &&
    hasBusinessCapability(access, "VIEW_STATUTORY_PROFILE") &&
    hasBusinessCapability(access, "VIEW_TAX_PROFILE");
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
        entries: {
          orderBy: [{ fullNameSnapshot: "asc" }],
          include: {
            membership: {
              select: {
                dateOfBirth: true,
                statutoryNationality: true,
                epfEnabled: true,
                epfMemberBeforeAug1998: true,
                socsoEnabled: true,
                socsoCategory: true,
                eisEnabled: true,
                eisPreviouslyContributed: true,
                lindung24OptIn: true,
              },
            },
          },
        },
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
  const totalGross = entries.reduce(
    (sum, entry) => sum + Number(entry.grossPay),
    0,
  );
  const totalNet = entries.reduce(
    (sum, entry) => sum + Number(entry.netPay),
    0,
  );
  const totalEmployer = entries.reduce(
    (sum, entry) =>
      sum +
      Number(entry.employerEpf) +
      Number(entry.employerSocso) +
      Number(entry.employerEis),
    0,
  );
  const runStatus =
    run?.status === "FINALIZED"
      ? "Calculations locked"
      : run?.status === "REVIEW"
        ? "Awaiting review"
      : run?.status === "DRAFT"
        ? "Draft"
        : "Not generated";

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={`hr-module-header ${styles.pageHeader}`}>
        <div className={styles.headerCopy}>
          <p className={`hr-module-eyebrow ${styles.eyebrow}`}>HR &amp; PAYROLL</p>
          <h1>Monthly payroll</h1>
          <p>
            Review attendance, calculate earnings and lock a clean monthly pay
            run.
          </p>
        </div>
        <nav className={`hr-module-actions ${styles.headerActions}`} aria-label="Payroll navigation">
          <Link href="/team/payroll/workspace">Payroll workspace</Link>
          <Link href="/team/payroll/runs">Payroll runs</Link>
          {canViewStatutory ? <Link href={`/team/payroll/statutory?month=${period.value}`}>Statutory submissions</Link> : null}
          {canViewAttendance ? <Link href="/team/attendance">View attendance</Link> : null}
          {canViewTeamDirectory ? <Link href="/team?section=people">Manage people</Link> : null}
        </nav>
      </header>

      {noticeMessage ? (
        <div
          className={
            params.type === "error"
              ? `${styles.notice} ${styles.noticeError}`
              : `${styles.notice} ${styles.noticeSuccess}`
          }
          role={params.type === "error" ? "alert" : "status"}
        >
          {noticeMessage}
        </div>
      ) : null}

      <section className={styles.periodPanel}>
        <div className={styles.periodSummary}>
          <span className={styles.periodIcon} aria-hidden="true">
            {period.start.toISOString().slice(5, 7)}
          </span>
          <div>
            <p className={styles.eyebrow}>SELECTED PAY PERIOD</p>
            <h2>{formatMonth(period.start)}</h2>
            <p>
              {run
                ? `${entries.length} employee records in this ${runStatus.toLowerCase()} run.`
                : "Choose a month, then generate a draft from approved attendance."}
            </p>
          </div>
        </div>
        <div className={styles.periodActions}>
          <form action="/team/payroll" className={styles.monthForm}>
            <label>
              <span>Payroll month</span>
              <input
                defaultValue={period.value}
                name="month"
                type="month"
              />
            </label>
            <button className={styles.secondaryButton} type="submit">
              View month
            </button>
          </form>
          <Link
            className={styles.primaryButton}
            href={run ? `/team/payroll/runs/${run.id}` : "/team/payroll/runs"}
          >
            {run ? "Open Payroll Run" : "Go to Payroll Runs"}
          </Link>
        </div>
      </section>

      <section className={styles.metrics} aria-label="Payroll summary">
        <Metric
          label="Employees"
          value={String(entries.length)}
          note={run ? `${runStatus} payroll run` : "No payroll run yet"}
        />
        <Metric
          label="Gross payroll"
          value={formatMoney(totalGross)}
          note="Basic pay, OT, holiday and allowances"
        />
        <Metric
          emphasis
          label="Net payroll"
          value={formatMoney(totalNet)}
          note="Estimated amount payable to employees"
        />
        <Metric
          label="Employer statutory"
          value={formatMoney(totalEmployer)}
          note="Employer EPF, SOCSO and EIS entered"
        />
      </section>

      <div className={styles.workspaceGrid}>
        <section className={`${styles.panel} ${styles.settingsPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>CALCULATION POLICY</p>
              <h2>Payroll settings</h2>
              <p>Define the normal work pattern used for this business.</p>
            </div>
            <span className={styles.badge}>Malaysia</span>
          </div>
          <form
            action={savePayrollSettingAction}
            className={styles.settingsForm}
          >
            <input name="month" type="hidden" value={period.value} />
            <Field
              disabled={!canEditPayroll}
              hint="Default: 26 days"
              label="Working days / month"
              max="31"
              min="1"
              name="workingDaysPerMonth"
              value={setting.workingDaysPerMonth}
            />
            <Field
              disabled={!canEditPayroll}
              hint={`${formatHours(setting.normalWorkMinutesPerDay)} paid hours`}
              label="Paid minutes / day"
              max="1440"
              min="1"
              name="normalWorkMinutesPerDay"
              value={setting.normalWorkMinutesPerDay}
            />
            <Field
              disabled={!canEditPayroll}
              hint="Unpaid break target"
              label="Break minutes"
              max="720"
              min="0"
              name="breakMinutesPerDay"
              value={setting.breakMinutesPerDay}
            />
            <Field
              disabled={!canEditPayroll}
              hint="Normal working day"
              label="OT multiplier"
              max="10"
              min="1"
              name="overtimeMultiplier"
              step="0.01"
              value={String(setting.overtimeMultiplier)}
            />
            <Field
              disabled={!canEditPayroll}
              hint="Extra on top of ordinary pay"
              label="Public holiday extra"
              max="10"
              min="0"
              name="publicHolidayExtraMultiplier"
              step="0.01"
              value={String(setting.publicHolidayExtraMultiplier)}
            />
            <label className={styles.formField}>
              <span>State / holiday label</span>
              <input
                defaultValue={
                  "stateCode" in setting ? setting.stateCode ?? "" : ""
                }
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
            <span className={styles.infoIcon} aria-hidden="true">
              i
            </span>
            <p>
              Monthly rate = salary / {setting.workingDaysPerMonth} working
              days / {formatHours(setting.normalWorkMinutesPerDay)} paid hours.
              A 9-hour shift with a 1-hour break remains 8 paid hours.
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
            <form
              action={addPayrollHolidayAction}
              className={styles.holidayForm}
            >
              <input name="month" type="hidden" value={period.value} />
              <label className={styles.formField}>
                <span>Branch</span>
                <select name="branchId" required>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.formField}>
                <span>Date</span>
                <input name="workDate" required type="date" />
              </label>
              <label className={`${styles.formField} ${styles.holidayName}`}>
                <span>Holiday name</span>
                <input
                  name="name"
                  placeholder="e.g. National Day"
                  required
                />
              </label>
              <button className={styles.secondaryButton} type="submit">
                Add holiday
              </button>
            </form>
          ) : null}
          <div className={styles.holidayList}>
            {holidays.length ? (
              holidays.map((holiday) => (
                <div className={styles.holidayItem} key={holiday.id}>
                  <span className={styles.holidayDate} aria-hidden="true">
                    <strong>
                      {holiday.workDate
                        .toISOString()
                        .slice(8, 10)}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat("en-MY", {
                        month: "short",
                        timeZone: "UTC",
                      }).format(holiday.workDate)}
                    </small>
                  </span>
                  <span className={styles.holidayCopy}>
                    <strong>{holiday.name}</strong>
                    <small>{holiday.branch.name}</small>
                  </span>
                  {canEditPayroll ? (
                    <form action={deletePayrollHolidayAction}>
                      <input
                        name="holidayId"
                        type="hidden"
                        value={holiday.id}
                      />
                      <input
                        name="month"
                        type="hidden"
                        value={period.value}
                      />
                      <button
                        className={styles.removeButton}
                        type="submit"
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            ) : (
              <div className={styles.holidayEmpty}>
                <span aria-hidden="true">31</span>
                <strong>No public holidays added</strong>
                <p>
                  Add only the dates that apply to each branch for{" "}
                  {formatMonth(period.start)}.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.runPanel}`}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>PAYROLL RUN</p>
            <h2>{formatMonth(period.start)} payroll</h2>
            <p>
              Review attendance-derived earnings and statutory entries before
              finalizing.
            </p>
          </div>
          <span
            className={
              run?.status === "FINALIZED"
                ? styles.finalized
                : run?.status === "REVIEW"
                  ? styles.review
                : run?.status === "DRAFT"
                  ? styles.draft
                  : styles.notGenerated
            }
          >
            {runStatus}
          </span>
        </div>

        {run && entries.length && canExportStatutory ? (
          <div className={styles.exportBar}>
            <div>
              <strong>Statutory documents</strong>
              <small>Payroll exports now live in the canonical Payroll Run.</small>
            </div>
            <div className={styles.downloadLinks}>
              {canExportStatutory ? <><Link href={`/team/payroll/export?month=${period.value}&kind=statutory&format=csv`}>Statutory CSV</Link>
              <Link href={`/team/payroll/export?month=${period.value}&kind=statutory&format=xlsx`}>Statutory Excel</Link></> : null}
            </div>
          </div>
        ) : null}

        {!run ? (
          <div className={styles.emptyRun}>
            <span className={styles.emptyRunIcon} aria-hidden="true">
              RM
            </span>
            <div>
              <strong>No payroll draft for {formatMonth(period.start)}</strong>
              <p>
                Make sure attendance is completed and approved, then generate
                the monthly draft.
              </p>
            </div>
            <Link className={styles.primaryButton} href="/team/payroll/runs">
              Go to Payroll Runs
            </Link>
          </div>
        ) : entries.length === 0 ? (
          <div className={styles.emptyRun}>
            <span className={styles.emptyRunIcon} aria-hidden="true">
              0
            </span>
            <div>
              <strong>No eligible employee records</strong>
              <p>
                This draft contains no employee with configured pay and
                completed attendance for the selected period.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Pay basis</th>
                    <th>Days</th>
                    <th>Regular</th>
                    <th>Overtime</th>
                    <th>Holiday</th>
                    <th>Gross</th>
                    <th>Net pay</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <PayrollEntryRows
                      editable={false}
                      entryEditorHref={
                        canEditPayroll && run.status === "DRAFT"
                          ? `/team/payroll/runs/${run.id}/entries/${entry.id}`
                          : null
                      }
                      profileEditable={canEditStatutory}
                      profileLinkEnabled={canViewTeamDirectory}
                      entry={entry}
                      key={entry.id}
                      month={period.value}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.runFooter}>
              <div className={styles.runGuidance}>
                <span className={styles.infoIcon} aria-hidden="true">
                  i
                </span>
                <p>
                  Only completed Attendance without pending or rejected
                  approval is included. Refreshing a draft clears manual
                  deductions.
                </p>
              </div>
              <Link className={styles.primaryButton} href={`/team/payroll/runs/${run.id}`}>
                Continue in Payroll Run
              </Link>
            </div>
            <p className={styles.completionBoundary}>
              Finalizing locks payroll calculations only. Payment completion
              and bank payment batches are not tracked in this release.
            </p>
          </>
        )}
      </section>

      <section className={styles.complianceNote}>
        <span className={styles.complianceIcon} aria-hidden="true">
          !
        </span>
        <div>
          <strong>Official statutory schedules, with a safe review gate</strong>
          <p>
            EPF, SOCSO and EIS are calculated from versioned official wage bands
            after each employee profile is configured. PCB remains a manual
            portal value because employee tax declarations and year-to-date data
            are required.
          </p>
        </div>
      </section>

      {recentRuns.length ? (
        <nav
          className={styles.history}
          aria-label="Recent payroll months"
        >
          <strong>Recent pay periods</strong>
          <div>
            {recentRuns.map((item) => {
              const value = item.periodStart.toISOString().slice(0, 7);
              return (
                <Link
                  className={
                    value === period.value ? styles.activeMonth : ""
                  }
                  href={`/team/payroll/runs/${item.id}`}
                  key={item.id}
                >
                  {formatShortMonth(item.periodStart)}
                  <small>
                    {item.status === "FINALIZED"
                      ? "Locked"
                      : item.status === "REVIEW"
                        ? "Review"
                        : "Draft"}
                  </small>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </main>
  );
}

function PayrollEntryRows({
  entry,
  month,
  editable,
  entryEditorHref,
  profileEditable,
  profileLinkEnabled,
}: {
  entry: PayrollEntryRow;
  month: string;
  editable: boolean;
  entryEditorHref: string | null;
  profileEditable: boolean;
  profileLinkEnabled: boolean;
}) {
  return (
    <>
      <tr className={styles.employeeRow}>
        <td className={styles.employeeCell} data-label="Employee">
          <span className={styles.employee}>
            <span className={styles.avatar}>
              {getInitials(entry.fullNameSnapshot)}
            </span>
            <span>
              {profileLinkEnabled ? (
                <Link
                  className={styles.employeeNameLink}
                  href={`/team/people/${entry.membershipId}`}
                >
                  {entry.fullNameSnapshot}
                </Link>
              ) : (
                <strong>{entry.fullNameSnapshot}</strong>
              )}
              <small>{entry.employeeCodeSnapshot}</small>
              {entryEditorHref ? (
                <Link className={styles.payslipLink} href={entryEditorHref}>
                  Edit in Payroll Run
                </Link>
              ) : null}
            </span>
          </span>
        </td>
        <td data-label="Pay basis">
          <span className={styles.basisBadge}>
            {formatPayBasis(entry.payBasisSnapshot)}
          </span>
          <small className={styles.baseRate}>
            {formatMoney(entry.baseRateSnapshot)} base
          </small>
        </td>
        <td data-label="Days">{entry.attendanceDays}</td>
        <td data-label="Regular">{formatMinutes(entry.regularMinutes)}</td>
        <td data-label="Overtime">{formatMinutes(entry.overtimeMinutes)}</td>
        <td data-label="Holiday">
          {formatMinutes(entry.publicHolidayMinutes)}
        </td>
        <td className={styles.moneyCell} data-label="Gross">
          {formatMoney(entry.grossPay)}
        </td>
        <td className={styles.netCell} data-label="Net pay">
          <strong>{formatMoney(entry.netPay)}</strong>
        </td>
      </tr>
      <tr className={styles.detailRow}>
        <td colSpan={8}>
          <details>
            <summary>
              <span>Review pay details and statutory entries</span>
              <small>{formatStatutoryStatus(entry.statutoryStatus)}</small>
            </summary>
            <div className={styles.statutoryStatus}>
              <span className={styles.badge}>
                {formatStatutoryStatus(entry.statutoryStatus)}
              </span>
              <p>
                {entry.statutoryWarning ??
                  (entry.statutoryRuleVersion
                    ? `Official rules: ${entry.statutoryRuleVersion}`
                    : "Configure this employee before automatic statutory deductions are applied.")}
              </p>
            </div>
            <form
              action={saveEmployeeStatutoryProfileAction}
              className={`${styles.entryForm} ${styles.profileForm}`}
            >
              <input name="membershipId" type="hidden" value={entry.membershipId} />
              <input name="month" type="hidden" value={month} />
              <fieldset className={styles.entrySection}>
                <legend>Statutory employee profile</legend>
                <div className={styles.profileGrid}>
                  <label className={styles.formField}>
                    <span>Date of birth</span>
                    <input
                      defaultValue={formatDateInput(entry.membership.dateOfBirth)}
                      disabled={!profileEditable}
                      name="dateOfBirth"
                      type="date"
                    />
                  </label>
                  <label className={styles.formField}>
                    <span>Statutory nationality</span>
                    <select
                      defaultValue={entry.membership.statutoryNationality ?? ""}
                      disabled={!profileEditable}
                      name="statutoryNationality"
                    >
                      <option value="">Select classification</option>
                      <option value="MALAYSIAN">Malaysian</option>
                      <option value="PERMANENT_RESIDENT">Permanent resident</option>
                      <option value="NON_MALAYSIAN">Non-Malaysian</option>
                    </select>
                  </label>
                  <label className={styles.formField}>
                    <span>SOCSO category</span>
                    <select
                      defaultValue={entry.membership.socsoCategory ?? ""}
                      disabled={!profileEditable}
                      name="socsoCategory"
                    >
                      <option value="">Select category</option>
                      <option value="FIRST">First category</option>
                      <option value="SECOND">Second category</option>
                    </select>
                  </label>
                </div>
                <div className={styles.optionGrid}>
                  <StatutoryOption checked={entry.membership.epfEnabled} disabled={!profileEditable} label="Auto-calculate EPF" name="epfEnabled" />
                  <StatutoryOption checked={entry.membership.socsoEnabled} disabled={!profileEditable} label="Auto-calculate SOCSO" name="socsoEnabled" />
                  <StatutoryOption checked={entry.membership.eisEnabled} disabled={!profileEditable} label="Auto-calculate EIS" name="eisEnabled" />
                  <StatutoryOption checked={entry.membership.epfMemberBeforeAug1998} disabled={!profileEditable} label="EPF member before Aug 1998" name="epfMemberBeforeAug1998" />
                  <StatutoryOption checked={entry.membership.eisPreviouslyContributed} disabled={!profileEditable} label="EIS contributed before age 57" name="eisPreviouslyContributed" />
                  <StatutoryOption checked={entry.membership.lindung24OptIn} disabled={!profileEditable} label="LINDUNG 24 Jam opt-in" name="lindung24OptIn" />
                </div>
              </fieldset>
              {profileEditable ? (
                <button className={styles.secondaryButton} type="submit">
                  Save statutory profile
                </button>
              ) : null}
            </form>
            <div className={styles.entryForm}>
              <input name="entryId" type="hidden" value={entry.id} />
              <input name="month" type="hidden" value={month} />
              <input name="epfWageBase" type="hidden" value={Number(entry.epfWageBase).toFixed(2)} />
              <input name="perkesoWageBase" type="hidden" value={Number(entry.perkesoWageBase).toFixed(2)} />

              <fieldset className={styles.entrySection}>
                <legend>Calculated earnings</legend>
                <div className={styles.entryGrid}>
                  <MoneyField
                    disabled
                    label="Basic"
                    name="basic"
                    value={entry.basicPay}
                  />
                  <MoneyField
                    disabled
                    label="OT pay"
                    name="overtime"
                    value={entry.overtimePay}
                  />
                  <MoneyField
                    disabled
                    label="Holiday pay"
                    name="holiday"
                    value={entry.publicHolidayPay}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="Allowances"
                    name="allowances"
                    value={entry.allowances}
                  />
                </div>
              </fieldset>

              <fieldset className={styles.entrySection}>
                <legend>Employee deductions</legend>
                <div className={styles.entryGrid}>
                  <MoneyField
                    disabled={!editable}
                    label="Other deductions"
                    name="otherDeductions"
                    value={entry.otherDeductions}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="EPF employee"
                    name="epfEmployee"
                    value={entry.epfEmployee}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="SOCSO employee"
                    name="socsoEmployee"
                    value={entry.socsoEmployee}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="EIS employee"
                    name="eisEmployee"
                    value={entry.eisEmployee}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="LINDUNG 24 Jam"
                    name="lindung24Employee"
                    value={entry.lindung24Employee}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="PCB"
                    name="pcb"
                    value={entry.pcb}
                  />
                </div>
              </fieldset>

              <fieldset className={styles.entrySection}>
                <legend>Employer contributions</legend>
                <div className={styles.entryGrid}>
                  <MoneyField
                    disabled={!editable}
                    label="Employer EPF"
                    name="employerEpf"
                    value={entry.employerEpf}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="Employer SOCSO"
                    name="employerSocso"
                    value={entry.employerSocso}
                  />
                  <MoneyField
                    disabled={!editable}
                    label="Employer EIS"
                    name="employerEis"
                    value={entry.employerEis}
                  />
                </div>
              </fieldset>

              <div className={styles.entryBottom}>
                <label className={styles.formField}>
                  <span>Payroll notes</span>
                  <input
                    defaultValue={entry.notes ?? ""}
                    disabled={!editable}
                    maxLength={500}
                    name="notes"
                    placeholder="Optional note for this employee"
                  />
                </label>
                {editable ? (
                  <button className={styles.primaryButton} type="submit">
                    Save employee entry
                  </button>
                ) : null}
              </div>
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function Metric({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        emphasis
          ? `${styles.metric} ${styles.metricEmphasis}`
          : styles.metric
      }
    >
      <span className={styles.metricHeading}>
        <span>{label}</span>
        <span className={styles.metricIndicator} aria-hidden="true" />
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
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
      <input
        defaultValue={value}
        disabled={disabled}
        name={name}
        type="number"
        {...props}
      />
      <small>{hint}</small>
    </label>
  );
}

function StatutoryOption({
  checked,
  disabled,
  label,
  name,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  name: string;
}) {
  return (
    <label className={styles.optionCard}>
      <input
        defaultChecked={checked}
        disabled={disabled}
        name={name}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function MoneyField({
  label,
  name,
  value,
  disabled,
}: {
  label: string;
  name: string;
  value: unknown;
  disabled: boolean;
}) {
  return (
    <label className={styles.moneyField}>
      <span>{label}</span>
      <span className={styles.moneyInput}>
        <span>RM</span>
        <input
          defaultValue={Number(value).toFixed(2)}
          disabled={disabled}
          min="0"
          name={name}
          step="0.01"
          type="number"
        />
      </span>
    </label>
  );
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(Number(value));
}

function formatMinutes(value: number) {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatShortMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatHours(minutes: number) {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function formatPayBasis(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatStatutoryStatus(value: string) {
  switch (value) {
    case "AUTO_CALCULATED":
      return "Auto-calculated";
    case "REVIEW_REQUIRED":
      return "Review required";
    case "MANUAL_OVERRIDE":
      return "Manual override";
    default:
      return "Not configured";
  }
}

function formatDateInput(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

type PayrollEntryRow = {
  id: string;
  membershipId: string;
  employeeCodeSnapshot: string;
  fullNameSnapshot: string;
  payBasisSnapshot: string;
  baseRateSnapshot: unknown;
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  basicPay: unknown;
  overtimePay: unknown;
  publicHolidayPay: unknown;
  allowances: unknown;
  otherDeductions: unknown;
  epfWageBase: unknown;
  perkesoWageBase: unknown;
  epfEmployee: unknown;
  socsoEmployee: unknown;
  eisEmployee: unknown;
  lindung24Employee: unknown;
  pcb: unknown;
  employerEpf: unknown;
  employerSocso: unknown;
  employerEis: unknown;
  grossPay: unknown;
  netPay: unknown;
  statutoryStatus: string;
  statutoryRuleVersion: string | null;
  statutoryWarning: string | null;
  notes: string | null;
  membership: {
    dateOfBirth: Date | null;
    statutoryNationality: string | null;
    epfEnabled: boolean;
    epfMemberBeforeAug1998: boolean;
    socsoEnabled: boolean;
    socsoCategory: string | null;
    eisEnabled: boolean;
    eisPreviouslyContributed: boolean;
    lindung24OptIn: boolean;
  };
};
