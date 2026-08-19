import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PayrollAttendanceInput } from "./attendance-integration";
import { calculateSabahStatutoryWorkPay, type WorkPayCoverageClass } from "./sabah-work-pay-calculation";
import {
  SABAH_WORK_PAY_CALCULATOR_TEST_DIGEST,
  SABAH_WORK_PAY_CANDIDATE_RULE,
  SABAH_WORK_PAY_DATASET_DIGEST,
  SABAH_WORK_PAY_DATASET_ROW_COUNT,
  SABAH_WORK_PAY_EFFECTIVE_FROM,
  SABAH_WORK_PAY_JURISDICTION,
  SABAH_WORK_PAY_OFFICIAL_SOURCES,
  SABAH_WORK_PAY_RULE_VERSION,
  SABAH_WORK_PAY_SOURCE_DIGEST,
} from "./sabah-work-pay-rule-pack";

type Database = PrismaClient;
type Transaction = Prisma.TransactionClient;

export const STATUTORY_MONEY_RULE_NOT_READY = "STATUTORY_MONEY_RULE_NOT_READY";
export const STATUTORY_WORK_PAY_SNAPSHOT_CONFLICT = "STATUTORY_WORK_PAY_SNAPSHOT_CONFLICT";

export async function registerSabahWorkPayCandidate(
  input: { actorUserId: string; reason: string },
  database: Database = prisma,
) {
  if (input.reason.trim().length < 10) throw new Error("STATUTORY_RULE_REGISTRATION_REASON_REQUIRED");
  const existing = await database.statutoryRuleSet.findUnique({
    where: { scheme_version: { scheme: "WORK_PAY", version: SABAH_WORK_PAY_RULE_VERSION } },
  });
  if (existing) {
    if (existing.sourceDigest !== SABAH_WORK_PAY_SOURCE_DIGEST) {
      throw new Error("SABAH_WORK_PAY_CANDIDATE_DIGEST_CONFLICT");
    }
    return { ruleSetId: existing.id, status: "EXISTING" as const };
  }
  const rule = await database.statutoryRuleSet.create({
    data: {
      scheme: "WORK_PAY",
      version: SABAH_WORK_PAY_RULE_VERSION,
      jurisdictionCode: SABAH_WORK_PAY_JURISDICTION,
      effectiveFrom: new Date(`${SABAH_WORK_PAY_EFFECTIVE_FROM}T00:00:00.000Z`),
      authority: "Sabah State Attorney-General's Chambers / Jabatan Tenaga Kerja Sabah",
      sourceReference: SABAH_WORK_PAY_OFFICIAL_SOURCES[0].url,
      sourceDocumentName: "Sabah statutory work-pay candidate source pack",
      sourceDigest: SABAH_WORK_PAY_SOURCE_DIGEST,
      datasetDigest: SABAH_WORK_PAY_DATASET_DIGEST,
      calculatorTestDigest: SABAH_WORK_PAY_CALCULATOR_TEST_DIGEST,
      datasetRowCount: SABAH_WORK_PAY_DATASET_ROW_COUNT,
      calculatorVersion: "P6C-1",
      readiness: "CALCULATION_VERIFIED",
      status: "READY_FOR_HUMAN_SIGN_OFF",
      humanReviewStatus: "PENDING",
      ruleData: SABAH_WORK_PAY_CANDIDATE_RULE as unknown as Prisma.InputJsonObject,
      verificationEvidence: {
        sources: SABAH_WORK_PAY_OFFICIAL_SOURCES,
        engineeringStatus: "READY",
        humanSignOff: "NOT_EXECUTED",
        activation: "NOT_ACTIVE",
        registrationReason: input.reason.trim(),
      } as unknown as Prisma.InputJsonObject,
      calculationVerifiedAt: new Date(),
      calculationVerifiedById: input.actorUserId,
      createdById: input.actorUserId,
    },
  });
  await database.statutoryRuleLifecycleAudit.createMany({
    data: ["RULESET_REGISTERED", "CALCULATION_VERIFIED", "READY_FOR_REVIEW"].map((action) => ({
      ruleSetId: rule.id,
      scheme: "WORK_PAY" as const,
      ruleVersion: rule.version,
      action: action as "RULESET_REGISTERED" | "CALCULATION_VERIFIED" | "READY_FOR_REVIEW",
      actorId: input.actorUserId,
      reason: input.reason.trim(),
      previousStatus: action === "RULESET_REGISTERED" ? "DRAFT" : rule.status,
      nextStatus: rule.status,
      evidenceDigest: SABAH_WORK_PAY_SOURCE_DIGEST,
    })),
  });
  return { ruleSetId: rule.id, status: "REGISTERED" as const };
}

export async function resolveActiveSabahWorkPayRule(
  period: Date,
  database: Database = prisma,
) {
  const rules = await database.statutoryRuleSet.findMany({
    where: {
      scheme: "WORK_PAY",
      jurisdictionCode: SABAH_WORK_PAY_JURISDICTION,
      status: "ACTIVE",
      effectiveFrom: { lte: period },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: period } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  if (rules.length !== 1) throw new Error(STATUTORY_MONEY_RULE_NOT_READY);
  const rule = rules[0];
  if (!rule.sourceDigest || !rule.sourceReference) throw new Error(STATUTORY_MONEY_RULE_NOT_READY);
  return rule;
}

export async function materializeSabahWorkPay(input: {
  businessId: string;
  payrollRunId: string;
  payrollEntryId: string;
  membershipId: string;
  compensationVersionId: string;
  attendanceInputSnapshotId: string;
  payBasis: "MONTHLY" | "DAILY" | "HOURLY";
  baseRateCents: number;
  normalWorkMinutes: number;
  period: Date;
  jurisdictionCode: string | null;
  actorUserId: string;
  attendance: PayrollAttendanceInput;
  coverageClass?: WorkPayCoverageClass | null;
}, database: Database = prisma) {
  const rule = await resolveActiveSabahWorkPayRule(input.period, database);
  return database.$transaction(
    (tx) => materializeSabahWorkPayInTransaction(tx, { ...input, rule }),
    { isolationLevel: "Serializable" },
  );
}

export async function materializeSabahWorkPayInTransaction(
  tx: Transaction,
  input: {
    businessId: string;
    payrollRunId: string;
    payrollEntryId: string;
    membershipId: string;
    compensationVersionId: string;
    attendanceInputSnapshotId: string;
    payBasis: "MONTHLY" | "DAILY" | "HOURLY";
    baseRateCents: number;
    normalWorkMinutes: number;
    period: Date;
    jurisdictionCode: string | null;
    actorUserId: string;
    attendance: PayrollAttendanceInput;
    coverageClass?: WorkPayCoverageClass | null;
    rule: Awaited<ReturnType<typeof resolveActiveSabahWorkPayRule>>;
  },
) {
  const { rule } = input;
  const calculation = calculateSabahStatutoryWorkPay({
    payBasis: input.payBasis,
    baseRateCents: input.baseRateCents,
    normalWorkMinutes: input.normalWorkMinutes,
    jurisdictionCode: input.jurisdictionCode,
    ruleStatus: "ACTIVE",
    ruleVersion: rule.version,
    sourceDigest: rule.sourceDigest!,
    coverageClass: input.coverageClass,
    attendance: input.attendance,
  });
  const run = await tx.payrollRun.findFirstOrThrow({
      where: { id: input.payrollRunId, businessId: input.businessId },
      select: { status: true },
    });
    if (run.status === "FINALIZED") throw new Error("FINALIZED_PAYROLL_IS_IMMUTABLE");
  const existing = await tx.payrollWorkPayCalculationSnapshot.findUnique({
      where: { payrollEntryId: input.payrollEntryId },
    });
    if (existing) {
    if (
        existing.inputDigest === calculation.inputDigest &&
        existing.calculationDigest === calculation.calculationDigest
    ) return { snapshotId: existing.id, calculation, status: "UNCHANGED" as const };
    throw new Error(STATUTORY_WORK_PAY_SNAPSHOT_CONFLICT);
  }
  const snapshot = await tx.payrollWorkPayCalculationSnapshot.create({
      data: {
        businessId: input.businessId,
        payrollRunId: input.payrollRunId,
        payrollEntryId: input.payrollEntryId,
        membershipId: input.membershipId,
        compensationVersionId: input.compensationVersionId,
        attendanceInputSnapshotId: input.attendanceInputSnapshotId,
        ruleSetId: rule.id,
        jurisdictionCode: input.jurisdictionCode ?? "UNRESOLVED",
        ruleVersion: rule.version,
        ruleStatusSnapshot: rule.status,
        sourceReference: rule.sourceReference,
        sourceDigest: rule.sourceDigest!,
        payBasis: input.payBasis,
        baseRate: money(input.baseRateCents),
        ordinaryDailyRate: calculation.ordinaryDailyRate,
        hourlyRate: calculation.hourlyRate,
        coverageStatus: calculation.coverageStatus,
        coverageReason: calculation.coverageReason,
        normalWorkMinutes: input.normalWorkMinutes,
        inputDigest: calculation.inputDigest,
        calculationDigest: calculation.calculationDigest,
        inputFacts: JSON.parse(JSON.stringify(input.attendance)) as Prisma.InputJsonValue,
        blockerCodes: calculation.blockerCodes,
      },
    });
  for (const [index, line] of calculation.lines.entries()) {
      const component = await tx.payrollEntryComponent.create({
        data: {
          businessId: input.businessId,
          payrollRunId: input.payrollRunId,
          payrollEntryId: input.payrollEntryId,
          membershipId: input.membershipId,
          lineKey: line.lineKey,
          type: "EARNING",
          code: line.classification,
          name: componentName(line.classification),
          amount: money(line.amountCents),
          currency: "MYR",
          sourceType: "STATUTORY",
          sourceId: snapshot.id,
          sourceVersionId: rule.id,
          sourceRevision: null,
          effectiveFromMonth: input.period,
          calculationBasis: `${SABAH_WORK_PAY_JURISDICTION}:${line.ruleSection}:${line.multiplier}`,
          origin: "SYSTEM",
          reason: null,
          sourceReason: null,
          sortOrder: 500 + index,
          createdById: input.actorUserId,
        },
      });
      await tx.payrollWorkPayCalculationLine.create({
        data: {
          businessId: input.businessId,
          payrollRunId: input.payrollRunId,
          payrollEntryId: input.payrollEntryId,
          membershipId: input.membershipId,
          snapshotId: snapshot.id,
          payrollComponentId: component.id,
          localDate: new Date(`${line.localDate}T00:00:00.000Z`),
          classification: line.classification,
          minutes: line.minutes,
          multiplier: line.multiplier,
          rate: line.rate,
          amount: money(line.amountCents),
          ruleSection: line.ruleSection,
          sourceDigest: rule.sourceDigest!,
          lineDigest: line.lineDigest,
          trace: line.trace as Prisma.InputJsonObject,
        },
      });
    }
  return { snapshotId: snapshot.id, calculation, status: "CREATED" as const };
}

function money(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error("STATUTORY_WORK_PAY_INVALID_MONEY");
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function componentName(classification: string) {
  return ({
    NORMAL_OT: "Normal Overtime Pay",
    REST_DAY_WORK: "Rest Day Work Pay",
    REST_DAY_OT: "Rest Day Overtime Pay",
    PUBLIC_HOLIDAY_WORK: "Public Holiday Work Pay",
    PUBLIC_HOLIDAY_OT: "Public Holiday Overtime Pay",
  } as Record<string, string>)[classification] ?? classification;
}
