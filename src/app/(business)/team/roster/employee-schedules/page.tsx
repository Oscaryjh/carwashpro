import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { listEmployeeRosterSchedules } from "@/lib/roster/employee-schedule-service";
import { listRosterShiftTemplates } from "@/lib/roster/shift-template-service";
import { EmployeeScheduleForm } from "./employee-schedule-form";
import styles from "../roster.module.css";

type Props = { searchParams: Promise<{ branchId?: string; type?: string; message?: string; setup?: string }> };
export const dynamic = "force-dynamic";

export default async function EmployeeSchedulesPage({ searchParams }: Props) {
  const { access, businessId } = await requireBusinessUser("VIEW_ROSTER");
  const [params, scope] = await Promise.all([searchParams, resolveAttendanceScope(access)]);
  const [branches, business] = await Promise.all([
    prisma.branch.findMany({ where: { businessId, id: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true } }),
  ]);
  const branchId = branches.some((branch) => branch.id === params.branchId) ? params.branchId! : branches[0]?.id;
  const [members, templates, versions] = branchId ? await Promise.all([
    prisma.employeeBusinessMembership.findMany({ where: { businessId, status: "ACTIVE", branchAssignments: { some: { businessId, branchId, status: "ACTIVE", OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: new Date() } }] } } }, select: { id: true, fullName: true, employeeCode: true }, orderBy: { fullName: "asc" } }),
    listRosterShiftTemplates({ context: { businessId, allowedBranchIds: scope.allowedBranchIds }, branchId }),
    listEmployeeRosterSchedules({ context: { businessId, allowedBranchIds: scope.allowedBranchIds }, branchId }),
  ]) : [[], [], []];
  const latest = [...versions].sort((left, right) => right.revision - left.revision).reduce((map, version) => map.has(version.membershipId) ? map : map.set(version.membershipId, version), new Map<string, (typeof versions)[number]>());
  const canEdit = hasBusinessCapability(access, "EDIT_ROSTER");
  const returnTo = `/team/roster/employee-schedules?branchId=${encodeURIComponent(branchId ?? "")}`;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: business.timezone });
  const selectedMembershipId = members.some((member) => member.id === params.setup) ? params.setup : undefined;
  const selectedSchedule = selectedMembershipId ? latest.get(selectedMembershipId) : undefined;
  const selectedEffectiveFrom = selectedSchedule ? laterDate(today, nextUtcDate(selectedSchedule.effectiveFrom)) : today;

  return <section className={`content hr-module-page ${styles.page}`}>
    <header className="page-header hr-module-header"><div><span className="hr-module-eyebrow">HR · SCHEDULING SETTINGS</span><h1>Default schedules</h1><p>Set the shift each employee normally follows. Use the weekly roster only for days that are different.</p></div><div className="hr-module-actions"><Link className="secondary-light-button" href={`/team/roster/templates?branchId=${encodeURIComponent(branchId ?? "")}`}>Back to shift settings</Link></div></header>
    {params.message ? <p className={params.type === "error" ? styles.warning : styles.success} role="status"><strong>{params.message}</strong></p> : null}
    {branches.length > 1 ? <form className={`${styles.templateToolbar} ${styles.employeeScheduleToolbar}`} method="get"><label><span>Branch</span><select defaultValue={branchId} name="branchId">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button type="submit">View branch</button></form> : null}
    <section className={`settings-card ${styles.employeeScheduleList}`}>
      <div className={styles.employeeScheduleListHeading}>
        <div><span className={styles.sectionKicker}>EMPLOYEE SCHEDULES</span><h2>{employeeCountText(members.length)}</h2><p>These schedules apply automatically until a weekly roster changes a specific date.</p></div>
      </div>
      <div className={styles.scheduleVersionCards}>{members.map((member) => {
        const version = latest.get(member.id);
        const olderCount = versions.filter((item) => item.membershipId === member.id).length - 1;
        const editHref = `${returnTo}&setup=${encodeURIComponent(member.id)}#schedule-editor`;
        return <article key={member.id}>
          <div className={styles.scheduleEmployeeIdentity}><strong>{member.fullName}</strong><small>{member.employeeCode}</small></div>
          <dl>
            <div><dt>Normal shift</dt><dd>{version?.shiftNameSnapshot ?? "Not set"}</dd></div>
            <div><dt>Rest Day</dt><dd>{version ? (version.restPolicy === "FIXED" ? fixedDays(version.fixedRestWeekdays) : `${version.requiredRestDays} each week`) : "Not set"}</dd></div>
            <div><dt>Effective from</dt><dd>{version ? formatDate(version.effectiveFrom) : "—"}</dd></div>
          </dl>
          <div className={styles.scheduleEmployeeActions}>
            <span className={`${styles.badge} ${version ? styles.badgeSuccess : styles.badgeWarning}`}>{version ? "Active" : "Setup needed"}</span>
            {canEdit ? <Link className={styles.scheduleChangeLink} href={editHref}>{version ? "Change" : "Set up"}</Link> : null}
          </div>
          {version && olderCount > 0 ? <details className={styles.scheduleHistory}><summary>History</summary><p>Version {version.revision} · {olderCount} earlier version(s) retained.</p></details> : null}
        </article>;
      })}</div>
    </section>
    {canEdit && branchId && selectedMembershipId ? <section className={`settings-card ${styles.employeeScheduleSetup}`} id="schedule-editor"><div className={styles.employeeScheduleForm}><EmployeeScheduleForm branchId={branchId} effectiveFrom={selectedEffectiveFrom} employees={members} initialSchedule={selectedSchedule ? { defaultShiftTemplateId: selectedSchedule.defaultShiftTemplateId, fixedRestWeekdays: selectedSchedule.fixedRestWeekdays, requiredRestDays: selectedSchedule.requiredRestDays, restPolicy: selectedSchedule.restPolicy } : undefined} key={selectedMembershipId} returnTo={returnTo} selectedEmployeeId={selectedMembershipId} shifts={templates} /></div></section> : null}
  </section>;
}

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fixedDays(values: number[]) { return values.length ? values.map((value) => weekdayNames[value - 1]).join(", ") : "No fixed Rest Day"; }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
function employeeCountText(value: number) { return `${value} ${value === 1 ? "employee" : "employees"}`; }
function nextUtcDate(value: Date) { const next = new Date(value); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10); }
function laterDate(left: string, right: string) { return left > right ? left : right; }
