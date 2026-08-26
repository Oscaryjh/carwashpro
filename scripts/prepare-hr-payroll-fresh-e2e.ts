import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";
import { hashEmployeeIdentifier } from "../src/lib/attendance/employee-auth/crypto";
import {
  createSessionToken,
  persistSessionContext,
  SESSION_CONTEXT_VERSION,
} from "../src/lib/auth/session";

const prisma = new PrismaClient();
const OUTPUT = join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json");
const STAFF_OUTPUT = join(process.cwd(), "..", "CodexTetamuP0-staff-ui", ".tmp", "hr-payroll-fresh-e2e.json");

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertLocal() {
  if (process.env.NODE_ENV === "production") throw new Error("FRESH_E2E_FORBIDDEN_IN_PRODUCTION");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname.toLowerCase())) {
    throw new Error("FRESH_E2E_REQUIRES_LOCAL_DATABASE");
  }
  process.env.SESSION_SECRET ??= "tetamu-local-development-session-secret-v1";
  process.env.EMPLOYEE_AUTH_SECRET ??= "tetamu-local-development-employee-auth-secret-v1";
}

async function appSession(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, businessId: true, branchId: true, name: true, email: true, role: true, permissions: true, status: true },
  });
  if (!user.businessId) throw new Error("APP_USER_BUSINESS_REQUIRED");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: user.businessId }, select: { industryType: true } });
  if (!user.email) throw new Error("APP_USER_EMAIL_REQUIRED");
  const sessionId = randomUUID();
  const session = {
    userId: user.id,
    sessionId,
    homeBusinessId: user.businessId,
    activeBusinessId: user.businessId,
    contextVersion: SESSION_CONTEXT_VERSION,
    industryType: business.industryType,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  };
  const token = await createSessionToken(session);
  await persistSessionContext(session);
  return token;
}

async function main() {
  assertLocal();
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash("FreshE2E-Local-Only!", 10);
  const created = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({ data: { name: `TETAMU Fresh Payroll UAT ${suffix}`, slug: `fresh-payroll-uat-${suffix}`, industryType: "GENERAL_SERVICE", timezone: "Asia/Kuching" } });
    const branch = await tx.branch.create({ data: { businessId: business.id, name: "Fresh UAT Branch", countryCode: "MY", stateCode: "SBH" } });
    const otherBranch = await tx.branch.create({ data: { businessId: business.id, name: "Fresh Other Branch", countryCode: "MY", stateCode: "SBH" } });
    await tx.branchAttendanceSetting.create({ data: { businessId: business.id, branchId: branch.id, latitude: 5.9804, longitude: 116.0735, requireGeofence: false, allowOutsideGeofenceRequest: true, timezone: "Asia/Kuching", isEnabled: true } });
    const owner = await tx.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Fresh Owner 001", email: `fresh.owner.${suffix}@tetamu.local`, passwordHash, role: "BUSINESS_OWNER", status: "active", loginEnabled: true } });
    const allPermissions = ["ALL_BRANCHES","ATTENDANCE_EMPLOYEE_READ","ATTENDANCE_EMPLOYEE_MANAGE","ROSTER_VIEW","ROSTER_MANAGE","VIEW_LEAVE","APPROVE_LEAVE","VIEW_CLAIM","REVIEW_CLAIM","VIEW_COMPENSATION","VIEW_PAYROLL_RUN","VIEW_PAYSLIP","PAYROLL_READ","PAYROLL_MANAGE"];
    const hr = await tx.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Fresh HR 001", email: `fresh.hr.${suffix}@tetamu.local`, passwordHash, role: "STAFF", permissions: allPermissions, status: "active", loginEnabled: true } });
    const manager = await tx.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Fresh Manager 001", email: `fresh.manager.${suffix}@tetamu.local`, passwordHash, role: "STAFF", permissions: ["ATTENDANCE_EMPLOYEE_READ","ATTENDANCE_EMPLOYEE_MANAGE","ROSTER_VIEW","VIEW_LEAVE","APPROVE_LEAVE","VIEW_CLAIM","REVIEW_CLAIM"], status: "active", loginEnabled: true } });
    for (const moduleKey of ["HR","PAYROLL","CLAIMS","COMMISSION"] as const) await tx.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2026-01-01"), source: "SYSTEM", planCode: "LOCAL_FRESH_E2E", createdById: owner.id, updatedById: owner.id } });
    await tx.payrollSetting.create({ data: { businessId: business.id, workingDaysPerMonth: 26, normalWorkMinutesPerDay: 480, breakMinutesPerDay: 60, overtimeMultiplier: 1.5, publicHolidayExtraMultiplier: 2, publicHolidayPayEnabled: false } });

    const makeEmployee = async (name: string, code: string, phone: string, targetBranchId: string) => {
      const account = await tx.employeeAccount.create({ data: { name, phoneNumber: phone, phoneNormalized: phone } });
      const membership = await tx.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: code, fullName: name, phoneNumber: phone, phoneNumberNormalized: phone, employmentType: "FULL_TIME", status: "ACTIVE", attendanceEnabled: true, payBasis: "MONTHLY", baseSalary: 3000, workingDaysPerMonth: 26, normalWorkMinutesPerDay: 480, targetBreakMinutes: 60, statutoryNationality: "MALAYSIAN", joinedAt: new Date("2026-01-01"), position: "Fresh E2E tester" } });
      await tx.employeeBranchAssignment.create({ data: { membershipId: membership.id, businessId: business.id, branchId: targetBranchId, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2026-01-01") } });
      await tx.employeeCompensationVersion.create({ data: { businessId: business.id, membershipId: membership.id, effectiveFromMonth: new Date("2026-08-01"), payBasis: "MONTHLY", baseRate: 3000, source: "MANUAL", reasonType: "DATA_MIGRATION", reasonNote: "LOCAL FRESH E2E baseline", createdById: owner.id } });
      await tx.employeeLindung24ParticipationVersion.create({ data: { businessId: business.id, membershipId: membership.id, revision: 1, effectiveFromMonth: new Date("2026-06-01"), status: "DEFAULT_PARTICIPATING", employerContext: "SINGLE_EMPLOYER", selectedEmployer: "CURRENT_BUSINESS", act4Covered: false, sourceType: "OFFICIAL_TRANSITION", sourceReference: "LOCAL_FRESH_E2E", reason: "Local UAT non-applicable profile", sourceDigest: hash(`l24-${membership.id}`), recordedById: owner.id } });
      const device = await tx.employeeDevice.create({ data: { employeeAccountId: account.id, deviceIdentifierHash: hashEmployeeIdentifier("device", `fresh-${account.id}`), displayName: `${name} UAT browser`, platform: "Browser", browser: "Codex", canView: true, canPunch: true } });
      const session = await createEmployeeSessionRecord({ employeeAccountId: account.id, membershipId: membership.id, businessId: business.id, primaryBranchId: targetBranchId, attendanceBranchId: targetBranchId, deviceId: device.id, now: new Date(), userAgent: "Tetamu Fresh E2E UAT" }, tx);
      return { account, membership, session };
    };
    const employee = await makeEmployee("Fresh Employee 001", `FRESH-${suffix}`, `+6011888${Date.now().toString().slice(-5)}`, branch.id);
    const managerEmployee = await makeEmployee("Fresh Manager 001", `FM-${suffix}`, `+6011777${Date.now().toString().slice(-5)}`, branch.id);
    const otherEmployee = await makeEmployee("Fresh Other Branch Employee", `FO-${suffix}`, `+6011666${Date.now().toString().slice(-5)}`, otherBranch.id);
    await tx.user.update({ where: { id: manager.id }, data: { employeeAccountId: managerEmployee.account.id, employeeBusinessMembershipId: managerEmployee.membership.id, teamMemberLinkStatus: "LINKED", teamMemberLinkedAt: new Date() } });

    const policy = await tx.leavePolicy.create({ data: { businessId: business.id, code: "ANNUAL", name: "Annual leave (Fresh UAT)", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 12, active: true, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY", versions: { create: { businessId: business.id, revision: 1, status: "ACTIVE", effectiveFrom: new Date("2026-01-01"), nameSnapshot: "Annual leave (Fresh UAT)", payTreatment: "PAID", countMode: "CALENDAR_DAYS", balanceTracked: true, defaultEntitlementDays: 12, origin: "BUSINESS_CUSTOM", legalStatus: "COMPANY_POLICY_ONLY", reason: "LOCAL FRESH E2E baseline", createdById: owner.id } } }, include: { versions: true } });
    const entitlement = await tx.employeeLeaveEntitlement.create({ data: { businessId: business.id, membershipId: employee.membership.id, policyId: policy.id, policyVersionId: policy.versions[0].id, leaveYearStart: new Date("2026-01-01"), leaveYearEnd: new Date("2026-12-31"), entitledUnits: 12, rawEntitledUnits: 12, prorationFactor: 1, source: "LOCAL_FRESH_E2E", sourceDigest: hash(`leave-${employee.membership.id}`), createdById: owner.id } });
    await tx.employeeLeaveBalance.create({ data: { businessId: business.id, membershipId: employee.membership.id, policyId: policy.id, year: 2026, entitlementOverrideDays: 12, note: "LOCAL FRESH E2E baseline" } });
    await tx.leaveBalanceLedgerEntry.create({ data: { businessId: business.id, membershipId: employee.membership.id, policyId: policy.id, policyVersionId: policy.versions[0].id, leaveYearStart: new Date("2026-01-01"), eventType: "ENTITLEMENT", units: 12, sourceKey: `fresh:${entitlement.id}`, entitlementId: entitlement.id, reason: "LOCAL FRESH E2E baseline", actorUserId: owner.id } });

    const category = await tx.claimCategory.create({ data: { businessId: business.id, code: "TRAVEL", name: "Fresh UAT travel", nature: "GENERAL", policyRevisions: { create: { revision: 1, status: "ACTIVE", effectiveFrom: new Date("2026-01-01"), nameSnapshot: "Fresh UAT travel", natureSnapshot: "GENERAL", receiptRequired: false, descriptionRequired: true, statutoryTreatmentStatus: "VERIFIED_NON_WAGE", reason: "LOCAL FRESH E2E verified reimbursement", createdById: owner.id } } }, include: { policyRevisions: true } });

    const shift = await tx.rosterShiftTemplate.create({ data: { businessId: business.id, branchId: branch.id, name: "Fresh UAT Day", shortCode: "FUD", startMinute: 540, endMinute: 1080, breakMinutes: 60, breakPaid: false, createdById: owner.id, updatedById: owner.id } });
    const weeks = ["2026-08-24"];
    const assignments: string[] = [];
    for (const week of weeks) {
      const period = await tx.rosterPeriod.create({ data: { businessId: business.id, branchId: branch.id, weekStart: new Date(week), status: "PUBLISHED", draftRevision: 1, publicationRevision: 1, createdById: owner.id, updatedById: owner.id } });
      const publication = await tx.rosterPublication.create({ data: { rosterPeriodId: period.id, businessId: business.id, branchId: branch.id, revision: 1, operationKey: `fresh-e2e-${period.id}`, sourceDigest: hash(period.id), reason: "LOCAL FRESH E2E baseline", publishedById: owner.id } });
      for (const day of [25,26,27]) {
        const workDate = new Date(`2026-08-${day}T00:00:00.000Z`);
        const assignment = await tx.rosterAssignment.create({ data: { rosterPeriodId: period.id, businessId: business.id, branchId: branch.id, membershipId: employee.membership.id, workDate, kind: "WORK_SHIFT", shiftTemplateId: shift.id, shiftNameSnapshot: shift.name, shiftColorSnapshot: shift.colorToken, crossMidnightSnapshot: false, startAt: new Date(`2026-08-${day}T01:00:00.000Z`), endAt: new Date(`2026-08-${day}T10:00:00.000Z`), breakMinutes: 60, breakPaidSnapshot: false, createdById: owner.id, updatedById: owner.id } });
        assignments.push(assignment.id);
        await tx.rosterPublishedAssignment.create({ data: { publicationId: publication.id, sourceAssignmentId: assignment.id, resolvedSource: "WEEKLY_SHIFT_OVERRIDE", businessId: business.id, branchId: branch.id, membershipId: employee.membership.id, workDate, kind: "WORK_SHIFT", shiftTemplateId: shift.id, shiftNameSnapshot: shift.name, shiftColorSnapshot: shift.colorToken, crossMidnightSnapshot: false, startAt: assignment.startAt, endAt: assignment.endAt, breakMinutes: 60, breakPaidSnapshot: false, timezoneSnapshot: "Asia/Kuching" } });
        await tx.attendanceExpectedDay.create({ data: { businessId: business.id, branchId: branch.id, membershipId: employee.membership.id, workDate, kind: "WORKDAY", source: "ROSTER", expectedStartAt: assignment.startAt, expectedEndAt: assignment.endAt, timezoneSnapshot: "Asia/Kuching", evidenceReference: publication.id, createdById: owner.id } });
      }
    }
    return { business, branch, otherBranch, owner, hr, manager, employee, managerEmployee, otherEmployee, policy, category, assignments };
  });

  const artifact = {
    environment: "LOCAL FRESH E2E",
    productionAccessed: false,
    createdAt: new Date().toISOString(),
    payrollPeriod: { start: "2026-08-01", end: "2026-08-31", month: "2026-08", payrollRunId: null, status: "NOT_CREATED" },
    businessId: created.business.id,
    businessName: created.business.name,
    branchId: created.branch.id,
    otherBranchId: created.otherBranch.id,
    owner: { id: created.owner.id, sessionToken: await appSession(created.owner.id) },
    hr: { id: created.hr.id, sessionToken: await appSession(created.hr.id) },
    manager: { id: created.manager.id, membershipId: created.managerEmployee.membership.id, sessionToken: created.managerEmployee.session.token },
    employee: { accountId: created.employee.account.id, membershipId: created.employee.membership.id, employeeCode: created.employee.membership.employeeCode, sessionToken: created.employee.session.token },
    otherEmployee: { membershipId: created.otherEmployee.membership.id },
    leavePolicy: { id: created.policy.id, versionId: created.policy.versions[0].id },
    claimCategory: { id: created.category.id, revisionId: created.category.policyRevisions[0].id },
    rosterAssignmentIds: created.assignments,
  };
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await mkdir(join(process.cwd(), "..", "CodexTetamuP0-staff-ui", ".tmp"), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(artifact, null, 2));
  await writeFile(STAFF_OUTPUT, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ ...artifact, owner: { id: artifact.owner.id }, hr: { id: artifact.hr.id }, manager: { id: artifact.manager.id, membershipId: artifact.manager.membershipId }, employee: { accountId: artifact.employee.accountId, membershipId: artifact.employee.membershipId, employeeCode: artifact.employee.employeeCode } }, null, 2));
}

main().finally(() => prisma.$disconnect());
