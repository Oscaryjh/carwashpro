import { notFound } from "next/navigation";
import { z } from "zod";
import {
  EmployeeProfileShell,
  type EmployeeProfileShellPerson,
} from "@/components/employee-profile-shell";
import {
  EmployeeProfileEmployment,
  EmployeeProfileOverview,
} from "@/components/employee-profile-phase2a";
import { EmployeeProfileAttendance } from "@/components/employee-profile-attendance";
import { EmployeeProfileLeave } from "@/components/employee-profile-leave";
import { EmployeeProfileClaims } from "@/components/employee-profile-claims";
import {
  EmployeeProfileCoreStaffOverview,
  EmployeeProfileCoreStaffPersonal,
  EmployeeProfilePersonal,
} from "@/components/employee-profile-personal";
import {
  EmployeeProfilePayroll,
  EmployeeProfileStatutory,
} from "@/components/employee-profile-payroll";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import {
  canViewEmployeeProfileTab,
  getVisibleEmployeeProfileTabs,
  isEmployeeProfileSection,
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
import { loadEmployeeCompensationSection } from "@/lib/team/employee-profile-compensation-read";
import { loadEmployeeStatutoryProfileSection } from "@/lib/team/employee-profile-statutory-read";
import { loadEmployeePayrollNavigationSection } from "@/lib/team/employee-profile-payroll-navigation-read";
import { loadEmployeePayrollSummary } from "@/lib/team/employee-profile-payroll-summary-read";
import { loadEmployeeBankSection } from "@/lib/team/employee-profile-bank-read";
import { updateEmployeeAvatarAction } from "./avatar-actions";

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
    reviewCount?: string;
    section?: string;
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

  const activeSection = isEmployeeProfileSection(query.section)
    ? query.section
    : "overview";
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
        status: true,
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
        employmentType: null,
        status: membership.status,
        primaryBranchName:
          membership.branchAssignments.find((assignment) => assignment.isPrimary)
            ?.branch.name ?? membership.branchAssignments[0]?.branch.name ?? null,
        linked: true,
      }
    : {
        id: staff!.id,
        avatarUrl: null,
        fullName: staff!.name,
        employeeCode: null,
        employmentType: null,
        status: staff!.status,
        primaryBranchName: staff!.branch?.name ?? null,
        linked: false,
      };

  let sectionContent = null;
  const sectionAuthorized = canViewEmployeeProfileTab(
    context.access,
    activeSection,
    context.moduleContext.enabledModules,
  );

  if (membership && sectionAuthorized && activeSection === "overview") {
    const overview = await getEmployeeProfileOverview({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!overview) {
      notFound();
    }
    sectionContent = <EmployeeProfileOverview data={overview} />;
  }

  if (!membership && staff && sectionAuthorized && activeSection === "overview") {
    sectionContent = <EmployeeProfileCoreStaffOverview data={staff} />;
  }

  if (membership && sectionAuthorized && activeSection === "personal") {
    const personal = await getEmployeeProfilePersonal({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!personal) {
      notFound();
    }
    sectionContent = <EmployeeProfilePersonal data={personal} />;
  }

  if (!membership && staff && sectionAuthorized && activeSection === "personal") {
    sectionContent = <EmployeeProfileCoreStaffPersonal data={staff} />;
  }

  if (membership && sectionAuthorized && activeSection === "employment") {
    const employment = await getEmployeeProfileEmployment({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!employment) {
      notFound();
    }
    sectionContent = <EmployeeProfileEmployment data={employment} />;
  }

  if (membership && sectionAuthorized && activeSection === "attendance") {
    const attendance = await loadEmployeeAttendanceSection({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!attendance) {
      notFound();
    }
    sectionContent = <EmployeeProfileAttendance data={attendance} />;
  }

  if (membership && sectionAuthorized && activeSection === "leave") {
    const leave = await loadEmployeeLeaveSection({
      ...peopleScope,
      membershipId: membership.id,
    });
    if (!leave) {
      notFound();
    }
    sectionContent = <EmployeeProfileLeave data={leave} />;
  }

  if (membership && sectionAuthorized && activeSection === "claims") {
    const claims = await loadEmployeeClaimsSection({
      businessId: context.businessId,
      membershipId: membership.id,
      allowedBranchIds: scope.allowedBranchIds,
    });
    sectionContent = <EmployeeProfileClaims data={claims} />;
  }

  if (membership && sectionAuthorized && activeSection === "payroll") {
    const payrollProfileInput = {
      access: context.access,
      allowedBranchIds: scope.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membership.id,
    };
    const [bank, compensation, payrollNavigation, payrollSummary] = await Promise.all([
      loadEmployeeBankSection(payrollProfileInput),
      loadEmployeeCompensationSection(payrollProfileInput),
      loadEmployeePayrollNavigationSection(payrollProfileInput),
      loadEmployeePayrollSummary(payrollProfileInput),
    ]);
    if (
      compensation.status === "NOT_FOUND" ||
      bank.status === "NOT_FOUND"
    ) {
      notFound();
    }
    sectionContent = (
      <EmployeeProfilePayroll
        bank={bank}
        compensation={compensation}
        employeeName={membership.fullName}
        navigation={payrollNavigation}
        summary={payrollSummary}
        notice={parsePayrollUpdateNotice(query)}
      />
    );
  }

  if (membership && sectionAuthorized && activeSection === "statutory") {
    const statutoryProfile = await loadEmployeeStatutoryProfileSection({
      access: context.access,
      allowedBranchIds: scope.allowedBranchIds,
      businessId: context.businessId,
      membershipId: membership.id,
    });
    if (statutoryProfile.status === "NOT_FOUND") notFound();
    sectionContent = (
      <EmployeeProfileStatutory
        notice={parsePayrollUpdateNotice(query)}
        profileEditHref={`/team/people/${person.id}?section=overview`}
        statutoryProfile={statutoryProfile}
      />
    );
  }

  return (
    <EmployeeProfileShell
      activeSection={activeSection}
      avatarAction={
        membership && hasBusinessCapability(context.access, "MODIFY_TEAM")
          ? updateEmployeeAvatarAction.bind(null, membership.id)
          : undefined
      }
      authorized={sectionAuthorized}
      person={person}
      sectionContent={sectionContent}
      profileLabel={context.moduleContext.enabledModules.has("HR") ? "People & HR" : "People"}
      visibleTabs={getVisibleEmployeeProfileTabs(
        context.access,
        context.moduleContext.enabledModules,
      )}
    />
  );
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
    (query.payrollUpdateStatus !== "success" && query.payrollUpdateStatus !== "error")
  ) return null;
  const draftCount = z.coerce.number().int().min(0).max(999).safeParse(query.affectedDrafts);
  const artifactCount = safeNoticeCount(query.artifactCount);
  const finalizedCount = safeNoticeCount(query.finalizedCount);
  const reviewCount = safeNoticeCount(query.reviewCount);
  const newRevision = z.coerce.number().int().min(0).max(999999).safeParse(query.newRevision);
  const changedFields = (query.changedFields ?? "")
    .split(",")
    .filter((field) => /^[A-Za-z][A-Za-z0-9]{1,39}$/.test(field))
    .slice(0, 12);
  const effectiveMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.effectiveMonth ?? "")
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
      | "compensation"
      | "bank"
      | "statutory"
      | "tax"
      | "work-target",
    message: (query.payrollUpdateMessage ?? "Payroll profile updated.").slice(0, 180),
    newRevision: newRevision.success ? newRevision.data : null,
    reviewCount,
    status: query.payrollUpdateStatus,
  } as const;
}

function safeNoticeCount(value: string | undefined) {
  const parsed = z.coerce.number().int().min(0).max(999).safeParse(value);
  return parsed.success ? parsed.data : null;
}
