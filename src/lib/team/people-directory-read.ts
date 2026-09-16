import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasBusinessCapability, type ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { getPayrollPeriodReadiness } from "@/lib/payroll/readiness";
import { buildCurrentPeopleAssignmentWhere, buildPeopleMembershipScopeWhere, type PeopleScopeInput } from "./people-scope";
import {
  employeeIssueCopy, filterPeople, peopleMonth, peoplePage,
  rowMatchesNonStatusFilters, rowMatchesPeopleFilter, type PeopleContext,
  type PeopleEmployee, type PeopleIssue, type PeopleIssueCategory,
} from "./people-presentation";
import type { ModuleKey } from "@/lib/modules/registry";

const PAGE_SIZE = 25;
const ATTENDANCE_CODES = new Set([
  "MISSING_LOCKED_TIMESHEET", "STALE_ATTENDANCE_SOURCE", "TIMESHEET_REVISION_INVALID",
  "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED", "ATTENDANCE_PAY_POLICY_NOT_READY",
  "LEGACY_ATTENDANCE_INPUT", "OVERTIME_APPROVAL_SOURCE_NOT_READY",
]);

function issueCategory(code: string): PeopleIssueCategory {
  return ATTENDANCE_CODES.has(code) ? "ATTENDANCE" : "PAYROLL";
}

/** One tenant/branch-scoped employee projection. Account-only users are deliberately excluded. */
export async function loadPeopleDirectory(
  input: PeopleScopeInput & {
    access: ResolvedBusinessAccess;
    context?: PeopleContext;
    modules: ReadonlySet<ModuleKey>;
  },
  db: PrismaClient = prisma,
) {
  if (!input.access.granted || !hasBusinessCapability(input.access, "VIEW_TEAM_DIRECTORY")) return null;
  const [memberships, business, branches] = await Promise.all([
    db.employeeBusinessMembership.findMany({
      where: buildPeopleMembershipScopeWhere(input),
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      select: {
        id: true, avatarUrl: true, fullName: true, employeeCode: true,
        phoneNumberNormalized: true, joinedAt: true, terminatedAt: true,
        status: true, position: true, isTestAccount: true,
        staffUser: { select: { email: true } },
        branchAssignments: {
          where: buildCurrentPeopleAssignmentWhere(input),
          select: { isPrimary: true, branch: { select: { id: true, name: true } } },
        },
      },
    }),
    db.business.findUnique({ where: { id: input.businessId }, select: { timezone: true, language: true } }),
    db.branch.findMany({ where: { businessId: input.businessId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  const defaultMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: business?.timezone || "Asia/Kuching", year: "numeric", month: "2-digit",
  }).format(input.now);
  const context = input.context ?? {};
  const zh = business?.language === "ZH";
  const copy = (en: string, chinese: string) => zh ? chinese : en;
  const month = peopleMonth(context.month ?? (context.fromHrHome === "1" ? context.homeMonth : undefined), defaultMonth);
  const wholeBusiness = input.wholeBusinessScope && branches.every(branch => input.allowedBranchIds.includes(branch.id));
  const canAttendance = input.modules.has("HR") && wholeBusiness && hasBusinessCapability(input.access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canPayroll = input.modules.has("PAYROLL") && wholeBusiness && hasBusinessCapability(input.access, "VIEW_PAYROLL_RUN");
  const shouldCheckReadiness = canAttendance || canPayroll;
  const payroll = shouldCheckReadiness
    ? await getPayrollPeriodReadiness({ businessId: input.businessId, month }, db).catch(() => null)
    : null;
  const byId = new Map(payroll?.employees.map(employee => [employee.membershipId, employee]) ?? []);

  const rows: PeopleEmployee[] = memberships.map(membership => {
    const issues: PeopleIssue[] = [];
    const profileIssues = [
      ...(!membership.fullName.trim() ? [["PROFILE_NAME", copy("Name is missing.", "姓名未填写。")]] : []),
      ...(!membership.employeeCode.trim() ? [["PROFILE_CODE", copy("Employee code is missing.", "员工编号未填写。")]] : []),
      ...(!membership.phoneNumberNormalized ? [["PROFILE_PHONE", copy("Mobile number is missing.", "手机号码未填写。")]] : []),
      ...(!membership.position?.trim() ? [["PROFILE_POSITION", copy("Position is missing.", "职位未填写。")]] : []),
      ...(membership.branchAssignments.filter(branch => branch.isPrimary).length !== 1
        ? [["PROFILE_PRIMARY_BRANCH", copy("Primary workplace needs review.", "主要工作地点需要复核。")]] : []),
    ] as [string, string][];
    for (const [code, message] of profileIssues) issues.push({ category: "PROFILE", code, message });

    const readiness = byId.get(membership.id);
    if (shouldCheckReadiness && !payroll && membership.status === "ACTIVE") {
      issues.push({ category: "PAYROLL", code: "READINESS_UNAVAILABLE", message: copy("Readiness checks are temporarily unavailable.", "就绪检查暂时不可用。") });
    }
    if (readiness) for (const issue of readiness.issues) {
      if (issue.severity === "INFO") continue;
      const category = issueCategory(issue.code);
      if (category === "ATTENDANCE" && !canAttendance) continue;
      if (category === "PAYROLL" && !canPayroll) continue;
      if (/BANK/.test(issue.code) && !hasBusinessCapability(input.access, "VIEW_BANK_ACCOUNT")) continue;
      if (/STATUTORY|EPF|SOCSO|EIS|LINDUNG/.test(issue.code) && !hasBusinessCapability(input.access, "VIEW_STATUTORY_PROFILE")) continue;
      if (/PCB|TAX/.test(issue.code) && !hasBusinessCapability(input.access, "VIEW_TAX_PROFILE")) continue;
      const translated = zh
        ? category === "ATTENDANCE"
          ? issue.code === "MISSING_LOCKED_TIMESHEET" ? "本工资期需要已锁定的出勤工时表。" : "出勤资料需要复核。"
          : /BANK/.test(issue.code) ? "付款前需要复核银行资料；这不代表工资计算失败。" : "工资设置需要复核。"
        : employeeIssueCopy(issue, month);
      issues.push({ category, code: issue.code, message: translated });
    }
    const inactive = membership.status !== "ACTIVE";
    const onboarding = !inactive && membership.joinedAt > input.now;
    const unavailable = issues.some(issue => issue.code === "READINESS_UNAVAILABLE");
    return {
      id: membership.id,
      avatarUrl: membership.avatarUrl,
      fullName: membership.fullName,
      employeeCode: membership.employeeCode,
      phone: membership.phoneNumberNormalized,
      email: membership.staffUser?.email ?? null,
      position: membership.position,
      status: membership.status,
      joinedAt: membership.joinedAt,
      terminatedAt: membership.terminatedAt,
      isTestAccount: membership.isTestAccount,
      branches: membership.branchAssignments.map(assignment => ({ ...assignment.branch, isPrimary: assignment.isPrimary })),
      issues,
      readiness: inactive ? "INACTIVE" : onboarding ? "ONBOARDING" : unavailable ? "UNKNOWN" : issues.length ? "ATTENTION" : "READY",
      attendanceChecked: Boolean(readiness) && canAttendance,
      payrollChecked: Boolean(readiness) && canPayroll,
    };
  });

  const nonStatusRows = rows.filter(row => rowMatchesNonStatusFilters(row, context));
  const summary = {
    all: nonStatusRows.length,
    ready: nonStatusRows.filter(row => rowMatchesPeopleFilter(row, "ready")).length,
    attention: nonStatusRows.filter(row => rowMatchesPeopleFilter(row, "attention")).length,
    inactive: nonStatusRows.filter(row => rowMatchesPeopleFilter(row, "inactive")).length,
  };
  const filteredRows = filterPeople(rows, context);
  const requestedPage = peoplePage(context.page);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const positions = [...new Set(memberships.map(membership => membership.position?.trim()).filter((value): value is string => Boolean(value)))].sort();

  return {
    rows: filteredRows.slice(start, start + PAGE_SIZE),
    summary,
    positions,
    language: business?.language ?? "EN",
    hiddenTestAccounts: rows.filter(row => row.isTestAccount && rowMatchesNonStatusFilters(row, { ...context, testAccounts: "show" })).length,
    month,
    pagination: { page, pageCount, totalPages: pageCount, pageSize: PAGE_SIZE, total: filteredRows.length },
    permissions: {
      canAttendance,
      canPayroll,
      canEditProfile: hasBusinessCapability(input.access, "MODIFY_TEAM"),
    },
    readinessStatus: payroll ? "CHECKED" as const : shouldCheckReadiness ? "UNKNOWN" as const : "NO_ACCESS" as const,
    checkedScope: [
      copy("Profile and employment fields", "个人与雇佣资料"),
      canAttendance ? copy("attendance source and locked timesheet", "出勤来源与已锁定工时表") : null,
      canPayroll ? copy("payroll setup visible to your role", "您角色可见的工资设置") : null,
    ].filter(Boolean).join(", "),
  };
}
