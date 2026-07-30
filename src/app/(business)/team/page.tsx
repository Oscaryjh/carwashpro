import Link from "next/link";
import { CatalogFormModal } from "@/components/catalog-form-modal";
import { PermissionChecklist } from "@/components/staff-form";
import { StaffCreateModal, StaffEditModal } from "@/components/staff-create-modal";
import { StaffAvailabilityForm } from "@/components/staff-availability-form";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
  buildPeopleStaffScopeWhere,
  hasWholeBusinessPeopleScope,
} from "@/lib/team/people-scope";
import {
  createStaffAction,
  linkTeamMemberAction,
  updateStaffAction,
  updateOwnerAppointmentAvailabilityAction,
} from "./actions";
import {
  assignStaffRoleAndLevelAction,
  saveStaffLevelAction,
  saveStaffRoleProfileAction,
} from "./configuration-actions";

const teamSections = [
  { key: "people", label: "People", description: "Employment & access" },
  { key: "schedule", label: "Schedule", description: "Hours & services" },
  { key: "attendance", label: "Attendance", description: "Clock records" },
  { key: "roles", label: "Roles & Permissions", description: "Access roles" },
  { key: "activity", label: "Activity", description: "Changes & logs" },
] as const;

type TeamSection = (typeof teamSections)[number]["key"];

type TeamPageProps = {
  searchParams: Promise<{
    levelId?: string;
    message?: string;
    modal?: string;
    q?: string;
    roleId?: string;
    section?: string;
    staffId?: string;
    type?: string;
  }>;
};

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("VIEW_TEAM_DIRECTORY");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  const params = await searchParams;
  const section = teamSections.some((item) => item.key === params.section)
    ? (params.section as TeamSection)
    : "people";
  const query = params.q?.trim() ?? "";
  const now = new Date();
  const attendanceModalOpen = params.modal === "attendance";
  const scope = await resolveAttendanceScope(access);
  const wholeBusinessScope = hasWholeBusinessPeopleScope(access);
  const peopleScope = {
    allowedBranchIds: scope.allowedBranchIds,
    businessId,
    now,
    wholeBusinessScope,
  };
  const currentAssignmentWhere =
    buildCurrentPeopleAssignmentWhere(peopleScope);
  const staffScopeWhere = buildPeopleStaffScopeWhere(peopleScope);
  const membershipScopeWhere =
    buildPeopleMembershipScopeWhere(peopleScope);
  const allowedBranchIds = new Set(scope.allowedBranchIds);

  const [staff, employeeOnlyMemberships, owners, branches, roleProfiles, staffLevels, services, recentActivity, attendance] =
    await Promise.all([
      prisma.user.findMany({
        where: {
          ...staffScopeWhere,
          role: "STAFF",
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: "insensitive" as const } },
                  { email: { contains: query, mode: "insensitive" as const } },
                  { whatsappPhone: { contains: query, mode: "insensitive" as const } },
                  { branch: { name: { contains: query, mode: "insensitive" as const } } },
                ],
              }
            : {}),
        },
        include: {
          branch: { select: { id: true, name: true } },
          staffRoleProfile: { select: { id: true, name: true } },
          staffLevel: { select: { id: true, name: true } },
          employeeBusinessMembership: {
            include: {
              branchAssignments: {
                ...(wholeBusinessScope
                  ? {}
                  : { where: currentAssignmentWhere }),
                include: {
                  branch: { select: { id: true, name: true } },
                },
              },
            },
          },
          staffAvailabilities: { where: { enabled: true }, select: { id: true } },
          staffBreaks: { where: { enabled: true }, select: { id: true } },
          staffTimeOff: {
            where: { endsAt: { gte: now } },
            select: { id: true, startsAt: true, endsAt: true, reason: true },
            orderBy: { startsAt: "asc" },
            take: 1,
          },
          serviceStaffAssignments: { select: { id: true, serviceId: true } },
          employeeAccount: {
            include: {
              memberships: {
                where: {
                  ...membershipScopeWhere,
                },
                include: {
                  branchAssignments: {
                    ...(wholeBusinessScope
                      ? {}
                      : { where: currentAssignmentWhere }),
                    include: { branch: { select: { id: true, name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
      }),
      prisma.employeeBusinessMembership.findMany({
        where: {
          ...membershipScopeWhere,
          staffUser: null,
        },
        include: {
          branchAssignments: {
            where: wholeBusinessScope
              ? { status: "ACTIVE" }
              : currentAssignmentWhere,
            include: { branch: { select: { id: true, name: true } } },
            orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
          },
        },
        orderBy: [{ status: "asc" }, { fullName: "asc" }],
      }),
      prisma.user.findMany({
        where: {
          businessId,
          role: "BUSINESS_OWNER",
          status: "active",
          ...(wholeBusinessScope
            ? {}
            : { id: "00000000-0000-0000-0000-000000000000" }),
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, appointmentBookable: true },
      }),
      getActiveBranches(businessId).then((activeBranches) =>
        wholeBusinessScope
          ? activeBranches
          : activeBranches.filter((branch) =>
              allowedBranchIds.has(branch.id),
            ),
      ),
      prisma.staffRoleProfile.findMany({
        where: { businessId },
        include: { _count: { select: { users: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      prisma.staffLevel.findMany({
        where: { businessId },
        include: { _count: { select: { users: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      prisma.service.findMany({
        where: { businessId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.auditLog.findMany({
        where: {
          businessId,
          action: { startsWith: "STAFF_" },
          ...(wholeBusinessScope
            ? {}
            : { branchId: { in: [...scope.allowedBranchIds] } }),
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          action: true,
          actorName: true,
          summary: true,
          createdAt: true,
        },
      }),
      prisma.employeeAttendance.findMany({
        where: {
          businessId,
          ...(wholeBusinessScope
            ? {}
            : { branchId: { in: [...scope.allowedBranchIds] } }),
        },
        include: {
          employeeAccount: { select: { name: true, phoneNormalized: true } },
          branch: { select: { name: true } },
        },
        orderBy: { clockInAt: "desc" },
        take: attendanceModalOpen ? 100 : 10,
      }),
    ]);

  const editingRole = params.roleId
    ? roleProfiles.find((role) => role.id === params.roleId)
    : undefined;
  const editingLevel = params.levelId
    ? staffLevels.find((level) => level.id === params.levelId)
    : undefined;
  const roleModalOpen = params.modal === "role";
  const levelModalOpen = params.modal === "level";
  const editingStaff = params.staffId
    ? staff.find((member) => member.id === params.staffId)
    : undefined;
  const scheduleModalOpen = params.modal === "schedule" && Boolean(editingStaff);
  const scheduleDetails = scheduleModalOpen && editingStaff
    ? await Promise.all([
        prisma.staffAvailability.findMany({
          where: { businessId, userId: editingStaff.id },
          orderBy: { dayOfWeek: "asc" },
        }),
        prisma.staffBreak.findMany({
          where: { businessId, userId: editingStaff.id },
          orderBy: { dayOfWeek: "asc" },
        }),
        prisma.staffTimeOff.findMany({
          where: { businessId, userId: editingStaff.id, endsAt: { gte: now } },
          orderBy: { startsAt: "asc" },
        }),
      ])
    : null;
  const messageType = params.type === "error" ? "error" : "success";

  return (
    <>
      <section className="content team-workspace-page">
        <div className="page-header team-page-header">
          <div>
            <h1>Team</h1>
            <p>People, employment, services, attendance, and access in one place.</p>
          </div>
          <Link className="button-link" href="/team?section=people&modal=create">
            Add team member
          </Link>
        </div>

        {params.message ? <div className={messageType}>{params.message}</div> : null}
        {!branches.length ? (
          <div className="warning">No active branch is available for staff assignment.</div>
        ) : null}

        <div className="team-workspace">
          <nav aria-label="Team sections" className="team-section-nav">
            <div className="team-section-nav-heading">
              <span>TEAM</span>
              <strong>Management</strong>
            </div>
            {teamSections.map((item) => (
              <Link
                className={section === item.key ? "active" : ""}
                href={`/team?section=${item.key}`}
                key={item.key}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </Link>
            ))}
          </nav>

          <div className="team-workspace-content">
            {section === "people" ? (
              <PeopleSection
                branchesAvailable={Boolean(branches.length)}
                employeeOnlyMemberships={employeeOnlyMemberships}
                query={query}
                roleProfiles={roleProfiles.filter((role) => role.active)}
                staff={staff}
                staffLevels={staffLevels.filter((level) => level.active)}
              />
            ) : null}
            {section === "schedule" ? <ScheduleSection owners={owners} staff={staff} /> : null}
            {section === "attendance" ? <AttendanceSection attendance={attendance} /> : null}
            {section === "roles" ? (
              <RolesSection roleProfiles={roleProfiles} staffLevels={staffLevels} />
            ) : null}
            {section === "activity" ? (
              <ActivitySection activity={recentActivity} attendance={attendance} />
            ) : null}
          </div>
        </div>
      </section>

      {params.modal === "create" ? (
        <StaffCreateModal
          action={createStaffAction}
          branches={branches}
          industryType={industryType}
          roleProfiles={roleProfiles.filter((role) => role.active)}
          services={services}
          staffLevels={staffLevels.filter((level) => level.active)}
        />
      ) : null}
      {params.modal === "edit" && editingStaff ? (
        <StaffEditModal
          action={updateStaffAction}
          assignedBranchIds={assignedBranchIds(editingStaff)}
          branches={branches}
          employeeProfile={
            editingStaff.employeeBusinessMembership
              ? {
                  attendanceEnabled:
                    editingStaff.employeeBusinessMembership.attendanceEnabled,
                  employeeCode: editingStaff.employeeBusinessMembership.employeeCode,
                  employmentType:
                    editingStaff.employeeBusinessMembership.employmentType,
                  joinedAt: formatDateInput(editingStaff.employeeBusinessMembership.joinedAt),
                  primaryBranchId:
                    editingStaff.employeeBusinessMembership.branchAssignments.find(
                      (assignment) => assignment.isPrimary,
                    )?.branchId ?? "",
                  canClockInBranchIds:
                    editingStaff.employeeBusinessMembership.branchAssignments
                      .filter((assignment) => assignment.canClockIn)
                      .map((assignment) => assignment.branchId),
                  status: editingStaff.employeeBusinessMembership.status,
                }
              : null
          }
          industryType={industryType}
          roleProfiles={roleProfiles.filter((role) => role.active)}
          selectedServiceIds={editingStaff.serviceStaffAssignments.map(
            (assignment) => assignment.serviceId,
          )}
          services={services}
          staff={editingStaff}
          staffLevels={staffLevels.filter((level) => level.active)}
        />
      ) : null}
      {scheduleDetails && editingStaff ? (
        <CatalogFormModal
          ariaLabel={`Manage schedule for ${editingStaff.name}`}
          closePath="/team?section=schedule"
          eyebrow="SCHEDULE"
          modalClassName="team-schedule-modal"
          title="Availability & time off"
          wide
        >
          <div className="team-schedule-modal-summary">
            <span className="team-avatar">{initials(editingStaff.name)}</span>
            <span>
              <strong>{editingStaff.name}</strong>
              <small>{branchNames(editingStaff)}</small>
            </span>
          </div>
          <StaffAvailabilityForm
            availability={scheduleDetails[0]}
            breaks={scheduleDetails[1]}
            returnTo="/team?section=schedule"
            staffId={editingStaff.id}
            timeOff={scheduleDetails[2]}
          />
        </CatalogFormModal>
      ) : null}
      {attendanceModalOpen ? (
        <CatalogFormModal
          ariaLabel="View all attendance records"
          closePath="/team?section=attendance"
          eyebrow="ATTENDANCE"
          modalClassName="team-attendance-modal"
          showMark={false}
          title="Clock activity"
          wide
        >
          <div className="team-attendance-modal-summary">
            <span>
              <small>Records</small>
              <strong>{attendance.length}</strong>
            </span>
            <span>
              <small>Clocked in</small>
              <strong>{attendance.filter((entry) => entry.status === "OPEN").length}</strong>
            </span>
            <span>
              <small>Clocked out</small>
              <strong>{attendance.filter((entry) => entry.status === "COMPLETED").length}</strong>
            </span>
          </div>
          <div className="team-attendance-modal-list">
            {attendance.length ? attendance.map((entry) => (
              <article key={entry.id}>
                <span className="team-avatar">{initials(entry.employeeAccount.name)}</span>
                <span className="team-attendance-person">
                  <strong>{entry.employeeAccount.name}</strong>
                  <small>{entry.branch.name} - {entry.employeeAccount.phoneNormalized}</small>
                </span>
                <span>
                  <small>Clock in</small>
                  <strong>{formatDateTime(entry.clockInAt)}</strong>
                </span>
                <span>
                  <small>Clock out</small>
                  <strong>{entry.clockOutAt ? formatDateTime(entry.clockOutAt) : "Still working"}</strong>
                </span>
                <span>
                  <small>Duration</small>
                  <strong>{formatAttendanceDuration(entry.clockInAt, entry.clockOutAt)}</strong>
                </span>
                <span className={entry.status === "OPEN" ? "status" : "status status-neutral"}>
                  {entry.status === "OPEN" ? "Clocked in" : "Clocked out"}
                </span>
              </article>
            )) : (
              <div className="empty-state">No attendance records yet.</div>
            )}
          </div>
        </CatalogFormModal>
      ) : null}
      {roleModalOpen ? (
        <CatalogFormModal
          ariaLabel={editingRole ? "Edit role profile" : "New role profile"}
          closePath="/team?section=roles"
          eyebrow="ROLES & PERMISSIONS"
          modalClassName="team-config-modal"
          title={editingRole ? "Edit role" : "New role"}
          wide
        >
          <form action={saveStaffRoleProfileAction} className="form team-role-form">
            <input name="id" type="hidden" value={editingRole?.id ?? ""} />
            <section className="team-role-form-section">
              <header className="team-role-form-heading">
                <div>
                  <h3>Role details</h3>
                  <p>Name the role and control whether it can be assigned to staff.</p>
                </div>
              </header>
              <div className="team-config-heading-grid">
                <label>
                  <span>Role name</span>
                  <input defaultValue={editingRole?.name ?? ""} name="name" required />
                </label>
                <label className="team-active-field">
                  <span>Active role</span>
                  <span className="team-active-toggle">
                    <small>Available when assigning staff.</small>
                    <input defaultChecked={editingRole?.active ?? true} name="active" type="checkbox" />
                    <span aria-hidden="true" className="team-active-switch" />
                  </span>
                </label>
              </div>
            </section>
            <section className="team-role-form-section">
              <PermissionChecklist
                defaultPermissions={editingRole?.permissions ?? []}
                description="These permissions apply to every staff member assigned to this role."
                industryType={industryType}
                title="Access permissions"
              />
            </section>
            <div className="form-actions">
              <button type="submit">Save role</button>
            </div>
          </form>
        </CatalogFormModal>
      ) : null}
      {levelModalOpen ? (
        <CatalogFormModal
          ariaLabel={editingLevel ? "Edit staff level" : "New staff level"}
          closePath="/team?section=roles"
          eyebrow="STAFF LEVEL"
          modalClassName="team-config-modal"
          title={editingLevel ? "Edit level" : "New level"}
          wide
        >
          <form action={saveStaffLevelAction} className="form team-level-form">
            <input name="id" type="hidden" value={editingLevel?.id ?? ""} />
            <div className="team-config-heading-grid">
              <label>
                <span>Level name</span>
                <input defaultValue={editingLevel?.name ?? ""} name="name" required />
              </label>
              <label className="team-active-field">
                <span>Active level</span>
                <span className="team-active-toggle">
                  <small>Available when assigning staff.</small>
                  <input defaultChecked={editingLevel?.active ?? true} name="active" type="checkbox" />
                  <span aria-hidden="true" className="team-active-switch" />
                </span>
              </label>
            </div>
            <div className="team-level-rules">
              <div className="team-level-rule-head">
                <span>Sale type</span>
                <span>Fixed amount</span>
                <span>Rate</span>
              </div>
              {(["service", "product", "package"] as const).map((type) => (
                <div className="team-level-rule" key={type}>
                  <strong>{capitalize(type)}</strong>
                  <label>
                    <span className="sr-only">{capitalize(type)} fixed amount</span>
                    <span className="input-prefix">RM</span>
                    <input
                      defaultValue={editingLevel ? decimalValue(editingLevel[`${type}FixedAmount`]) : "0"}
                      min="0"
                      name={`${type}FixedAmount`}
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label>
                    <span className="sr-only">{capitalize(type)} rate</span>
                    <input
                      defaultValue={editingLevel ? decimalValue(editingLevel[`${type}Percent`]) : "0"}
                      max="100"
                      min="0"
                      name={`${type}Percent`}
                      step="0.01"
                      type="number"
                    />
                    <span className="input-suffix">%</span>
                  </label>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button type="submit">Save level</button>
            </div>
          </form>
        </CatalogFormModal>
      ) : null}
    </>
  );
}

function PeopleSection({
  branchesAvailable,
  employeeOnlyMemberships,
  query,
  roleProfiles,
  staff,
  staffLevels,
}: {
  branchesAvailable: boolean;
  employeeOnlyMemberships: EmployeeOnlyRow[];
  query: string;
  roleProfiles: Array<{ id: string; name: string }>;
  staff: StaffRow[];
  staffLevels: Array<{ id: string; name: string }>;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const visibleEmployeeOnlyMemberships = normalizedQuery
    ? employeeOnlyMemberships.filter((employee) =>
        [
          employee.fullName,
          employee.employeeCode,
          ...employee.branchAssignments.map((assignment) => assignment.branch.name),
        ].some((value) => value.toLocaleLowerCase("en").includes(normalizedQuery)),
      )
    : employeeOnlyMemberships;
  const peopleCount = staff.length + visibleEmployeeOnlyMemberships.length;

  return (
    <section className="team-section-panel">
      <div className="team-section-toolbar">
        <div>
          <p className="eyebrow">PEOPLE</p>
          <h2>All team members</h2>
        </div>
        <span className="status">{peopleCount} people</span>
      </div>
      <form action="/team" className="team-workspace-search">
        <input name="section" type="hidden" value="people" />
        <input
          defaultValue={query}
          name="q"
          placeholder="Search name, employee code, email, or branch"
        />
        <button type="submit">Search</button>
        {query ? <Link href="/team?section=people">Clear</Link> : null}
      </form>
      <div className="team-staff-list">
        {staff.map((member) => {
          const employment = employmentProfile(member);

          return (
            <article className="team-staff-row" key={member.id}>
              <div className="team-staff-summary">
                <div className="team-staff-identity">
                  <span className="team-avatar">{initials(member.name)}</span>
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.whatsappPhone || member.email || "No contact"}</small>
                  </span>
                </div>
                <span className={employment?.status === "ACTIVE" ? "status" : "status status-neutral"}>
                  {employment?.status
                    ? capitalize(employment.status)
                    : member.teamMemberLinkStatus === "REVIEW_REQUIRED"
                      ? "Review required"
                      : "Staff only"}
                </span>
              </div>
              <div className="team-staff-facts">
                <span><small>Branches</small>{branchNames(member)}</span>
                <span><small>Employee code</small>{employment?.employeeCode ?? "Not linked"}</span>
                <span><small>Services</small>{member.serviceStaffAssignments.length} assigned</span>
              </div>
              <div className="team-member-feature-badges" aria-label={`${member.name} features`}>
                <FeatureBadge enabled={Boolean(employment)} label="Employment" />
                <FeatureBadge
                  enabled={employment?.attendanceEnabled === true}
                  label="Attendance"
                />
                <FeatureBadge
                  enabled={member.status === "active" && member.appointmentBookable}
                  label="Services"
                />
                <FeatureBadge
                  enabled={member.status === "active" && member.loginEnabled}
                  label="POS access"
                />
              </div>
              {employment ? (
                <form action={assignStaffRoleAndLevelAction} className="team-staff-classification">
                  <input name="userId" type="hidden" value={member.id} />
                  <label>
                    <span>Role</span>
                    <select defaultValue={member.staffRoleProfileId ?? ""} name="staffRoleProfileId">
                      <option value="">Advanced override (custom)</option>
                      {roleProfiles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Level</span>
                    <select defaultValue={member.staffLevelId ?? ""} name="staffLevelId">
                      <option value="">No level</option>
                      {staffLevels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
                    </select>
                  </label>
                  <button className="secondary-light-button" type="submit">Apply</button>
                </form>
              ) : employeeOnlyMemberships.length ? (
                <form action={linkTeamMemberAction} className="team-staff-classification">
                  <input name="userId" type="hidden" value={member.id} />
                  <label>
                    <span>Link employment profile</span>
                    <select name="membershipId" required>
                      <option value="">Select by employee code</option>
                      {employeeOnlyMemberships.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.employeeCode} - {employee.fullName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="form-hint">
                    Manual selection only. Names are never matched automatically.
                  </span>
                  <button className="secondary-light-button" type="submit">Link</button>
                </form>
              ) : (
                <div className="team-staff-classification staff-record-access-note">
                  No unlinked employment profile is available in this business.
                </div>
              )}
              {employment ? (
                <Link
                  aria-label={`Edit ${member.name}`}
                  className="secondary-light-button team-row-action"
                  href={`/team?section=people&modal=edit&staffId=${member.id}`}
                >
                  <span aria-hidden="true" className="team-row-action-icon">&#9998;</span>
                  <span>Edit</span>
                </Link>
              ) : null}
            </article>
          );
        })}
        {visibleEmployeeOnlyMemberships.map((employee) => (
          <article className="team-staff-row" key={`employee-${employee.id}`}>
            <div className="team-staff-summary">
              <div className="team-staff-identity">
                <span className="team-avatar">{initials(employee.fullName)}</span>
                <span>
                  <strong>{employee.fullName}</strong>
                  <small>{employee.employeeCode} &middot; Employment profile only</small>
                </span>
              </div>
              <span className={employee.status === "ACTIVE" ? "status" : "status status-neutral"}>
                {capitalize(employee.status)}
              </span>
            </div>
            <div className="team-staff-facts">
              <span><small>Branches</small>{employeeBranchNames(employee)}</span>
              <span><small>Employment</small>{capitalize(employee.employmentType)}</span>
              <span><small>Access</small>No service or POS profile</span>
            </div>
            <div className="team-member-feature-badges" aria-label={`${employee.fullName} features`}>
              <FeatureBadge enabled label="Employment" />
              <FeatureBadge enabled={employee.attendanceEnabled} label="Attendance" />
              <FeatureBadge enabled={false} label="Services" />
              <FeatureBadge enabled={false} label="POS access" />
            </div>
            <Link
              aria-label={`View ${employee.fullName}`}
              className="secondary-light-button team-row-action"
              href={`/team/employees/${employee.id}`}
            >
              View employment
            </Link>
          </article>
        ))}
        {!peopleCount ? (
          <div className="empty-state">
            {query
              ? "No team members match this search."
              : branchesAvailable
                ? "No team members yet."
                : "Add an active branch first."}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FeatureBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span className={enabled ? "status" : "status status-neutral"}>
      {label}: {enabled ? "On" : "Off"}
    </span>
  );
}

function ScheduleSection({ owners, staff }: { owners: OwnerRow[]; staff: StaffRow[] }) {
  return (
    <section className="team-section-panel">
      <div className="team-section-toolbar">
        <div><p className="eyebrow">SCHEDULE</p><h2>Availability & services</h2></div>
        <span className="status">{staff.length} staff</span>
      </div>
      {owners.length ? (
        <div className="team-owner-availability">
          <h3>Owner availability</h3>
          {owners.map((owner) => (
            <form action={updateOwnerAppointmentAvailabilityAction} key={owner.id}>
              <input name="userId" type="hidden" value={owner.id} />
              <input name="appointmentBookable" type="hidden" value={owner.appointmentBookable ? "false" : "true"} />
              <span><strong>{owner.name}</strong><small>Owner</small></span>
              <span className={owner.appointmentBookable ? "status" : "status status-neutral"}>{owner.appointmentBookable ? "Shown" : "Hidden"}</span>
              <button className="secondary-light-button" type="submit">{owner.appointmentBookable ? "Hide" : "Show"}</button>
            </form>
          ))}
        </div>
      ) : null}
      <div className="team-schedule-list">
        {staff.map((member) => (
          <article key={member.id}>
            <div className="team-staff-identity"><span className="team-avatar">{initials(member.name)}</span><span><strong>{member.name}</strong><small>{branchNames(member)}</small></span></div>
            <div className="team-schedule-metrics">
              <span><strong>{member.staffAvailabilities.length}</strong><small>work days</small></span>
              <span><strong>{member.staffBreaks.length}</strong><small>breaks</small></span>
              <span><strong>{member.serviceStaffAssignments.length}</strong><small>services</small></span>
              <span><strong>{member.staffTimeOff.length}</strong><small>upcoming leave</small></span>
            </div>
            <Link
              className="secondary-light-button team-row-action"
              href={`/team?section=schedule&modal=schedule&staffId=${member.id}`}
            >
              Manage
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function AttendanceSection({ attendance }: { attendance: AttendanceRow[] }) {
  return (
    <section className="team-section-panel">
      <div className="team-section-toolbar">
        <div><p className="eyebrow">ATTENDANCE</p><h2>Recent clock activity</h2></div>
        <Link className="button-link" href="/team?section=attendance&modal=attendance">View all</Link>
      </div>
      <div className="team-activity-table" role="table">
        {attendance.length ? attendance.map((entry) => (
          <div className="team-activity-row" key={entry.id} role="row">
            <span><strong>{entry.employeeAccount.name}</strong><small>{entry.branch.name}</small></span>
            <span><small>Clock in</small>{formatDateTime(entry.clockInAt)}</span>
            <span><small>Clock out</small>{entry.clockOutAt ? formatDateTime(entry.clockOutAt) : "Still working"}</span>
            <span className={entry.status === "OPEN" ? "status" : "status status-neutral"}>{capitalize(entry.status)}</span>
          </div>
        )) : <div className="empty-state">No attendance records yet.</div>}
      </div>
    </section>
  );
}

function RolesSection({ roleProfiles, staffLevels }: { roleProfiles: RoleRow[]; staffLevels: LevelRow[] }) {
  return (
    <section className="team-section-panel team-roles-section">
      <div className="team-section-toolbar"><div><p className="eyebrow">TEAM ACCESS</p><h2>Roles & Permissions</h2></div><Link className="button-link" href="/team?section=roles&modal=role">New role</Link></div>
      <div className="team-config-list">
        {roleProfiles.length ? roleProfiles.map((role) => (
          <article key={role.id}>
            <div><strong>{role.name}</strong><small>{role.permissions.length} permissions</small></div>
            <span><strong>{role._count.users}</strong><small>staff</small></span>
            <span className={role.active ? "status" : "status status-neutral"}>{role.active ? "Active" : "Inactive"}</span>
            <Link className="secondary-light-button" href={`/team?section=roles&modal=role&roleId=${role.id}`}>Edit</Link>
          </article>
        )) : <div className="empty-state">No reusable roles yet.</div>}
      </div>

      <div className="team-section-toolbar team-level-heading"><div><p className="eyebrow">STAFF LEVELS</p><h2>Commission presets</h2></div><Link className="button-link" href="/team?section=roles&modal=level">New level</Link></div>
      <div className="team-level-list">
        <div className="team-level-list-head"><span>Level</span><span>Service</span><span>Product</span><span>Package</span><span>Assigned</span><span>Actions</span></div>
        {staffLevels.length ? staffLevels.map((level) => (
          <article key={level.id}>
            <span><strong>{level.name}</strong><small>{level.active ? "Active" : "Inactive"}</small></span>
            <span>{commissionLabel(level.serviceFixedAmount, level.servicePercent)}</span>
            <span>{commissionLabel(level.productFixedAmount, level.productPercent)}</span>
            <span>{commissionLabel(level.packageFixedAmount, level.packagePercent)}</span>
            <span>{level._count.users} staff</span>
            <Link
              aria-label={`Edit ${level.name} level`}
              className="secondary-light-button team-row-action team-level-action"
              href={`/team?section=roles&modal=level&levelId=${level.id}`}
            >
              <span aria-hidden="true" className="team-row-action-icon">&#9998;</span>
              <span>Edit</span>
            </Link>
          </article>
        )) : <div className="empty-state">No staff levels yet.</div>}
      </div>
    </section>
  );
}

function ActivitySection({
  activity,
  attendance,
}: {
  activity: ActivityRow[];
  attendance: AttendanceRow[];
}) {
  const entries = [
    ...activity.map((entry) => ({
      id: `audit-${entry.id}`,
      title: entry.summary,
      detail: humanizeAction(entry.action),
      actor: entry.actorName || "System",
      createdAt: entry.createdAt,
    })),
    ...attendance.flatMap((entry) => [
      {
        id: `attendance-in-${entry.id}`,
        title: `${entry.employeeAccount.name} clocked in`,
        detail: entry.branch.name,
        actor: "Attendance",
        createdAt: entry.clockInAt,
      },
      ...(entry.clockOutAt
        ? [{
            id: `attendance-out-${entry.id}`,
            title: `${entry.employeeAccount.name} clocked out`,
            detail: entry.branch.name,
            actor: "Attendance",
            createdAt: entry.clockOutAt,
          }]
        : []),
    ]),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10);

  return (
    <section className="team-section-panel">
      <div className="team-section-toolbar"><div><p className="eyebrow">ACTIVITY</p><h2>Team activity</h2></div><span className="status">Latest 10</span></div>
      <div className="team-audit-list">
        {entries.length ? entries.map((entry) => (
          <article key={entry.id}>
            <span className="team-audit-marker" />
            <div><strong>{entry.title}</strong><small>{entry.detail}</small></div>
            <span><strong>{entry.actor}</strong><small>{formatDateTime(entry.createdAt)}</small></span>
          </article>
        )) : <div className="empty-state">No team activity yet.</div>}
      </div>
    </section>
  );
}

type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  whatsappPhone: string | null;
  appointmentBookable: boolean;
  loginEnabled: boolean;
  status: string;
  teamMemberLinkStatus: string;
  branchId: string | null;
  staffRoleProfileId: string | null;
  staffLevelId: string | null;
  employeeBusinessMembership: {
    id: string;
    attendanceEnabled: boolean;
    employeeCode: string;
    employmentType: string;
    joinedAt: Date;
    status: string;
    branchAssignments: Array<{
      branchId: string;
      canClockIn: boolean;
      isPrimary: boolean;
      branch: { id: string; name: string };
    }>;
  } | null;
  branch: { id: string; name: string } | null;
  staffRoleProfile: { id: string; name: string } | null;
  staffLevel: { id: string; name: string } | null;
  staffAvailabilities: Array<{ id: string }>;
  staffBreaks: Array<{ id: string }>;
  staffTimeOff: Array<{
    id: string;
    reason: string | null;
    startsAt: Date;
    endsAt: Date;
  }>;
  serviceStaffAssignments: Array<{ id: string; serviceId: string }>;
  employeeAccount: {
    memberships: Array<{
      attendanceEnabled: boolean;
      employeeCode: string;
      employmentType: string;
      joinedAt: Date;
      status: string;
      branchAssignments: Array<{
        branch: { id: string; name: string };
      }>;
    }>;
  } | null;
};
type EmployeeOnlyRow = {
  id: string;
  attendanceEnabled: boolean;
  employeeCode: string;
  employmentType: string;
  fullName: string;
  status: string;
  branchAssignments: Array<{
    branchId: string;
    isPrimary: boolean;
    branch: { id: string; name: string };
  }>;
};
type OwnerRow = { id: string; name: string; appointmentBookable: boolean };
type RoleRow = { id: string; name: string; permissions: string[]; active: boolean; _count: { users: number } };
type LevelRow = {
  id: string; name: string; active: boolean; _count: { users: number };
  serviceFixedAmount: unknown; servicePercent: unknown; productFixedAmount: unknown;
  productPercent: unknown; packageFixedAmount: unknown; packagePercent: unknown;
};
type ActivityRow = { id: string; action: string; actorName: string | null; summary: string; createdAt: Date };
type AttendanceRow = { id: string; status: string; clockInAt: Date; clockOutAt: Date | null; employeeAccount: { name: string; phoneNormalized: string }; branch: { name: string } };

function branchNames(member: StaffRow) {
  const assigned =
    member.employeeBusinessMembership?.branchAssignments.map(
      (assignment) => assignment.branch.name,
    ) ??
    member.employeeAccount?.memberships.flatMap((membership) =>
      membership.branchAssignments.map((assignment) => assignment.branch.name),
    ) ??
    [];
  const names = Array.from(new Set(assigned.length ? assigned : member.branch?.name ? [member.branch.name] : []));
  return names.length ? names.join(", ") : "No branch";
}

function assignedBranchIds(member: Pick<
  StaffRow,
  "branchId" | "employeeAccount" | "employeeBusinessMembership"
>) {
  const assigned =
    member.employeeBusinessMembership?.branchAssignments.map(
      (assignment) => assignment.branch.id,
    ) ??
    member.employeeAccount?.memberships.flatMap((membership) =>
      membership.branchAssignments.map((assignment) => assignment.branch.id),
    ) ??
    [];
  return Array.from(new Set(assigned.length ? assigned : member.branchId ? [member.branchId] : []));
}

function employmentProfile(member: StaffRow) {
  return member.employeeBusinessMembership;
}

function employeeBranchNames(employee: EmployeeOnlyRow) {
  const names = employee.branchAssignments.map(
    (assignment) =>
      `${assignment.branch.name}${assignment.isPrimary ? " - Primary" : ""}`,
  );
  return names.length ? names.join(", ") : "No active branch";
}

function formatDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value;
}

function decimalValue(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : "0.00";
}

function commissionLabel(fixed: unknown, percent: unknown) {
  const parts = [];
  if (Number(fixed) > 0) parts.push(`RM${decimalValue(fixed)}`);
  if (Number(percent) > 0) parts.push(`${decimalValue(percent)}%`);
  return parts.length ? parts.join(" + ") : "Not set";
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(value);
}

function formatAttendanceDuration(clockInAt: Date, clockOutAt: Date | null) {
  const end = clockOutAt ?? new Date();
  const minutes = Math.max(0, Math.floor((end.getTime() - clockInAt.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function humanizeAction(action: string) {
  return action.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
