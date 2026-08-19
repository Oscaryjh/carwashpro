import { addDays, dateValue } from "@/lib/roster/domain";
import Link from "next/link";
import { removeRosterAssignmentAction } from "./actions";
import { RosterQuickAssign } from "./roster-quick-assign";
import styles from "./roster.module.css";

type Member = { id: string; fullName: string; employeeCode: string };
type Assignment = {
  id: string;
  membershipId: string;
  workDate: Date;
  kind: "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
  shiftTemplateId: string | null;
  startAt: Date | null;
  endAt: Date | null;
  breakMinutes: number;
  breakPaidSnapshot?: boolean;
  shiftNameSnapshot: string | null;
  shiftColorSnapshot: string | null;
  sourceAssignmentId?: string | null;
  resolvedSource?: string;
  membership: Member;
};
type LeaveDay = { membershipId: string; leaveDate: Date; leaveRequest: { policyNameSnapshot: string }; membership: Pick<Member, "id" | "fullName"> };
type Holiday = { workDate: Date; name: string };
type UnresolvedDay = { membershipId: string; workDate: Date; reason: "BEFORE_SCHEDULE_START" | "NO_DEFAULT_SCHEDULE"; scheduleStartsAt: Date | null };
type RosterAttention = { membershipId: string; employeeName: string; required: number; assigned: number };
type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; paidLabel: string; colorToken: string };

export function StaffRosterView({ assignments, attention, branchId, canEdit, days, draftRevision, holidays, leaves, members, returnTo, shiftTemplates, timezone, todayValue, unresolvedDays, weekStart }: {
  assignments: Assignment[];
  attention: RosterAttention[];
  branchId: string;
  canEdit: boolean;
  days: Date[];
  draftRevision: number;
  holidays: Holiday[];
  leaves: LeaveDay[];
  members: Member[];
  returnTo: string;
  shiftTemplates: ShiftTemplate[];
  timezone: string;
  todayValue: string;
  unresolvedDays: UnresolvedDay[];
  weekStart: string;
}) {
  const assignmentMap = new Map(assignments.map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]));
  const leaveMap = new Map(leaves.map((item) => [`${item.membershipId}:${dateValue(item.leaveDate)}`, item]));
  const holidayMap = new Map(holidays.map((item) => [dateValue(item.workDate), item]));
  const unresolvedMap = new Map(unresolvedDays.map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]));
  const attentionIds = new Set(attention.map((item) => item.membershipId));

  const dayContent = (member: Member, day: Date) => {
    const dateKey = dateValue(day);
    const assignment = assignmentMap.get(`${member.id}:${dateKey}`);
    const leave = leaveMap.get(`${member.id}:${dateKey}`);
    const holiday = holidayMap.get(dateKey);
    const unresolved = unresolvedMap.get(`${member.id}:${dateKey}`);
    return <div className={styles.cellStack}>
      {holiday ? <span className={styles.holidayBadge}>PH · {holiday.name}</span> : null}
      {leave ? <LeaveBadge leave={leave} /> : assignment ? <>
        <AssignmentCard assignment={assignment} canEdit={canEdit} draftRevision={draftRevision} returnTo={returnTo} timezone={timezone} conflict={false} />
        {canEdit ? <RosterQuickAssign branchId={branchId} currentSource={assignment.resolvedSource} dateLabel={formatDate(day)} employeeName={member.fullName} existingAssignmentId={assignment.sourceAssignmentId} existingKind={assignment.kind} existingTemplateId={assignment.shiftTemplateId} expectedDraftRevision={draftRevision} membershipId={member.id} returnTo={returnTo} templates={shiftTemplates} weekStart={weekStart} workDate={dateKey} /> : null}
      </> : <>
        <span className={styles.unresolvedDay}><strong>{unresolved?.reason === "BEFORE_SCHEDULE_START" ? `Starts ${shortDate(unresolved.scheduleStartsAt)}` : "Unassigned"}</strong><small>{unresolved?.reason === "BEFORE_SCHEDULE_START" ? "Before normal schedule" : attentionIds.has(member.id) ? "Rest Day required" : "No normal schedule"}</small></span>
        {canEdit ? <RosterQuickAssign branchId={branchId} dateLabel={formatDate(day)} employeeName={member.fullName} expectedDraftRevision={draftRevision} membershipId={member.id} returnTo={returnTo} templates={shiftTemplates} weekStart={weekStart} workDate={dateKey} /> : null}
      </>}
    </div>;
  };

  return <>
    <div className={styles.matrixWrap}><table className={styles.matrix}>
      <thead><tr><th>Employee</th>{days.map((day) => <th key={dateValue(day)}>{day.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}{dateValue(day) === todayValue ? <small>Today</small> : null}</th>)}</tr></thead>
      <tbody>{members.map((member) => {
        const expectedMinutes = days.reduce((total, day) => total + paidMinutes(assignmentMap.get(`${member.id}:${dateValue(day)}`)), 0);
        return <tr key={member.id}><td><strong>{member.fullName}</strong><small>{member.employeeCode}</small><span className={styles.hoursBadge}>{duration(expectedMinutes)} scheduled</span>{attentionIds.has(member.id) ? <span className={styles.rowAttention}>Rest Day required</span> : null}</td>{days.map((day) => <td key={dateValue(day)}>{dayContent(member, day)}</td>)}</tr>;
      })}{!members.length ? <tr><td colSpan={8}>No employees match the selected branch and search.</td></tr> : null}</tbody>
    </table></div>
    <div className={styles.mobileRoster}>{members.map((member) => {
      const expectedMinutes = days.reduce((total, day) => total + paidMinutes(assignmentMap.get(`${member.id}:${dateValue(day)}`)), 0);
      return <article className={styles.mobileRosterCard} key={member.id}><header><div><strong>{member.fullName}</strong><small>{member.employeeCode}</small>{attentionIds.has(member.id) ? <span className={styles.rowAttention}>Rest Day required</span> : null}</div><span className={styles.hoursBadge}>{duration(expectedMinutes)} scheduled</span></header>{days.map((day) => <div className={styles.mobileRosterDay} key={dateValue(day)}><div><strong>{day.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}</strong>{dateValue(day) === todayValue ? <small>Today</small> : null}</div>{dayContent(member, day)}</div>)}</article>;
    })}{!members.length ? <p>No employees match the selected branch and search.</p> : null}</div>
  </>;
}

export function EmployeeRosterView({ assignments, branchId, canEdit, days, draftRevision, holidays, leaves, members, returnTo, selectedMemberId, shiftTemplates, timezone, todayValue, unresolvedDays, weekStart }: {
  assignments: Assignment[];
  branchId: string;
  canEdit: boolean;
  days: Date[];
  draftRevision: number;
  holidays: Holiday[];
  leaves: LeaveDay[];
  members: Member[];
  returnTo: string;
  selectedMemberId?: string;
  shiftTemplates: ShiftTemplate[];
  timezone: string;
  todayValue: string;
  unresolvedDays: UnresolvedDay[];
  weekStart: string;
}) {
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0];
  if (!selectedMember) return <div className={styles.emptyState}><strong>No employees found</strong><p>Choose another branch or clear the staff search.</p></div>;
  const assignmentMap = new Map(assignments.filter((item) => item.membershipId === selectedMember.id).map((item) => [dateValue(item.workDate), item]));
  const leaveMap = new Map(leaves.filter((item) => item.membershipId === selectedMember.id).map((item) => [dateValue(item.leaveDate), item]));
  const holidayMap = new Map(holidays.map((item) => [dateValue(item.workDate), item]));
  const unresolvedMap = new Map(unresolvedDays.filter((item) => item.membershipId === selectedMember.id).map((item) => [dateValue(item.workDate), item]));
  return <div className={styles.staffFocus}>
    <aside className={styles.staffPicker} aria-label="Choose employee">
      <strong>Staff</strong>
      {members.map((member) => <Link aria-current={member.id === selectedMember.id ? "page" : undefined} className={member.id === selectedMember.id ? styles.staffPickerActive : undefined} href={withStaff(returnTo, member.id)} key={member.id}><span>{initials(member.fullName)}</span><div><b>{member.fullName}</b><small>{member.employeeCode}</small></div></Link>)}
    </aside>
    <section className={styles.staffWeek}>
      <header><div><span className={styles.sectionKicker}>THIS WEEK</span><h3>{selectedMember.fullName}</h3></div><span className={styles.hoursBadge}>{duration(days.reduce((total, day) => total + paidMinutes(assignmentMap.get(dateValue(day))), 0))} scheduled</span></header>
      <div className={styles.staffWeekDays}>{days.map((day) => {
        const key = dateValue(day);
        const assignment = assignmentMap.get(key);
        const leave = leaveMap.get(key);
        const holiday = holidayMap.get(key);
        const unresolved = unresolvedMap.get(key);
        return <article key={key}>
          <div className={styles.staffWeekDate}><strong>{day.toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" })}</strong><small>{day.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}{key === todayValue ? " · Today" : ""}</small></div>
          <div className={styles.staffWeekSchedule}>{holiday ? <span className={styles.holidayBadge}>PH · {holiday.name}</span> : null}{leave ? <LeaveBadge leave={leave} /> : assignment ? <AssignmentCard assignment={assignment} canEdit={false} conflict={false} draftRevision={draftRevision} returnTo={returnTo} timezone={timezone} /> : <span className={styles.unresolvedDay}><strong>Not set</strong><small>{unresolved?.reason === "BEFORE_SCHEDULE_START" ? `Normal schedule starts ${shortDate(unresolved.scheduleStartsAt)}` : "Choose a shift for this date"}</small></span>}</div>
          {canEdit && !leave ? <RosterQuickAssign branchId={branchId} currentSource={assignment?.resolvedSource} dateLabel={formatDate(day)} employeeName={selectedMember.fullName} existingAssignmentId={assignment?.sourceAssignmentId} existingKind={assignment?.kind} existingTemplateId={assignment?.shiftTemplateId} expectedDraftRevision={draftRevision} membershipId={selectedMember.id} returnTo={returnTo} templates={shiftTemplates} weekStart={weekStart} workDate={key} /> : null}
        </article>;
      })}</div>
    </section>
  </div>;
}

function withStaff(returnTo: string, staffId: string) {
  return `${returnTo.replace(/&staffId=[^&]*/g, "")}&staffId=${encodeURIComponent(staffId)}`;
}

export function StaffScheduleGridView({ assignments, branchId, canEdit, days, draftRevision, holidays, leaves, members, returnTo, selectedMemberId, shiftTemplates, timezone, todayValue, unresolvedDays, weekStart }: {
  assignments: Assignment[];
  branchId: string;
  canEdit: boolean;
  days: Date[];
  draftRevision: number;
  holidays: Holiday[];
  leaves: LeaveDay[];
  members: Member[];
  returnTo: string;
  selectedMemberId?: string;
  shiftTemplates: ShiftTemplate[];
  timezone: string;
  todayValue: string;
  unresolvedDays: UnresolvedDay[];
  weekStart: string;
}) {
  if (!members.length) return <div className={styles.emptyState}><strong>No employees found</strong><p>Choose another branch or clear the staff search.</p></div>;
  const assignmentMap = new Map(assignments.map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]));
  const leaveMap = new Map(leaves.map((item) => [`${item.membershipId}:${dateValue(item.leaveDate)}`, item]));
  const holidayMap = new Map(holidays.map((item) => [dateValue(item.workDate), item]));
  const unresolvedMap = new Map(unresolvedDays.map((item) => [`${item.membershipId}:${dateValue(item.workDate)}`, item]));
  const selectedId = selectedMemberId && members.some((member) => member.id === selectedMemberId) ? selectedMemberId : undefined;

  return <div className={styles.staffScheduleWrap}>
    <table className={styles.staffScheduleGrid}>
      <thead><tr><th><span>Staff</span><small>{members.length} employee{members.length === 1 ? "" : "s"}</small></th>{days.map((day) => {
        const key = dateValue(day);
        return <th key={key}><span className={styles.staffScheduleDate}><span>{day.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })}</span><strong>{day.getUTCDate()}</strong></span>{key === todayValue ? <small>Today</small> : null}</th>;
      })}</tr></thead>
      <tbody>{members.map((member) => {
        const expectedMinutes = days.reduce((total, day) => total + paidMinutes(assignmentMap.get(`${member.id}:${dateValue(day)}`)), 0);
        return <tr className={member.id === selectedId ? styles.staffScheduleSelected : undefined} key={member.id}>
          <th scope="row"><span className={styles.staffAvatar}>{initials(member.fullName)}</span><span className={styles.staffIdentity}><strong>{member.fullName}</strong><small>{member.employeeCode}</small><em>{duration(expectedMinutes)} scheduled</em></span></th>
          {days.map((day) => {
            const key = dateValue(day);
            const mapKey = `${member.id}:${key}`;
            const assignment = assignmentMap.get(mapKey);
            const leave = leaveMap.get(mapKey);
            const holiday = holidayMap.get(key);
            const unresolved = unresolvedMap.get(mapKey);
            const label = assignment ? shiftLabel(assignment) : "";
            const sublabel = assignment?.startAt && assignment.endAt ? `${time(assignment.startAt, timezone)}–${time(assignment.endAt, timezone)}` : assignment ? sourceLabel(assignment.resolvedSource ?? "") : "";
            const triggerClass = `${styles.staffScheduleCellButton} ${staffScheduleColor(assignment)}`;
            return <td key={key}>
              {holiday ? <span className={styles.staffHoliday}>PH · {holiday.name}</span> : null}
              {leave ? <span className={`${styles.staffScheduleBlock} ${styles.staffScheduleLeave}`}><strong>{leave.leaveRequest.policyNameSnapshot}</strong><small>Approved leave</small></span> : canEdit ? <RosterQuickAssign branchId={branchId} currentSource={assignment?.resolvedSource} dateLabel={formatDate(day)} employeeName={member.fullName} existingAssignmentId={assignment?.sourceAssignmentId} existingKind={assignment?.kind} existingTemplateId={assignment?.shiftTemplateId} expectedDraftRevision={draftRevision} membershipId={member.id} returnTo={returnTo} templates={shiftTemplates} triggerClassName={triggerClass} triggerContent={assignment ? <><strong>{label}</strong>{sublabel ? <small>{sublabel}</small> : null}</> : <><span className={styles.staffScheduleAdd}>+</span><small>{unresolved?.reason === "BEFORE_SCHEDULE_START" ? `Starts ${shortDate(unresolved.scheduleStartsAt)}` : "Assign"}</small></>} weekStart={weekStart} workDate={key} /> : assignment ? <span className={`${styles.staffScheduleBlock} ${staffScheduleColor(assignment)}`}><strong>{label}</strong>{sublabel ? <small>{sublabel}</small> : null}</span> : null}
            </td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function staffScheduleColor(assignment?: Assignment) {
  if (!assignment) return styles.staffScheduleEmpty;
  if (assignment.kind === "REST_DAY") return styles.staffScheduleRest;
  if (assignment.kind === "NOT_SCHEDULED") return styles.staffScheduleOff;
  const color = assignment.shiftColorSnapshot ?? "TEAL";
  return ({ TEAL: styles.staffScheduleTEAL, BLUE: styles.staffScheduleBLUE, VIOLET: styles.staffScheduleVIOLET, AMBER: styles.staffScheduleAMBER, ROSE: styles.staffScheduleROSE, SLATE: styles.staffScheduleSLATE } as Record<string, string>)[color] ?? styles.staffScheduleTEAL;
}

type CoverageGroup = {
  category: "SHIFT" | "REST_DAY" | "NOT_SCHEDULED" | "LEAVE";
  color: string;
  label: string;
  people: Map<string, Array<{ code?: string; id: string; name: string }>>;
  sublabel: string;
};

export function ShiftRosterView({ assignments, days, holidays, leaves, timezone, todayValue }: { assignments: Assignment[]; days: Date[]; holidays: Holiday[]; leaves: LeaveDay[]; timezone: string; todayValue: string }) {
  const holidayMap = new Map(holidays.map((holiday) => [dateValue(holiday.workDate), holiday]));
  const groups = new Map<string, CoverageGroup>();
  for (const assignment of assignments) {
    const key = shiftKey(assignment, timezone);
    const group = groups.get(key) ?? {
      category: assignment.kind === "WORK_SHIFT" ? "SHIFT" : assignment.kind,
      color: assignment.kind === "REST_DAY" ? "VIOLET" : assignment.kind === "NOT_SCHEDULED" ? "SLATE" : assignment.shiftColorSnapshot ?? "TEAL",
      label: shiftLabel(assignment),
      people: new Map(),
      sublabel: shiftSublabel(assignment, timezone),
    };
    const day = dateValue(assignment.workDate);
    group.people.set(day, [...(group.people.get(day) ?? []), { code: assignment.membership.employeeCode, id: assignment.membership.id, name: assignment.membership.fullName }]);
    groups.set(key, group);
  }
  for (const leave of leaves) {
    const key = `LEAVE:${leave.leaveRequest.policyNameSnapshot}`;
    const group = groups.get(key) ?? { category: "LEAVE", label: leave.leaveRequest.policyNameSnapshot, sublabel: "Approved leave", color: "ROSE", people: new Map() };
    const day = dateValue(leave.leaveDate);
    group.people.set(day, [...(group.people.get(day) ?? []), { id: leave.membership.id, name: leave.membership.fullName }]);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.entries()].sort(([, left], [, right]) => {
    const categoryOrder = { SHIFT: 0, REST_DAY: 1, NOT_SCHEDULED: 2, LEAVE: 3 };
    return categoryOrder[left.category] - categoryOrder[right.category]
      || left.sublabel.localeCompare(right.sublabel)
      || left.label.localeCompare(right.label);
  });
  const workingGroups = sortedGroups.filter(([, group]) => group.category === "SHIFT");
  const statusGroups = sortedGroups.filter(([, group]) => group.category !== "SHIFT");
  return <>
    <section className={styles.coverageBoard}>
      <header className={styles.coverageBoardHeader}>
        <div><span className={styles.sectionKicker}>TEAM COVERAGE</span><h3>Who is scheduled for each shift?</h3><p>Read across each row to compare staffing through the week.</p></div>
        <div className={styles.coverageLegend} aria-label="Coverage legend"><span><i className={`${styles.colorDot} ${styles.colorTEAL}`} />Working shifts</span><span><i className={`${styles.colorDot} ${styles.colorVIOLET}`} />Rest and availability</span><span><i className={`${styles.colorDot} ${styles.colorROSE}`} />Approved leave</span></div>
      </header>
      {holidays.length ? <div className={styles.coverageHolidayStrip} aria-label="Public holidays in this week">{holidays.map((holiday) => <span key={`${dateValue(holiday.workDate)}-${holiday.name}`}><strong>{holiday.workDate.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}</strong><small>Public holiday · {holiday.name}</small></span>)}</div> : null}
      <div className={`${styles.matrixWrap} ${styles.coverageTableWrap}`}><table className={styles.coverageTable}>
        <thead><tr><th>Shift</th>{days.map((day) => { const key = dateValue(day); return <th key={key}><span>{day.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })}</span><strong>{day.getUTCDate()}</strong>{key === todayValue ? <small>Today</small> : null}</th>; })}</tr></thead>
        <tbody>
          {workingGroups.map(([key, group]) => <CoverageRow days={days} group={group} key={key} />)}
          {workingGroups.length && statusGroups.length ? <tr className={styles.coverageSectionRow}><th colSpan={8}>Rest, availability and leave</th></tr> : null}
          {statusGroups.map(([key, group]) => <CoverageRow days={days} group={group} key={key} />)}
          {!groups.size ? <tr><td className={styles.coverageEmpty} colSpan={8}><strong>No coverage to show yet</strong><span>Assign a normal shift or weekly change to see staff coverage here.</span></td></tr> : null}
        </tbody>
      </table></div>
    </section>
    <div className={styles.mobileRoster}>{days.map((day) => {
      const dayKey = dateValue(day);
      const staffedGroups = sortedGroups.map(([key, group]) => ({ key, group, people: group.people.get(dayKey) ?? [] })).filter((item) => item.people.length);
      const holiday = holidayMap.get(dayKey);
      return <article className={styles.mobileRosterCard} key={dayKey}><header><div><strong>{day.toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" })}</strong>{dayKey === todayValue ? <small>Today</small> : null}</div><span className={styles.hoursBadge}>{staffedGroups.reduce((total, item) => total + item.people.length, 0)} scheduled</span></header>{holiday ? <span className={styles.holidayBadge}>Public holiday · {holiday.name}</span> : null}{staffedGroups.map(({ group, key, people }) => <div className={styles.mobileShiftGroup} key={key}><div><span className={`${styles.colorDot} ${styles[`color${group.color}`]}`} /><strong>{group.label}</strong><small>{group.sublabel}</small></div><div className={styles.coveragePeople}>{people.sort((a, b) => a.name.localeCompare(b.name)).map((person) => <CoveragePerson key={`${key}-${dayKey}-${person.id}`} person={person} />)}</div></div>)}{!staffedGroups.length ? <p className={styles.muted}>No one is scheduled for this day.</p> : null}</article>;
    })}</div>
  </>;
}

function CoverageRow({ days, group }: { days: Date[]; group: CoverageGroup }) {
  const total = [...group.people.values()].reduce((sum, people) => sum + people.length, 0);
  return <tr className={`${styles.coverageRow} ${styles[`coverage${group.category}`]}`}>
    <th scope="row"><span className={`${styles.coverageShiftColor} ${styles[`color${group.color}`]}`} aria-hidden="true" /><span><strong>{group.label}</strong><small>{group.sublabel}</small></span><em>{total} scheduled</em></th>
    {days.map((day) => {
      const dayKey = dateValue(day);
      const people = (group.people.get(dayKey) ?? []).sort((left, right) => left.name.localeCompare(right.name));
      return <td key={dayKey}>{people.length ? <div className={styles.coveragePeople}>{people.map((person) => <CoveragePerson key={`${dayKey}-${person.id}`} person={person} />)}</div> : <span className={styles.coverageNoStaff}>No staff</span>}</td>;
    })}
  </tr>;
}

function CoveragePerson({ person }: { person: { code?: string; id: string; name: string } }) {
  return <span className={styles.coveragePerson}><i aria-hidden="true">{initials(person.name)}</i><span><strong>{person.name}</strong>{person.code ? <small>{person.code}</small> : null}</span></span>;
}

export function MonthlyRosterView({ assignments, dayHrefBase, holidays, leaves, month, todayValue: _todayValue }: { assignments: Assignment[]; dayHrefBase: string; holidays: Holiday[]; leaves: LeaveDay[]; month: Date; todayValue: string }) {
  void _todayValue;
  const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const calendarStart = addDays(monthStart, -((monthStart.getUTCDay() || 7) - 1));
  const calendarEnd = addDays(monthEnd, 7 - (monthEnd.getUTCDay() || 7));
  const dates: Date[] = [];
  for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) dates.push(day);
  const byDay = new Map<string, Array<{ key: string; person: string; detail: string; kind: string; color: string }>>();
  for (const assignment of assignments) {
    const day = dateValue(assignment.workDate);
    const rows = byDay.get(day) ?? [];
    rows.push({ key: assignment.id, person: assignment.membership.fullName, detail: shiftLabel(assignment), kind: assignment.kind, color: monthEntryColor(assignment.kind, assignment.shiftColorSnapshot) });
    byDay.set(day, rows);
  }
  for (const leave of leaves) {
    const day = dateValue(leave.leaveDate);
    const rows = byDay.get(day) ?? [];
    rows.push({ key: `leave-${leave.membershipId}-${day}`, person: leave.membership.fullName, detail: leave.leaveRequest.policyNameSnapshot, kind: "LEAVE", color: "ROSE" });
    byDay.set(day, rows);
  }
  const holidayMap = new Map(holidays.map((item) => [dateValue(item.workDate), item.name]));
  return <div className={styles.monthCalendar}>
    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <strong className={styles.monthWeekday} key={name}>{name}</strong>)}
    {dates.map((day) => {
      const key = dateValue(day);
      const rows = byDay.get(key) ?? [];
      const outside = day < monthStart || day > monthEnd;
      const holidayName = holidayMap.get(key);
      const dateLabel = day.toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      return <article className={`${styles.monthDay} ${holidayName ? styles.monthDayHoliday : ""} ${outside ? styles.monthDayOutside : ""}`} key={key}>
        {!outside ? <Link aria-label={`Open roster for ${dateLabel}`} className={styles.monthDayHitArea} href={`${dayHrefBase}&day=${key}`} scroll={false}><span className={styles.visuallyHidden}>Open roster for {dateLabel}</span></Link> : null}
        <header><span>{day.toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" })}</span><strong>{day.getUTCDate()}</strong></header>
        <div className={styles.monthEntries}>{rows.slice(0, 4).map((row) => <MonthEntry key={row.key} row={row} />)}{rows.length > 4 ? <details><summary>View all ({rows.length})</summary><div>{rows.slice(4).map((row) => <MonthEntry key={row.key} row={row} />)}</div></details> : null}</div>
      </article>;
    })}
  </div>;
}

function MonthEntry({ row }: { row: { person: string; detail: string; color: string } }) {
  return <span className={styles.monthEntry}><i aria-hidden="true" className={`${styles.colorDot} ${styles[`color${row.color}`]}`} /><strong>{row.person}</strong><small>{row.detail}</small></span>;
}

function monthEntryColor(kind: string, color: string | null) {
  if (kind === "REST_DAY") return "VIOLET";
  if (kind === "NOT_SCHEDULED") return "SLATE";
  return color ?? "TEAL";
}

function AssignmentCard({ assignment, canEdit, conflict, draftRevision, returnTo, timezone }: { assignment: Assignment; canEdit: boolean; conflict: boolean; draftRevision: number; returnTo: string; timezone: string }) {
  return <div className={`${styles.assignment} ${styles[`assignment${assignment.kind}`]} ${conflict ? styles.assignmentConflict : ""}`}><strong>{shiftLabel(assignment)}</strong>{assignment.startAt && assignment.endAt ? <span>{time(assignment.startAt, timezone)}–{time(assignment.endAt, timezone)}</span> : null}{assignment.resolvedSource ? <small className={styles.assignmentSource}>{sourceLabel(assignment.resolvedSource)}</small> : null}{conflict ? <small>Approved Leave conflict</small> : null}{canEdit && assignment.sourceAssignmentId ? <form action={removeRosterAssignmentAction}><input name="assignmentId" type="hidden" value={assignment.sourceAssignmentId} /><input name="expectedDraftRevision" type="hidden" value={draftRevision} /><input name="returnTo" type="hidden" value={returnTo} /><button className={styles.resetCellButton} type="submit">Use normal schedule</button></form> : null}</div>;
}
function LeaveBadge({ leave }: { leave: LeaveDay }) { return <span className={styles.leaveBadge}><strong>{initials(leave.leaveRequest.policyNameSnapshot)}</strong><span>{leave.leaveRequest.policyNameSnapshot}</span></span>; }
function shiftLabel(assignment: Assignment) { if (assignment.kind === "REST_DAY") return "Rest Day"; if (assignment.kind === "NOT_SCHEDULED") return "Not Scheduled"; return assignment.shiftNameSnapshot ?? "Custom shift"; }
function shiftSublabel(assignment: Assignment, timezone: string) { if (!assignment.startAt || !assignment.endAt) return "Day type"; return `${time(assignment.startAt, timezone)}–${time(assignment.endAt, timezone)} · ${assignment.breakMinutes ? `${assignment.breakMinutes} min break` : "No break"}`; }
function shiftKey(assignment: Assignment, timezone: string) { return assignment.kind === "WORK_SHIFT" ? `${shiftLabel(assignment)}:${shiftSublabel(assignment, timezone)}` : assignment.kind; }
function time(value: Date, timezone: string) { return value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }); }
function paidMinutes(assignment?: Assignment) { return assignment?.startAt && assignment.endAt ? Math.max(0, Math.round((assignment.endAt.getTime() - assignment.startAt.getTime()) / 60000) - (assignment.breakPaidSnapshot ? 0 : assignment.breakMinutes)) : 0; }
function duration(minutes: number) { return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]?.toUpperCase()).join("") || "LV"; }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
function shortDate(value: Date | null) { return value ? value.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" }) : "later"; }
function sourceLabel(value: string) { return ({ DEFAULT_SHIFT: "Normal", FIXED_REST: "Repeats weekly", VARIABLE_REST: "This week", WEEKLY_SHIFT_OVERRIDE: "This date only", WEEKLY_REST_OVERRIDE: "This date only", WEEKLY_NOT_SCHEDULED_OVERRIDE: "This date only", CUSTOM_SHIFT: "This date only" } as Record<string, string>)[value] ?? value; }
