import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getBranchLocalDateKey,
} from "../src/lib/attendance/work-date";
import {
  materializeAttendanceP2Day,
  recordExpectedAttendance,
} from "../src/lib/attendance/p2-service";
import { businessWallClockToUtc } from "../src/lib/business-day";
import {
  addDaysToDateValue,
  dateValueToUtcDate,
} from "../src/lib/business-time";
import { installClaimCategoryStarters } from "../src/lib/claim/service";
import { installCompanyLeaveStarter } from "../src/lib/leave/service";
import { prisma } from "../src/lib/prisma";
import { addDays, startOfIsoWeek } from "../src/lib/roster/domain";
import {
  ensureRosterPeriod,
  publishRoster,
  upsertRosterAssignment,
  type RosterServiceContext,
} from "../src/lib/roster/service";
import { saveRosterShiftTemplate } from "../src/lib/roster/shift-template-service";
import { getStaffAppointmentDay } from "../src/lib/staff-pwa/appointments";
import { resolveStaffTeamApprovalAccess } from "../src/lib/staff-pwa/team-approvals";
import { resolveStaffOvertimeAccess } from "../src/lib/staff-pwa/overtime-approvals";

const OUTPUT_PATH = join(process.cwd(), ".tmp", "testing-staff-two-phone-uat-prepared.json");
const BUSINESS_ID = "611b0c19-ebf7-4548-8a48-a3b6a7af8a81";
const BRANCH_ID = "41575966-238f-46ab-a114-22bbee4949c5";
const EMPLOYEE_PHONE = "+601112212259";
const MANAGER_PHONE = "+60128793848";
const EMPLOYEE_NAME = "Real Device UAT Employee";
const MANAGER_NAME = "Real Device UAT Manager";
const MANAGER_EMAIL = "real-device-uat.manager.0128793848@tetamu.local";
const MARKER = "STAFF 3000 TWO PHONE REAL DEVICE UAT";
const MANAGER_PROFILE_NAME = "Staff 3000 Real Device UAT Manager";
const MANAGER_PERMISSIONS = [
  "APPROVE_LEAVE",
  "REVIEW_CLAIM",
  "ATTENDANCE_EMPLOYEE_READ",
  "ATTENDANCE_EMPLOYEE_MANAGE",
  "ROSTER_VIEW",
] as const;

function assertTestingWriteBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("TWO_PHONE_UAT_PREPARATION_REQUIRES_RAILWAY_TESTING_ENVIRONMENT");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("TWO_PHONE_UAT_PREPARATION_REQUIRES_TESTING_WEB_SERVICE_CONTEXT");
  }
  if (process.env.TETAMU_STAFF_TWO_PHONE_UAT_WRITE_ACK !== "OWNER_APPROVED") {
    throw new Error("TWO_PHONE_UAT_PREPARATION_REQUIRES_OWNER_WRITE_ACKNOWLEDGEMENT");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const approved = hostname === "postgres-singapore.railway.internal"
    || hostname.endsWith(".proxy.rlwy.net");
  if (!approved) {
    throw new Error("TWO_PHONE_UAT_PREPARATION_DATABASE_HOST_IS_NOT_APPROVED_TESTING_RAILWAY");
  }
  return hostname;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authContext(input: {
  sessionId: string;
  employeeAccountId: string;
  membershipId: string;
  businessId: string;
  branchId: string;
  deviceId: string;
}) {
  return {
    sessionId: input.sessionId,
    employeeAccountId: input.employeeAccountId,
    membershipId: input.membershipId,
    businessId: input.businessId,
    primaryBranchId: input.branchId,
    attendanceBranchId: input.branchId,
    deviceId: input.deviceId,
  };
}

async function main() {
  const databaseHost = assertTestingWriteBoundary();
  const [business, branch, employeeAccount, managerAccount] = await Promise.all([
    prisma.business.findFirstOrThrow({
      where: { id: BUSINESS_ID, status: "active" },
      select: { id: true, name: true, slug: true, industryType: true, timezone: true },
    }),
    prisma.branch.findFirstOrThrow({
      where: { id: BRANCH_ID, businessId: BUSINESS_ID, status: "ACTIVE" },
      include: { attendanceSetting: true },
    }),
    prisma.employeeAccount.findUniqueOrThrow({
      where: { phoneNormalized: EMPLOYEE_PHONE },
      include: {
        devices: { where: { status: "ACTIVE" }, orderBy: { lastActiveAt: "desc" } },
        sessions: { where: { revokedAt: null }, orderBy: { lastActiveAt: "desc" } },
      },
    }),
    prisma.employeeAccount.findUniqueOrThrow({
      where: { phoneNormalized: MANAGER_PHONE },
      include: {
        devices: { where: { status: "ACTIVE" }, orderBy: { lastActiveAt: "desc" } },
        sessions: { where: { revokedAt: null }, orderBy: { lastActiveAt: "desc" } },
      },
    }),
  ]);
  if (!branch.attendanceSetting?.isEnabled) throw new Error("UAT_BRANCH_ATTENDANCE_IS_NOT_ENABLED");
  const timezone = branch.attendanceSetting.timezone;

  const [employee, manager] = await Promise.all([
    prisma.employeeBusinessMembership.findFirstOrThrow({
      where: { employeeAccountId: employeeAccount.id, businessId: business.id, status: "ACTIVE" },
      include: {
        staffUser: true,
        branchAssignments: { where: { status: "ACTIVE" } },
      },
    }),
    prisma.employeeBusinessMembership.findFirstOrThrow({
      where: { employeeAccountId: managerAccount.id, businessId: business.id, status: "ACTIVE" },
      include: {
        staffUser: true,
        branchAssignments: { where: { status: "ACTIVE" } },
      },
    }),
  ]);
  for (const [label, membership] of [["EMPLOYEE", employee], ["MANAGER", manager]] as const) {
    const assignment = membership.branchAssignments.find((item) => item.branchId === branch.id);
    if (!assignment?.canClockIn) throw new Error(`${label}_ACTIVE_CLOCK_IN_BRANCH_ASSIGNMENT_IS_MISSING`);
  }
  if (!employee.staffUser) throw new Error("IPHONE_EMPLOYEE_STAFF_USER_LINK_IS_MISSING");

  const actorUser = await prisma.user.findFirst({
    where: {
      businessId: business.id,
      status: "active",
      OR: [
        { email: "real-device-uat.hr@tetamu.local" },
        { role: "BUSINESS_OWNER" },
      ],
    },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
  });
  if (!actorUser) throw new Error("TESTING_FIXTURE_ACTOR_IS_MISSING");
  const actor = { userId: actorUser.id, name: actorUser.name, email: actorUser.email ?? "" };

  const linked = await prisma.$transaction(async (tx) => {
    const roleProfile = await tx.staffRoleProfile.upsert({
      where: { businessId_name: { businessId: business.id, name: MANAGER_PROFILE_NAME } },
      update: { permissions: [...MANAGER_PERMISSIONS], active: true },
      create: {
        businessId: business.id,
        name: MANAGER_PROFILE_NAME,
        permissions: [...MANAGER_PERMISSIONS],
        active: true,
      },
    });

    await tx.employeeAccount.update({ where: { id: employeeAccount.id }, data: { name: EMPLOYEE_NAME } });
    await tx.employeeBusinessMembership.update({ where: { id: employee.id }, data: { fullName: EMPLOYEE_NAME } });
    const employeeUser = await tx.user.update({
      where: { id: employee.staffUser!.id },
      data: {
        name: EMPLOYEE_NAME,
        businessId: business.id,
        branchId: branch.id,
        role: "STAFF",
        permissions: [],
        staffRoleProfileId: null,
        status: "active",
        loginEnabled: true,
        appointmentBookable: true,
      },
    });

    await tx.employeeAccount.update({ where: { id: managerAccount.id }, data: { name: MANAGER_NAME } });
    await tx.employeeBusinessMembership.update({ where: { id: manager.id }, data: { fullName: MANAGER_NAME } });
    const emailOwner = await tx.user.findUnique({ where: { email: MANAGER_EMAIL } });
    if (emailOwner && emailOwner.employeeBusinessMembershipId && emailOwner.employeeBusinessMembershipId !== manager.id) {
      throw new Error("MANAGER_UAT_EMAIL_IS_LINKED_TO_A_DIFFERENT_MEMBERSHIP");
    }
    const managerUser = manager.staffUser
      ? await tx.user.update({
          where: { id: manager.staffUser.id },
          data: {
            name: MANAGER_NAME,
            email: MANAGER_EMAIL,
            businessId: business.id,
            branchId: branch.id,
            employeeAccountId: managerAccount.id,
            employeeBusinessMembershipId: manager.id,
            teamMemberLinkStatus: "LINKED",
            teamMemberLinkReason: MARKER,
            teamMemberLinkedAt: new Date(),
            role: "STAFF",
            permissions: [...MANAGER_PERMISSIONS],
            staffRoleProfileId: roleProfile.id,
            status: "active",
            loginEnabled: true,
            appointmentBookable: false,
          },
        })
      : emailOwner
        ? await tx.user.update({
            where: { id: emailOwner.id },
            data: {
              name: MANAGER_NAME,
              businessId: business.id,
              branchId: branch.id,
              employeeAccountId: managerAccount.id,
              employeeBusinessMembershipId: manager.id,
              teamMemberLinkStatus: "LINKED",
              teamMemberLinkReason: MARKER,
              teamMemberLinkedAt: new Date(),
              role: "STAFF",
              permissions: [...MANAGER_PERMISSIONS],
              staffRoleProfileId: roleProfile.id,
              status: "active",
              loginEnabled: true,
              appointmentBookable: false,
            },
          })
        : await tx.user.create({
            data: {
              name: MANAGER_NAME,
              email: MANAGER_EMAIL,
              businessId: business.id,
              branchId: branch.id,
              employeeAccountId: managerAccount.id,
              employeeBusinessMembershipId: manager.id,
              teamMemberLinkStatus: "LINKED",
              teamMemberLinkReason: MARKER,
              teamMemberLinkedAt: new Date(),
              role: "STAFF",
              permissions: [...MANAGER_PERMISSIONS],
              staffRoleProfileId: roleProfile.id,
              status: "active",
              loginEnabled: true,
              appointmentBookable: false,
            },
          });
    return { employeeUser, managerUser, roleProfile };
  });

  await installCompanyLeaveStarter(business.id, actorUser.id);
  const claimStarters = await installClaimCategoryStarters({ businessId: business.id, actor });
  const claimCategories = await prisma.claimCategory.findMany({
    where: { businessId: business.id, active: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const leaveLedger = await prisma.leaveBalanceLedgerEntry.aggregate({
    where: {
      businessId: business.id,
      membershipId: employee.id,
      leaveYearStart: new Date("2026-01-01T00:00:00.000Z"),
    },
    _sum: { units: true },
  });
  const availableLeaveUnits = Number(leaveLedger._sum.units?.toString() ?? 0);
  if (availableLeaveUnits < 1) throw new Error("IPHONE_EMPLOYEE_HAS_NO_AVAILABLE_TESTING_LEAVE_BALANCE");

  const rosterContext: RosterServiceContext = {
    businessId: business.id,
    allowedBranchIds: [branch.id],
    actor,
    canAmendPublished: true,
    canManageRetrospective: true,
  };
  let shift = await prisma.rosterShiftTemplate.findFirst({
    where: { businessId: business.id, branchId: branch.id, name: "Mobile UAT Shift" },
  });
  if (!shift) {
    shift = await saveRosterShiftTemplate({
      context: rosterContext,
      input: {
        branchId: branch.id,
        name: "Mobile UAT Shift",
        shortCode: "M-UAT",
        startMinute: 8 * 60,
        endMinute: 23 * 60,
        breakMinutes: 30,
        breakPaid: false,
        colorToken: "TEAL",
        active: true,
      },
    });
  }

  const todayKey = getBranchLocalDateKey(new Date(), timezone);
  const today = dateValueToUtcDate(todayKey);
  const rosterAssignmentIds: string[] = [];
  const rosterPublicationIds: string[] = [];
  const periods = new Map<string, string>();
  for (let offset = 0; offset < 5; offset += 1) {
    const workDate = addDays(today, offset);
    const weekStart = startOfIsoWeek(workDate);
    const period = await ensureRosterPeriod({ context: rosterContext, branchId: branch.id, weekStart });
    const result = await upsertRosterAssignment({
      context: rosterContext,
      input: {
        branchId: branch.id,
        weekStart,
        expectedDraftRevision: period.draftRevision,
        membershipId: employee.id,
        workDate,
        kind: "WORK_SHIFT",
        shiftTemplateId: shift.id,
        breakMinutes: 30,
        note: MARKER,
      },
    });
    rosterAssignmentIds.push(result.assignment.id);
    periods.set(weekStart.toISOString().slice(0, 10), result.periodId);
  }
  for (const periodId of periods.values()) {
    const period = await prisma.rosterPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const publication = await publishRoster({
      context: rosterContext,
      input: {
        rosterPeriodId: period.id,
        expectedDraftRevision: period.draftRevision,
        operationKey: `two-phone-uat-${period.id}-${period.draftRevision}`,
        reason: MARKER,
      },
    });
    rosterPublicationIds.push(publication.publication.id);
  }

  const missingPunchDate = addDays(today, -5);
  let missingPunchAttendance = await prisma.employeeAttendance.findFirst({
    where: { businessId: business.id, membershipId: employee.id, workDate: missingPunchDate },
    orderBy: { clockInAt: "asc" },
  });
  if (!missingPunchAttendance) {
    const dateKey = missingPunchDate.toISOString().slice(0, 10);
    missingPunchAttendance = await prisma.employeeAttendance.create({
      data: {
        employeeAccountId: employeeAccount.id,
        membershipId: employee.id,
        businessId: business.id,
        branchId: branch.id,
        workDate: missingPunchDate,
        status: "INCOMPLETE",
        clockInAt: businessWallClockToUtc(dateKey, "09:05", timezone),
        clockOutAt: null,
        totalBreakMinutes: 0,
        totalWorkedMinutes: 0,
        requiresApproval: false,
        approvalStatus: "NOT_REQUIRED",
      },
    });
  }

  const lockedAugustTimesheet = await prisma.attendanceMonthlyTimesheet.findUnique({
    where: { businessId_periodStart: { businessId: business.id, periodStart: new Date("2026-08-01T00:00:00.000Z") } },
    select: { id: true, status: true },
  });
  if (lockedAugustTimesheet?.status === "LOCKED") throw new Error("AUGUST_TIMESHEET_IS_LOCKED_AND_BLOCKS_OT_UAT");
  const otCandidates = await prisma.employeeBusinessMembership.findMany({
    where: {
      businessId: business.id,
      id: { notIn: [employee.id, manager.id] },
      status: "ACTIVE",
      branchAssignments: { some: { branchId: branch.id, status: "ACTIVE" } },
      staffUser: { isNot: null },
    },
    orderBy: { employeeCode: "asc" },
    take: 3,
    include: { staffUser: true },
  });
  if (otCandidates.length < 3) throw new Error("THREE_BRANCH_SCOPED_OT_CANDIDATE_EMPLOYEES_ARE_REQUIRED");
  const otFixtureDates = ["2026-08-20", "2026-08-21", "2026-08-22"];
  const otFinalResultIds: string[] = [];
  for (const [index, membership] of otCandidates.entries()) {
    const workDateKey = otFixtureDates[index]!;
    const workDate = dateValueToUtcDate(workDateKey);
    const expectedStartAt = businessWallClockToUtc(workDateKey, "09:00", timezone);
    const expectedEndAt = businessWallClockToUtc(workDateKey, "17:00", timezone);
    const actualClockInAt = businessWallClockToUtc(workDateKey, "08:30", timezone);
    const actualClockOutAt = businessWallClockToUtc(workDateKey, "18:30", timezone);
    await recordExpectedAttendance({
      context: { businessId: business.id, allowedBranchIds: [branch.id], actor },
      input: {
        branchId: branch.id,
        membershipId: membership.id,
        workDate,
        kind: "WORKDAY",
        source: "MANUAL_EVIDENCE",
        expectedStartAt,
        expectedEndAt,
        graceMinutes: 0,
        timezoneSnapshot: timezone,
        evidenceReference: `${MARKER}:OT:${index + 1}`,
      },
    });
    let attendance = await prisma.employeeAttendance.findFirst({
      where: { businessId: business.id, membershipId: membership.id, workDate },
      orderBy: { clockInAt: "asc" },
    });
    if (!attendance) {
      const account = await prisma.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: membership.id },
        select: { employeeAccountId: true },
      });
      attendance = await prisma.employeeAttendance.create({
        data: {
          employeeAccountId: account.employeeAccountId,
          membershipId: membership.id,
          businessId: business.id,
          branchId: branch.id,
          workDate,
          status: "COMPLETED",
          clockInAt: actualClockInAt,
          clockOutAt: actualClockOutAt,
          totalBreakMinutes: 0,
          totalWorkedMinutes: 600,
          requiresApproval: false,
          approvalStatus: "NOT_REQUIRED",
        },
      });
    } else {
      attendance = await prisma.employeeAttendance.update({
        where: { id: attendance.id },
        data: {
          branchId: branch.id,
          status: "COMPLETED",
          clockInAt: actualClockInAt,
          clockOutAt: actualClockOutAt,
          totalBreakMinutes: 0,
          totalWorkedMinutes: 600,
          requiresApproval: false,
          approvalStatus: "NOT_REQUIRED",
        },
      });
    }
    const result = await materializeAttendanceP2Day({
      context: { businessId: business.id, allowedBranchIds: [branch.id], actor },
      membershipId: membership.id,
      workDate,
    });
    if (!result.finalResult) throw new Error(`OT_FIXTURE_${index + 1}_DID_NOT_MATERIALIZE_A_FINAL_RESULT`);
    otFinalResultIds.push(result.finalResult.id);
    await prisma.attendanceOvertimeReview.deleteMany({
      where: { businessId: business.id, membershipId: membership.id, workDate, status: "PENDING_REVIEW" },
    });
  }

  const moduleEntitlements = await prisma.businessModuleEntitlement.findMany({
    where: { businessId: business.id, status: "ENABLED" },
    select: { moduleKey: true },
  });
  const salonEnabled = business.industryType === "SALON_BEAUTY"
    && moduleEntitlements.some((item) => item.moduleKey === "SALON");
  const appointmentIds: string[] = [];
  if (salonEnabled) {
    const category = await prisma.serviceCategory.upsert({
      where: { businessId_name: { businessId: business.id, name: "Mobile UAT Services" } },
      update: { status: "ACTIVE" },
      create: { businessId: business.id, name: "Mobile UAT Services" },
    });
    const service = await prisma.service.upsert({
      where: { businessId_name: { businessId: business.id, name: "Signature Scalp Renewal and Precision Finish" } },
      update: { branchId: branch.id, categoryId: category.id, status: "ACTIVE", durationMinutes: 75 },
      create: {
        businessId: business.id,
        branchId: branch.id,
        categoryId: category.id,
        name: "Signature Scalp Renewal and Precision Finish",
        category: "SALON",
        description: MARKER,
        price: "188.00",
        durationMinutes: 75,
      },
    });
    await prisma.serviceStaffAssignment.createMany({
      data: [{ businessId: business.id, serviceId: service.id, userId: linked.employeeUser.id }],
      skipDuplicates: true,
    });
    const customers = await Promise.all([
      { name: "Nur Aisyah", phone: "+600000003001" },
      { name: "Alexandria-Margaret Mobile UAT Customer", phone: "+600000003002" },
    ].map((customer) => prisma.customer.upsert({
      where: { businessId_phone: { businessId: business.id, phone: customer.phone } },
      update: { branchId: branch.id, name: customer.name, notes: `${MARKER} private note` },
      create: { businessId: business.id, branchId: branch.id, ...customer, notes: `${MARKER} private note` },
    })));
    for (const [index, customer] of customers.entries()) {
      const note = `${MARKER}:APPOINTMENT:${index + 1}`;
      const scheduledAt = new Date(Date.now() + (45 + index * 90) * 60_000);
      const existing = await prisma.appointment.findFirst({
        where: { businessId: business.id, notes: note },
      });
      const appointment = existing
        ? await prisma.appointment.update({
            where: { id: existing.id },
            data: {
              branchId: branch.id,
              customerId: customer.id,
              serviceId: service.id,
              serviceIds: [service.id],
              assignedStaffId: linked.employeeUser.id,
              scheduledAt,
              durationMinutes: 75,
              status: index ? "CONFIRMED" : "SCHEDULED",
            },
          })
        : await prisma.appointment.create({
            data: {
              businessId: business.id,
              branchId: branch.id,
              customerId: customer.id,
              serviceId: service.id,
              serviceIds: [service.id],
              assignedStaffId: linked.employeeUser.id,
              scheduledAt,
              durationMinutes: 75,
              status: index ? "CONFIRMED" : "SCHEDULED",
              notes: note,
            },
          });
      appointmentIds.push(appointment.id);
    }
  }

  const [employeeSession, managerSession] = [
    employeeAccount.sessions.find((session) => session.membershipId === employee.id && session.employeeDeviceId),
    managerAccount.sessions.find((session) => session.membershipId === manager.id && session.employeeDeviceId),
  ];
  const employeeDevice = employeeAccount.devices.find((device) => device.id === employeeSession?.employeeDeviceId);
  const managerDevice = managerAccount.devices.find((device) => device.id === managerSession?.employeeDeviceId);
  if (!employeeSession || !employeeDevice || !employeeDevice.canPunch) throw new Error("IPHONE_CANONICAL_DEVICE_SESSION_IS_NOT_READY");
  if (!managerSession || !managerDevice || !managerDevice.canView) throw new Error("ANDROID_CANONICAL_DEVICE_SESSION_IS_NOT_READY");
  const employeeAuth = authContext({
    sessionId: employeeSession.id,
    employeeAccountId: employeeAccount.id,
    membershipId: employee.id,
    businessId: business.id,
    branchId: branch.id,
    deviceId: employeeDevice.id,
  });
  const managerAuth = authContext({
    sessionId: managerSession.id,
    employeeAccountId: managerAccount.id,
    membershipId: manager.id,
    businessId: business.id,
    branchId: branch.id,
    deviceId: managerDevice.id,
  });
  const [employeeApprovalAccess, managerApprovalAccess, managerOtAccess, appointmentDay] = await Promise.all([
    resolveStaffTeamApprovalAccess(employeeAuth),
    resolveStaffTeamApprovalAccess(managerAuth),
    resolveStaffOvertimeAccess(managerAuth),
    salonEnabled ? getStaffAppointmentDay({ auth: employeeAuth, date: todayKey, now: new Date() }) : Promise.resolve(null),
  ]);
  if (employeeApprovalAccess) throw new Error("NORMAL_EMPLOYEE_UNEXPECTEDLY_HAS_APPROVAL_ACCESS");
  if (!managerApprovalAccess?.canReviewAttendance || !managerApprovalAccess.canReviewLeave || !managerApprovalAccess.canReviewClaims) {
    throw new Error("ANDROID_MANAGER_APPROVAL_CAPABILITIES_ARE_INCOMPLETE");
  }
  if (!managerOtAccess) throw new Error("ANDROID_MANAGER_OT_CAPABILITY_IS_MISSING");
  if (managerApprovalAccess.actorMembershipId === employee.id) throw new Error("MANAGER_AND_EMPLOYEE_MEMBERSHIPS_MUST_BE_DIFFERENT");
  if (appointmentDay && appointmentDay.appointments.length < 1) throw new Error("TODAY_APPOINTMENT_FIXTURE_IS_NOT_VISIBLE");
  if (appointmentDay && (JSON.stringify(appointmentDay).includes("private note") || JSON.stringify(appointmentDay).includes("+600000003"))) {
    throw new Error("STAFF_APPOINTMENT_PROJECTION_EXPOSED_PRIVATE_CUSTOMER_DATA");
  }

  const [publishedAssignments, expectedToday, leavePolicies, finalOtCandidates, payslips, commissions] = await Promise.all([
    prisma.rosterPublishedAssignment.findMany({
      where: { businessId: business.id, membershipId: employee.id, workDate: { gte: today, lte: addDays(today, 4) } },
      orderBy: { workDate: "asc" },
    }),
    prisma.attendanceExpectedDay.findFirst({
      where: { businessId: business.id, membershipId: employee.id, workDate: today, status: "CURRENT", source: "ROSTER" },
      orderBy: { revision: "desc" },
    }),
    prisma.leavePolicy.findMany({ where: { businessId: business.id, active: true }, select: { id: true, code: true, name: true } }),
    prisma.attendanceP2FinalResult.findMany({ where: { id: { in: otFinalResultIds } }, orderBy: { workDate: "asc" } }),
    prisma.payrollPayslipPublication.findMany({ where: { businessId: business.id, membershipId: employee.id }, orderBy: { publishedAt: "desc" } }),
    prisma.commissionStatement.findMany({ where: { businessId: business.id, membershipId: employee.id }, orderBy: { createdAt: "desc" } }),
  ]);
  if (publishedAssignments.length < 5 || !expectedToday) throw new Error("PUBLISHED_ROSTER_OR_TODAY_EXPECTED_EVIDENCE_IS_INCOMPLETE");
  if (finalOtCandidates.length !== 3) throw new Error("THREE_CANONICAL_ATTENDANCE_DERIVED_OT_RESULTS_ARE_REQUIRED");

  const output = {
    environment: "testing",
    productionAccessed: false,
    productionModified: false,
    databaseHost,
    canonicalRuntime: "Staff 3000 only",
    business: { id: business.id, name: business.name, industryType: business.industryType },
    branch: { id: branch.id, name: branch.name, timezone },
    employee: {
      phone: EMPLOYEE_PHONE,
      accountId: employeeAccount.id,
      membershipId: employee.id,
      staffUserId: linked.employeeUser.id,
      name: EMPLOYEE_NAME,
      permissions: linked.employeeUser.permissions,
      approvalAccess: false,
      activePhysicalDevice: { id: employeeDevice.id, platform: employeeDevice.platform, browser: employeeDevice.browser },
      activeSessionId: employeeSession.id,
    },
    manager: {
      phone: MANAGER_PHONE,
      accountId: managerAccount.id,
      membershipId: manager.id,
      staffUserId: linked.managerUser.id,
      name: MANAGER_NAME,
      permissions: linked.managerUser.permissions,
      roleProfileId: linked.roleProfile.id,
      branchLimited: !managerApprovalAccess.wholeBusinessScope,
      approvalAccess: {
        leave: managerApprovalAccess.canReviewLeave,
        claims: managerApprovalAccess.canReviewClaims,
        attendance: managerApprovalAccess.canReviewAttendance,
        overtime: Boolean(managerOtAccess),
      },
      activePhysicalDevice: { id: managerDevice.id, platform: managerDevice.platform, browser: managerDevice.browser },
      activeSessionId: managerSession.id,
    },
    otp: { provider: "sms123", mode: "REAL_TESTING_SMS", smsSentDuringPreparation: false },
    roster: {
      shiftTemplateId: shift.id,
      shiftName: shift.name,
      dateFrom: todayKey,
      dateTo: addDaysToDateValue(todayKey, 4),
      assignmentIds: rosterAssignmentIds,
      publicationIds: rosterPublicationIds,
      publishedSnapshotIds: publishedAssignments.map((item) => item.id),
      expectedTodayId: expectedToday.id,
    },
    leave: { availableUnits: availableLeaveUnits, policies: leavePolicies },
    claims: { starters: claimStarters, categories: claimCategories },
    attendanceCorrection: {
      employeeCreatesLiveRequest: true,
      sourceAttendanceId: missingPunchAttendance.id,
      sourceWorkDate: missingPunchAttendance.workDate.toISOString().slice(0, 10),
      precreatedPendingRequest: false,
    },
    overtime: {
      employeeCreatesOtRequest: false,
      canonicalAttendanceDerived: true,
      finalResultIds: finalOtCandidates.map((item) => item.id),
      candidateMembershipIds: finalOtCandidates.map((item) => item.membershipId),
      workDates: finalOtCandidates.map((item) => item.workDate.toISOString().slice(0, 10)),
    },
    pay: { publishedPayslipCount: payslips.length, commissionStatementCount: commissions.length },
    appointments: salonEnabled ? {
      enabled: true,
      appointmentIds,
      visibleToday: appointmentDay?.appointments.length ?? 0,
      privacyProjectionVerified: true,
    } : { enabled: false, appointmentIds: [], visibleToday: 0, privacyProjectionVerified: true },
    fixtureMarkerDigest: digest(MARKER),
  };
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: output.environment,
    productionAccessed: output.productionAccessed,
    business: output.business.name,
    branch: output.branch.name,
    employee: { phone: output.employee.phone, approvalAccess: output.employee.approvalAccess },
    manager: { phone: output.manager.phone, approvalAccess: output.manager.approvalAccess, branchLimited: output.manager.branchLimited },
    rosterDays: output.roster.publishedSnapshotIds.length,
    leaveUnits: output.leave.availableUnits,
    claimCategories: output.claims.categories.length,
    attendanceCorrectionReady: output.attendanceCorrection.employeeCreatesLiveRequest,
    overtimeCandidates: output.overtime.finalResultIds.length,
    publishedPayslips: output.pay.publishedPayslipCount,
    commissionStatements: output.pay.commissionStatementCount,
    appointmentsVisibleToday: output.appointments.visibleToday,
    outputPath: OUTPUT_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
