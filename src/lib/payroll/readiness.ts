import type { Prisma, PrismaClient } from "@prisma/client";
import { assertSupportedPayrollProration } from "@/lib/payroll/calculation";
import { getPayrollRunComponentReconciliationFailures } from "@/lib/payroll/component-service";
import { isPayrollBankAccountMfaEnabled } from "@/lib/payroll/payment/bank-account-security";
import { parsePayrollMonth } from "@/lib/payroll/period";
import { prisma } from "@/lib/prisma";

type ReadinessDatabase = PrismaClient | Prisma.TransactionClient;

export type PayrollReadinessSeverity = "BLOCKING" | "REVIEW" | "INFO";
export type PayrollReadinessStatus = "READY" | "REVIEW_REQUIRED" | "BLOCKED";

type PayrollStatutoryReadinessSnapshot = {
  scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24" | "PCB" | "WORK_PAY";
  status: "CALCULATED" | "MANUAL" | "BLOCKED" | "NOT_APPLICABLE";
  blockerCode: string | null;
  evidenceNature: "REAL" | "SYNTHETIC_TESTING";
  evidenceEnvironment: "LOCAL" | "TESTING" | null;
  fixturePurpose: "PAYROLL_PAYSLIP_UAT" | null;
  officialExportEligible: boolean;
};

const REQUIRED_STATUTORY_UAT_SCHEMES = [
  "EPF",
  "SOCSO",
  "EIS",
  "LINDUNG24",
  "PCB",
] as const;

export function isNonProductionDeferredPcbSnapshot(
  snapshot: PayrollStatutoryReadinessSnapshot,
) {
  return snapshot.scheme === "PCB" &&
    snapshot.status === "BLOCKED" &&
    snapshot.blockerCode === "PCB_PROFILE_INCOMPLETE" &&
    snapshot.evidenceNature === "SYNTHETIC_TESTING" &&
    (snapshot.evidenceEnvironment === "LOCAL" ||
      snapshot.evidenceEnvironment === "TESTING") &&
    snapshot.fixturePurpose === "PAYROLL_PAYSLIP_UAT" &&
    snapshot.officialExportEligible === false;
}

export function hasOnlyNonProductionDeferredPcbBlocker(
  snapshots: PayrollStatutoryReadinessSnapshot[],
) {
  const byScheme = new Map(snapshots.map((snapshot) => [snapshot.scheme, snapshot]));
  if (
    REQUIRED_STATUTORY_UAT_SCHEMES.some((scheme) => !byScheme.has(scheme)) ||
    !isNonProductionDeferredPcbSnapshot(byScheme.get("PCB")!)
  ) {
    return false;
  }
  return snapshots.every(
    (snapshot) => snapshot.status !== "BLOCKED" ||
      isNonProductionDeferredPcbSnapshot(snapshot),
  );
}
export type PayrollReadinessCode =
  | "MISSING_COMPENSATION"
  | "RECONCILIATION_FAILED"
  | "PRORATION_NOT_SUPPORTED"
  | "MISSING_LOCKED_TIMESHEET"
  | "STALE_ATTENDANCE_SOURCE"
  | "TIMESHEET_REVISION_INVALID"
  | "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED"
  | "ATTENDANCE_PAY_POLICY_NOT_READY"
  | "LEGACY_ATTENDANCE_INPUT"
  | "OVERTIME_APPROVAL_SOURCE_NOT_READY"
  | "APPROVED_VARIABLE_PAY_MISSING"
  | "APPROVED_CORRECTION_MISSING"
  | "EMPTY_PAYROLL_RUN"
  | "MISSING_BANK_ACCOUNT"
  | "BANK_ACCOUNT_UNVERIFIED"
  | "STATUTORY_PROFILE_INCOMPLETE"
  | "MISSING_EPF_PROFILE"
  | "MISSING_SOCSO_PROFILE"
  | "MISSING_EIS_PROFILE"
  | "PCB_PROFILE_INCOMPLETE"
  | "PCB_YTD_LEDGER_INCOMPLETE"
  | "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED"
  | "CP38_INSTRUCTION_NOT_READY"
  | "STATUTORY_RULE_NOT_AVAILABLE"
  | "STATUTORY_CLASSIFICATION_REQUIRED"
  | "STATUTORY_CALCULATION_FAILED"
  | "STALE_STATUTORY_PROFILE"
  | "STALE_STATUTORY_SOURCE"
  | "LINDUNG24_PROFILE_INCOMPLETE"
  | "LINDUNG24_PARTICIPATION_REQUIRED"
  | "LINDUNG24_SELECTED_EMPLOYER_REQUIRED"
  | "LINDUNG24_APPLICABILITY_INCOMPLETE"
  | "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED"
  | "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE"
  | "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED"
  | "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED"
  | "STALE_LINDUNG24_PARTICIPATION"
  | "PENDING_VARIABLE_PAY"
  | "FUTURE_COMPENSATION_CHANGE"
  | "APPROVED_INPUT_READY"
  | "CLAIM_STATUTORY_TREATMENT_NOT_READY"
  | "STATUTORY_WORK_PAY_NOT_READY"
  | "STATUTORY_WORK_PAY_REVIEW_REQUIRED"
  | "STALE_STATUTORY_WORK_PAY_SOURCE"
  | "STATUTORY_WORK_PAY_RECONCILIATION_FAILED";

export type PayrollReadinessIssue = {
  code: PayrollReadinessCode;
  severity: PayrollReadinessSeverity;
  employeeId: string | null;
  membershipId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  source: string;
  message: string;
  resolutionHint: string;
};

export type PayrollReadiness = {
  businessId: string;
  month: string;
  runId: string | null;
  employeeCount: number;
  status: PayrollReadinessStatus;
  readyCount: number;
  reviewRequiredCount: number;
  blockedCount: number;
  needsAttentionCount: number;
  issues: PayrollReadinessIssue[];
  blockers: PayrollReadinessIssue[];
  warnings: PayrollReadinessIssue[];
  info: PayrollReadinessIssue[];
  counts: Record<PayrollReadinessCode, number>;
  employees: Array<{
    membershipId: string;
    employeeCode: string;
    employeeName: string;
    status: PayrollReadinessStatus;
    issues: PayrollReadinessIssue[];
  }>;
  canProceed: boolean;
};

export async function getPayrollPeriodReadiness(
  input: { businessId: string; month: string; runId?: string | null },
  database: ReadinessDatabase = prisma,
): Promise<PayrollReadiness> {
  const period = parsePayrollMonth(input.month);
  const bankVerificationRequired = isPayrollBankAccountMfaEnabled();
  const run = input.runId
    ? await database.payrollRun.findFirst({
        where: {
          id: input.runId,
          businessId: input.businessId,
          periodStart: period.start,
          periodEnd: period.end,
        },
        select: {
          id: true,
          status: true,
          attendanceSource: true,
          attendanceTimesheetRevisionId: true,
          attendanceTimesheetRevisionSnapshot: true,
          attendanceTimesheetDigestSnapshot: true,
          attendanceTimesheetLockedAtSnapshot: true,
        },
      })
    : await database.payrollRun.findUnique({
        where: {
          businessId_periodStart_periodEnd: {
            businessId: input.businessId,
            periodStart: period.start,
            periodEnd: period.end,
          },
        },
        select: {
          id: true,
          status: true,
          attendanceSource: true,
          attendanceTimesheetRevisionId: true,
          attendanceTimesheetRevisionSnapshot: true,
          attendanceTimesheetDigestSnapshot: true,
          attendanceTimesheetLockedAtSnapshot: true,
        },
      });
  if (input.runId && !run) throw new Error("Payroll run not found.");

  const currentTimesheet = await database.attendanceMonthlyTimesheet.findUnique({
    where: {
      businessId_periodStart: {
        businessId: input.businessId,
        periodStart: period.start,
      },
    },
    select: {
      id: true,
      status: true,
      currentRevision: {
        select: {
          id: true,
          revision: true,
          sourceDigest: true,
          lockedAt: true,
        },
      },
    },
  });

  const memberships = await database.employeeBusinessMembership.findMany({
    where: {
      businessId: input.businessId,
      joinedAt: { lt: period.end },
      OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.start } }],
    },
    orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      joinedAt: true,
      terminatedAt: true,
      statutoryProfileRevision: true,
      taxProfileRevision: true,
      epfEnabled: true,
      epfMemberNumber: true,
      socsoEnabled: true,
      socsoMemberNumber: true,
      taxIdentificationNumber: true,
    },
  });
  const membershipIds = memberships.map((membership) => membership.id);
  const lockedP2MembershipIds = new Set(
    currentTimesheet?.status === "LOCKED" && currentTimesheet.currentRevision
      ? (
          await database.attendanceTimesheetP2DaySnapshot.findMany({
            where: {
              businessId: input.businessId,
              revisionId: currentTimesheet.currentRevision.id,
              membershipId: { in: membershipIds },
            },
            distinct: ["membershipId"],
            select: { membershipId: true },
          })
        ).map((item) => item.membershipId)
      : [],
  );
  const [
    compensations,
    futureCompensations,
    entries,
    banks,
    variablePay,
    corrections,
    activeStatutoryRules,
    lindung24Participation,
  ] =
    await Promise.all([
      database.employeeCompensationVersion.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          effectiveFromMonth: { lte: period.start },
          status: "ACTIVE",
        },
        orderBy: [
          { membershipId: "asc" },
          { effectiveFromMonth: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        select: { id: true, membershipId: true, payBasis: true },
      }),
      database.employeeCompensationVersion.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          effectiveFromMonth: { gt: period.start },
          status: "ACTIVE",
        },
        orderBy: [{ membershipId: "asc" }, { effectiveFromMonth: "asc" }],
        select: { membershipId: true },
      }),
      run
        ? database.payrollEntry.findMany({
            where: { businessId: input.businessId, payrollRunId: run.id },
            select: {
              id: true,
              membershipId: true,
              compensationVersionId: true,
              payBasisSnapshot: true,
              statutoryStatus: true,
              statutoryWarning: true,
              components: {
                select: {
                  id: true,
                  amount: true,
                  sourceId: true,
                  sourceType: true,
                },
              },
              attendanceInputSnapshot: {
                select: {
                  membershipId: true,
                  timesheetRevisionId: true,
                  timesheetRevision: true,
                  timesheetSourceDigest: true,
                  timesheetLockedAt: true,
                  periodStart: true,
                  periodEnd: true,
                  legacyCompatibility: true,
                  policyBlockers: true,
                  normalOtMinutes: true,
                  restDayWorkMinutes: true,
                  restDayOtMinutes: true,
                  publicHolidayWorkMinutes: true,
                  publicHolidayOtMinutes: true,
                },
              },
              workPayCalculationSnapshot: {
                select: {
                  id: true,
                  ruleSetId: true,
                  ruleVersion: true,
                  sourceDigest: true,
                  coverageStatus: true,
                  blockerCodes: true,
                  lines: {
                    select: {
                      payrollComponentId: true,
                      amount: true,
                    },
                  },
                },
              },
              statutorySnapshots: {
                select: {
                  evidenceNature: true,
                  evidenceEnvironment: true,
                  fixturePurpose: true,
                  officialExportEligible: true,
                  scheme: true,
                  status: true,
                  blockerCode: true,
                  ruleSetId: true,
                  ruleVersionSnapshot: true,
                  artifactDigestSnapshot: true,
                  datasetDigestSnapshot: true,
                  fixtureDigestSnapshot: true,
                  classificationVersionSnapshot: true,
                  parserVersionSnapshot: true,
                  calculatorVersionSnapshot: true,
                  profileRevisionSnapshot: true,
                  taxProfileRevisionSnapshot: true,
                  lindung24ParticipationVersionId: true,
                  lindung24ParticipationRevisionSnapshot: true,
                  lindung24EmployerSelectionSnapshot: true,
                },
              },
              claimReimbursementSnapshots: {
                select: { status: true, blockerCode: true, claimNumberSnapshot: true },
              },
            },
          })
        : Promise.resolve([]),
      database.employeeBankAccountVersion.findMany({
        where: {
          businessId: input.businessId,
          employeeMembershipId: { in: membershipIds },
          isPrimary: true,
          status: "ACTIVE",
          effectiveFrom: { lt: period.end },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: period.start } }],
        },
        orderBy: [{ employeeMembershipId: "asc" }, { effectiveFrom: "desc" }],
        select: { employeeMembershipId: true, verificationStatus: true },
      }),
      database.payrollVariablePay.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          payrollPeriodStart: period.start,
          status: { in: ["DRAFT", "APPROVED", "APPLIED"] },
        },
        select: { id: true, membershipId: true, status: true, appliedPayrollEntryId: true },
      }),
      database.payrollCorrection.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          applyToPeriodStart: period.start,
          status: { in: ["APPROVED", "APPLIED"] },
        },
        select: { id: true, membershipId: true, status: true, appliedPayrollEntryId: true },
      }),
      database.statutoryRuleSet.findMany({
        where: {
          status: "ACTIVE",
          effectiveFrom: { lte: period.start },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.start } }],
        },
        select: {
          id: true,
          scheme: true,
          jurisdictionCode: true,
          version: true,
          sourceDigest: true,
          datasetDigest: true,
          goldenFixtureDigest: true,
          classificationVersion: true,
          parserVersion: true,
          calculatorVersion: true,
        },
      }),
      database.employeeLindung24ParticipationVersion.findMany({
        where: {
          businessId: input.businessId,
          membershipId: { in: membershipIds },
          effectiveFromMonth: { lte: period.start },
          OR: [{ effectiveToMonth: null }, { effectiveToMonth: { gt: period.start } }],
        },
        select: {
          id: true,
          membershipId: true,
          revision: true,
          selectedEmployer: true,
        },
      }),
    ]);

  const reconciliationFailures = run
    ? new Set(
        await getPayrollRunComponentReconciliationFailures(
          database,
          { businessId: input.businessId, runId: run.id },
        ),
      )
    : new Set<string>();
  const compensationByMembership = firstBy(compensations, "membershipId");
  const futureCompensationMemberships = new Set(
    futureCompensations.map((version) => version.membershipId),
  );
  const entryByMembership = new Map(entries.map((entry) => [entry.membershipId, entry]));
  const bankByMembership = firstBy(banks, "employeeMembershipId");
  const variableByMembership = groupBy(variablePay, "membershipId");
  const correctionByMembership = groupBy(corrections, "membershipId");
  const activeStatutoryRuleByScheme = new Map(
    activeStatutoryRules.map((rule) => [rule.scheme, rule]),
  );
  const lindung24ParticipationByMembership = new Map(
    lindung24Participation.map((record) => [record.membershipId, record]),
  );
  const issues: PayrollReadinessIssue[] = [];

  for (const membership of memberships) {
    const compensation = compensationByMembership.get(membership.id);
    const entry = entryByMembership.get(membership.id);
    const add = (
      severity: PayrollReadinessSeverity,
      code: PayrollReadinessCode,
      message: string,
    ) => issues.push(createPayrollReadinessIssue({
      severity,
      code,
      message,
      membershipId: membership.id,
      employeeCode: membership.employeeCode,
      employeeName: membership.fullName,
    }));

    if (!compensation || (run && (!entry || !entry.compensationVersionId))) {
      add("BLOCKING", "MISSING_COMPENSATION", "No verified compensation applies to this payroll month.");
    } else {
      try {
        assertSupportedPayrollProration({
          payBasis: entry?.payBasisSnapshot ?? compensation.payBasis,
          joinedAt: membership.joinedAt,
          terminatedAt: membership.terminatedAt,
          periodStart: period.start,
          periodEnd: period.end,
        });
      } catch {
        add("BLOCKING", "PRORATION_NOT_SUPPORTED", "Monthly mid-period join or termination needs an approved proration policy.");
      }
    }
    if (
      !run &&
      compensation &&
      compensation.payBasis !== "MONTHLY" &&
      !lockedP2MembershipIds.has(membership.id)
    ) {
      add(
        "BLOCKING",
        "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED",
        "Daily and Hourly payroll require employee day snapshots in the locked Timesheet revision.",
      );
    }
    if (entry && reconciliationFailures.has(entry.id)) {
      add("BLOCKING", "RECONCILIATION_FAILED", "Stored totals do not reconcile with canonical component lines.");
    }
    if (entry) {
      const cp38Warning = entry.statutoryWarning
        ?.split("; ")
        .find((warning) => warning.startsWith("CP38:"));
      if (cp38Warning) {
        add(
          "BLOCKING",
          "CP38_INSTRUCTION_NOT_READY",
          `CP38 deduction is not ready: ${cp38Warning.slice("CP38:".length).trim()}`,
        );
      }
      for (const snapshot of entry.claimReimbursementSnapshots) {
        if (snapshot.status === "BLOCKED_STATUTORY") {
          add(
            "REVIEW",
            "CLAIM_STATUTORY_TREATMENT_NOT_READY",
            `Claim ${snapshot.claimNumberSnapshot} is on hold until its payroll treatment is set. Salary payroll can continue.`,
          );
        }
      }
      for (const snapshot of entry.statutorySnapshots) {
        const activeRule = activeStatutoryRuleByScheme.get(snapshot.scheme);
        if (
          snapshot.profileRevisionSnapshot !== membership.statutoryProfileRevision ||
          snapshot.taxProfileRevisionSnapshot !== membership.taxProfileRevision
        ) {
          add(
            "BLOCKING",
            "STALE_STATUTORY_PROFILE",
            `${snapshot.scheme} profile changed after this Draft was calculated. Recalculate payroll.`,
          );
        }
        if (run?.status === "DRAFT" && snapshot.scheme === "LINDUNG24") {
          const currentParticipation = lindung24ParticipationByMembership.get(membership.id);
          if (
            snapshot.lindung24ParticipationVersionId !== (currentParticipation?.id ?? null) ||
            snapshot.lindung24ParticipationRevisionSnapshot !== (currentParticipation?.revision ?? null) ||
            snapshot.lindung24EmployerSelectionSnapshot !==
              (currentParticipation?.selectedEmployer ?? null)
          ) {
            add(
              "BLOCKING",
              "STALE_LINDUNG24_PARTICIPATION",
              "LINDUNG24 participation or selected-employer evidence changed after this Draft was calculated. Recalculate payroll.",
            );
          }
        }
        if (
          run?.status === "DRAFT" &&
          snapshot.status === "CALCULATED" &&
          !isStatutorySnapshotSourceCurrent(
            snapshot,
            activeRule,
          )
        ) {
          add(
            "BLOCKING",
            "STALE_STATUTORY_SOURCE",
            `${snapshot.scheme} rule or verified source changed after this Draft was calculated. Recalculate payroll.`,
          );
        }
        if (snapshot.status !== "BLOCKED") continue;
        if (isNonProductionDeferredPcbSnapshot(snapshot)) {
          add(
            "REVIEW",
            "PCB_PROFILE_INCOMPLETE",
            "PCB is pending configuration for this non-production payroll UAT and is not included in net pay.",
          );
          continue;
        }
        if (
          run?.status === "DRAFT" &&
          snapshot.blockerCode === "STATUTORY_RULE_NOT_AVAILABLE" &&
          activeRule
        ) {
          add(
            "BLOCKING",
            "STALE_STATUTORY_SOURCE",
            `${snapshot.scheme} now has an active payroll rule. Refresh this Draft to recalculate it.`,
          );
          continue;
        }
        add(
          "BLOCKING",
          readinessCodeForStatutoryBlocker(snapshot.blockerCode),
          `${snapshot.scheme} statutory calculation is blocked: ${snapshot.blockerCode ?? "unknown reason"}.`,
        );
      }
    }

    const lockedRevision =
      currentTimesheet?.status === "LOCKED"
        ? currentTimesheet.currentRevision
        : null;
    if (!lockedRevision) {
      add(
        "BLOCKING",
        "MISSING_LOCKED_TIMESHEET",
        "A locked Attendance Timesheet is required for this payroll period.",
      );
    } else if (
      run &&
      (run.attendanceSource !== "LOCKED_TIMESHEET_REVISION" ||
        run.attendanceTimesheetRevisionId !== lockedRevision.id ||
        run.attendanceTimesheetRevisionSnapshot !== lockedRevision.revision ||
        run.attendanceTimesheetDigestSnapshot !== lockedRevision.sourceDigest ||
        run.attendanceTimesheetLockedAtSnapshot?.getTime() !==
          lockedRevision.lockedAt.getTime())
    ) {
      add(
        "BLOCKING",
        "STALE_ATTENDANCE_SOURCE",
        "Attendance source changed. Recalculate this Draft payroll before continuing.",
      );
    }
    if (run && entry) {
      const snapshot = entry.attendanceInputSnapshot;
      if (!snapshot) {
        add(
          "BLOCKING",
          "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED",
          "The approved Attendance input has not been materialised for this employee.",
        );
      } else if (
        snapshot.membershipId !== membership.id ||
        snapshot.timesheetRevisionId !== run.attendanceTimesheetRevisionId ||
        snapshot.timesheetRevision !== run.attendanceTimesheetRevisionSnapshot ||
        snapshot.timesheetSourceDigest !== run.attendanceTimesheetDigestSnapshot ||
        snapshot.timesheetLockedAt.getTime() !==
          run.attendanceTimesheetLockedAtSnapshot?.getTime() ||
        snapshot.periodStart.getTime() !== period.start.getTime() ||
        snapshot.periodEnd.getTime() !== period.end.getTime()
      ) {
        add(
          "BLOCKING",
          "TIMESHEET_REVISION_INVALID",
          "The employee Attendance snapshot does not match the exact locked Timesheet revision.",
        );
      }
      if (snapshot?.legacyCompatibility) {
        add(
          "REVIEW",
          "LEGACY_ATTENDANCE_INPUT",
          "This Monthly entry uses a locked pre-P2 Timesheet with no P2 day snapshots; no Attendance money effect was inferred.",
        );
      }
      for (const policyCode of jsonStringArray(snapshot?.policyBlockers)) {
        add(
          "BLOCKING",
          "ATTENDANCE_PAY_POLICY_NOT_READY",
          `Attendance payroll policy is not ready: ${policyCode}.`,
        );
      }
    }

    const entrySources = new Set(
      entry?.components
        .filter((component) => component.sourceId)
        .map((component) => `${component.sourceType}:${component.sourceId}`) ?? [],
    );
    const variables = variableByMembership.get(membership.id) ?? [];
    for (const source of variables.filter((item) => item.status === "APPROVED")) {
      if (run && !entrySources.has(`VARIABLE_PAY:${source.id}`)) {
        add("BLOCKING", "APPROVED_VARIABLE_PAY_MISSING", "Approved variable pay has not been materialised into this run.");
      } else if (!run) {
        add("INFO", "APPROVED_INPUT_READY", "Approved variable pay is ready for payroll generation.");
      }
    }
    for (const source of variables.filter((item) => item.status === "APPLIED")) {
      if (run && source.appliedPayrollEntryId === entry?.id && !entrySources.has(`VARIABLE_PAY:${source.id}`)) {
        add("BLOCKING", "APPROVED_VARIABLE_PAY_MISSING", "Applied variable pay is missing from canonical component lines.");
      }
    }
    if (variables.some((item) => item.status === "DRAFT")) {
      add("REVIEW", "PENDING_VARIABLE_PAY", "Draft variable pay exists and is not included.");
    }
    for (const correction of correctionByMembership.get(membership.id) ?? []) {
      if (correction.status === "APPROVED" && run && !entrySources.has(`CORRECTION:${correction.id}`)) {
        add("BLOCKING", "APPROVED_CORRECTION_MISSING", "Approved correction has not been materialised into this run.");
      } else if (correction.status === "APPROVED" && !run) {
        add("INFO", "APPROVED_INPUT_READY", "Approved correction is ready for payroll generation.");
      } else if (
        correction.status === "APPLIED" &&
        run &&
        correction.appliedPayrollEntryId === entry?.id &&
        !entrySources.has(`CORRECTION:${correction.id}`)
      ) {
        add("BLOCKING", "APPROVED_CORRECTION_MISSING", "Applied correction is missing from canonical component lines.");
      }
    }

    const bank = bankByMembership.get(membership.id);
    if (!bank) add("REVIEW", "MISSING_BANK_ACCOUNT", "No active primary bank account is configured.");
    else if (
      bankVerificationRequired &&
      bank.verificationStatus !== "MANUALLY_VERIFIED"
    ) {
      add("REVIEW", "BANK_ACCOUNT_UNVERIFIED", "The primary bank account is not verified.");
    }
    const statutoryIncomplete =
      membership.statutoryProfileRevision === 0 ||
      membership.taxProfileRevision === 0 ||
      (membership.epfEnabled && !membership.epfMemberNumber) ||
      (membership.socsoEnabled && !membership.socsoMemberNumber) ||
      !membership.taxIdentificationNumber;
    if (statutoryIncomplete) {
      add("REVIEW", "STATUTORY_PROFILE_INCOMPLETE", "Statutory or tax profile is incomplete.");
    }
    if (futureCompensationMemberships.has(membership.id)) {
      add("INFO", "FUTURE_COMPENSATION_CHANGE", "A future compensation change is scheduled.");
    }
  }

  if (run && entries.length === 0) {
    issues.push(createPayrollReadinessIssue({
      code: "EMPTY_PAYROLL_RUN",
      severity: "BLOCKING",
      membershipId: null,
      employeeCode: null,
      employeeName: null,
      message: "An empty payroll run cannot proceed.",
    }));
  }
  return summarizePayrollReadiness({
    businessId: input.businessId,
    month: period.value,
    runId: run?.id ?? null,
    memberships,
    issues,
  });
}

export function summarizePayrollReadiness(input: {
  businessId: string;
  month: string;
  runId: string | null;
  memberships: Array<{ id: string; employeeCode: string; fullName: string }>;
  issues: PayrollReadinessIssue[];
}): PayrollReadiness {
  const blockers = input.issues.filter((issue) => issue.severity === "BLOCKING");
  const warnings = input.issues.filter((issue) => issue.severity === "REVIEW");
  const info = input.issues.filter((issue) => issue.severity === "INFO");
  const counts = Object.fromEntries(
    READINESS_CODES.map((code) => [code, input.issues.filter((issue) => issue.code === code).length]),
  ) as Record<PayrollReadinessCode, number>;
  const employees = input.memberships.map((membership) => {
    const employeeIssues = input.issues.filter((issue) => issue.membershipId === membership.id);
    const status = employeeIssues.some((issue) => issue.severity === "BLOCKING")
      ? "BLOCKED" as const
      : employeeIssues.some((issue) => issue.severity === "REVIEW")
        ? "REVIEW_REQUIRED" as const
        : "READY" as const;
    return {
      membershipId: membership.id,
      employeeCode: membership.employeeCode,
      employeeName: membership.fullName,
      status,
      issues: employeeIssues,
    };
  });
  const readyCount = employees.filter((employee) => employee.status === "READY").length;
  const reviewRequiredCount = employees.filter(
    (employee) => employee.status === "REVIEW_REQUIRED",
  ).length;
  const blockedCount = employees.filter((employee) => employee.status === "BLOCKED").length;
  const status: PayrollReadinessStatus = blockers.length
    ? "BLOCKED"
    : warnings.length
      ? "REVIEW_REQUIRED"
      : "READY";
  return {
    businessId: input.businessId,
    month: input.month,
    runId: input.runId,
    employeeCount: employees.length,
    status,
    readyCount,
    reviewRequiredCount,
    blockedCount,
    needsAttentionCount: reviewRequiredCount + blockedCount,
    issues: input.issues,
    blockers,
    warnings,
    info,
    counts,
    employees,
    canProceed: blockers.length === 0,
  };
}

export function createPayrollReadinessIssue(input: {
  code: PayrollReadinessCode;
  severity: PayrollReadinessSeverity;
  membershipId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  message: string;
}): PayrollReadinessIssue {
  const guidance = readinessIssueGuidance(input.code);
  return {
    ...input,
    employeeId: input.membershipId,
    source: guidance.source,
    resolutionHint: guidance.resolutionHint,
  };
}

export function assertPayrollReadinessCanProceed(readiness: PayrollReadiness) {
  if (readiness.canProceed) return;
  const reasons = readiness.blockers.slice(0, 5).map((issue) =>
    `${issue.employeeName ? `${issue.employeeName}: ` : ""}${issue.message}`,
  );
  throw new Error(`Cannot continue payroll: ${reasons.join(" ")}`);
}

const READINESS_CODES: PayrollReadinessCode[] = [
  "MISSING_COMPENSATION",
  "RECONCILIATION_FAILED",
  "PRORATION_NOT_SUPPORTED",
  "MISSING_LOCKED_TIMESHEET",
  "STALE_ATTENDANCE_SOURCE",
  "TIMESHEET_REVISION_INVALID",
  "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED",
  "ATTENDANCE_PAY_POLICY_NOT_READY",
  "LEGACY_ATTENDANCE_INPUT",
  "OVERTIME_APPROVAL_SOURCE_NOT_READY",
  "APPROVED_VARIABLE_PAY_MISSING",
  "APPROVED_CORRECTION_MISSING",
  "EMPTY_PAYROLL_RUN",
  "MISSING_BANK_ACCOUNT",
  "BANK_ACCOUNT_UNVERIFIED",
  "STATUTORY_PROFILE_INCOMPLETE",
  "MISSING_EPF_PROFILE",
  "MISSING_SOCSO_PROFILE",
  "MISSING_EIS_PROFILE",
  "PCB_PROFILE_INCOMPLETE",
  "PCB_YTD_LEDGER_INCOMPLETE",
  "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED",
  "CP38_INSTRUCTION_NOT_READY",
  "STATUTORY_RULE_NOT_AVAILABLE",
  "STATUTORY_CLASSIFICATION_REQUIRED",
  "STATUTORY_CALCULATION_FAILED",
  "STALE_STATUTORY_PROFILE",
  "STALE_STATUTORY_SOURCE",
  "LINDUNG24_PROFILE_INCOMPLETE",
  "LINDUNG24_PARTICIPATION_REQUIRED",
  "LINDUNG24_SELECTED_EMPLOYER_REQUIRED",
  "LINDUNG24_APPLICABILITY_INCOMPLETE",
  "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED",
  "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE",
  "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED",
  "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED",
  "STALE_LINDUNG24_PARTICIPATION",
  "PENDING_VARIABLE_PAY",
  "FUTURE_COMPENSATION_CHANGE",
  "APPROVED_INPUT_READY",
  "CLAIM_STATUTORY_TREATMENT_NOT_READY",
  "STATUTORY_WORK_PAY_NOT_READY",
  "STATUTORY_WORK_PAY_REVIEW_REQUIRED",
  "STALE_STATUTORY_WORK_PAY_SOURCE",
  "STATUTORY_WORK_PAY_RECONCILIATION_FAILED",
];

function readinessIssueGuidance(code: PayrollReadinessCode): {
  source: string;
  resolutionHint: string;
} {
  switch (code) {
    case "MISSING_COMPENSATION":
    case "PRORATION_NOT_SUPPORTED":
    case "FUTURE_COMPENSATION_CHANGE":
      return {
        source: "Compensation",
        resolutionHint:
          code === "MISSING_COMPENSATION"
            ? "Add and verify an effective compensation version for this payroll month."
            : code === "PRORATION_NOT_SUPPORTED"
              ? "Approve a supported proration policy or correct the effective employment dates."
              : "Review the future compensation version; no action is required for this run.",
      };
    case "MISSING_LOCKED_TIMESHEET":
    case "STALE_ATTENDANCE_SOURCE":
    case "TIMESHEET_REVISION_INVALID":
    case "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED":
    case "ATTENDANCE_PAY_POLICY_NOT_READY":
    case "LEGACY_ATTENDANCE_INPUT":
    case "OVERTIME_APPROVAL_SOURCE_NOT_READY":
      return {
        source: "Attendance Timesheet",
        resolutionHint:
          code === "MISSING_LOCKED_TIMESHEET"
            ? "Resolve Attendance issues and lock the monthly Timesheet before generating payroll."
            : code === "LEGACY_ATTENDANCE_INPUT"
              ? "Review the legacy locked Timesheet evidence; regenerate only if a current P2 revision is required."
              : "Return the run to Draft and refresh it from the current locked Timesheet revision.",
      };
    case "RECONCILIATION_FAILED":
    case "APPROVED_VARIABLE_PAY_MISSING":
    case "APPROVED_CORRECTION_MISSING":
      return {
        source: "Payroll Components",
        resolutionHint: "Return the run to Draft and refresh canonical component lines, then review the employee totals.",
      };
    case "EMPTY_PAYROLL_RUN":
      return {
        source: "Payroll Run",
        resolutionHint: "Regenerate the Draft after confirming at least one eligible employee is in scope.",
      };
    case "PENDING_VARIABLE_PAY":
      return {
        source: "Variable Pay",
        resolutionHint: "Approve or remove the Draft variable-pay item before final review if it belongs in this month.",
      };
    case "APPROVED_INPUT_READY":
      return {
        source: "Approved Payroll Input",
        resolutionHint: "Generate or refresh the payroll Draft to materialise this approved input.",
      };
    case "MISSING_BANK_ACCOUNT":
    case "BANK_ACCOUNT_UNVERIFIED":
      return {
        source: "Payment Readiness",
        resolutionHint: "Add or verify the employee bank account before creating a payment batch; payroll finalization is not blocked.",
      };
    case "STATUTORY_WORK_PAY_NOT_READY":
    case "STATUTORY_WORK_PAY_REVIEW_REQUIRED":
    case "STALE_STATUTORY_WORK_PAY_SOURCE":
    case "STATUTORY_WORK_PAY_RECONCILIATION_FAILED":
      return {
        source: "Sabah Work Pay",
        resolutionHint: "Resolve the P6C work-pay evidence or rule coverage, then refresh the Draft calculation.",
      };
    case "CLAIM_STATUTORY_TREATMENT_NOT_READY":
      return {
        source: "Claims",
        resolutionHint: "Set the claim category as a business reimbursement to include this claim. Only this reimbursement is on hold; salary payroll may continue.",
      };
    case "STALE_STATUTORY_SOURCE":
      return {
        source: "Statutory Readiness",
        resolutionHint: "Refresh this Draft to apply the currently active payroll rule.",
      };
    case "STATUTORY_RULE_NOT_AVAILABLE":
      return {
        source: "Statutory Readiness",
        resolutionHint: "An approved and active payroll rule is still required for this scheme.",
      };
    case "PCB_PROFILE_INCOMPLETE":
      return {
        source: "PCB setup",
        resolutionHint: "Complete and confirm this employee's PCB tax details, then refresh the Draft.",
      };
    case "PCB_YTD_LEDGER_INCOMPLETE":
      return {
        source: "PCB tax-year totals",
        resolutionHint: "Review the employee's previous-employer and year-to-date PCB totals, then refresh the Draft.",
      };
    case "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED":
      return {
        source: "PCB additional pay",
        resolutionHint: "PCB could not reconcile total EPF with the normal-pay EPF allocation. Review this employee's EPF setup, then refresh the payroll draft.",
      };
    case "CP38_INSTRUCTION_NOT_READY":
      return {
        source: "CP38 instruction",
        resolutionHint: "Review the employee's active CP38 instruction and effective period, then refresh the payroll Draft.",
      };
    case "LINDUNG24_PROFILE_INCOMPLETE":
    case "LINDUNG24_PARTICIPATION_REQUIRED":
    case "LINDUNG24_SELECTED_EMPLOYER_REQUIRED":
    case "LINDUNG24_APPLICABILITY_INCOMPLETE":
    case "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED":
    case "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE":
    case "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED":
    case "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED":
    case "STALE_LINDUNG24_PARTICIPATION":
      return {
        source: "Statutory Readiness",
        resolutionHint:
          code === "LINDUNG24_SELECTED_EMPLOYER_REQUIRED" ||
          code === "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED"
            ? "Select the employee's LINDUNG 24 employer, then refresh this Draft."
            : code === "LINDUNG24_APPLICABILITY_INCOMPLETE"
              ? "Record statutory nationality and Act 4 coverage before deciding whether LINDUNG 24 applies."
            : code === "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED"
              ? "Record the local employee's participation or official opt-out evidence, then refresh this Draft."
            : code === "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE"
              ? "Complete the mandatory foreign-worker eligibility and LINDUNG 24 evidence, then refresh this Draft."
            : code === "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED"
              ? "July 2026 spans the official policy transition. Complete the statutory transition review before payroll."
            : code === "STALE_LINDUNG24_PARTICIPATION"
              ? "Refresh this Draft to apply the latest LINDUNG 24 participation details."
              : "Complete the employee's LINDUNG 24 participation details, then refresh this Draft.",
      };
    default:
      return {
        source: "Statutory Readiness",
        resolutionHint:
          code === "STATUTORY_PROFILE_INCOMPLETE"
            ? "Complete the employee statutory profile before submission; manual verified PCB remains allowed where configured."
            : "Resolve the statutory profile, classification or verified rule-source issue, then refresh the Draft.",
      };
  }
}

function readinessCodeForStatutoryBlocker(
  blockerCode: string | null,
): PayrollReadinessCode {
  if (blockerCode === "PCB_PROFILE_INCOMPLETE") return "PCB_PROFILE_INCOMPLETE";
  if (blockerCode === "PCB_YTD_LEDGER_INCOMPLETE") {
    return "PCB_YTD_LEDGER_INCOMPLETE";
  }
  if (blockerCode === "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED") {
    return "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED";
  }
  if (blockerCode === "LINDUNG24_PROFILE_INCOMPLETE") {
    return "LINDUNG24_PROFILE_INCOMPLETE";
  }
  if (blockerCode === "LINDUNG24_APPLICABILITY_INCOMPLETE") {
    return "LINDUNG24_APPLICABILITY_INCOMPLETE";
  }
  if (blockerCode === "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED") {
    return "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED";
  }
  if (blockerCode === "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE") {
    return "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE";
  }
  if (blockerCode === "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED") {
    return "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED";
  }
  if (blockerCode === "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED") {
    return "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED";
  }
  if (
    blockerCode === "LINDUNG24_PARTICIPATION_REQUIRED" ||
    blockerCode === "LEGACY_LINDUNG24_PARTICIPATION_REVIEW_REQUIRED"
  ) {
    return "LINDUNG24_PARTICIPATION_REQUIRED";
  }
  if (blockerCode === "LINDUNG24_SELECTED_EMPLOYER_REQUIRED") {
    return "LINDUNG24_SELECTED_EMPLOYER_REQUIRED";
  }
  if (blockerCode === "STATUTORY_CLASSIFICATION_REQUIRED") {
    return "STATUTORY_CLASSIFICATION_REQUIRED";
  }
  if (
    blockerCode === "STATUTORY_RULE_NOT_AVAILABLE" ||
    blockerCode?.endsWith("_RULE_NOT_READY")
  ) {
    return "STATUTORY_RULE_NOT_AVAILABLE";
  }
  return "STATUTORY_CALCULATION_FAILED";
}

export function isStatutorySnapshotSourceCurrent(
  snapshot: {
    ruleSetId: string | null;
    ruleVersionSnapshot: string | null;
    artifactDigestSnapshot: string | null;
    datasetDigestSnapshot: string | null;
    fixtureDigestSnapshot: string | null;
    classificationVersionSnapshot: string | null;
    parserVersionSnapshot: string | null;
    calculatorVersionSnapshot: string | null;
  },
  activeRule:
    | {
        id: string;
        version: string;
        sourceDigest: string | null;
        datasetDigest: string | null;
        goldenFixtureDigest: string | null;
        classificationVersion: string | null;
        parserVersion: string | null;
        calculatorVersion: string | null;
      }
    | undefined,
) {
  return Boolean(
    activeRule &&
      snapshot.ruleSetId === activeRule.id &&
      snapshot.ruleVersionSnapshot === activeRule.version &&
      snapshot.artifactDigestSnapshot === activeRule.sourceDigest &&
      snapshot.datasetDigestSnapshot === activeRule.datasetDigest &&
      snapshot.fixtureDigestSnapshot === activeRule.goldenFixtureDigest &&
      snapshot.classificationVersionSnapshot === activeRule.classificationVersion &&
      snapshot.parserVersionSnapshot === activeRule.parserVersion &&
      snapshot.calculatorVersionSnapshot === activeRule.calculatorVersion,
  );
}

function firstBy<T, K extends keyof T>(items: T[], key: K) {
  const map = new Map<T[K], T>();
  for (const item of items) if (!map.has(item[key])) map.set(item[key], item);
  return map;
}

function groupBy<T, K extends keyof T>(items: T[], key: K) {
  const map = new Map<T[K], T[]>();
  for (const item of items) map.set(item[key], [...(map.get(item[key]) ?? []), item]);
  return map;
}

function jsonStringArray(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
