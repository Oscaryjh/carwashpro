"use client";

import Link from "next/link";
import { useState } from "react";
import { RosterQuickAssign } from "./roster-quick-assign";
import styles from "./roster.module.css";

type Member = { id: string; fullName: string; employeeCode: string };
type Assignment = {
  id: string;
  membershipId: string;
  kind: "WORK_SHIFT" | "REST_DAY" | "NOT_SCHEDULED";
  shiftTemplateId: string | null;
  shiftNameSnapshot: string | null;
  startAt: Date | null;
  endAt: Date | null;
  breakMinutes: number;
  sourceAssignmentId: string | null;
  resolvedSource: string;
};
type Leave = { membershipId: string; leaveRequest: { policyNameSnapshot: string }; membership: { id: string; fullName: string } };
type ShiftTemplate = { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; paidLabel: string; colorToken: string };

export function DayRosterPanel({ assignments, branchId, canEdit, closeHref, customReturnTo, date, dateLabel, draftRevision, holidays, leaves, members, returnTo, shiftTemplates, timezone, weekStart }: {
  assignments: Assignment[];
  branchId: string;
  canEdit: boolean;
  closeHref: string;
  customReturnTo: string;
  date: string;
  dateLabel: string;
  draftRevision: number;
  holidays: Array<{ name: string }>;
  leaves: Leave[];
  members: Member[];
  returnTo: string;
  shiftTemplates: ShiftTemplate[];
  timezone: string;
  weekStart: string;
}) {
  const [tab, setTab] = useState<"working" | "leave">("working");
  const assignmentMap = new Map(assignments.map((item) => [item.membershipId, item]));
  const leaveMap = new Map(leaves.map((item) => [item.membershipId, item]));
  const working = members.filter((member) => !leaveMap.has(member.id));
  return <div aria-label={`Roster for ${dateLabel}`} aria-modal="true" className={styles.dayDrawerBackdrop} role="dialog">
    <aside className={styles.dayDrawer}>
      <header className={styles.dayDrawerHeader}><Link aria-label="Close day roster" className={styles.drawerClose} href={closeHref} scroll={false}>×</Link><div><span className={styles.sectionKicker}>DAY ROSTER</span><h2>{dateLabel}</h2>{holidays.map((holiday) => <span className={styles.holidayBadge} key={holiday.name}>PH · {holiday.name}</span>)}</div></header>
      <div className={styles.dayDrawerTabs} role="tablist"><button aria-selected={tab === "working"} className={tab === "working" ? styles.dayDrawerTabActive : undefined} onClick={() => setTab("working")} role="tab" type="button">Working <span>{working.length}</span></button><button aria-selected={tab === "leave"} className={tab === "leave" ? styles.dayDrawerTabActive : undefined} onClick={() => setTab("leave")} role="tab" type="button">On Leave <span>{leaves.length}</span></button></div>
      {tab === "working" ? <div className={styles.dayRosterList}>{working.map((member) => {
        const assignment = assignmentMap.get(member.id);
        return <article className={styles.dayRosterRow} key={member.id}><div className={styles.dayRosterPerson}><span>{initials(member.fullName)}</span><div><strong>{member.fullName}</strong><small>{member.employeeCode}</small></div></div><div className={styles.dayRosterSchedule}><strong>{assignment ? label(assignment) : "Not set"}</strong>{assignment?.startAt && assignment.endAt ? <small>{time(assignment.startAt, timezone)}–{time(assignment.endAt, timezone)}{assignment.breakMinutes ? ` · ${assignment.breakMinutes} min break` : ""}</small> : <small>{assignment ? "No work expected" : "Choose a shift"}</small>}{assignment?.sourceAssignmentId ? <em>Changed</em> : assignment ? <em>Normal</em> : null}</div>{canEdit ? <RosterQuickAssign branchId={branchId} currentSource={assignment?.resolvedSource} customReturnTo={customReturnTo} dateLabel={dateLabel} employeeName={member.fullName} existingAssignmentId={assignment?.sourceAssignmentId} existingKind={assignment?.kind} existingTemplateId={assignment?.shiftTemplateId} expectedDraftRevision={draftRevision} membershipId={member.id} returnTo={returnTo} templates={shiftTemplates} weekStart={weekStart} workDate={date} /> : null}</article>;
      })}{!working.length ? <div className={styles.emptyState}><strong>No staff scheduled</strong><p>Everyone is on approved Leave for this date.</p></div> : null}</div> : <div className={styles.dayRosterList}>{leaves.map((leave) => <article className={styles.dayRosterRow} key={leave.membershipId}><div className={styles.dayRosterPerson}><span>{initials(leave.membership.fullName)}</span><div><strong>{leave.membership.fullName}</strong><small>Approved Leave</small></div></div><div className={styles.dayRosterSchedule}><strong>{leave.leaveRequest.policyNameSnapshot}</strong><small>Managed in Leave</small></div></article>)}{!leaves.length ? <div className={styles.emptyState}><strong>No approved Leave</strong><p>No staff are on approved Leave for this date.</p></div> : null}</div>}
      <footer className={styles.dayDrawerFooter}><p>Pick a staff member, choose a shift, and save. Normal schedules remain unchanged unless this date is edited.</p></footer>
    </aside>
  </div>;
}

function label(assignment: Assignment) {
  if (assignment.kind === "REST_DAY") return "Rest Day";
  if (assignment.kind === "NOT_SCHEDULED") return "Not Scheduled";
  return assignment.shiftNameSnapshot ?? "Custom time";
}
function time(value: Date, timezone: string) { return new Date(value).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }); }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ST"; }
