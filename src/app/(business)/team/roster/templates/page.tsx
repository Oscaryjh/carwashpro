import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { listEmployeeRosterSchedules } from "@/lib/roster/employee-schedule-service";
import { listRosterShiftTemplates, rosterShiftColors } from "@/lib/roster/shift-template-service";
import { saveRosterShiftTemplateAction } from "../actions";
import styles from "../roster.module.css";
import { DefaultSchedulesDialog } from "./default-schedules-dialog";
import { ShiftTemplateCreateDialog, ShiftTemplateCreateDialogTrigger } from "./shift-template-create-dialog";

type Props = {
  searchParams: Promise<{ branchId?: string; type?: string; message?: string }>;
};

export const dynamic = "force-dynamic";

export default async function RosterShiftTemplatesPage({ searchParams }: Props) {
  const { access, businessId } = await requireBusinessUser("VIEW_ROSTER");
  const [params, scope] = await Promise.all([searchParams, resolveAttendanceScope(access)]);
  const branches = await prisma.branch.findMany({
    where: { businessId, id: { in: [...scope.allowedBranchIds] }, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const branchId = branches.some((branch) => branch.id === params.branchId) ? params.branchId! : branches[0]?.id;
  const selectedBranchName = branches.find((branch) => branch.id === branchId)?.name;
  const [templates, members, scheduleVersions] = branchId ? await Promise.all([
    listRosterShiftTemplates({
      context: { businessId, allowedBranchIds: scope.allowedBranchIds },
      branchId,
      includeInactive: true,
    }),
    prisma.employeeBusinessMembership.findMany({
      where: { businessId, status: "ACTIVE", branchAssignments: { some: { businessId, branchId, status: "ACTIVE", OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: new Date() } }] } } },
      select: { id: true, fullName: true, employeeCode: true },
      orderBy: { fullName: "asc" },
    }),
    listEmployeeRosterSchedules({ context: { businessId, allowedBranchIds: scope.allowedBranchIds }, branchId }),
  ]) : [[], [], []];
  const latestSchedule = [...scheduleVersions]
    .sort((left, right) => right.revision - left.revision)
    .reduce((map, version) => map.has(version.membershipId) ? map : map.set(version.membershipId, version), new Map<string, (typeof scheduleVersions)[number]>());
  const canManage = hasBusinessCapability(access, "MANAGE_SHIFT_TEMPLATES");
  const canEditRoster = hasBusinessCapability(access, "EDIT_ROSTER");
  const returnTo = `/team/roster/templates?branchId=${encodeURIComponent(branchId ?? "")}`;
  const rosterHref = (view: "month" | "week" | "staff" | "coverage") =>
    `/team/roster?branchId=${encodeURIComponent(branchId ?? "")}&view=${view}`;

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      <nav aria-label="Roster views" className={styles.viewTabs}>
        <Link href={rosterHref("month")}><span aria-hidden="true" className={styles.viewTabIcon}>▦</span><span><strong>Month</strong><small>Calendar overview</small></span></Link>
        <Link href={rosterHref("week")}><span aria-hidden="true" className={styles.viewTabIcon}>☷</span><span><strong>Week</strong><small>Team by day</small></span></Link>
        <Link href={rosterHref("staff")}><span aria-hidden="true" className={styles.viewTabIcon}>◎</span><span><strong>Staff</strong><small>One employee&apos;s week</small></span></Link>
        <Link href={rosterHref("coverage")}><span aria-hidden="true" className={styles.viewTabIcon}>☰</span><span><strong>Coverage</strong><small>Staff by shift</small></span></Link>
        <Link aria-current="page" aria-label="Shift settings" className={styles.activeViewTab} href={returnTo}><span aria-hidden="true" className={styles.viewTabIcon}>⚙</span><span><strong>Shift settings</strong><small>Manage shifts</small></span></Link>
      </nav>

      <div aria-label="Shift settings actions" className={styles.templatePageActions}>
        {branchId ? (
          <DefaultSchedulesDialog
            branchId={branchId}
            canEdit={canEditRoster}
            employees={members.map((member) => {
              const schedule = latestSchedule.get(member.id);
              return {
                employeeCode: member.employeeCode,
                fullName: member.fullName,
                id: member.id,
                normalShift: schedule?.shiftNameSnapshot ?? "Not set",
                restDay: schedule ? (schedule.restPolicy === "FIXED" ? fixedDays(schedule.fixedRestWeekdays) : `${schedule.requiredRestDays} each week`) : "Not set",
                effectiveFrom: schedule ? formatScheduleDate(schedule.effectiveFrom) : "—",
                ready: Boolean(schedule),
              };
            })}
          />
        ) : null}
        {canManage ? <ShiftTemplateCreateDialogTrigger /> : null}
      </div>

      {params.message ? <p className={params.type === "error" ? styles.warning : styles.success} role="status"><strong>{params.message}</strong></p> : null}

      {branches.length > 1 ? (
        <form aria-label="Change shift template branch" className={styles.templateToolbar} method="get">
          <div className={styles.templateToolbarCopy}>
            <span>CURRENT BRANCH</span>
            <strong>{selectedBranchName ?? "Choose a branch"}</strong>
            <small>Change branch only when you need to manage another location.</small>
          </div>
          <label>
            <span>View templates for</span>
            <select defaultValue={branchId} name="branchId">
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button type="submit">View branch</button>
        </form>
      ) : null}

      {canManage ? (
        <ShiftTemplateCreateDialog>
          <section className={styles.templateCreate}>
          <div className={styles.templateCreateHeader}>
            <span className={styles.stepBadge}>+</span>
            <div><span className={styles.sectionKicker}>NEW TEMPLATE</span><h2>Create shift template</h2><p>Save a reusable set of working hours, break rules and a roster colour.</p></div>
          </div>
          <form action={saveRosterShiftTemplateAction} className={styles.templateCreateForm}>
            <input name="returnTo" type="hidden" value={returnTo} />
            <div className={styles.templateSection}>
              <div className={styles.templateSectionHeading}><span>1</span><div><h3>Shift details</h3><p>Name this shift. It will be saved for {selectedBranchName ?? "the current branch"}.</p></div></div>
              <input name="branchId" type="hidden" value={branchId ?? ""} />
              <div className={`${styles.templateSectionFields} ${styles.templateFieldsTwo}`}>
                <label><span>Shift name</span><input maxLength={80} name="name" placeholder="e.g. Morning Shift" required /></label>
                <label><span>Shift code <small>Optional</small></span><input maxLength={12} name="shortCode" placeholder="e.g. AM" /></label>
              </div>
            </div>
            <div className={styles.templateSection}>
              <div className={styles.templateSectionHeading}><span>2</span><div><h3>Working hours</h3><p>Overnight shifts are supported when the end time is earlier than the start time.</p></div></div>
              <div className={`${styles.templateSectionFields} ${styles.templateFieldsTwo}`}>
                <label><span>Shift starts</span><input defaultValue="09:00" name="startTime" required type="time" /></label>
                <label><span>Shift ends</span><input defaultValue="18:00" name="endTime" required type="time" /></label>
              </div>
            </div>
            <div className={styles.templateSection}>
              <div className={styles.templateSectionHeading}><span>3</span><div><h3>Break rules</h3><p>Set the planned break and whether that time counts as paid work.</p></div></div>
              <div className={`${styles.templateSectionFields} ${styles.templateFieldsTwo}`}>
                <label><span>Break duration</span><select defaultValue="60" name="breakMinutes"><option value="0">No break</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1 hour 30 minutes</option><option value="120">2 hours</option></select></label>
                <label><span>Is the break paid?</span><select defaultValue="false" name="breakPaid"><option value="false">No — unpaid break</option><option value="true">Yes — paid break</option></select></label>
              </div>
            </div>
            <div className={styles.templateSection}>
              <div className={styles.templateSectionHeading}><span>4</span><div><h3>Roster colour</h3><p>Choose a colour that makes this shift easy to recognise.</p></div></div>
              <div className={styles.templateSectionFields}><ColorSelect hideLegend /></div>
            </div>
            <input name="status" type="hidden" value="ACTIVE" />
            <div className={styles.templateCreateActions}>
              <div><strong>Ready to add this shift?</strong><small>The new template will be active immediately and can be used in Draft rosters.</small></div>
              <button type="submit">Create shift template</button>
            </div>
          </form>
          </section>
        </ShiftTemplateCreateDialog>
      ) : null}

      <section className={`settings-card ${styles.templateLibrary}`}>
        <div className={styles.libraryHeading}><div><span className={styles.sectionKicker}>ALL SHIFTS</span><h2>{templates.length} shifts</h2></div><p>Select a shift to review or edit its settings.</p></div>
        <div className={styles.templateList}>
          {templates.map((template) => (
            <details className={styles.templateCard} key={template.id}>
              <summary>
                <span className={`${styles.colorDot} ${styles[`color${template.colorToken}`]}`} />
                <span><strong>{template.shortCode ? `${template.shortCode} · ` : ""}{template.name}</strong><small>{template.branch?.name ?? "Business-wide"}</small></span>
                <span className={styles.templateTime}>{minuteText(template.startMinute)}–{minuteText(template.endMinute)}<small>{template.breakMinutes ? `${template.breakMinutes} min ${template.breakPaid ? "paid" : "unpaid"} break` : "No break"}{template.crossMidnight ? " · Next-day finish" : ""} · {scheduledHours(template)} scheduled</small></span>
                <span className={`${styles.badge} ${template.active ? styles.badgeSuccess : styles.badgeWarning}`}>{template.active ? "Active" : "Inactive"}</span>
              </summary>
              {canManage ? (
                <form action={saveRosterShiftTemplateAction} className={styles.templateForm}>
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <input name="templateId" type="hidden" value={template.id} />
                  <input name="expectedRevision" type="hidden" value={template.revision} />
                  <input name="branchId" type="hidden" value={template.branchId ?? ""} />
                  <label><span>Shift name</span><input defaultValue={template.name} maxLength={80} name="name" required /></label>
                  <label><span>Shift code</span><input defaultValue={template.shortCode ?? ""} maxLength={12} name="shortCode" /></label>
                  <label><span>Shift starts</span><input defaultValue={minuteText(template.startMinute)} name="startTime" required type="time" /></label>
                  <label><span>Shift ends</span><input defaultValue={minuteText(template.endMinute)} name="endTime" required type="time" /></label>
                  <label><span>Break duration</span><input defaultValue={template.breakMinutes} max="720" min="0" name="breakMinutes" required type="number" /></label>
                  <label><span>Is the break paid?</span><select defaultValue={template.breakPaid ? "true" : "false"} name="breakPaid"><option value="false">No — unpaid break</option><option value="true">Yes — paid break</option></select></label>
                  <ColorSelect value={template.colorToken} />
                  <label><span>Status</span><select defaultValue={template.active ? "ACTIVE" : "INACTIVE"} name="status"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
                  <button type="submit">Save</button>
                </form>
              ) : null}
            </details>
          ))}
          {!templates.length ? <div className={styles.emptyState}><strong>No shift templates yet</strong><p>Create Morning, PM, Full Day or Night templates for this branch.</p></div> : null}
        </div>
      </section>
    </section>
  );
}

function ColorSelect({ hideLegend = false, value = "TEAL" }: { hideLegend?: boolean; value?: string }) {
  return (
    <fieldset className={styles.colorPicker}>
      <legend className={hideLegend ? styles.visuallyHidden : undefined}>Roster colour</legend>
      <div className={styles.colorChoices}>
        {rosterShiftColors.map((color) => (
          <label className={styles.colorChoice} key={color}>
            <input defaultChecked={color === value} name="colorToken" type="radio" value={color} />
            <span className={`${styles.colorSwatch} ${styles[`color${color}`]}`} />
            <span>{title(color)}</span>
          </label>
        ))}
      </div>
      <small>Used to recognise this shift in the roster.</small>
    </fieldset>
  );
}

function minuteText(value: number) {
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

function scheduledHours(template: { startMinute: number; endMinute: number; crossMidnight: boolean; breakMinutes: number; breakPaid: boolean }) {
  const elapsed = template.endMinute + (template.crossMidnight ? 1_440 : 0) - template.startMinute;
  const paid = Math.max(0, elapsed - (template.breakPaid ? 0 : template.breakMinutes));
  return `${Math.floor(paid / 60)}h${paid % 60 ? ` ${paid % 60}m` : ""}`;
}

function title(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function fixedDays(values: number[]) { return values.length ? values.map((value) => weekdayNames[value - 1]).join(", ") : "No fixed Rest Day"; }
function formatScheduleDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
