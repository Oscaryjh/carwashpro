import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveBranchHolidays } from "@/lib/holidays/service";
import { prisma } from "@/lib/prisma";
import { addDays, dateValue, startOfIsoWeek } from "@/lib/roster/domain";
import { ensureRosterPeriod, getRosterManagerOverview, reconcileRosterExpectedDays } from "@/lib/roster/service";
import { resolveRosterWeek } from "@/lib/roster/employee-schedule-service";
import { listRosterShiftTemplates } from "@/lib/roster/shift-template-service";
import {
  copyPreviousRosterWeekAction,
  bulkRosterAssignmentAction,
  publishRosterMonthAction,
  publishRosterAction,
  saveRosterAssignmentAction,
} from "./actions";
import { RosterAssignmentFields } from "./roster-assignment-fields";
import { RosterToolDialog } from "./roster-tool-dialog";
import { DayRosterPanel } from "./day-roster-panel";
import { MonthlyRosterView, ShiftRosterView, StaffRosterView, StaffScheduleGridView } from "./roster-views";
import styles from "./roster.module.css";

type Props = {
  searchParams: Promise<{ assignDate?: string; assignMember?: string; branchId?: string; day?: string; staffId?: string; week?: string; view?: string; q?: string; type?: string; message?: string }>;
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
  const now = new Date();
  const localToday = localDate(now, business.timezone);
  const selectedDate = parseDate(params.week) ?? localToday;
  const selectedDay = parseDate(params.day);
  const view = params.view === "week" ? "week" : params.view === "staff" ? "staff" : params.view === "coverage" || params.view === "shift" ? "coverage" : "month";
  const weekStart = startOfIsoWeek(selectedDay ?? selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const range = view === "month" ? monthRange(selectedDate) : { from: weekStart, to: weekEnd };
  const canCreate = hasBusinessCapability(context.access, "CREATE_ROSTER");
  const canEdit = hasBusinessCapability(context.access, "EDIT_ROSTER");
  const canPublish = hasBusinessCapability(context.access, "PUBLISH_ROSTER");
  const canAmend = hasBusinessCapability(context.access, "AMEND_PUBLISHED_ROSTER");
  if (branchId && canCreate && (view !== "month" || selectedDay)) {
    await ensureRosterPeriod({
      context: { businessId: context.businessId, allowedBranchIds: scope.allowedBranchIds, actor: context.user },
      branchId,
      weekStart,
    });
  }
  const overview = branchId
    ? await getRosterManagerOverview({
        context: { businessId: context.businessId, allowedBranchIds: [branchId] },
        from: range.from,
        to: range.to,
      })
    : [];
  const period = overview.find((item) => dateValue(item.weekStart) === dateValue(weekStart));
  const allMembers = branchId ? await prisma.employeeBusinessMembership.findMany({
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
  const query = view === "coverage" ? "" : params.q?.trim().toLowerCase() ?? "";
  const members = query
    ? allMembers.filter((member) => `${member.fullName} ${member.employeeCode}`.toLowerCase().includes(query))
    : allMembers;
  const [leaveDays, holidays, shiftTemplates] = branchId ? await Promise.all([
    prisma.leaveRequestDay.findMany({
      where: {
        businessId: context.businessId,
        leaveDate: { gte: range.from, lte: range.to },
        leaveRequest: { branchId, status: "APPROVED" },
      },
      include: {
        membership: { select: { id: true, fullName: true } },
        leaveRequest: { select: { policyNameSnapshot: true } },
      },
      orderBy: [{ leaveDate: "asc" }, { membership: { fullName: "asc" } }],
    }),
    resolveBranchHolidays({
      businessId: context.businessId,
      branchId,
      from: range.from,
      to: range.to,
    }),
    listRosterShiftTemplates({
      context: { businessId: context.businessId, allowedBranchIds: scope.allowedBranchIds },
      branchId,
    }),
  ]) : [[], [], []];
  const reconciliation = branchId
    ? await reconcileRosterExpectedDays({
        context: { businessId: context.businessId, allowedBranchIds: [branchId] },
        from: range.from,
        to: range.to,
      })
    : { checked: 0, issues: [], consistent: true };
  const returnTo = `/team/roster?branchId=${encodeURIComponent(branchId ?? "")}&week=${dateValue(view === "month" ? selectedDate : weekStart)}&view=${view}${query ? `&q=${encodeURIComponent(query)}` : ""}${selectedDay ? `&day=${dateValue(selectedDay)}` : ""}${view === "staff" && params.staffId ? `&staffId=${encodeURIComponent(params.staffId)}` : ""}`;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visibleMemberIds = new Set(members.map((member) => member.id));
  const resolvedWeek = branchId && (view !== "month" || selectedDay) ? await resolveRosterWeek({ businessId: context.businessId, branchId, weekStart, database: prisma, overrides: period?.assignments ?? [] }) : null;
  const monthWeekData = branchId && view === "month"
    ? await Promise.all(monthWeekStarts(range.from, range.to).map(async (monthWeekStart) => {
        const monthPeriod = overview.find((item) => dateValue(item.weekStart) === dateValue(monthWeekStart));
        const resolution = await resolveRosterWeek({
          businessId: context.businessId,
          branchId,
          weekStart: monthWeekStart,
          database: prisma,
          overrides: monthPeriod?.assignments ?? [],
        });
        return { weekStart: monthWeekStart, period: monthPeriod, resolution };
      }))
    : [];
  const resolvedMonthAssignments = view === "month"
    ? monthWeekData.flatMap((item) => item.resolution.assignments).filter((assignment) => assignment.workDate >= range.from && assignment.workDate <= range.to)
    : null;
  const visibleAssignments = (resolvedWeek?.assignments ?? resolvedMonthAssignments ?? overview.flatMap((item) => item.assignments)).filter((item) => visibleMemberIds.has(item.membershipId));
  const visibleLeaves = leaveDays.filter((item) => visibleMemberIds.has(item.membershipId));
  const todayValue = dateValue(localToday);
  const dayOptions = days.map((day) => ({
    label: day.toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" }),
    value: dateValue(day),
  }));
  const employeeOptions = allMembers.map((item) => ({
    label: `${item.fullName} (${item.employeeCode})`,
    value: item.id,
  }));
  const defaultAssignmentMember = allMembers.some((member) => member.id === params.assignMember) ? params.assignMember : undefined;
  const defaultAssignmentDate = dayOptions.some((day) => day.value === params.assignDate) ? params.assignDate : undefined;
  const templateOptions = shiftTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    label: `${template.name} · ${minuteText(template.startMinute)}–${minuteText(template.endMinute)}${template.crossMidnight ? " next day" : ""}`,
    value: template.id,
    startTime: minuteText(template.startMinute),
    endTime: minuteText(template.endMinute),
    breakMinutes: template.breakMinutes,
    crossMidnight: template.crossMidnight,
    colorToken: template.colorToken,
    paidLabel: paidDuration(template),
  }));
  const latestPublication = period?.publications[0];
  const currentComparisonAssignments = resolvedWeek?.assignments ?? period?.assignments ?? [];
  const unpublishedChanges = period
    ? latestPublication
      ? rosterChangeCount(currentComparisonAssignments, latestPublication.assignments)
      : period.assignments.length
    : 0;
  const draftChanges = latestPublication
    ? changedComparableAssignments(currentComparisonAssignments, latestPublication.assignments)
    : period?.assignments ?? [];
  const requiresRetrospectiveReason = draftChanges.some((assignment) => {
    const workDate = dateValue(assignment.workDate);
    return workDate < todayValue || (workDate === todayValue && (!assignment.startAt || assignment.startAt <= now));
  });
  const memberNameById = new Map(allMembers.map((member) => [member.id, member.fullName]));
  const feedback = rosterFeedback(params.message, params.type === "error");
  const monthName = selectedDate.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthPublishedWeeks = monthWeekData.filter((item) => item.period?.publicationRevision && item.period.status === "PUBLISHED").length;
  const monthPendingWeeks = monthWeekData.length - monthPublishedWeeks;
  const monthPendingWeekData = monthWeekData.filter((item) => !(item.period?.publicationRevision && item.period.status === "PUBLISHED"));
  const monthEmptyWeeks = monthPendingWeekData.filter((item) => !item.resolution.assignments.length);
  const monthBlockedWeeks = monthPendingWeekData.filter((item) => item.resolution.attention.length || (item.period?.publicationRevision && item.period.status === "DRAFT" && !canAmend));
  const monthRequiresRetrospectiveReason = monthPendingWeekData.some((item) => {
    const latest = item.period?.publications[0];
    const changed = latest
      ? changedComparableAssignments(item.resolution.assignments, latest.assignments)
      : item.period?.assignments ?? [];
    return changed.some((assignment) => {
      const workDate = dateValue(assignment.workDate);
      return workDate < todayValue || (workDate === todayValue && (!assignment.startAt || assignment.startAt <= now));
    });
  });
  const monthPublicationFrom = monthWeekData[0]?.weekStart;
  const monthPublicationTo = monthWeekData.length ? addDays(monthWeekData.at(-1)!.weekStart, 6) : undefined;

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      {feedback ? <div className={`${styles.feedback} ${params.type === "error" ? styles.feedbackError : styles.feedbackSuccess}`} role="status"><span aria-hidden="true">{params.type === "error" ? "!" : "✓"}</span><div><strong>{feedback.title}</strong><small>{feedback.detail ?? (unpublishedChanges ? "Review and publish when you are ready." : "Your roster is up to date.")}</small>{feedback.actionHref ? <Link className={styles.feedbackAction} href={feedback.actionHref}>{feedback.actionLabel}</Link> : null}</div></div> : null}
      <nav aria-label="Roster views" className={styles.viewTabs}>
        <Link aria-current={view === "month" ? "page" : undefined} className={view === "month" ? styles.activeViewTab : undefined} href={href(branchId, selectedDate, "month", query)}><span aria-hidden="true" className={styles.viewTabIcon}>▦</span><span><strong>Month</strong><small>Calendar overview</small></span></Link>
        <Link aria-current={view === "week" ? "page" : undefined} className={view === "week" ? styles.activeViewTab : undefined} href={href(branchId, weekStart, "week", query)}><span aria-hidden="true" className={styles.viewTabIcon}>☷</span><span><strong>Week</strong><small>Team by day</small></span></Link>
        <Link aria-current={view === "staff" ? "page" : undefined} className={view === "staff" ? styles.activeViewTab : undefined} href={href(branchId, weekStart, "staff", query)}><span aria-hidden="true" className={styles.viewTabIcon}>◎</span><span><strong>Staff</strong><small>One employee&apos;s week</small></span></Link>
        <Link aria-current={view === "coverage" ? "page" : undefined} className={view === "coverage" ? styles.activeViewTab : undefined} href={href(branchId, weekStart, "coverage", query)}><span aria-hidden="true" className={styles.viewTabIcon}>☰</span><span><strong>Coverage</strong><small>Staff by shift</small></span></Link>
        <Link aria-label="Shift settings" href={`/team/roster/templates?branchId=${encodeURIComponent(branchId ?? "")}`}><span aria-hidden="true" className={styles.viewTabIcon}>⚙</span><span><strong>Shift settings</strong><small>Manage shifts</small></span></Link>
      </nav>

      <div aria-label="Roster controls" className={`${styles.toolbar} ${styles.periodToolbar}`}>
        <div aria-label={view === "month" ? "Month navigation" : "Week navigation"} className={styles.toolbarActions} role="navigation">
          <Link aria-label={view === "month" ? "Previous month" : "Previous week"} className={styles.periodArrow} href={href(branchId, view === "month" ? addMonths(selectedDate, -1) : addDays(weekStart, -7), view, query)}><span aria-hidden="true">‹</span></Link>
          <div className={styles.periodTitle}><strong>{view === "month" ? selectedDate.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }) : formatWeekRange(weekStart, weekEnd)}</strong><Link href={href(branchId, view === "month" ? localToday : startOfIsoWeek(localToday), view, query)}>{view === "month" ? "This month" : "This week"}</Link></div>
          <Link aria-label={view === "month" ? "Next month" : "Next week"} className={styles.periodArrow} href={href(branchId, view === "month" ? addMonths(selectedDate, 1) : addDays(weekStart, 7), view, query)}><span aria-hidden="true">›</span></Link>
        </div>
        <div className={styles.rosterControlActions}>
          {view !== "coverage" ? <details className={styles.rosterSearch} open={Boolean(query)}>
            <summary aria-label="Search staff"><span aria-hidden="true">⌕</span><span>{query ? "Search active" : "Search"}</span></summary>
            <form method="get"><input name="branchId" type="hidden" value={branchId} /><input name="week" type="hidden" value={dateValue(view === "month" ? selectedDate : weekStart)} /><input name="view" type="hidden" value={view} /><label><span>Find staff</span><input autoFocus={Boolean(query)} defaultValue={query} name="q" placeholder="Name or employee code" /></label><div><button type="submit">Search</button>{query ? <Link className="secondary-light-button" href={href(branchId, view === "month" ? selectedDate : weekStart, view, "")}>Clear</Link> : null}</div></form>
          </details> : null}
        </div>
      </div>

      {view === "month" && branchId && canPublish ? <section aria-label={`${monthName} publication`} className={styles.monthPublishCard}>
        <div className={styles.monthPublishSummary}>
          <span aria-hidden="true" className={monthPendingWeeks ? styles.monthPublishPendingIcon : styles.monthPublishCompleteIcon}>{monthPendingWeeks ? monthPendingWeeks : "✓"}</span>
          <div>
            <strong>{monthPendingWeeks ? `${monthPendingWeeks} weekly version${monthPendingWeeks === 1 ? "" : "s"} remaining for ${monthName}` : `${monthName} roster is published`}</strong>
            <span>{monthPublishedWeeks} of {monthWeekData.length} weeks published · Staff App and Attendance update together</span>
          </div>
        </div>
        {monthPendingWeeks ? <details className={styles.monthPublishPanel}>
          <summary>Publish {monthName}</summary>
          <div>
            <h3>Publish the full month</h3>
            <p>One action creates {monthPendingWeeks} remaining weekly roster version{monthPendingWeeks === 1 ? "" : "s"}. Weekly versions keep later changes and Attendance evidence traceable.</p>
            {monthPublicationFrom && monthPublicationTo && (monthPublicationFrom < range.from || monthPublicationTo > range.to) ? <p className={styles.monthBoundaryNote}><strong>Calendar edge weeks:</strong> this batch covers {formatWeekRange(monthPublicationFrom, monthPublicationTo)} so the first and last weeks stay complete.</p> : null}
            {monthBlockedWeeks.length ? <div className={styles.monthPublishBlocker} role="status"><strong>{monthBlockedWeeks.length} week{monthBlockedWeeks.length === 1 ? "" : "s"} need attention</strong><ul>{monthBlockedWeeks.map((item) => <li key={dateValue(item.weekStart)}><span>{formatWeekRange(item.weekStart, addDays(item.weekStart, 6))}</span><small>{monthBlockerReason(item, canAmend)}</small></li>)}</ul></div> : null}
            <form action={publishRosterMonthAction} className={styles.monthPublishForm}>
              <input name="branchId" type="hidden" value={branchId} />
              <input name="month" type="hidden" value={dateValue(selectedDate).slice(0, 7)} />
              <input name="operationKey" type="hidden" value={`roster-month-${branchId}-${dateValue(selectedDate).slice(0, 7)}-${randomUUID()}`} />
              <input name="returnTo" type="hidden" value={returnTo} />
              {monthEmptyWeeks.length ? <fieldset className={styles.monthEmptyConfirmation}>
                <legend>{monthEmptyWeeks.length} week{monthEmptyWeeks.length === 1 ? " has" : "s have"} no shifts</legend>
                <p>Confirm only when nobody is scheduled to work. These weeks will be published as intentionally empty.</p>
                {monthEmptyWeeks.map((item) => <label key={dateValue(item.weekStart)}>
                  <input name="confirmEmptyWeek" required type="checkbox" value={dateValue(item.weekStart)} />
                  <span><strong>{formatWeekRange(item.weekStart, addDays(item.weekStart, 6))}</strong><small>Confirm no employee shifts</small></span>
                </label>)}
              </fieldset> : null}
              {monthRequiresRetrospectiveReason ? <label><span>Reason for past schedule corrections *</span><small>Only required because this month contains unpublished changes to dates that have already started.</small><input maxLength={500} minLength={3} name="reason" placeholder="e.g. Approved roster correction" required /></label> : null}
              <button disabled={Boolean(monthBlockedWeeks.length) || !monthWeekData.length} type="submit">{monthEmptyWeeks.length ? "Confirm & publish" : "Publish"} {monthName}</button>
            </form>
          </div>
        </details> : <span className={styles.monthPublishedBadge}>Published</span>}
      </section> : null}

      {(view !== "month" || selectedDay) && unpublishedChanges ? <section aria-label="Draft and publishing" className={`${styles.publishBar} ${styles.publishBarDirty}`}>
        <div className={styles.publishStatus}>
          <span aria-hidden="true" className={styles.publishStatusIcon}>{unpublishedChanges || "✓"}</span>
          <div><strong>{unpublishedChanges ? `${unpublishedChanges} change${unpublishedChanges === 1 ? "" : "s"} ready to publish` : latestPublication ? "Roster published" : "Default schedules are active"}</strong><span>{unpublishedChanges ? "Review the Draft, then publish it to Staff App and Attendance." : latestPublication ? `Last published ${formatDateTime(latestPublication.publishedAt, business.timezone)}` : "Employees follow their effective default schedules until you add a weekly change."}</span></div>
        </div>
        <div className={styles.publishBarActions}>
          <div className={styles.publishSecondaryActions}>
            {canCreate && branchId && !period?.assignments.length ? <form action={copyPreviousRosterWeekAction}><input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="returnTo" type="hidden" value={returnTo} /><button className="secondary-light-button" type="submit">Copy previous week</button></form> : null}
            {canCreate && canEdit && resolvedWeek?.attention.length ? <a className="secondary-light-button" href="#rest-days">Assign Rest Days</a> : null}
            {period && unpublishedChanges ? <details className={styles.reviewPopover}><summary>Review {unpublishedChanges} change{unpublishedChanges === 1 ? "" : "s"}</summary><div><h3>Draft changes</h3>{changeRows(currentComparisonAssignments, latestPublication?.assignments ?? [], business.timezone, memberNameById).map((row) => <p key={row.key}><strong>{row.employee}</strong><span>{row.date}</span><small>{row.before} → {row.after}</small></p>)}</div></details> : null}
          </div>
          {canPublish && period && (period.publicationRevision === 0 || canAmend) ? <form action={publishRosterAction} className={styles.publishForm}><input name="rosterPeriodId" type="hidden" value={period.id} /><input name="expectedDraftRevision" type="hidden" value={period.draftRevision} /><input name="operationKey" type="hidden" value={`roster-publish-${period.id}-${period.draftRevision}-${randomUUID()}`} /><input name="returnTo" type="hidden" value={returnTo} />{requiresRetrospectiveReason ? <label><span>Reason for changing a past or already-started date *</span><small>Required because this Draft changes schedule evidence that has already started.</small><input maxLength={500} minLength={3} name="reason" placeholder="e.g. Approved schedule correction" required /></label> : null}<button disabled={!resolvedWeek?.assignments.length || Boolean(resolvedWeek.attention.length) || !unpublishedChanges} type="submit">Publish to Staff App</button></form> : null}
        </div>
      </section> : null}
      {resolvedWeek?.attention.length ? <section className={styles.rosterAttention} role="alert"><div><strong>Roster requires attention</strong><p>Variable Rest Day requirements must be assigned before Publish.</p></div><ul>{resolvedWeek.attention.map((item) => <li key={item.membershipId}><strong>{item.employeeName}</strong><span>{item.assigned} of {item.required} Rest Days assigned</span></li>)}</ul></section> : null}

      {canEdit && branchId && period && resolvedWeek?.attention.length ? <section className={`settings-card ${styles.restDayWorkspace}`} id="rest-days"><div className={styles.libraryHeading}><div><span className={styles.sectionKicker}>THIS WEEK REST DAYS</span><h2>Complete variable Rest Day schedules</h2></div><p>Choose only the missing Rest Days. Other days continue to inherit each employee&apos;s Default Shift.</p></div>{resolvedWeek.attention.map((item) => <article key={item.membershipId}><div><strong>{item.employeeName}</strong><small>{item.required - item.assigned} more Rest Day{item.required - item.assigned === 1 ? "" : "s"} required</small></div><div className={styles.restDayChoices}>{days.map((day) => { const dayKey = dateValue(day); const hasLeave = visibleLeaves.some((leave) => leave.membershipId === item.membershipId && dateValue(leave.leaveDate) === dayKey); return <form action={saveRosterAssignmentAction} key={dayKey}><input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="expectedDraftRevision" type="hidden" value={period.draftRevision} /><input name="returnTo" type="hidden" value={returnTo} /><input name="membershipId" type="hidden" value={item.membershipId} /><input name="workDate" type="hidden" value={dayKey} /><input name="kind" type="hidden" value="REST_DAY" /><input name="startTime" type="hidden" value="09:00" /><input name="endTime" type="hidden" value="18:00" /><input name="breakMinutes" type="hidden" value="0" /><button disabled={hasLeave} title={hasLeave ? "Approved Leave already controls this date" : `Set ${dayKey} as Rest Day`} type="submit"><strong>{day.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })}</strong><small>{day.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" })}{hasLeave ? " · Leave" : ""}</small></button></form>; })}</div></article>)}</section> : null}

      <section className={`settings-card ${styles.scheduleCard} ${view === "month" ? styles.monthScheduleCard : ""}`}>
        {view !== "month" && view !== "coverage" ? <div className={styles.scheduleHeading}>
          <div><span className={styles.sectionKicker}>{view === "staff" ? "STAFF VIEW" : "WEEKLY ROSTER"}</span><h2>{formatWeekRange(weekStart, weekEnd)}</h2></div>
          {latestPublication || !reconciliation.consistent ? <details aria-label="Roster publication details" className={`${styles.publicationStatus} ${!reconciliation.consistent ? styles.publicationStatusWarning : ""}`}>
            <summary><span aria-hidden="true" className={styles.publicationStatusDot} /><span>{reconciliation.consistent ? "Published" : "Needs attention"}</span><span aria-hidden="true" className={styles.publicationStatusChevron}>⌄</span></summary>
            <div className={styles.publicationStatusPanel}>
              <strong>Roster publication</strong>
              {latestPublication ? <p><span>Last published</span><strong>{formatDateTime(latestPublication.publishedAt, business.timezone)}</strong></p> : <p><span>Publication</span><strong>Not published yet</strong></p>}
              <dl>
                <div><dt>Draft</dt><dd>v{period?.draftRevision ?? 0}</dd></div>
                <div><dt>Published</dt><dd>v{period?.publicationRevision ?? 0}</dd></div>
                <div><dt>Attendance evidence</dt><dd>{reconciliation.consistent ? "Synced" : `${reconciliation.issues.length} issue(s)`}</dd></div>
              </dl>
            </div>
          </details> : null}
        </div> : null}
        {view !== "month" && view !== "coverage" ? <p className={styles.guidance}><strong>Normal schedules are already shown.</strong><span>Select a day only to use a different shift, Rest Day or Not Scheduled. Weekly changes take effect after publishing.</span></p> : null}
        {view === "month" ? <MonthlyRosterView assignments={visibleAssignments} dayHrefBase={href(branchId, selectedDate, "month", query)} holidays={holidays} leaves={visibleLeaves} month={selectedDate} todayValue={todayValue} /> : view === "coverage" ? <ShiftRosterView assignments={visibleAssignments} days={days} holidays={holidays} leaves={visibleLeaves} timezone={business.timezone} todayValue={todayValue} /> : view === "staff" && branchId ? <StaffScheduleGridView assignments={visibleAssignments} branchId={branchId} canEdit={canEdit} days={days} draftRevision={period?.draftRevision ?? 0} holidays={holidays} leaves={visibleLeaves} members={members} returnTo={returnTo} selectedMemberId={params.staffId} shiftTemplates={templateOptions} timezone={business.timezone} todayValue={todayValue} unresolvedDays={resolvedWeek?.unresolvedDays ?? []} weekStart={dateValue(weekStart)} /> : branchId ? <StaffRosterView assignments={visibleAssignments} attention={resolvedWeek?.attention ?? []} branchId={branchId} canEdit={canEdit} days={days} draftRevision={period?.draftRevision ?? 0} holidays={holidays} leaves={visibleLeaves} members={members} returnTo={returnTo} shiftTemplates={templateOptions} timezone={business.timezone} todayValue={todayValue} unresolvedDays={resolvedWeek?.unresolvedDays ?? []} weekStart={dateValue(weekStart)} /> : null}
      </section>

      {view === "month" && selectedDay && branchId && period && resolvedWeek ? <DayRosterPanel assignments={resolvedWeek.assignments.filter((item) => dateValue(item.workDate) === dateValue(selectedDay))} branchId={branchId} canEdit={canEdit} closeHref={href(branchId, selectedDate, "month", query)} customReturnTo={href(branchId, selectedDay, "month", query)} date={dateValue(selectedDay)} dateLabel={selectedDay.toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })} draftRevision={period.draftRevision} holidays={holidays.filter((item) => dateValue(item.workDate) === dateValue(selectedDay))} leaves={visibleLeaves.filter((item) => dateValue(item.leaveDate) === dateValue(selectedDay))} members={members} returnTo={returnTo} shiftTemplates={templateOptions} timezone={business.timezone} weekStart={dateValue(weekStart)} /> : null}

      {(view !== "month" || defaultAssignmentMember || defaultAssignmentDate) && canCreate && canEdit && branchId ? <section aria-label="Roster tools" className={styles.editorShortcuts}>
        <header className={styles.editorShortcutHeading}>
          <div><span className={styles.sectionKicker}>SCHEDULING TOOLS</span><h2>Choose one action</h2></div>
          <p>Change one employee&apos;s schedule, or apply the same schedule to several employees.</p>
        </header>
        <div className={styles.editorToolList}>
        <RosterToolDialog badge="1" defaultOpen={Boolean(defaultAssignmentMember || defaultAssignmentDate)} description="Change one employee on one day" title="Custom shift">
        <form action={saveRosterAssignmentAction} className={styles.editor} id="roster-editor">
          <input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="expectedDraftRevision" type="hidden" value={period?.draftRevision ?? 0} /><input name="returnTo" type="hidden" value={returnTo} />
          <RosterAssignmentFields days={dayOptions} defaultDate={defaultAssignmentDate} defaultEmployee={defaultAssignmentMember} employees={employeeOptions} templates={templateOptions} />
          <div className={styles.editorActions}><button type="submit">Save change to Draft</button></div>
        </form>
        </RosterToolDialog>

        <RosterToolDialog badge="2" description="Apply one schedule to several employees on the same day" title="Bulk assign">
          <form action={bulkRosterAssignmentAction} className={styles.editor} id="bulk-assign"><input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="expectedDraftRevision" type="hidden" value={period?.draftRevision ?? 0} /><input name="returnTo" type="hidden" value={returnTo} /><RosterAssignmentFields bulk days={dayOptions} employees={employeeOptions} templates={templateOptions} /><div className={styles.editorActions}><button type="submit">Save bulk assignment to Draft</button></div></form>
        </RosterToolDialog>
        </div>
        {!period?.assignments.length ? <details className={styles.copyWeekAction}><summary>Copy previous week&apos;s changes</summary><form action={copyPreviousRosterWeekAction}><input name="branchId" type="hidden" value={branchId} /><input name="weekStart" type="hidden" value={dateValue(weekStart)} /><input name="returnTo" type="hidden" value={returnTo} /><p>Use this only when last week&apos;s exceptions are still relevant.</p><button className="secondary-light-button" type="submit">Copy changes</button></form></details> : null}
      </section> : null}

    </section>
  );
}

function localDate(now: Date, timezone: string) {
  const value = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${value}T00:00:00.000Z`);
}
function parseDate(value?: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null; }
function monthRange(value: Date) { return { from: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)), to: new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)) }; }
function monthWeekStarts(from: Date, to: Date) {
  const starts: Date[] = [];
  for (let week = startOfIsoWeek(from); week <= startOfIsoWeek(to); week = addDays(week, 7)) starts.push(week);
  return starts;
}
function href(branchId: string | undefined, date: Date, view: string, query = "") { return `/team/roster?branchId=${encodeURIComponent(branchId ?? "")}&week=${dateValue(date)}&view=${view}${query ? `&q=${encodeURIComponent(query)}` : ""}`; }
function addMonths(value: Date, months: number) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1)); }
function minuteText(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; }
function formatWeekRange(from: Date, to: Date) {
  const fromLabel = from.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
  const toLabel = to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${fromLabel} – ${toLabel}`;
}
function monthBlockerReason(item: { period?: { publicationRevision: number; status: string } | null; resolution: { assignments: unknown[]; attention: { employeeName: string }[] } }, canAmend: boolean) {
  if (!item.resolution.assignments.length) return "No employee schedules are available.";
  if (item.resolution.attention.length) return `Rest Days incomplete for ${item.resolution.attention.map((attention) => attention.employeeName).join(", ")}.`;
  if (item.period?.publicationRevision && item.period.status === "DRAFT" && !canAmend) return "Published week has new changes; amendment access is required.";
  return "Review this week before publishing.";
}
function paidDuration(template: { startMinute: number; endMinute: number; crossMidnight: boolean; breakMinutes: number; breakPaid: boolean }) {
  const minutes = Math.max(0, template.endMinute + (template.crossMidnight ? 1440 : 0) - template.startMinute - (template.breakPaid ? 0 : template.breakMinutes));
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}
function formatDateTime(value: Date, timezone: string) {
  return value.toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone });
}
type ComparableAssignment = { membershipId: string; workDate: Date; kind: string; startAt: Date | null; endAt: Date | null; breakMinutes: number; shiftNameSnapshot: string | null };
function assignmentKey(item: ComparableAssignment) { return `${item.membershipId}:${dateValue(item.workDate)}`; }
function assignmentSignature(item: ComparableAssignment) { return JSON.stringify([item.kind, item.startAt?.toISOString() ?? null, item.endAt?.toISOString() ?? null, item.breakMinutes, item.shiftNameSnapshot]); }
function changedComparableAssignments(current: ComparableAssignment[], published: ComparableAssignment[]) {
  const before = new Map(published.map((item) => [assignmentKey(item), item]));
  const after = new Map(current.map((item) => [assignmentKey(item), item]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((key) => {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous && next && assignmentSignature(previous) === assignmentSignature(next)) return [];
    return [next ?? previous!];
  });
}
function rosterChangeCount(current: ComparableAssignment[], published: ComparableAssignment[]) {
  return changedComparableAssignments(current, published).length;
}
function changeRows(current: ComparableAssignment[], published: ComparableAssignment[], timezone: string, memberNames: Map<string, string>) {
  const before = new Map(published.map((item) => [assignmentKey(item), item]));
  const after = new Map(current.map((item) => [assignmentKey(item), item]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((key) => {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous && next && assignmentSignature(previous) === assignmentSignature(next)) return [];
    const item = next ?? previous!;
    return [{ key, employee: memberNames.get(item.membershipId) ?? "Employee", date: item.workDate.toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), before: previous ? assignmentLabel(previous, timezone) : "Unassigned", after: next ? assignmentLabel(next, timezone) : "Unassigned" }];
  });
}
function assignmentLabel(item: ComparableAssignment, timezone: string) {
  if (item.kind === "REST_DAY") return "Rest Day";
  if (item.kind === "NOT_SCHEDULED") return "Off";
  const time = item.startAt && item.endAt ? `${item.startAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone })}–${item.endAt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone })}` : "";
  return `${item.shiftNameSnapshot ?? "Custom shift"}${time ? ` ${time}` : ""}`;
}
function rosterFeedback(message?: string, isError = false) {
  if (!message) return null;
  const lockedTimesheet = message.match(/The (\d{4}-\d{2}) Timesheet is locked/i)?.[1];
  if (lockedTimesheet) {
    const publishedWeeks = Number(message.match(/^(\d+) weeks? published\./i)?.[1] ?? 0);
    const timesheetMonth = new Date(`${lockedTimesheet}-01T00:00:00.000Z`).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
    return {
      title: publishedWeeks ? `${publishedWeeks} weeks published; remaining weeks paused` : "Roster month could not be published",
      detail: `${timesheetMonth} timesheet is locked. Reopen it, then publish the remaining weeks.`,
      actionHref: `/team/attendance/timesheets?month=${lockedTimesheet}`,
      actionLabel: "Open monthly timesheet",
    };
  }
  if (/assignment (saved|updated)|draft assignment saved/i.test(message)) return { title: "Schedule change saved." };
  if (/assignment (removed|reset)|normal schedule/i.test(message)) return { title: "Normal schedule restored." };
  if (/published/i.test(message) && !isError) return { title: "Roster published to Staff App and Attendance." };
  if (/copied/i.test(message)) return { title: "Previous week changes copied." };
  return { title: message, detail: isError ? "Review the message and try again." : undefined };
}
