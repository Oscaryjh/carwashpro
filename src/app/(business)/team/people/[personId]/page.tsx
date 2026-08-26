import { notFound } from "next/navigation";
import { z } from "zod";
import {
  EmployeeProfileShell,
  type EmployeeProfileShellPerson,
} from "@/components/employee-profile-shell";
import { EmployeeProfileOverview } from "@/components/employee-profile-phase2a";
import { StaffEditModal } from "@/components/staff-create-modal";
import { EmployeeProfileAttendance } from "@/components/employee-profile-attendance";
import { EmployeeProfileLeave } from "@/components/employee-profile-leave";
import { EmployeeLeaveBalanceModal } from "@/components/employee-leave-balance-modal";
import { EmployeeProfileClaims } from "@/components/employee-profile-claims";
import { EmployeeProfileCommission } from "@/components/employee-profile-commission";
import { EmployeeProfileCoreStaffOverview } from "@/components/employee-profile-personal";
import {
  EmployeeProfileAccess,
  EmployeeProfileAreaTabs,
  EmployeeProfileCompensationHome,
  type EmployeeCompensationOverviewItem,
  EmployeeProfileTimeSummary,
  EmployeeProfileWork,
} from "@/components/employee-profile-360";
import {
  EmployeeProfilePayroll,
  EmployeeProfileStatutory,
} from "@/components/employee-profile-payroll";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getActiveBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import {
  canViewEmployeeProfileTab,
  getVisibleEmployeeProfileTabs,
  resolveEmployeeProfileLocation,
} from "@/lib/team/employee-profile-tabs";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
  buildPeopleStaffScopeWhere,
  hasWholeBusinessPeopleScope,
} from "@/lib/team/people-scope";
import {
  getEmployeeProfileEmployment,
  getEmployeeProfileOverview,
  getEmployeeProfilePersonal,
} from "@/lib/team/employee-profile-read";
import { loadEmployeeAttendanceSection } from "@/lib/team/employee-profile-attendance-read";
import { loadEmployeeLeaveSection } from "@/lib/team/employee-profile-leave-read";
import { loadEmployeeClaimsSection } from "@/lib/team/employee-profile-claims-read";
import { loadEmployeeCommissionSection } from "@/lib/team/employee-profile-commission-read";
import { loadEmployeeCompensationSection } from "@/lib/team/employee-profile-compensation-read";
import { loadEmployeeStatutoryProfileSection } from "@/lib/team/employee-profile-statutory-read";
import { loadEmployeePayrollNavigationSection } from "@/lib/team/employee-profile-payroll-navigation-read";
import { loadEmployeePayrollSummary } from "@/lib/team/employee-profile-payroll-summary-read";
import { loadEmployeeBankSection } from "@/lib/team/employee-profile-bank-read";
import { updateEmployeeAvatarAction } from "./avatar-actions";
import {
  saveEmployeeCommissionItemOverrideAction,
  saveEmployeeCommissionOverrideAction,
} from "./commission-actions";
import { updateStaffAction } from "../../actions";

type EmployeeProfilePageProps = {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{
    affectedDrafts?: string;
    artifactCount?: string;
    artifactWarning?: string;
    changedFields?: string;
    effectiveMonth?: string;
    finalizedCount?: string;
    newRevision?: string;
    payrollUpdate?: string;
    payrollUpdateMessage?: string;
    payrollUpdateStatus?: string;
    bankDialog?: string;
    bankDialogError?: string;
    reviewCount?: string;
    section?: string;
    view?: string;
    edit?: string;
    message?: string;
    manageLeave?: string;
    type?: string;
  }>;
};

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: EmployeeProfilePageProps) {
  const context = await requireBusinessUser("VIEW_TEAM_DIRECTORY");
  const scope = await resolveAttendanceScope(context.access);
  const route = await params;
  const query = await searchParams;
  const personId = z.string().uuid().safeParse(route.personId);

  if (!personId.success) {
    notFound();
  }

  const profileLocation = resolveEmployeeProfileLocation(query.section, query.view);
  const activeSection = profileLocation.section;
  const activeView = profileLocation.view;
  const now = new Date();
  const peopleScope = {
    allowedBranchIds: scope.allowedBranchIds,
    businessId: context.businessId,
    now,
    wholeBusinessScope: hasWholeBusinessPeopleScope(context.access),
  };
  const currentAssignmentWhere = buildCurrentPeopleAssignmentWhere(peopleScope);

  const [membership, staff] = await Promise.all([
    prisma.employeeBusinessMembership.findFirst({
      where: {
        ...buildPeopleMembershipScopeWhere(peopleScope),
        OR: [
          { id: personId.data },
          { staffUser: { is: { id: personId.data } } },
        ],
      },
      select: {
        id: true,
        avatarUrl: true,
        employeeCode: true,
        fullName: true,
        position: true,
        status: true,
        staffUser: { select: { id: true } },
        branchAssignments: {
          where: currentAssignmentWhere,
          orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
          take: 1,
          select: {
            isPrimary: true,
            branch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findFirst({
      where: {
        ...buildPeopleStaffScopeWhere(peopleScope),
        id: personId.data,
        role: "STAFF",
      },
      select: {
        appointmentBookable: true,
        email: true,
        id: true,
        loginEnabled: true,
        name: true,
        status: true,
        branch: { select: { name: true } },
        staffRoleProfile: { select: { name: true } },
        whatsappPhone: true,
        _count: { select: { serviceStaffAssignments: true } },
      },
    }),
  ]);

  if (!membership && !staff) {
    notFound();
  }

  const person: EmployeeProfileShellPerson = membership
    ? {
        id: membership.id,
        avatarUrl: membership.avatarUrl,
        fullName: membership.fullName,
        employeeCode: membership.employeeCode,
        position: membership.position,
        employmentType: null,
        status: membership.status,
        primaryBranchName:
          membership.branchAssignments.find(
            (assignment) => assignment.isPrimary,
          )?.branch.name ??
          membership.branchAssignments[0]?.branch.name ??
          null,
        linked: true,
      }
    : {
        id: staff!.id,
        avatarUrl: null,
        fullName: staff!.name,
        employeeCode: null,
        position: null,
        employmentType: null,
        status: staff!.status,
        primaryBranchName: staff!.branch?.name ?? null,
        linked: false,
      };

  const canManageTeam = hasBusinessCapability(context.access, "MODIFY_TEAM");
  const canAdjustLeaveBalance = hasBusinessCapability(
    context.access,
    "ADJUST_LEAVE_BALANCE",
  );
  const editProfileOpen =
    activeSection === "overview" && query.edit === "profile" && canManageTeam;
  const linkedStaffId = membership?.staffUser?.id ?? staff?.id ?? null;
  const profilePath = `/team/people/${person.id}?section=overview`;
  const canEditEmployeeRecord =
    canManageTeam ||
    hasBusinessCapability(context.access, "MODIFY_ATTENDANCE_EMPLOYEES");
  const profileEditHref = linkedStaffId
    ? canManageTeam
      ? `${profilePath}&edit=profile`
      : undefined
    : membership && canEditEmployeeRecord
      ? `/team/employees/${membership.id}`
      : undefined;

  let sectionContent = null;
  let leaveData: Awaited<ReturnType<typeof loadEmployeeLeaveSection>> = null;
  const areaAuthorized = canViewEmployeeProfileTab(
    context.access,
    activeSection,
    context.moduleContext.enabledModules,
  );
  let sectionAuthorized = areaAuthorized;
  const profileInput = membership
    ? { ...peopleScope, membershipId: membership.id }
    : null;
  const canViewAttendance =
    context.moduleContext.enabledModules.has("HR") &&
    hasBusinessCapability(context.access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canViewLeave =
    context.moduleContext.enabledModules.has("HR") &&
    hasBusinessCapability(context.access, "VIEW_LEAVE");
  const canViewPayrollSummary =
    context.moduleContext.enabledModules.has("PAYROLL") &&
    hasBusinessCapability(context.access, "VIEW_PAYROLL_RUN");

  if (
    membership &&
    profileInput &&
    areaAuthorized &&
    ["overview", "work", "access"].includes(activeSection)
  ) {
    const [overview, personal, employment, attendance, overviewLeave, overviewPayroll] = await Promise.all([
      getEmployeeProfileOverview(profileInput),
      getEmployeeProfilePersonal(profileInput),
      context.moduleContext.enabledModules.has("HR")
        ? getEmployeeProfileEmployment(profileInput)
        : Promise.resolve(null),
      activeSection === "overview" && canViewAttendance
        ? loadEmployeeAttendanceSection(profileInput)
        : Promise.resolve(null),
      activeSection === "overview" && canViewLeave
        ? loadEmployeeLeaveSection(profileInput)
        : Promise.resolve(null),
      activeSection === "overview" && canViewPayrollSummary
        ? loadEmployeePayrollSummary({
            access: context.access,
            allowedBranchIds: scope.allowedBranchIds,
            businessId: context.businessId,
            membershipId: membership.id,
          })
        : Promise.resolve(null),
    ]);
    if (!overview || !personal) {
      notFound();
    }
    if (activeSection === "overview") sectionContent = (
      <EmployeeProfileOverview
        attendance={attendance}
        employment={employment}
        leave={overviewLeave}
        overview={overview}
        payroll={overviewPayroll}
        personal={personal}
      />
    );
    if (activeSection === "work") {
      sectionContent = <EmployeeProfileWork employment={employment} overview={overview} />;
    }
    if (activeSection === "access") {
      sectionContent = (
        <EmployeeProfileAccess
          employment={employment}
          overview={overview}
          personal={personal}
        />
      );
    }
  }

  if (
    !membership &&
    staff &&
    areaAuthorized &&
    activeSection === "overview"
  ) {
    sectionContent = <EmployeeProfileCoreStaffOverview data={staff} />;
  }

  if (membership && areaAuthorized && activeSection === "time") {
    const timeItems = [
      ...(canViewAttendance ? [{ key: "attendance", label: "Attendance" }] : []),
      ...(canViewLeave ? [{ key: "leave", label: "Leave" }] : []),
    ];
    if (activeView === "attendance") sectionAuthorized = canViewAttendance;
    if (activeView === "leave") sectionAuthorized = canViewLeave;
    let timeContent = null;
    if (activeView === "attendance" && canViewAttendance) {
    const attendance = await loadEmployeeAttendanceSection({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!attendance) {
      notFound();
    }
      timeContent = <EmployeeProfileAttendance data={attendance} />;
    }
    if (activeView === "leave" && canViewLeave) {
      leaveData = await loadEmployeeLeaveSection({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!leaveData) {
      notFound();
    }
      timeContent = (
      <EmployeeProfileLeave
        canAdjustBalance={canAdjustLeaveBalance}
        data={leaveData}
      />
    );
    }
    if (activeView === "summary") {
      if (canViewAttendance && canViewLeave) {
        const [attendance, leave] = await Promise.all([
          loadEmployeeAttendanceSection({ ...peopleScope, membershipId: membership.id }),
          loadEmployeeLeaveSection({ ...peopleScope, membershipId: membership.id }),
        ]);
        if (!attendance || !leave) notFound();
        leaveData = leave;
        timeContent = (
          <EmployeeProfileTimeSummary
            attendance={attendance}
            canAdjustBalance={canAdjustLeaveBalance}
            leave={leave}
            personId={person.id}
          />
        );
      } else if (canViewAttendance) {
        const attendance = await loadEmployeeAttendanceSection({ ...peopleScope, membershipId: membership.id });
        if (!attendance) notFound();
        timeContent = <EmployeeProfileAttendance data={attendance} />;
      } else if (canViewLeave) {
        leaveData = await loadEmployeeLeaveSection({ ...peopleScope, membershipId: membership.id });
        if (!leaveData) notFound();
        timeContent = <EmployeeProfileLeave canAdjustBalance={canAdjustLeaveBalance} data={leaveData} />;
      }
    }
    sectionContent = (
      <>
        <EmployeeProfileAreaTabs
          activeView={activeView}
          items={[{ key: "summary", label: "Summary" }, ...timeItems]}
          personId={person.id}
          section="time"
        />
        {timeContent}
      </>
    );
  }

  if (membership && areaAuthorized && activeSection === "compensation") {
    const compensationItems = [
      { key: "summary", label: "Summary", allowed: true },
      { key: "payroll", label: "Pay & payroll", allowed: context.moduleContext.enabledModules.has("PAYROLL") && hasBusinessCapability(context.access, "VIEW_COMPENSATION") },
      { key: "commission", label: "Commission", allowed: context.moduleContext.enabledModules.has("COMMISSION") && hasBusinessCapability(context.access, "VIEW_COMMISSION") },
      { key: "claims", label: "Claims", allowed: context.moduleContext.enabledModules.has("CLAIMS") && hasBusinessCapability(context.access, "VIEW_CLAIM") },
      { key: "statutory", label: "Statutory & tax", allowed: context.moduleContext.enabledModules.has("STATUTORY") && (hasBusinessCapability(context.access, "VIEW_STATUTORY_PROFILE") || hasBusinessCapability(context.access, "VIEW_TAX_PROFILE")) },
    ].filter((item) => item.allowed);
    const selectedItem = compensationItems.find((item) => item.key === activeView);
    sectionAuthorized = Boolean(selectedItem);
    let compensationContent = null;

  if (activeView === "summary" && selectedItem) {
    const summaryItems: EmployeeCompensationOverviewItem[] = [];
    const payrollProfileInput = {
      access: context.access,
      allowedBranchIds: scope.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membership.id,
    };
    if (compensationItems.some((item) => item.key === "payroll")) {
      const [bank, compensation, payrollSummary] = await Promise.all([
        loadEmployeeBankSection(payrollProfileInput),
        loadEmployeeCompensationSection(payrollProfileInput),
        loadEmployeePayrollSummary(payrollProfileInput),
      ]);
      const monthlyItems = compensation.status === "READY"
        ? compensation.data.recurringPayComponents.filter((item) => item.state !== "ENDED").length
        : 0;
      const salary = compensation.status === "READY" && compensation.data.baseRate
        ? formatProfileMoney(compensation.data.baseRate)
        : "Salary not set";
      const bankLabel = bank.status === "READY" && bank.data.bank
        ? `${bank.data.bank.bankName} ${bank.data.bank.accountNumber}`
        : "Bank account not set";
      const readiness = payrollSummary.status === "READY"
        ? payrollSummary.data.readiness
        : "Restricted";
      summaryItems.push({
        description: `${salary} · ${monthlyItems} monthly item${monthlyItems === 1 ? "" : "s"}`,
        key: "payroll",
        primary: readiness === "READY" ? "Ready" : readiness === "Restricted" ? readiness : "Needs attention",
        secondary: bankLabel,
        title: "Pay & payroll",
        tone: readiness === "READY" ? "ready" : "attention",
      });
    }
    if (compensationItems.some((item) => item.key === "commission")) {
      const commission = await loadEmployeeCommissionSection({
        businessId: context.businessId,
        membershipId: membership.id,
      });
      if (commission) {
        const personalRates = commission.overrides.length;
        const itemRates = commission.itemOverrides.length;
        summaryItems.push({
          description: `${personalRates} category rate${personalRates === 1 ? "" : "s"}`,
          key: "commission",
          primary: itemRates ? `${itemRates} special item${itemRates === 1 ? "" : "s"}` : "Company rules",
          secondary: itemRates ? "Employee-specific item rates apply first" : "No special item rates",
          title: "Commission",
          tone: "neutral",
        });
      }
    }
    if (compensationItems.some((item) => item.key === "claims")) {
      const claims = await loadEmployeeClaimsSection({
        businessId: context.businessId,
        membershipId: membership.id,
        allowedBranchIds: scope.allowedBranchIds,
      });
      summaryItems.push({
        description: claims.total ? `${claims.total} recent claim${claims.total === 1 ? "" : "s"}` : "No claims yet",
        key: "claims",
        primary: claims.submitted ? `${claims.submitted} pending` : "Up to date",
        secondary: claims.reimbursementPending ? `${claims.reimbursementPending} reimbursement${claims.reimbursementPending === 1 ? "" : "s"} pending` : "No reimbursement pending",
        title: "Claims",
        tone: claims.submitted || claims.reimbursementPending ? "attention" : "neutral",
      });
    }
    if (compensationItems.some((item) => item.key === "statutory")) {
      const statutory = await loadEmployeeStatutoryProfileSection(payrollProfileInput);
      const statutoryData = statutory.status === "READY" && statutory.statutory.status === "READY"
        ? statutory.statutory.data
        : null;
      const taxData = statutory.status === "READY" && statutory.tax.status === "READY"
        ? statutory.tax.data
        : null;
      const profileReady = Boolean(statutoryData && taxData);
      const schemes = statutoryData
        ? [statutoryData.epfEnabled, statutoryData.socsoEnabled, statutoryData.eisEnabled].filter(Boolean).length
        : 0;
      const taxReady = Boolean(taxData && (taxData.tin || taxData.tinMasked));
      summaryItems.push({
        description: profileReady ? `${schemes} statutory scheme${schemes === 1 ? "" : "s"} enabled` : "Profile access restricted",
        key: "statutory",
        primary: profileReady && taxReady ? "Configured" : "Needs attention",
        secondary: taxReady ? "Tax identity recorded" : "Tax identity needs review",
        title: "Statutory & tax",
        tone: profileReady && taxReady ? "ready" : "attention",
      });
    }
    compensationContent = (
      <EmployeeProfileCompensationHome items={summaryItems} personId={person.id} />
    );
  }

  if (activeView === "claims" && selectedItem) {
    const claims = await loadEmployeeClaimsSection({
      businessId: context.businessId,
      membershipId: membership.id,
      allowedBranchIds: scope.allowedBranchIds,
    });
    compensationContent = <EmployeeProfileClaims data={claims} />;
  }

  if (activeView === "commission" && selectedItem) {
    const commission = await loadEmployeeCommissionSection({
      businessId: context.businessId,
      membershipId: membership.id,
    });
    if (!commission) {
      notFound();
    }
    compensationContent = (
      <EmployeeProfileCommission
        action={saveEmployeeCommissionOverrideAction}
        itemAction={saveEmployeeCommissionItemOverrideAction}
        canManage={hasBusinessCapability(
          context.access,
          "MANAGE_COMMISSION_RULES",
        )}
        data={commission}
        membershipId={membership.id}
      />
    );
  }

  if (activeView === "payroll" && selectedItem) {
    const payrollProfileInput = {
      access: context.access,
      allowedBranchIds: scope.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membership.id,
    };
    const [bank, compensation, payrollNavigation, payrollSummary] =
      await Promise.all([
        loadEmployeeBankSection(payrollProfileInput),
        loadEmployeeCompensationSection(payrollProfileInput),
        loadEmployeePayrollNavigationSection(payrollProfileInput),
        loadEmployeePayrollSummary(payrollProfileInput),
      ]);
    if (compensation.status === "NOT_FOUND" || bank.status === "NOT_FOUND") {
      notFound();
    }
    compensationContent = (
      <EmployeeProfilePayroll
        bank={bank}
        bankDialogError={query.bankDialogError?.slice(0, 180) ?? null}
        bankDialogInitiallyOpen={query.bankDialog === "1"}
        compensation={compensation}
        employeeName={membership.fullName}
        navigation={payrollNavigation}
        summary={payrollSummary}
        notice={parsePayrollUpdateNotice(query)}
      />
    );
  }

  if (activeView === "statutory" && selectedItem) {
    const statutoryProfile = await loadEmployeeStatutoryProfileSection({
      access: context.access,
      allowedBranchIds: scope.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membership.id,
    });
    if (statutoryProfile.status === "NOT_FOUND") notFound();
    compensationContent = (
      <EmployeeProfileStatutory
        notice={parsePayrollUpdateNotice(query)}
        profileEditHref={`${profilePath}&edit=profile`}
        statutoryProfile={statutoryProfile}
      />
    );
  }
    sectionContent = (
      <>
        <EmployeeProfileAreaTabs
          activeView={activeView}
          items={compensationItems.map(({ key, label }) => ({ key, label }))}
          personId={person.id}
          section="compensation"
        />
        {compensationContent}
      </>
    );
  }

  const editData =
    editProfileOpen && linkedStaffId
      ? await loadProfileEditData({
          allowedBranchIds: scope.allowedBranchIds,
          businessId: context.businessId,
          linkedStaffId,
          peopleScope,
          wholeBusinessScope: peopleScope.wholeBusinessScope,
        })
      : null;

  const canEditCompensation =
    context.moduleContext.enabledModules.has("PAYROLL") &&
    hasBusinessCapability(context.access, "EDIT_COMPENSATION");
  const canManagePermissions = hasBusinessCapability(
    context.access,
    "MANAGE_TEAM_PERMISSIONS",
  );

  return (
    <>
      <EmployeeProfileShell
        activeSection={activeSection}
        avatarAction={
          membership && canManageTeam
            ? updateEmployeeAvatarAction.bind(null, membership.id)
            : undefined
        }
        authorized={sectionAuthorized}
        editHref={
          activeSection === "overview"
            ? profileEditHref
            : undefined
        }
        notice={parseProfileUpdateNotice(query)}
        person={person}
        sectionContent={sectionContent}
        profileLabel={
          context.moduleContext.enabledModules.has("HR")
            ? "People & HR"
            : "People"
        }
        visibleTabs={getVisibleEmployeeProfileTabs(
          context.access,
          context.moduleContext.enabledModules,
        )}
      />
      {editData ? (
        <StaffEditModal
          action={updateStaffAction}
          allowHrFields={context.moduleContext.enabledModules.has("HR")}
          allowPayrollFields={canEditCompensation}
          assignedBranchIds={editData.staff.employeeBusinessMembership.branchAssignments.map(
            (assignment) => assignment.branchId,
          )}
          branches={editData.branches}
          canManagePermissions={canManagePermissions}
          closePath={profilePath}
          enabledModules={[...context.moduleContext.enabledModules]}
          employeeProfile={{
            id: editData.staff.employeeBusinessMembership.id,
            attendanceEnabled:
              editData.staff.employeeBusinessMembership.attendanceEnabled,
            canClockInBranchIds:
              editData.staff.employeeBusinessMembership.branchAssignments
                .filter((assignment) => assignment.canClockIn)
                .map((assignment) => assignment.branchId),
            dateOfBirth:
              editData.staff.employeeBusinessMembership.dateOfBirth
                ?.toISOString()
                .slice(0, 10) ?? "",
            employeeCode:
              editData.staff.employeeBusinessMembership.employeeCode,
            employmentType:
              editData.staff.employeeBusinessMembership.employmentType,
            joinedAt: editData.staff.employeeBusinessMembership.joinedAt
              .toISOString()
              .slice(0, 10),
            primaryBranchId:
              editData.staff.employeeBusinessMembership.branchAssignments.find(
                (assignment) => assignment.isPrimary,
              )?.branchId ?? "",
            status: editData.staff.employeeBusinessMembership.status,
          }}
          industryType={context.industryType}
          returnTo={profilePath}
          roleProfiles={editData.roleProfiles}
          selectedServiceIds={editData.staff.serviceStaffAssignments.map(
            (assignment) => assignment.serviceId,
          )}
          services={editData.services}
          staff={{
            appointmentBookable: editData.staff.appointmentBookable,
            branchId: editData.staff.branchId,
            email: editData.staff.email,
            id: editData.staff.id,
            loginEnabled: editData.staff.loginEnabled,
            name: editData.staff.name,
            permissions: editData.staff.permissions,
            staffLevelId: editData.staff.staffLevelId,
            staffRoleProfileId: editData.staff.staffRoleProfileId,
            status: editData.staff.status,
            whatsappPhone: editData.staff.whatsappPhone,
          }}
          staffLevels={editData.staffLevels}
        />
      ) : null}
      {leaveData &&
      membership &&
      activeSection === "time" &&
      (activeView === "leave" || activeView === "summary") &&
      query.manageLeave === "1" &&
      canAdjustLeaveBalance ? (
        <EmployeeLeaveBalanceModal
          data={leaveData}
          employeeCode={membership.employeeCode}
          employeeName={membership.fullName}
          notice={parseProfileUpdateNotice(query)}
        />
      ) : null}
    </>
  );
}

function formatProfileMoney(value: string) {
  return new Intl.NumberFormat("en-MY", {
    currency: "MYR",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

async function loadProfileEditData({
  allowedBranchIds,
  businessId,
  linkedStaffId,
  peopleScope,
  wholeBusinessScope,
}: {
  allowedBranchIds: readonly string[];
  businessId: string;
  linkedStaffId: string;
  peopleScope: {
    allowedBranchIds: readonly string[];
    businessId: string;
    now: Date;
    wholeBusinessScope: boolean;
  };
  wholeBusinessScope: boolean;
}) {
  const allowedBranchIdSet = new Set(allowedBranchIds);
  const [staff, branches, roleProfiles, staffLevels, services] =
    await Promise.all([
      prisma.user.findFirst({
        where: {
          ...buildPeopleStaffScopeWhere(peopleScope),
          id: linkedStaffId,
          role: "STAFF",
        },
        select: {
          appointmentBookable: true,
          branchId: true,
          email: true,
          id: true,
          loginEnabled: true,
          name: true,
          permissions: true,
          staffLevelId: true,
          staffRoleProfileId: true,
          status: true,
          whatsappPhone: true,
          employeeBusinessMembership: {
            select: {
              id: true,
              attendanceEnabled: true,
              dateOfBirth: true,
              employeeCode: true,
              employmentType: true,
              joinedAt: true,
              status: true,
              branchAssignments: {
                where: wholeBusinessScope
                  ? { status: "ACTIVE" }
                  : {
                      status: "ACTIVE",
                      branchId: { in: [...allowedBranchIds] },
                    },
                select: {
                  branchId: true,
                  canClockIn: true,
                  isPrimary: true,
                },
              },
            },
          },
          serviceStaffAssignments: { select: { serviceId: true } },
        },
      }),
      getActiveBranches(businessId).then((items) =>
        wholeBusinessScope
          ? items
          : items.filter((branch) => allowedBranchIdSet.has(branch.id)),
      ),
      prisma.staffRoleProfile.findMany({
        where: { active: true, businessId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.staffLevel.findMany({
        where: { active: true, businessId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.service.findMany({
        where: { businessId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const employeeBusinessMembership = staff?.employeeBusinessMembership;
  if (!staff || !employeeBusinessMembership) return null;
  return {
    branches,
    roleProfiles,
    services,
    staff: { ...staff, employeeBusinessMembership },
    staffLevels,
  };
}

function parseProfileUpdateNotice(query: {
  message?: string;
  type?: string;
}) {
  if (!query.message || !["error", "success"].includes(query.type ?? "")) {
    return null;
  }
  return {
    message: query.message.slice(0, 180),
    tone: query.type as "error" | "success",
  };
}

function parsePayrollUpdateNotice(query: {
  affectedDrafts?: string;
  artifactCount?: string;
  artifactWarning?: string;
  changedFields?: string;
  effectiveMonth?: string;
  finalizedCount?: string;
  newRevision?: string;
  payrollUpdate?: string;
  payrollUpdateMessage?: string;
  payrollUpdateStatus?: string;
  reviewCount?: string;
}) {
  if (
    !["bank", "compensation", "statutory", "tax", "work-target"].includes(
      query.payrollUpdate ?? "",
    ) ||
    (query.payrollUpdateStatus !== "success" &&
      query.payrollUpdateStatus !== "error")
  )
    return null;
  const draftCount = z.coerce
    .number()
    .int()
    .min(0)
    .max(999)
    .safeParse(query.affectedDrafts);
  const artifactCount = safeNoticeCount(query.artifactCount);
  const finalizedCount = safeNoticeCount(query.finalizedCount);
  const reviewCount = safeNoticeCount(query.reviewCount);
  const newRevision = z.coerce
    .number()
    .int()
    .min(0)
    .max(999999)
    .safeParse(query.newRevision);
  const changedFields = (query.changedFields ?? "")
    .split(",")
    .filter((field) => /^[A-Za-z][A-Za-z0-9]{1,39}$/.test(field))
    .slice(0, 12);
  const effectiveMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(
    query.effectiveMonth ?? "",
  )
    ? query.effectiveMonth!
    : null;
  return {
    affectedDrafts: draftCount.success ? draftCount.data : null,
    artifactCount,
    changedFields,
    existingArtifactWarning: query.artifactWarning === "true",
    effectiveMonth,
    finalizedCount,
    kind: query.payrollUpdate as
      "compensation" | "bank" | "statutory" | "tax" | "work-target",
    message: (query.payrollUpdateMessage ?? "Payroll profile updated.").slice(
      0,
      180,
    ),
    newRevision: newRevision.success ? newRevision.data : null,
    reviewCount,
    status: query.payrollUpdateStatus,
  } as const;
}

function safeNoticeCount(value: string | undefined) {
  const parsed = z.coerce.number().int().min(0).max(999).safeParse(value);
  return parsed.success ? parsed.data : null;
}
