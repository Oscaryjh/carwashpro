import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { addDays, dateValue, startOfIsoWeek } from "@/lib/roster/domain";
import { getRosterManagerOverview, reconcileRosterExpectedDays } from "@/lib/roster/service";
import {
  copyPreviousRosterWeekAction,
  bulkRosterAssignmentAction,
  publishRosterAction,
  removeRosterAssignmentAction,
  saveRosterAssignmentAction,
} from "./actions";
import styles from "./roster.module.css";

type Props = {
  searchParams: Promise<{ branchId?: string; week?: string; view?: string; type?: string; message?: string }>;
};

export const dynamic = "force-dynamic";

export default async function RosterPage({ searchParams }: Props) {
  const context = await requireBusinessUser("VIEW_ROSTER");
  const [params, scope, business] = await Promise.all([
    searchParams,
    resolveAttendanceScope(context.access),
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } }),
  ]);
  const branches = await prisma.branch.findMany({
    where: { businessId: context.businessId, id: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const branchId = branches.some((item) => item.id === params.branchId) ? params.branchId! : branches[0]?.id;
  const localToday = localDate(new Date(), business.timezone);
  const selectedDate = parseDate(params.week) ?? localToday;
  const weekStart = startOfIsoWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const view = params.view === "month" ? "month" : "week";
  const range = view === "month" ? monthRange(selectedDate) : { from: weekStart, to: weekEnd };
  const overview = branchId
    ? await getRosterManagerOverview({
        context: { businessId: context.businessId, allowedBranchIds: [branchId] },
        from: range.from,
        to: range.to,
      })
    : [];
  const period = overview.find((item) => dateValue(item.weekStart) === dateValue(weekStart));
  const members = branchId ? await prisma.employeeBusinessMembership.findMany({
    where: {
      businessId: context.businessId,
      status: "ACTIVE",
      joinedAt: { lt: addDays(weekEnd, 1) },
      OR: [{ terminatedAt: null }, { terminatedAt: { gte: weekStart } }],
      branchAssignments: {
        some: {
          branchId,
          businessId: context.businessId,
          status: "ACTIVE",
          effectiveFrom: { lt: addDays(weekEnd, 1) },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: weekStart } }],
        },
      },
    },
    select: { id: true, fullName: true, employeeCode: true },
    orderBy: { fullName: "asc" },
  }) : [];
  const reconciliation = branchId
    ? await reconcileRosterExpectedDays({
        context: { businessId: context.businessId, allowedBranchIds: [branchId] },
        from: range.from,
        to: range.to,
      })
    : { checked: 0, issues: [], consistent: true };
  const canCreate = hasBusinessCapability(context.access, "CREATE_ROSTER");
  const canEdit = hasBusinessCapability(context.access, "EDIT_ROSTER");
  const canPublish = hasBusinessCapability(context.access, "PUBLISH_ROSTER");
  const canAmend = hasBusinessCapability(context.access, "AMEND_PUBLISHED_ROSTER");
  const returnTo = `/team/roster?branchId=${encodeURIComponent(branchId ?? "")}&week=${dateValue(weekStart)}&view=${view}`;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const assignments = new Map(period?.assignments.map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]));

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      <header className="page-header hr-module-header">
        <div><span className="hr-module-eyebrow">HR · SCHEDULING EVIDENCE</span><h1>Roster</h1><p>Plan expected work. Attendance remains the source of actual punches and Timesheet remains the approved result.</p></div>
        <div className="hr-module-actions"><Link className="secondary-light-button" href="/team/attendance">Attendance</Link><Link className="secondary-light-button" href="/team/leave">Leave</Link></div>
      </header>

      {params.message ? <p className={params.type === "error" ? styles.warning : undefined} role="status"><strong>{params.message}</strong></p> : null}
      <div className={styles.toolbar}>
        <form method="get">
          <label><span>Branch</span><select defaultValue={branchId} name="branchId">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label><span>Week</span><input defaultValue={dateValue(weekStart)} name="week" type="date" /></label>
          <input name="view" type="hidden" value={view} />
          <button type="submit">Open</button>
        </form>
        <div className={styles.toolbarActions}>
          <Link className="secondary-button" href={href(branchId, addDays(weekStart, -7), view)}>Previous</Link>
          <Link className="secondary-button" href={href(branchId, startOfIsoWeek(localToday), "week")}>Current week</Link>
          <Link className="secondary-button" href={href(branchId, addDays(weekStart, 7), view)}>Next</Link>
          <Link className="secondary-button" href={href(branchId, selectedDate, view === "week" ? "month" : "week")}>{view === "week" ? "Monthly view" : "Weekly view"}</Link>
        </div>
      </div>

      {view === "month" ? (
        <section className="settings-card">
          <h2>{selectedDate.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" })} roster periods</h2>
          <div className={styles.monthGrid}>
            {overview.map((item) => <Link className={styles.monthCard} href={href(branchId, item.weekStart, "week")} key={item.id}><strong>Week of {dateValue(item.weekStart)}</strong><span>{item.assignments.length} assignments</span><span className={styles.badge}>{item.status} · Revision {item.publicationRevision}</span></Link>)}
            {!overview.length ? <p>No roster periods in this month. Blank dates remain unspecified, not Off Day.</p> : null}
          </div>
        </section>
      ) : (
        <>
          <section className="settings-card">
            <div className={styles.statusRow}>
              <h2>Week of {dateValue(weekStart)}</h2>
              <span className={styles.badge}>{period?.status ?? "NO DRAFT"}</span>
              <span className={styles.badge}>Draft revision {period?.draftRevision ?? 0}</span>
              <span className={styles.badge}>Published revision {period?.publicationRevision ?? 0}</span>
              <span className={styles.badge}>Reconciliation {reconciliation.consistent ? "PASS" : `${reconciliation.issues.length} issue(s)`}</span>
            </div>
            <p>Blank cells mean unspecified. They never become Rest Day, Not Scheduled or No-show evidence.</p>
            <div className={styles.matrixWrap}>
              <table className={styles.matrix}>
                <thead><tr><th>Employee</th>{days.map((day) => <th key={dateValue(day)}>{day.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}</th>)}</tr></thead>
                <tbody>
                  {members.map((member) => <tr key={member.id}><td><strong>{member.fullName}</strong><br /><small>{member.employeeCode}</small></td>{days.map((day) => {
                    const assignment = assignments.get(`${member.id}:${dateValue(day)}`);
                    return <td key={dateValue(day)}>{assignment ? <div className={styles.assignment}><strong>{label(assignment.kind)}</strong>{assignment.startAt && assignment.endAt ? <span>{time(assignment.startAt, business.timezone)}–{time(assignment.endAt, business.timezone)}</span> : null}{assignment.breakMinutes ? <small>{assignment.breakMinutes} min break</small> : null}{canEdit ? <form action={removeRosterAssignmentAction}><input name="assignmentId" type="hidden" value={assignment.id} /><input name="expectedDraftRevision" type="hidden" value={period?.draftRevision ?? 0} /><input name="returnTo" type="hidden" value={returnTo} /><button className="link-button" type="submit">Remove</button></form> : null}</div> : <small className={styles.muted}>No published assignment</small>}</td>;
                  })}</tr>)}
                  {!members.length ? <tr><td colSpan={8}>No active employees are assigned to this branch for this week.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          {canCreate && canEdit && branchId ? <form action={saveRosterAssignmentAction} className={`settings-card ${styles.editor}`}>
            <h2>Add or update Draft assignment</h2>
            <p>Phase 1 supports one assignment per employee/day. Overnight work is supported; choose an end time earlier than start to end next day.</p>
            <input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="expectedDraftRevision" type="hidden" value={period?.draftRevision ?? 0} /><input name="returnTo" type="hidden" value={returnTo} />
            <div className={styles.editorGrid}>
              <label><span>Employee</span><select name="membershipId" required>{members.map((item) => <option key={item.id} value={item.id}>{item.fullName} ({item.employeeCode})</option>)}</select></label>
              <label><span>Date</span><select name="workDate" required>{days.map((day) => <option key={dateValue(day)} value={dateValue(day)}>{day.toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" })}</option>)}</select></label>
              <label><span>Assignment</span><select defaultValue="WORK_SHIFT" name="kind"><option value="WORK_SHIFT">Work shift</option><option value="REST_DAY">Rest Day</option><option value="NOT_SCHEDULED">Not Scheduled / Off</option></select></label>
              <label><span>Break minutes</span><input defaultValue="60" max="720" min="0" name="breakMinutes" type="number" /></label>
              <label><span>Start</span><input defaultValue="09:00" name="startTime" type="time" /></label>
              <label><span>End</span><input defaultValue="18:00" name="endTime" type="time" /></label>
              <label><span>Note</span><input maxLength={500} name="note" placeholder="Optional operational note" /></label>
            </div>
            <div className={styles.editorActions}><button type="submit">Save Draft assignment</button></div>
          </form> : null}

          {canCreate && canEdit && branchId ? <form action={bulkRosterAssignmentAction} className={`settings-card ${styles.editor}`}>
            <h2>Bulk assignment</h2>
            <p>Select multiple employees to apply one explicit assignment to the same day. The command is atomic; it never auto-schedules.</p>
            <input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="expectedDraftRevision" type="hidden" value={period?.draftRevision ?? 0} /><input name="returnTo" type="hidden" value={returnTo} />
            <div className={styles.editorGrid}>
              <label><span>Employees</span><select multiple name="membershipIds" required size={Math.min(6, Math.max(2, members.length))}>{members.map((item) => <option key={item.id} value={item.id}>{item.fullName} ({item.employeeCode})</option>)}</select></label>
              <label><span>Date</span><select name="workDate" required>{days.map((day) => <option key={dateValue(day)} value={dateValue(day)}>{day.toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" })}</option>)}</select></label>
              <label><span>Assignment</span><select defaultValue="WORK_SHIFT" name="kind"><option value="WORK_SHIFT">Work shift</option><option value="REST_DAY">Rest Day</option><option value="NOT_SCHEDULED">Not Scheduled / Off</option></select></label>
              <label><span>Break minutes</span><input defaultValue="60" max="720" min="0" name="breakMinutes" type="number" /></label>
              <label><span>Start</span><input defaultValue="09:00" name="startTime" type="time" /></label>
              <label><span>End</span><input defaultValue="18:00" name="endTime" type="time" /></label>
              <label><span>Note</span><input maxLength={500} name="note" placeholder="Optional shared note" /></label>
            </div>
            <div className={styles.editorActions}><button type="submit">Save bulk Draft</button></div>
          </form> : null}

          <section className={`settings-card ${styles.publish}`}>
            <h2>Draft / Publish controls</h2>
            <p>Copy Week always creates Draft. Publish snapshots the complete branch week and versions AttendanceExpectedDay atomically.</p>
            <div className={styles.editorActions}>
              {canCreate && branchId && !period?.assignments.length ? <form action={copyPreviousRosterWeekAction}><input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="returnTo" type="hidden" value={returnTo} /><button className="secondary-button" type="submit">Copy previous published week</button></form> : null}
              {canPublish && period && (period.publicationRevision === 0 || canAmend) ? <form action={publishRosterAction}><input name="rosterPeriodId" type="hidden" value={period.id} /><input name="expectedDraftRevision" type="hidden" value={period.draftRevision} /><input name="operationKey" type="hidden" value={`roster-publish-${period.id}-${period.draftRevision}-${randomUUID()}`} /><input name="returnTo" type="hidden" value={returnTo} /><label><span>Reason (required for retrospective dates)</span><input maxLength={500} name="reason" placeholder="Publication or amendment reason" /></label><button type="submit">Publish roster revision</button></form> : null}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function localDate(now: Date, timezone: string) {
  const value = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${value}T00:00:00.000Z`);
}
function parseDate(value?: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null; }
function monthRange(value: Date) { return { from: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)), to: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)) }; }
function href(branchId: string | undefined, date: Date, view: string) { return `/team/roster?branchId=${encodeURIComponent(branchId ?? "")}&week=${dateValue(date)}&view=${view}`; }
function label(value: string) { return value === "WORK_SHIFT" ? "Work shift" : value === "REST_DAY" ? "Rest Day" : "Not Scheduled"; }
function time(value: Date, timezone: string) { return value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }); }
