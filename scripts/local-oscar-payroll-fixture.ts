import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  approveMonthlyAttendanceTimesheet,
  loadMonthlyAttendanceTimesheet,
  lockMonthlyAttendanceTimesheet,
  markAttendanceTimesheetBranchReady,
  type AttendanceTimesheetContext,
} from "@/lib/attendance/timesheet-service";
import { deriveOvertimeCandidate } from "@/lib/attendance/overtime-service";
import type { PayrollProfileWriteContext } from "@/lib/payroll/employee-profile-write/types";
import { updateEmployeeTaxProfile } from "@/lib/payroll/employee-profile-write/tax";
import { scheduleRecurringPayComponent } from "@/lib/payroll/recurring-pay";
import { generatePayrollRun } from "@/lib/payroll/service";

const prisma = new PrismaClient();
const MEMBERSHIP_ID = "83466c71-1675-470b-acb1-9217e0aa7b19";
const ACTOR_ID = "fffa7a0d-8f22-41d9-9c62-bc0d57f1c0b3";
const EMPLOYEE_NAME = "OSCAR YONG";
const TEST_MONTH = "2026-10";
const FIXTURE_REFERENCE = "LOCAL_OSCAR_PAYROLL_UAT_2026_10";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1'].includes(hostname)) {
    throw new Error("This payroll fixture is restricted to the local database.");
  }
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
}

async function main() {
  assertLocalDatabase();
  const shouldApply = process.argv.includes("--apply");
  const shouldRebuildPayroll = process.argv.includes("--rebuild-payroll");
  const shouldNormalizeTransport = process.argv.includes("--normalize-transport");
  const shouldApplyPcbProfile = process.argv.includes("--apply-pcb-profile");
  const shouldPreparePcbUat = process.argv.includes("--prepare-pcb-uat");
  const membership = await prisma.employeeBusinessMembership.findUnique({
    where: { id: MEMBERSHIP_ID },
    include: {
      branchAssignments: { include: { branch: true } },
      compensationVersions: { orderBy: { effectiveFromMonth: "desc" } },
      statutoryProfileVersions: { orderBy: { revision: "desc" } },
      bankAccountVersions: { orderBy: { revision: "desc" } },
      recurringPayComponents: {
        include: { versions: { orderBy: { revision: "desc" } } },
      },
    },
  });

  if (!membership) {
    throw new Error(`Membership ${MEMBERSHIP_ID} was not found.`);
  }

  const activeStatutoryRules = await prisma.statutoryRuleSet.findMany({
    where: { status: "ACTIVE" },
    include: {
      classifications: {
        where: {
          componentCode: {
            in: ["TRANSPORT_ALLOWANCE", "EMP_TRANSPORT_FEE_6ED4A869C4"],
          },
        },
        include: {
          reviewDecisions: {
            orderBy: { decisionRevision: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }],
  });

  if (shouldApply) {
    await applyFixture({
      businessId: membership.businessId,
      branchId:
        membership.branchAssignments.find((assignment) => assignment.isPrimary)?.branchId
        ?? membership.branchAssignments.find((assignment) => assignment.status === "ACTIVE")?.branchId
        ?? null,
    });
  }

  if (shouldNormalizeTransport) {
    await normalizeFixtureTransportAllowance({ businessId: membership.businessId });
  }

  if (shouldApplyPcbProfile) {
    await applyLocalPcbProfile({ businessId: membership.businessId });
  }

  if (shouldPreparePcbUat) {
    await prepareLocalPcbUatRule();
    await endLocalTransportAllowanceForPcbUat({ businessId: membership.businessId });
  }

  if (shouldRebuildPayroll) {
    await rebuildPayrollDraft({ businessId: membership.businessId });
  }

  if (process.argv.includes("--pcb-summary")) {
    const [refreshedMembership, pcbRules, octoberRun] = await Promise.all([
      prisma.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: MEMBERSHIP_ID },
        select: {
          statutoryProfileRevision: true,
          taxProfileRevision: true,
          pcbProfile: true,
          statutoryProfileVersions: {
            orderBy: { revision: "desc" },
            take: 1,
            select: {
              revision: true,
              taxProfileRevision: true,
              pcbProfileSnapshot: true,
            },
          },
        },
      }),
      prisma.statutoryRuleSet.findMany({
        where: { scheme: "PCB" },
        orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
        select: {
          id: true,
          version: true,
          status: true,
          readiness: true,
          humanReviewStatus: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      }),
      prisma.payrollRun.findUnique({
        where: {
          businessId_periodStart_periodEnd: {
            businessId: membership.businessId,
            periodStart: new Date("2026-10-01T00:00:00.000Z"),
            periodEnd: new Date("2026-11-01T00:00:00.000Z"),
          },
        },
        select: {
          id: true,
          status: true,
          entries: {
            where: { membershipId: MEMBERSHIP_ID },
            select: {
              statutorySnapshots: {
                where: { scheme: { in: ["PCB", "LINDUNG24"] } },
                select: {
                  scheme: true,
                  status: true,
                  blockerCode: true,
                  wageBase: true,
                  employeeContribution: true,
                  employerContribution: true,
                  calculationSource: true,
                  ruleVersionSnapshot: true,
                },
              },
            },
          },
        },
      }),
    ]);
    const profile = refreshedMembership.pcbProfile as { version?: unknown } | null;
    const snapshot = refreshedMembership.statutoryProfileVersions[0]
      ?.pcbProfileSnapshot as { version?: unknown } | null | undefined;
    console.log(json({
      pcbProfile: {
        statutoryProfileRevision: refreshedMembership.statutoryProfileRevision,
        currentRevision: refreshedMembership.taxProfileRevision,
        currentVersion: profile?.version ?? null,
        latestStatutoryRevision: refreshedMembership.statutoryProfileVersions[0]?.revision ?? null,
        snapshotTaxProfileRevision:
          refreshedMembership.statutoryProfileVersions[0]?.taxProfileRevision ?? null,
        snapshotVersion: snapshot?.version ?? null,
      },
      pcbRules,
      octoberPayroll: octoberRun
        ? {
            id: octoberRun.id,
            status: octoberRun.status,
            statutory: octoberRun.entries[0]?.statutorySnapshots ?? [],
          }
        : null,
    }));
    return;
  }

  const periodStart = new Date("2026-08-01T00:00:00.000Z");
  const periodEnd = new Date("2026-08-31T00:00:00.000Z");
  const testPeriodStart = new Date("2026-10-01T00:00:00.000Z");
  const testPeriodEnd = new Date("2026-11-01T00:00:00.000Z");

  const [attendances, finalResults, timesheets, payrollRuns, october, activeBranches, schedules, holidays] = await Promise.all([
    prisma.employeeAttendance.findMany({
      where: {
        membershipId: MEMBERSHIP_ID,
        workDate: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { workDate: "asc" },
    }),
    prisma.attendanceFinalResult.findMany({
      where: {
        employeeId: MEMBERSHIP_ID,
        workDate: { gte: periodStart, lte: periodEnd },
      },
      orderBy: [{ workDate: "asc" }, { version: "desc" }],
    }),
    prisma.attendanceMonthlyTimesheet.findMany({
      where: {
        businessId: membership.businessId,
        periodStart,
      },
      include: { revisions: { orderBy: { revision: "desc" } } },
    }),
    prisma.payrollRun.findMany({
      where: {
        businessId: membership.businessId,
        periodStart,
      },
      include: {
        entries: { where: { membershipId: MEMBERSHIP_ID } },
      },
    }),
    Promise.all([
      prisma.attendanceExpectedDay.findMany({
        where: { membershipId: MEMBERSHIP_ID, workDate: { gte: testPeriodStart, lt: testPeriodEnd } },
        orderBy: { workDate: "asc" },
      }),
      prisma.employeeAttendance.findMany({
        where: { membershipId: MEMBERSHIP_ID, workDate: { gte: testPeriodStart, lt: testPeriodEnd } },
        orderBy: { workDate: "asc" },
      }),
      prisma.attendanceP2FinalResult.findMany({
        where: { membershipId: MEMBERSHIP_ID, workDate: { gte: testPeriodStart, lt: testPeriodEnd } },
        orderBy: [{ workDate: "asc" }, { version: "desc" }],
      }),
      prisma.attendanceOvertimeReview.findMany({
        where: { membershipId: MEMBERSHIP_ID, workDate: { gte: testPeriodStart, lt: testPeriodEnd } },
        orderBy: { workDate: "asc" },
      }),
      prisma.attendanceMonthlyTimesheet.findUnique({
        where: { businessId_periodStart: { businessId: membership.businessId, periodStart: testPeriodStart } },
        include: { revisions: true, branchReadiness: true },
      }),
      prisma.payrollRun.findMany({
        where: { businessId: membership.businessId, periodStart: testPeriodStart },
        include: {
          entries: {
            where: { membershipId: MEMBERSHIP_ID },
            include: {
              attendanceInputSnapshot: true,
              components: { orderBy: { sortOrder: "asc" } },
              recurringPaySnapshots: true,
              statutorySnapshots: { orderBy: { scheme: "asc" } },
            },
          },
        },
      }),
    ]),
    prisma.branch.findMany({
      where: { businessId: membership.businessId, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    prisma.employeeRosterScheduleVersion.findMany({
      where: {
        membershipId: MEMBERSHIP_ID,
        effectiveFrom: { lt: testPeriodEnd },
      },
      orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
      include: { defaultShiftTemplate: true },
    }),
    prisma.holidayOccurrence.findMany({
      where: {
        businessId: membership.businessId,
        workDate: { gte: testPeriodStart, lt: testPeriodEnd },
      },
      orderBy: { workDate: "asc" },
    }),
  ]);

  if (process.argv.includes("--summary")) {
    const outcomeCounts = october[2].reduce<Record<string, number>>((counts, item) => {
      counts[item.outcome] = (counts[item.outcome] ?? 0) + 1;
      return counts;
    }, {});
    const payrollRun = october[5][0] ?? null;
    const payrollEntry = payrollRun?.entries[0] ?? null;

    console.log(
      json({
        employee: `${EMPLOYEE_NAME} (${membership.employeeCode})`,
        testMonth: TEST_MONTH,
        payrollSetup: {
          payBasis: membership.payBasis,
          baseSalary: membership.baseSalary,
          workingDaysPerMonth: membership.workingDaysPerMonth,
          normalWorkMinutesPerDay: membership.normalWorkMinutesPerDay,
          statutoryNationality: membership.statutoryNationality,
          epfEnabled: membership.epfEnabled,
          socsoEnabled: membership.socsoEnabled,
          socsoCategory: membership.socsoCategory,
          eisEnabled: membership.eisEnabled,
          statutoryProfileRevision: membership.statutoryProfileRevision,
          taxProfileRevision: membership.taxProfileRevision,
          hasPcbProfile: membership.pcbProfile !== null,
          latestStatutoryVersion: membership.statutoryProfileVersions[0]
            ? {
                revision: membership.statutoryProfileVersions[0].revision,
                taxProfileRevision: membership.statutoryProfileVersions[0].taxProfileRevision,
                sourceDigest: membership.statutoryProfileVersions[0].sourceDigest,
                hasPcbProfileSnapshot:
                  membership.statutoryProfileVersions[0].pcbProfileSnapshot !== null,
              }
            : null,
          bank: membership.bankAccountVersions[0]
            ? {
                name: membership.bankAccountVersions[0].bankNameSnapshot,
                ending: membership.bankAccountVersions[0].accountNumberLast4,
                status: membership.bankAccountVersions[0].status,
                verificationStatus: membership.bankAccountVersions[0].verificationStatus,
              }
            : null,
        },
        attendance: {
          expectedDays: october[0].length,
          finalResults: october[2].length,
          outcomes: outcomeCounts,
          noShowDates: october[2]
            .filter((item) => item.outcome === "UNAUTHORIZED_ABSENCE")
            .map((item) => item.workDate),
          overtime: october[3].map((item) => ({
            date: item.workDate,
            status: item.status,
            approvedMinutes: item.approvedOtMinutes,
          })),
        },
        timesheet: october[4]
          ? {
              status: october[4].status,
              currentRevision: october[4].revisions.at(-1)?.revision ?? null,
              branchReadiness: october[4].branchReadiness,
            }
          : null,
        transportClassification: activeStatutoryRules.map((rule) => ({
          scheme: rule.scheme,
          version: rule.version,
          classifications: rule.classifications.map((classification) => ({
            componentCode: classification.componentCode,
            sourceType: classification.sourceType,
            treatment: classification.treatment,
            latestDecision: classification.reviewDecisions[0]?.decision ?? null,
          })),
        })),
        payroll: payrollEntry
          ? {
              runId: payrollRun?.id,
              runStatus: payrollRun?.status,
              attendanceDays: payrollEntry.attendanceDays,
              regularMinutes: payrollEntry.regularMinutes,
              overtimeMinutes: payrollEntry.overtimeMinutes,
              unpaidLeaveDays: payrollEntry.unpaidLeaveDays,
              basicPay: payrollEntry.basicPay,
              unpaidLeaveDeduction: payrollEntry.unpaidLeaveDeduction,
              overtimePay: payrollEntry.overtimePay,
              recurringAllowances: payrollEntry.recurringAllowancesSnapshot,
              recurringDeductions: payrollEntry.recurringDeductionsSnapshot,
              grossPay: payrollEntry.grossPay,
              epfEmployee: payrollEntry.epfEmployee,
              socsoEmployee: payrollEntry.socsoEmployee,
              eisEmployee: payrollEntry.eisEmployee,
              pcb: payrollEntry.pcb,
              netPay: payrollEntry.netPay,
              employerEpf: payrollEntry.employerEpf,
              employerSocso: payrollEntry.employerSocso,
              employerEis: payrollEntry.employerEis,
              statutoryStatus: payrollEntry.statutoryStatus,
              statutoryWarning: payrollEntry.statutoryWarning,
              attendanceInput: payrollEntry.attendanceInputSnapshot,
              components: payrollEntry.components.map((component) => ({
                type: component.type,
                code: component.code,
                name: component.name,
                amount: component.amount,
              })),
              statutory: payrollEntry.statutorySnapshots.map((snapshot) => ({
                scheme: snapshot.scheme,
                status: snapshot.status,
                wageBase: snapshot.wageBase,
                employeeContribution: snapshot.employeeContribution,
                employerContribution: snapshot.employerContribution,
                blockerCode: snapshot.blockerCode,
              })),
            }
          : null,
      }),
    );
    return;
  }

  console.log(
    json({
      databaseUrl: process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@"),
      membership: {
        id: membership.id,
        businessId: membership.businessId,
        employeeCode: membership.employeeCode,
        legalName: EMPLOYEE_NAME,
        status: membership.status,
        primaryBranchId:
          membership.branchAssignments.find((assignment) => assignment.isPrimary)?.branchId
          ?? null,
        payBasis: membership.payBasis,
        baseSalary: membership.baseSalary,
        workingDaysPerMonth: membership.workingDaysPerMonth,
        normalWorkMinutesPerDay: membership.normalWorkMinutesPerDay,
        targetBreakMinutes: membership.targetBreakMinutes,
        dateOfBirth: membership.dateOfBirth,
        statutoryNationality: membership.statutoryNationality,
        epfEnabled: membership.epfEnabled,
        socsoEnabled: membership.socsoEnabled,
        socsoCategory: membership.socsoCategory,
        eisEnabled: membership.eisEnabled,
        hasIdentityNumber: Boolean(membership.statutoryIdentityNumber),
        hasTaxNumber: Boolean(membership.taxIdentificationNumber),
        hasEpfNumber: Boolean(membership.epfMemberNumber),
        hasSocsoNumber: Boolean(membership.socsoMemberNumber),
        branches: membership.branchAssignments.map((assignment) => ({
          branchId: assignment.branchId,
          branchName: assignment.branch.name,
          status: assignment.status,
          isPrimary: assignment.isPrimary,
        })),
        latestCompensation: membership.compensationVersions[0],
        latestStatutoryVersion: membership.statutoryProfileVersions[0] ?? null,
        latestBank: membership.bankAccountVersions[0]
          ? {
              bankName: membership.bankAccountVersions[0].bankNameSnapshot,
              accountLast4: membership.bankAccountVersions[0].accountNumberLast4,
              status: membership.bankAccountVersions[0].status,
              verificationStatus: membership.bankAccountVersions[0].verificationStatus,
              isPrimary: membership.bankAccountVersions[0].isPrimary,
            }
          : null,
        recurringPay: membership.recurringPayComponents.map((component) => ({
          code: component.code,
          versions: component.versions.map((version) => ({
            name: version.name,
            kind: component.type,
            amount: version.amount,
            effectiveFromMonth: version.effectiveFromMonth,
            status: version.status,
          })),
        })),
      },
      august2026: {
        attendanceDates: attendances.map((item) => item.workDate),
        finalResults: finalResults.map((item) => ({ workDate: item.workDate, outcome: item.disposition })),
        timesheets: timesheets.map((item) => ({
          status: item.status,
          currentRevision: item.revisions[0]?.revision ?? null,
        })),
        payrollRuns: payrollRuns.map((run) => ({ id: run.id, status: run.status, oscarEntries: run.entries.length })),
      },
      october2026: {
        expectedDays: october[0].map((item) => ({
          workDate: item.workDate,
          dayKind: item.kind,
          expectedStartAt: item.expectedStartAt,
          expectedEndAt: item.expectedEndAt,
        })),
        attendances: october[1].map((item) => ({ id: item.id, workDate: item.workDate })),
        finalResults: october[2].map((item) => ({
          id: item.id,
          workDate: item.workDate,
          outcome: item.outcome,
          actualClockInAt: item.actualClockInAt,
          actualClockOutAt: item.actualClockOutAt,
          totalBreakMinutes: item.totalBreakMinutes,
          totalWorkedMinutes: item.totalWorkedMinutes,
        })),
        overtimeReviews: october[3].map((item) => ({
          workDate: item.workDate,
          status: item.status,
          context: item.context,
          potentialOtMinutes: item.potentialOtMinutes,
          approvedOtMinutes: item.approvedOtMinutes,
        })),
        timesheet: october[4]
          ? {
              id: october[4].id,
              status: october[4].status,
              currentRevision: october[4].revisions.at(-1)?.revision ?? null,
              revisions: october[4].revisions.length,
              branchReadiness: october[4].branchReadiness,
            }
          : null,
        payrollRuns: october[5].map((run) => ({
          id: run.id,
          status: run.status,
          entries: run.entries.map((entry) => ({
            attendanceDays: entry.attendanceDays,
            regularMinutes: entry.regularMinutes,
            overtimeMinutes: entry.overtimeMinutes,
            paidLeaveDays: entry.paidLeaveDays,
            unpaidLeaveDays: entry.unpaidLeaveDays,
            basicPay: entry.basicPay,
            unpaidLeaveDeduction: entry.unpaidLeaveDeduction,
            overtimePay: entry.overtimePay,
            recurringAllowancesSnapshot: entry.recurringAllowancesSnapshot,
            recurringDeductionsSnapshot: entry.recurringDeductionsSnapshot,
            epfEmployee: entry.epfEmployee,
            socsoEmployee: entry.socsoEmployee,
            eisEmployee: entry.eisEmployee,
            employerEpf: entry.employerEpf,
            employerSocso: entry.employerSocso,
            employerEis: entry.employerEis,
            pcb: entry.pcb,
            grossPay: entry.grossPay,
            netPay: entry.netPay,
            statutoryStatus: entry.statutoryStatus,
            statutoryWarning: entry.statutoryWarning,
            attendanceInput: entry.attendanceInputSnapshot,
            components: entry.components.map((component) => ({
              type: component.type,
              code: component.code,
              name: component.name,
              amount: component.amount,
              origin: component.origin,
            })),
            recurringPay: entry.recurringPaySnapshots.map((snapshot) => ({
              type: snapshot.type,
              code: snapshot.code,
              name: snapshot.name,
              amount: snapshot.amount,
            })),
            statutory: entry.statutorySnapshots.map((snapshot) => ({
              scheme: snapshot.scheme,
              status: snapshot.status,
              wageBase: snapshot.wageBase,
              employeeContribution: snapshot.employeeContribution,
              employerContribution: snapshot.employerContribution,
              blockerCode: snapshot.blockerCode,
            })),
          })),
        })),
        transportClassification: activeStatutoryRules.map((rule) => ({
          scheme: rule.scheme,
          version: rule.version,
          classifications: rule.classifications.map((classification) => ({
            componentCode: classification.componentCode,
            sourceType: classification.sourceType,
            treatment: classification.treatment,
            latestDecision: classification.reviewDecisions[0]?.decision ?? null,
          })),
        })),
        activeBranches: activeBranches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          timezone: "Asia/Kuching",
        })),
        schedules: schedules.map((schedule) => ({
          id: schedule.id,
          effectiveFrom: schedule.effectiveFrom,
          revision: schedule.revision,
          restPolicy: schedule.restPolicy,
          fixedRestWeekdays: schedule.fixedRestWeekdays,
          defaultShift: schedule.defaultShiftTemplate
            ? {
                id: schedule.defaultShiftTemplate.id,
                name: schedule.defaultShiftTemplate.name,
                startMinute: schedule.defaultShiftTemplate.startMinute,
                endMinute: schedule.defaultShiftTemplate.endMinute,
                breakMinutes: schedule.defaultShiftTemplate.breakMinutes,
              }
            : null,
        })),
        holidays: holidays.map((holiday) => ({ workDate: holiday.workDate, name: holiday.name, status: holiday.status })),
      },
    }),
  );
}

async function applyLocalPcbProfile(args: { businessId: string }) {
  const [membership, actor] = await Promise.all([
    prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: MEMBERSHIP_ID },
      include: {
        business: { select: { industryType: true } },
        branchAssignments: {
          where: { status: "ACTIVE" },
          orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }],
          take: 1,
        },
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ACTOR_ID },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const branchId = membership.branchAssignments[0]?.branchId ?? null;
  const now = new Date().toISOString();
  const context: PayrollProfileWriteContext = {
    access: {
      actorRole: "BUSINESS_OWNER",
      branchId,
      businessId: args.businessId,
      capability: "EDIT_TAX_PROFILE",
      effectiveBusinessRole: "BUSINESS_OWNER",
      granted: true,
      groupId: null,
      groupUserId: null,
      homeBusinessId: args.businessId,
      identityRole: "BUSINESS_OWNER",
      industryType: membership.business.industryType,
      permissions: ["VIEW_TAX_PROFILE", "EDIT_TAX_PROFILE"],
      source: "DIRECT_BUSINESS",
      userId: actor.id,
    },
    actor: {
      email: actor.email ?? "",
      name: actor.name,
      userId: actor.id,
    },
    allowedBranchIds: branchId ? [branchId] : [],
    businessId: args.businessId,
    caller: "SYSTEM",
  };

  const result = await updateEmployeeTaxProfile({
    command: {
      commandId: randomUUID(),
      expectedRevision: membership.taxProfileRevision,
      membershipId: MEMBERSHIP_ID,
      pcbProfile: {
        version: 2,
        taxYear: 2026,
        taxRegime: "RESIDENT_STANDARD",
        employeeCategory: "CATEGORY_1",
        individualDisabled: false,
        spouseDisabled: false,
        children: {
          under18Full: 0,
          under18Half: 0,
          studying18PlusFull: 0,
          studying18PlusHalf: 0,
          diplomaOrDegreeFull: 0,
          diplomaOrDegreeHalf: 0,
          disabledFull: 0,
          disabledHalf: 0,
          disabledStudyingFull: 0,
          disabledStudyingHalf: 0,
        },
        priorEmployerGrossRemunerationCents: 0,
        priorEmployerEpfCents: 0,
        priorEmployerPcbCents: 0,
        priorEmployerAllowableDeductionsCents: 0,
        priorEmployerZakatCents: 0,
        currentAllowableDeductionsCents: 0,
        currentZakatCents: 0,
        currentReligiousTravelLevyCents: 0,
        tp1Declaration: {
          formVersion: "HASIL_TP1_1_2026_BM",
          status: "NOT_APPLICABLE",
          allowableDeductionsCents: 0,
          zakatCents: 0,
          sourceReference: null,
          declaredAt: now,
          reviewedAt: now,
        },
        tp3Declaration: {
          formVersion: "HASIL_TP3_1_2026_BM",
          status: "NOT_APPLICABLE",
          grossRemunerationCents: 0,
          epfCents: 0,
          pcbCents: 0,
          allowableDeductionsCents: 0,
          zakatCents: 0,
          sourceReference: null,
          declaredAt: now,
          reviewedAt: now,
        },
        religiousTravelLevyDeclaration: {
          status: "NOT_APPLICABLE",
          amountCents: 0,
          sourceReference: null,
          declaredAt: now,
          reviewedAt: now,
        },
        confirmedAt: now,
      },
      reasonNote: "Local October 2026 payroll UAT: governed PCB declarations recorded as not applicable.",
      reasonType: "DATA_MIGRATION",
    },
    context,
  });
  console.log(`Applied governed local PCB profile revision ${result.newRevision}.`);
}

async function prepareLocalPcbUatRule() {
  const localVersion = "LOCAL_UAT_PCB_2026_UNVERIFIED_1";
  const existingLocal = await prisma.statutoryRuleSet.findUnique({
    where: { scheme_version: { scheme: "PCB", version: localVersion } },
    select: { id: true, status: true },
  });
  if (existingLocal) {
    if (existingLocal.status !== "ACTIVE") {
      throw new Error("The local PCB UAT rule exists but is not active; inspect it before continuing.");
    }
    console.log(`Local PCB UAT rule already active: ${existingLocal.id}`);
    return;
  }

  const activeOfficial = await prisma.statutoryRuleSet.findFirst({
    where: { scheme: "PCB", status: "ACTIVE" },
    select: { id: true, version: true },
  });
  if (activeOfficial) {
    throw new Error(
      `An active PCB rule already exists (${activeOfficial.version}); a local UAT override was not created.`,
    );
  }

  const candidate = await prisma.statutoryRuleSet.findFirst({
    where: { scheme: "PCB", version: "malaysia-pcb-2026-signoff-candidate-v1" },
    include: { classifications: true },
  });
  if (!candidate) throw new Error("The retained PCB 2026 candidate rule was not found.");

  const sourceDigest = digest({
    candidateId: candidate.id,
    candidateDigest: candidate.sourceDigest,
    localVersion,
    transportAssumption: "EXCLUDED_FROM_PCB_FOR_LOCAL_UAT_ONLY",
  });
  const created = await prisma.statutoryRuleSet.create({
    data: {
      scheme: "PCB",
      version: localVersion,
      jurisdictionCode: candidate.jurisdictionCode,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
      authority: "Tetamu local UAT only — not HASiL approved",
      sourceReference: "local://pcb-uat/2026/unverified",
      sourceDocumentName: "Local PCB 2026 payroll UAT rule (unverified)",
      sourceDigest,
      datasetDigest: candidate.datasetDigest,
      goldenFixtureDigest: candidate.goldenFixtureDigest,
      independentReviewDigest: candidate.independentReviewDigest,
      classificationVersion: `${candidate.classificationVersion ?? candidate.version}-local-uat`,
      classificationDigest: digest({ sourceDigest, classifications: candidate.classifications }),
      parserName: candidate.parserName,
      parserVersion: candidate.parserVersion,
      calculatorVersion: candidate.calculatorVersion,
      calculatorTestDigest: candidate.calculatorTestDigest,
      datasetRowCount: candidate.datasetRowCount,
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
      humanReviewStatus: "COMPLETED",
      humanReviewRevision: 1,
      humanClassificationDigest: sourceDigest,
      humanReviewCompletedAt: new Date(),
      humanReviewCompletedById: ACTOR_ID,
      calculationVerifiedAt: new Date(),
      calculationVerifiedById: ACTOR_ID,
      activatedAt: new Date(),
      activatedById: ACTOR_ID,
      activationReason:
        "Local October 2026 payroll UAT only. HASiL software verification remains pending.",
      ruleData: {
        localUatOnly: true,
        productionEligible: false,
        sourceCandidateId: candidate.id,
        hasilSoftwareVerificationStatus: "PENDING",
      },
      verificationEvidence: {
        scope: "LOCAL_UAT_ONLY",
        hasilSoftwareVerificationStatus: "PENDING",
        warning: "This rule must never be copied to production as an approved statutory rule.",
      },
      createdById: ACTOR_ID,
      classifications: {
        create: candidate.classifications.map((classification) => ({
          scheme: "PCB",
          componentCode: classification.componentCode,
          sourceType: classification.sourceType,
          treatment:
            classification.componentCode === "TRANSPORT_ALLOWANCE"
              ? "EXCLUDED"
              : classification.treatment,
          rationale:
            classification.componentCode === "TRANSPORT_ALLOWANCE"
              ? "Local UAT assumption only: the fixture transport amount is treated as an excluded reimbursement."
              : classification.rationale,
          authorityRef:
            classification.componentCode === "TRANSPORT_ALLOWANCE"
              ? "local://pcb-uat/assumption/transport-reimbursement"
              : classification.authorityRef,
        })),
      },
    },
    select: { id: true },
  });
  console.log(`Created local-only PCB UAT rule: ${created.id}`);
}

async function endLocalTransportAllowanceForPcbUat(args: { businessId: string }) {
  const component = await prisma.employeeRecurringPayComponent.findFirst({
    where: {
      businessId: args.businessId,
      membershipId: MEMBERSHIP_ID,
      code: "TRANSPORT_ALLOWANCE",
    },
    include: {
      versions: {
        where: { status: "CURRENT" },
        orderBy: [{ effectiveFromMonth: "desc" }, { revision: "desc" }],
      },
    },
  });
  const effectiveFromMonth = new Date("2026-10-01T00:00:00.000Z");
  const applicableVersion = component?.versions.find(
    (version) => version.effectiveFromMonth <= effectiveFromMonth,
  );
  if (!component || !applicableVersion || applicableVersion.state !== "ACTIVE") {
    console.log("Local PCB UAT transport allowance is already inactive.");
    return;
  }

  const [membership, actor] = await Promise.all([
    prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: MEMBERSHIP_ID },
      include: {
        business: { select: { industryType: true } },
        branchAssignments: {
          where: { status: "ACTIVE" },
          orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }],
          take: 1,
        },
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ACTOR_ID },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const branchId = membership.branchAssignments[0]?.branchId ?? null;
  const context: PayrollProfileWriteContext = {
    access: {
      actorRole: "BUSINESS_OWNER" as const,
      branchId,
      businessId: args.businessId,
      capability: null,
      effectiveBusinessRole: "BUSINESS_OWNER" as const,
      granted: true,
      groupId: null,
      groupUserId: null,
      homeBusinessId: args.businessId,
      identityRole: "BUSINESS_OWNER" as const,
      industryType: membership.business.industryType,
      permissions: [],
      source: "DIRECT_BUSINESS" as const,
      userId: actor.id,
    },
    actor: {
      email: actor.email ?? "",
      name: actor.name,
      userId: actor.id,
    },
    allowedBranchIds: branchId ? [branchId] : [],
    businessId: args.businessId,
    caller: "SYSTEM" as const,
  };
  await scheduleRecurringPayComponent({
    command: {
      amount: applicableVersion.amount,
      code: component.code,
      commandId: randomUUID(),
      componentId: component.id,
      effectiveFromMonth,
      expectedRevision: membership.recurringPayRevision,
      membershipId: MEMBERSHIP_ID,
      name: applicableVersion.name,
      operation: "END",
      reasonNote:
        "Local PCB UAT fixture excludes the transport reimbursement from October payroll.",
      reasonType: "PAYROLL_POLICY_CHANGE",
      source: "MANUAL",
      type: component.type,
    },
    context,
  });
  console.log("Ended the local October transport allowance for PCB UAT consistency.");
}

async function normalizeFixtureTransportAllowance(args: { businessId: string }) {
  const legacyCode = "EMP_TRANSPORT_FEE_6ED4A869C4";
  const canonicalCode = "TRANSPORT_ALLOWANCE";
  const existingCanonical = await prisma.employeeRecurringPayComponent.findFirst({
    where: {
      businessId: args.businessId,
      membershipId: MEMBERSHIP_ID,
      code: canonicalCode,
    },
  });
  if (existingCanonical) return;

  const component = await prisma.employeeRecurringPayComponent.findFirst({
    where: {
      businessId: args.businessId,
      membershipId: MEMBERSHIP_ID,
      code: legacyCode,
    },
    include: {
      versions: {
        where: { status: "CURRENT", state: "ACTIVE" },
        orderBy: [{ effectiveFromMonth: "desc" }, { revision: "desc" }],
        take: 1,
      },
      snapshots: {
        include: {
          payrollEntry: {
            include: { payrollRun: { select: { status: true } } },
          },
        },
      },
    },
  });
  if (!component) {
    throw new Error(`Local transport component ${legacyCode} was not found.`);
  }
  const currentVersion = component.versions[0];
  if (!currentVersion) {
    throw new Error("The local transport component has no active version to migrate.");
  }

  const immutableSnapshot = component.snapshots.find(
    (snapshot) => snapshot.payrollEntry.payrollRun.status !== "DRAFT",
  );
  if (immutableSnapshot) {
    throw new Error("The local transport component is already used by an immutable Payroll Run.");
  }

  const [membership, actor] = await Promise.all([
    prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: MEMBERSHIP_ID },
      include: {
        business: { select: { industryType: true } },
        branchAssignments: {
          where: { status: "ACTIVE" },
          orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "desc" }],
          take: 1,
        },
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: ACTOR_ID },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const branchId = membership.branchAssignments[0]?.branchId ?? null;
  const context: PayrollProfileWriteContext = {
    access: {
      actorRole: "BUSINESS_OWNER" as const,
      branchId,
      businessId: args.businessId,
      capability: null,
      effectiveBusinessRole: "BUSINESS_OWNER" as const,
      granted: true,
      groupId: null,
      groupUserId: null,
      homeBusinessId: args.businessId,
      identityRole: "BUSINESS_OWNER" as const,
      industryType: membership.business.industryType,
      permissions: [],
      source: "DIRECT_BUSINESS" as const,
      userId: actor.id,
    },
    actor: {
      email: actor.email ?? "",
      name: actor.name,
      userId: actor.id,
    },
    allowedBranchIds: branchId ? [branchId] : [],
    businessId: args.businessId,
    caller: "SYSTEM" as const,
  };
  const effectiveFromMonth = new Date("2026-10-01T00:00:00.000Z");
  const ended = await scheduleRecurringPayComponent({
    command: {
      amount: currentVersion.amount,
      code: legacyCode,
      commandId: randomUUID(),
      componentId: component.id,
      effectiveFromMonth,
      expectedRevision: membership.recurringPayRevision,
      membershipId: MEMBERSHIP_ID,
      name: currentVersion.name,
      operation: "END",
      reasonNote: "Local UAT migration from the legacy transport fee code.",
      reasonType: "PAYROLL_POLICY_CHANGE",
      source: "MANUAL",
      type: component.type,
    },
    context,
  });
  await scheduleRecurringPayComponent({
    command: {
      amount: currentVersion.amount,
      code: canonicalCode,
      commandId: randomUUID(),
      componentId: null,
      effectiveFromMonth,
      expectedRevision: ended.newRevision,
      membershipId: MEMBERSHIP_ID,
      name: "Transport allowance",
      operation: "SET",
      reasonNote: "Local UAT transport allowance aligned with the reviewed statutory classification.",
      reasonType: "PAYROLL_POLICY_CHANGE",
      source: "MANUAL",
      type: component.type,
    },
    context,
  });
}

async function rebuildPayrollDraft(args: { businessId: string }) {
  const periodStart = new Date("2026-10-01T00:00:00.000Z");
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: ACTOR_ID },
    select: { id: true, name: true, email: true },
  });
  const run = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId: args.businessId,
        periodStart,
        periodEnd: new Date("2026-11-01T00:00:00.000Z"),
      },
    },
    include: {
      _count: {
        select: {
          paymentBatches: true,
          payslipPublications: true,
          statutoryArtifacts: true,
          statutorySubmissions: true,
        },
      },
    },
  });
  if (!run) {
    const created = await generatePayrollRun({
      actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" },
      businessId: args.businessId,
      month: TEST_MONTH,
    });
    console.log(`Created local October 2026 payroll Draft: ${created.id}`);
    return;
  }
  if (run.status !== "DRAFT") {
    throw new Error(`Only a local DRAFT may be rebuilt; current status is ${run.status}.`);
  }
  const protectedRecordCount =
    run._count.paymentBatches
    + run._count.payslipPublications
    + run._count.statutoryArtifacts
    + run._count.statutorySubmissions;
  if (protectedRecordCount > 0) {
    throw new Error("The Draft has downstream payment, payslip, or statutory records and was not rebuilt.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.payrollWorkPayCalculationLine.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollWorkPayCalculationSnapshot.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollEntryStatutorySnapshot.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollClaimReimbursementSnapshot.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollEntryRecurringPaySnapshot.deleteMany({
      where: { payrollEntry: { payrollRunId: run.id } },
    });
    await transaction.payrollEntryComponent.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollAttendanceInputSnapshot.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollEntry.deleteMany({ where: { payrollRunId: run.id } });
    await transaction.payrollRun.delete({ where: { id: run.id } });
  });

  const rebuilt = await generatePayrollRun({
    actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" },
    businessId: args.businessId,
    month: TEST_MONTH,
  });
  console.log(`Rebuilt local October 2026 payroll Draft: ${rebuilt.id}`);
}

async function applyFixture(args: { businessId: string; branchId: string | null }) {
  if (!args.branchId) throw new Error("Oscar Yong has no primary branch.");
  const periodStart = new Date("2026-10-01T00:00:00.000Z");
  const periodEnd = new Date("2026-11-01T00:00:00.000Z");
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: ACTOR_ID },
    select: { id: true, name: true, email: true },
  });
  const existing = await Promise.all([
    prisma.employeeAttendance.count({
      where: { membershipId: MEMBERSHIP_ID, workDate: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.attendanceExpectedDay.count({
      where: { membershipId: MEMBERSHIP_ID, workDate: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.attendanceP2FinalResult.count({
      where: { membershipId: MEMBERSHIP_ID, workDate: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.attendanceMonthlyTimesheet.count({
      where: { businessId: args.businessId, periodStart },
    }),
    prisma.payrollRun.count({
      where: { businessId: args.businessId, periodStart },
    }),
  ]);
  if (existing.some((count) => count > 0)) {
    throw new Error(
      `October 2026 is no longer empty (attendance=${existing[0]}, expected=${existing[1]}, final=${existing[2]}, timesheet=${existing[3]}, payroll=${existing[4]}). No changes were made.`,
    );
  }

  const workedDates = Array.from({ length: 16 }, (_, index) => index + 1);
  const overtimeDates = new Set([6, 12, 16]);
  const noShowDate = 17;
  await prisma.$transaction(async (transaction) => {
    for (const day of [...workedDates, noShowDate]) {
      const dateKey = `2026-10-${String(day).padStart(2, "0")}`;
      const workDate = new Date(`${dateKey}T00:00:00.000Z`);
      const expectedStartAt = new Date(`${dateKey}T03:45:00.000Z`);
      const expectedEndAt = new Date(`${dateKey}T12:45:00.000Z`);
      const expectedDay = await transaction.attendanceExpectedDay.create({
        data: {
          businessId: args.businessId,
          branchId: args.branchId!,
          membershipId: MEMBERSHIP_ID,
          workDate,
          kind: "WORKDAY",
          source: "MANUAL_EVIDENCE",
          expectedStartAt,
          expectedEndAt,
          graceMinutes: 0,
          timezoneSnapshot: "Asia/Kuching",
          policySnapshot: {
            fixture: FIXTURE_REFERENCE,
            shiftName: "Morning shift",
            startLocal: "11:45",
            endLocal: "20:45",
            breakMinutes: 60,
          },
          evidenceReference: `${FIXTURE_REFERENCE}:${dateKey}`,
          status: "CURRENT",
          revision: 1,
          createdById: actor.id,
        },
      });

      const isNoShow = day === noShowDate;
      const isOvertime = overtimeDates.has(day);
      const actualClockOutAt = isNoShow
        ? null
        : new Date(`${dateKey}T${isOvertime ? "15:45" : "12:45"}:00.000Z`);
      const totalWorkedMinutes = isNoShow ? 0 : isOvertime ? 660 : 480;
      const sourceDigest = digest({ fixture: FIXTURE_REFERENCE, dateKey, totalWorkedMinutes });
      const finalResult = await transaction.attendanceP2FinalResult.create({
        data: {
          businessId: args.businessId,
          branchId: args.branchId!,
          membershipId: MEMBERSHIP_ID,
          workDate,
          version: 1,
          outcome: isNoShow ? "UNAUTHORIZED_ABSENCE" : "PRESENT",
          expectedDayKindSnapshot: "WORKDAY",
          expectedDayId: expectedDay.id,
          expectedStartAt,
          expectedEndAt,
          graceMinutesSnapshot: 0,
          actualClockInAt: isNoShow ? null : expectedStartAt,
          actualClockOutAt,
          totalBreakMinutes: isNoShow ? 0 : 60,
          totalWorkedMinutes,
          sourceDigest,
          resolutionDigest: digest({ sourceDigest, outcome: isNoShow ? "UNAUTHORIZED_ABSENCE" : "PRESENT" }),
          createdById: actor.id,
        },
      });

      if (isOvertime) {
        const candidate = deriveOvertimeCandidate(finalResult, "Asia/Kuching");
        if (candidate.potentialOtMinutes !== 180) {
          throw new Error(`Expected 180 OT minutes on ${dateKey}, received ${candidate.potentialOtMinutes}.`);
        }
        const review = await transaction.attendanceOvertimeReview.create({
          data: {
            businessId: args.businessId,
            branchId: args.branchId!,
            membershipId: MEMBERSHIP_ID,
            workDate,
            finalResultId: finalResult.id,
            finalResultVersion: finalResult.version,
            expectedDayId: expectedDay.id,
            status: "APPROVED",
            context: candidate.context,
            potentialOtMinutes: 180,
            approvedOtMinutes: 180,
            sourceDigest: candidate.sourceDigest,
            revision: 1,
            reviewedById: actor.id,
            reviewedAt: new Date(),
            reason: "Local payroll UAT: approved three-hour overtime shift.",
          },
        });
        await transaction.attendanceOvertimeReviewEvent.create({
          data: {
            reviewId: review.id,
            businessId: args.businessId,
            branchId: args.branchId!,
            membershipId: MEMBERSHIP_ID,
            workDate,
            type: "OT_APPROVED",
            reviewRevision: 1,
            potentialOtMinutes: 180,
            approvedOtMinutes: 180,
            context: candidate.context,
            actorId: actor.id,
            reason: "Local payroll UAT: approved three-hour overtime shift.",
            afterSnapshot: {
              fixture: FIXTURE_REFERENCE,
              status: "APPROVED",
              approvedOtMinutes: 180,
            },
          },
        });
      }
    }
  });

  const context: AttendanceTimesheetContext = {
    businessId: args.businessId,
    allowedBranchIds: [args.branchId],
    wholeBusinessScope: true,
    actor: {
      userId: actor.id,
      name: actor.name,
      email: actor.email ?? "",
    },
  };
  await markAttendanceTimesheetBranchReady({
    context,
    month: TEST_MONTH,
    branchId: args.branchId,
  });
  const ready = await loadMonthlyAttendanceTimesheet({
    businessId: args.businessId,
    allowedBranchIds: [args.branchId],
    month: TEST_MONTH,
  });
  if (ready.totals.blockers !== 0 || !ready.allBranchesReady) {
    throw new Error(`October timesheet is not ready: blockers=${ready.totals.blockers}.`);
  }
  await approveMonthlyAttendanceTimesheet({
    context,
    month: TEST_MONTH,
    reason: "Local payroll UAT: 16 worked days, 9 approved OT hours and one no-show.",
    expectedUpdatedAt: ready.timesheet?.updatedAt.toISOString(),
  });
  const approved = await loadMonthlyAttendanceTimesheet({
    businessId: args.businessId,
    allowedBranchIds: [args.branchId],
    month: TEST_MONTH,
  });
  await lockMonthlyAttendanceTimesheet({
    context,
    month: TEST_MONTH,
    reason: "Local payroll UAT: lock October attendance evidence for payroll calculation.",
    expectedUpdatedAt: approved.timesheet?.updatedAt.toISOString(),
  });
  await generatePayrollRun({
    actor: { userId: actor.id, name: actor.name, email: actor.email ?? "" },
    businessId: args.businessId,
    month: TEST_MONTH,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
