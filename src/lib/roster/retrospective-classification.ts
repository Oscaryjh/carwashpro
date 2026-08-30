import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { dateValue, type RosterAssignmentInput } from "./domain";

type RetrospectiveAssignment = Pick<
  RosterAssignmentInput,
  "membershipId" | "workDate" | "kind" | "startAt"
>;

export function rosterAssignmentDayKey(
  assignment: Pick<RosterAssignmentInput, "membershipId" | "workDate">,
) {
  return `${assignment.membershipId}:${dateValue(assignment.workDate)}`;
}

export function isRosterAssignmentRetrospective(
  assignment: RetrospectiveAssignment,
  now: Date,
  timezone: string,
) {
  const workDate = dateValue(assignment.workDate);
  const localToday = getBranchLocalDateKey(now, timezone);

  if (workDate < localToday) return true;
  if (workDate > localToday) return false;

  // A work shift remains current-safe until its exact, timezone-resolved start
  // instant. Rest and not-scheduled days have no later start boundary, so the
  // local day boundary remains their retrospective boundary.
  if (assignment.kind !== "WORK_SHIFT" || !assignment.startAt) return true;
  return now.getTime() >= assignment.startAt.getTime();
}
