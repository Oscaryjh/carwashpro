import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LINDUNG24_BLOCKERS,
  lindung24ParticipationDigest,
  resolveLindung24Eligibility,
  resolveLindung24ParticipationForPeriod,
  resolveLindung24PolicyEra,
  validateLindung24ParticipationChange,
  type Lindung24ParticipationEvidence,
} from "../../src/lib/payroll/lindung24-participation";
import { calculateLindung24 } from "../../src/lib/payroll/statutory-p2c";
import type { NormalizedContributionDataset } from "../../src/lib/payroll/statutory-artifact-pipeline";
import { recordEmployeeLindung24Participation } from "../../src/lib/payroll/lindung24-participation-service";
import type { PrismaClient } from "@prisma/client";

const dataset = JSON.parse(
  readFileSync("statutory/official/datasets/perkeso-act4-lindung24-2026-06.json", "utf8"),
) as NormalizedContributionDataset;

test("LINDUNG24 eligibility uses Act 4 and employment facts without age or identifier guesses", () => {
  assert.deepEqual(
    resolveLindung24Eligibility({ act4Covered: true, isEmployee: true, statutoryNationality: "MALAYSIAN" }),
    { status: "ELIGIBLE", employeeCategory: "LOCAL" },
  );
  assert.deepEqual(
    resolveLindung24Eligibility({ act4Covered: true, isEmployee: true, statutoryNationality: "NON_MALAYSIAN" }),
    { status: "ELIGIBLE", employeeCategory: "FOREIGN" },
  );
  assert.deepEqual(
    resolveLindung24Eligibility({ act4Covered: false, isEmployee: true, statutoryNationality: "MALAYSIAN" }),
    { status: "NOT_ELIGIBLE", reason: "NOT_COVERED_BY_EMPLOYEES_SOCIAL_SECURITY_ACT_1969" },
  );
  assert.deepEqual(
    resolveLindung24Eligibility({ act4Covered: null, isEmployee: true, statutoryNationality: null }),
    { status: "INSUFFICIENT_PROFILE", missing: ["act4Covered", "statutoryNationality"] },
  );
});

test("policy chronology keeps June, July transition and August current policy distinct", () => {
  assert.equal(resolveLindung24PolicyEra(new Date("2026-05-01T00:00:00.000Z")), "NOT_STARTED");
  assert.equal(resolveLindung24PolicyEra(new Date("2026-06-01T00:00:00.000Z")), "INITIAL_MANDATORY");
  assert.equal(resolveLindung24PolicyEra(new Date("2026-07-01T00:00:00.000Z")), "LOCAL_TRANSITION_REVIEW");
  assert.equal(
    resolveLindung24PolicyEra(new Date("2026-08-01T00:00:00.000Z")),
    "CURRENT_LOCAL_VOLUNTARY_FOREIGN_MANDATORY",
  );

  const june = resolve("2026-06-01", "MALAYSIAN", record({ status: "MANDATORY", effectiveFromMonth: "2026-06-01" }));
  assert.equal(june.status, "CONTRIBUTION_REQUIRED");

  const julyLocal = resolve("2026-07-01", "MALAYSIAN", record({ status: "DEFAULT_PARTICIPATING" }));
  assert.deepEqual(
    { status: julyLocal.status, blocker: julyLocal.status === "BLOCKED" ? julyLocal.blockerCode : null },
    { status: "BLOCKED", blocker: LINDUNG24_BLOCKERS.POLICY_TRANSITION_REVIEW_REQUIRED },
  );

  const local = resolve("2026-08-01", "MALAYSIAN", record({ status: "DEFAULT_PARTICIPATING", effectiveFromMonth: "2026-08-01" }));
  assert.equal(local.status, "CONTRIBUTION_REQUIRED");

  const optedOut = resolve("2026-08-01", "MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    status: "VOLUNTARY_OPT_OUT",
    sourceType: "EMPLOYEE_OPT_OUT",
    officialSubmittedAt: new Date("2026-07-13T01:30:00.000Z"),
  }));
  assert.deepEqual(
    { status: optedOut.status, reason: optedOut.status === "NO_CONTRIBUTION" ? optedOut.reason : null },
    { status: "NO_CONTRIBUTION", reason: "OFFICIAL_LOCAL_EMPLOYEE_OPT_OUT" },
  );

  const foreignInvalid = resolve("2026-08-01", "NON_MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    status: "VOLUNTARY_OPT_OUT",
    sourceType: "EMPLOYEE_OPT_OUT",
    officialSubmittedAt: new Date("2026-07-13T01:30:00.000Z"),
  }));
  assert.deepEqual(
    { status: foreignInvalid.status, blocker: foreignInvalid.status === "BLOCKED" ? foreignInvalid.blockerCode : null },
    { status: "BLOCKED", blocker: LINDUNG24_BLOCKERS.PARTICIPATION_INVALID },
  );
});

test("current policy distinguishes applicability, local decision and foreign mandatory profile", () => {
  const applicability = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality: "MALAYSIAN",
    records: [],
  });
  assert.equal(
    applicability.status === "BLOCKED" ? applicability.blockerCode : null,
    LINDUNG24_BLOCKERS.APPLICABILITY_INCOMPLETE,
  );

  const localDecision = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality: "MALAYSIAN",
    act4Covered: true,
    records: [],
  });
  assert.equal(
    localDecision.status === "BLOCKED" ? localDecision.blockerCode : null,
    LINDUNG24_BLOCKERS.LOCAL_PARTICIPATION_DECISION_REQUIRED,
  );

  const foreignProfile = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality: "NON_MALAYSIAN",
    act4Covered: true,
    records: [],
  });
  assert.equal(
    foreignProfile.status === "BLOCKED" ? foreignProfile.blockerCode : null,
    LINDUNG24_BLOCKERS.FOREIGN_MANDATORY_PROFILE_INCOMPLETE,
  );

  const notCovered = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality: "NON_MALAYSIAN",
    act4Covered: false,
    records: [],
  });
  assert.equal(notCovered.status, "NOT_APPLICABLE");
});

test("multiple employment never guesses the current tenant", () => {
  const pending = resolve("2026-08-01", "MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    employerContext: "MULTIPLE_EMPLOYER",
    selectedEmployer: "PERKESO_SELECTION_PENDING",
  }));
  assert.equal(pending.status, "BLOCKED");
  assert.equal(pending.status === "BLOCKED" ? pending.blockerCode : null, LINDUNG24_BLOCKERS.SELECTED_EMPLOYER_REQUIRED);

  const other = resolve("2026-08-01", "MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    employerContext: "MULTIPLE_EMPLOYER",
    selectedEmployer: "OTHER_EMPLOYER",
  }));
  assert.equal(other.status, "NO_CONTRIBUTION");

  const current = resolve("2026-08-01", "MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    employerContext: "MULTIPLE_EMPLOYER",
    selectedEmployer: "CURRENT_BUSINESS",
  }));
  assert.equal(current.status, "CONTRIBUTION_REQUIRED");
});

test("legacy evidence, overlap and once-in-always-in fail closed", () => {
  const legacy = resolve("2026-08-01", "MALAYSIAN", record({
    effectiveFromMonth: "2026-08-01",
    sourceType: "LEGACY_REVIEW",
  }));
  assert.equal(legacy.status, "BLOCKED");
  assert.equal(
    legacy.status === "BLOCKED" ? legacy.blockerCode : null,
    LINDUNG24_BLOCKERS.LOCAL_PARTICIPATION_DECISION_REQUIRED,
  );

  const overlapping = resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date("2026-07-01T00:00:00.000Z"),
    statutoryNationality: "MALAYSIAN",
    records: [record({}), record({ id: "00000000-0000-4000-8000-000000000099", revision: 2 })],
  });
  assert.equal(overlapping.status, "BLOCKED");
  assert.equal(overlapping.status === "BLOCKED" ? overlapping.blockerCode : null, LINDUNG24_BLOCKERS.PARTICIPATION_OVERLAP);

  assert.throws(
    () => validateLindung24ParticipationChange({
      previous: record({ status: "VOLUNTARY_OPT_IN" }),
      next: withoutIdentity(record({
        effectiveFromMonth: "2026-09-01",
        status: "VOLUNTARY_OPT_OUT",
        sourceType: "EMPLOYEE_OPT_OUT",
        officialSubmittedAt: new Date("2026-09-01T00:00:00.000Z"),
      })),
      hasPriorCalculatedContribution: true,
      employeeCategory: "LOCAL",
    }),
    /LINDUNG24_ONCE_IN_ALWAYS_IN/,
  );
});

test("verified Phase 1 schedule produces employee-only contribution across official boundaries", () => {
  for (const [wageCents, employeeCents, row] of [
    [3_000, 20, "ACT4-01"],
    [50_000, 335, "ACT4-09"],
    [60_000, 415, "ACT4-10"],
    [600_000, 4_465, "ACT4-64"],
    [600_001, 4_465, "ACT4-65"],
  ] as const) {
    const calculation = calculateLindung24({ dataset, wageCents });
    assert.equal(calculation.employeeCents, employeeCents);
    assert.equal(calculation.employerCents, 0);
    assert.equal(calculation.matchedRowKey, row);
  }
  const monthlySalary = calculateLindung24({ dataset, wageCents: 300_000 });
  assert.equal(monthlySalary.employeeCents, 2_215);
  assert.equal(monthlySalary.employerCents, 0);
});

test("current local mandatory and foreign voluntary opt-out states are rejected", () => {
  assert.throws(
    () => validateLindung24ParticipationChange({
      previous: null,
      next: withoutIdentity(record({
        effectiveFromMonth: "2026-08-01",
        status: "MANDATORY",
      })),
      hasPriorCalculatedContribution: false,
      employeeCategory: "LOCAL",
    }),
    /LINDUNG24_PARTICIPATION_INVALID/,
  );
  assert.throws(
    () => validateLindung24ParticipationChange({
      previous: null,
      next: withoutIdentity(record({
        effectiveFromMonth: "2026-08-01",
        status: "VOLUNTARY_OPT_OUT",
        sourceType: "EMPLOYEE_OPT_OUT",
        officialSubmittedAt: new Date("2026-08-01T00:00:00.000Z"),
      })),
      hasPriorCalculatedContribution: false,
      employeeCategory: "FOREIGN",
    }),
    /LINDUNG24_PARTICIPATION_INVALID/,
  );
});

test("participation digest changes with revision and selected employer", () => {
  const base = record({});
  const input = {
    act4Covered: base.act4Covered,
    businessId: base.businessId,
    effectiveFromMonth: base.effectiveFromMonth,
    effectiveToMonth: base.effectiveToMonth,
    employerContext: base.employerContext,
    evidenceNature: base.evidenceNature,
    evidenceEnvironment: base.evidenceEnvironment,
    fixturePurpose: base.fixturePurpose,
    officialExportEligible: base.officialExportEligible,
    statutoryNationalitySnapshot: base.statutoryNationalitySnapshot,
    membershipId: base.membershipId,
    officialSubmittedAt: base.officialSubmittedAt,
    reason: "Official evidence reviewed",
    revision: base.revision,
    selectedEmployer: base.selectedEmployer,
    sourceReference: base.sourceReference,
    sourceType: base.sourceType,
    status: base.status,
  };
  assert.notEqual(
    lindung24ParticipationDigest(input),
    lindung24ParticipationDigest({ ...input, revision: 2 }),
  );
  assert.notEqual(
    lindung24ParticipationDigest(input),
    lindung24ParticipationDigest({ ...input, employerContext: "MULTIPLE_EMPLOYER", selectedEmployer: "OTHER_EMPLOYER" }),
  );
});

test("participation write requires statutory capability and whole-business scope", async () => {
  const command = {
    act4Covered: true,
    effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
    employerContext: "SINGLE_EMPLOYER" as const,
    expectedRevision: 0,
    membershipId: MEMBERSHIP_ID,
    officialSubmittedAt: null,
    reason: "Official evidence reviewed",
    selectedEmployer: "CURRENT_BUSINESS" as const,
    sourceReference: "PERKESO FAQ v2.1",
    sourceType: "OFFICIAL_TRANSITION" as const,
    status: "DEFAULT_PARTICIPATING" as const,
  };
  await assert.rejects(
    recordEmployeeLindung24Participation(
      {
        command,
        context: {
          access: {
            granted: false,
            userId: "00000000-0000-4000-8000-000000000004",
            requestedBusinessId: BUSINESS_ID,
            reason: "CAPABILITY_DENIED",
            fallback: { kind: "NO_ACCESS" },
          },
          actor: { userId: "00000000-0000-4000-8000-000000000004", name: "Denied", email: "denied@test.local" },
          allowedBranchIds: [],
          businessId: BUSINESS_ID,
          caller: "API",
        },
      },
      {} as PrismaClient,
    ),
    /LINDUNG24_STATUTORY_PERMISSION_REQUIRED/,
  );

  const branchOnlyDatabase = { branch: { count: async () => 2 } } as unknown as PrismaClient;
  await assert.rejects(
    recordEmployeeLindung24Participation(
      {
        command,
        context: {
          access: {
            granted: true,
            userId: "00000000-0000-4000-8000-000000000004",
            homeBusinessId: BUSINESS_ID,
            businessId: BUSINESS_ID,
            branchId: "00000000-0000-4000-8000-000000000005",
            identityRole: "STAFF",
            actorRole: "STAFF",
            effectiveBusinessRole: "STAFF",
            permissions: ["VIEW_STATUTORY_PROFILE", "EDIT_STATUTORY_PROFILE", "PAYROLL_READ"],
            industryType: "GENERAL_SERVICE",
            source: "DIRECT_BUSINESS",
            groupId: null,
            groupUserId: null,
            capability: null,
          },
          actor: { userId: "00000000-0000-4000-8000-000000000004", name: "Branch", email: "branch@test.local" },
          allowedBranchIds: ["00000000-0000-4000-8000-000000000005"],
          businessId: BUSINESS_ID,
          caller: "API",
        },
      },
      branchOnlyDatabase,
    ),
    /LINDUNG24_WHOLE_BUSINESS_SCOPE_REQUIRED/,
  );
});

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000002";

function resolve(period: string, nationality: "MALAYSIAN" | "NON_MALAYSIAN", value: Lindung24ParticipationEvidence) {
  return resolveLindung24ParticipationForPeriod({
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    statutoryPeriod: new Date(`${period}T00:00:00.000Z`),
    statutoryNationality: nationality,
    records: [value],
  });
}

function record(overrides: Partial<Omit<Lindung24ParticipationEvidence, "effectiveFromMonth">> & { effectiveFromMonth?: string } = {}): Lindung24ParticipationEvidence {
  const { effectiveFromMonth, ...rest } = overrides;
  return {
    id: "00000000-0000-4000-8000-000000000003",
    businessId: BUSINESS_ID,
    membershipId: MEMBERSHIP_ID,
    revision: 1,
    effectiveFromMonth: new Date(`${effectiveFromMonth ?? "2026-07-01"}T00:00:00.000Z`),
    effectiveToMonth: null,
    status: "DEFAULT_PARTICIPATING",
    employerContext: "SINGLE_EMPLOYER",
    selectedEmployer: "CURRENT_BUSINESS",
    act4Covered: true,
    officialSubmittedAt: null,
    sourceType: "OFFICIAL_TRANSITION",
    sourceReference: "PERKESO FAQ v2.1",
    sourceDigest: "a".repeat(64),
    evidenceNature: "REAL",
    evidenceEnvironment: null,
    fixturePurpose: null,
    officialExportEligible: true,
    statutoryNationalitySnapshot: "MALAYSIAN",
    ...rest,
  };
}

function withoutIdentity(value: Lindung24ParticipationEvidence) {
  const { id, revision, sourceDigest, ...result } = value;
  void id;
  void revision;
  void sourceDigest;
  return result;
}
