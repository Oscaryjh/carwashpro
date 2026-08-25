import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATUTORY_ARTIFACT_ERRORS,
  assertRuleActivationReady,
  buildActivationPreview,
  canonicalDigest,
  goldenFixtureDigest,
  prepareControlledActivation,
  validateContributionDataset,
  validateGoldenCertification,
  validateIndependentReview,
  type GoldenFixtureCertificationRecord,
  type GoldenFixtureSet,
  type IndependentDatasetReviewRecord,
  type NormalizedContributionDataset,
  type RuleActivationEvidence,
} from "../../src/lib/payroll/statutory-artifact-pipeline";
import {
  STATUTORY_P2C_CALCULATOR_VERSION,
  assessDraftStatutoryRefresh,
  calculateEis,
  calculateEpf,
  calculateLindung24,
  calculateSocso,
  type EpfContributionCategory,
} from "../../src/lib/payroll/statutory-p2c";

const epf = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/kwsp-third-schedule-2025-10.json",
);
const epfFixtures = readJson<GoldenFixtureSet>(
  "statutory/official/fixtures/kwsp-third-schedule-2025-10-golden-v1.json",
);
const epfReview = readJson<IndependentDatasetReviewRecord>(
  "statutory/official/reviews/kwsp-third-schedule-2025-10-independent-review.json",
);
const epfCertification = readJson<GoldenFixtureCertificationRecord>(
  "statutory/official/certifications/kwsp-third-schedule-2025-10-golden-certification.json",
);

const act4 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act4-lindung24-2026-06.json",
);
const act800 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act800-2024-10.review.json",
);
const socsoFixtures = readJson<GoldenFixtureSet>(
  "statutory/official/fixtures/perkeso-act4-2026-06-boundaries-review-v1.json",
);
const eisFixtures = readJson<GoldenFixtureSet>(
  "statutory/official/fixtures/perkeso-act800-2024-10-boundaries-review-v1.json",
);
const socsoReview = readJson<IndependentDatasetReviewRecord>(
  "statutory/official/reviews/perkeso-act4-2026-06-independent-review.json",
);
const eisReview = readJson<IndependentDatasetReviewRecord>(
  "statutory/official/reviews/perkeso-act800-2024-10-independent-review.json",
);
const lindung24AmountReview = readJson<IndependentDatasetReviewRecord>(
  "statutory/official/reviews/perkeso-lindung24-2026-06-amount-review.json",
);
const socsoCertification = readJson<GoldenFixtureCertificationRecord>(
  "statutory/official/certifications/perkeso-act4-2026-06-golden-certification.json",
);
const eisCertification = readJson<GoldenFixtureCertificationRecord>(
  "statutory/official/certifications/perkeso-act800-2024-10-golden-certification.json",
);

test("SOCSO and EIS retain a digest-bound independent second-path review", () => {
  assert.deepEqual(validateIndependentReview(socsoReview), {
    reviewDigest: socsoReview.reviewDigest,
    rowsChecked: 65,
  });
  assert.deepEqual(validateIndependentReview(eisReview), {
    reviewDigest: eisReview.reviewDigest,
    rowsChecked: 65,
  });
  assert.deepEqual(validateIndependentReview(lindung24AmountReview), {
    reviewDigest: lindung24AmountReview.reviewDigest,
    rowsChecked: 65,
  });
  assert.equal(socsoReview.certifiedDatasetDigest, act4.datasetDigest);
  assert.equal(eisReview.certifiedDatasetDigest, act800.datasetDigest);
  assert.equal(lindung24AmountReview.certifiedDatasetDigest, act4.datasetDigest);

  const mutation = structuredClone(eisReview);
  mutation.rowsChecked.count = 64;
  assert.throws(
    () => validateIndependentReview(mutation),
    new RegExp(STATUTORY_ARTIFACT_ERRORS.REVIEW_DIGEST_MISMATCH),
  );
});

test("official schedule-row golden sets are independently certified", () => {
  assert.deepEqual(validateGoldenCertification(epfCertification, epfFixtures), {
    certificationDigest: epfCertification.certificationDigest,
    fixtureCount: 21,
  });
  assert.deepEqual(validateGoldenCertification(socsoCertification, socsoFixtures), {
    certificationDigest: socsoCertification.certificationDigest,
    fixtureCount: 20,
  });
  assert.deepEqual(validateGoldenCertification(eisCertification, eisFixtures), {
    certificationDigest: eisCertification.certificationDigest,
    fixtureCount: 11,
  });
  assert.equal(goldenFixtureDigest(socsoFixtures), socsoFixtures.fixtureDigest);
  assert.equal(goldenFixtureDigest(eisFixtures), eisFixtures.fixtureDigest);
});

test("EPF retained artifact dataset, independent review and golden fixtures are digest-bound", () => {
  assert.deepEqual(validateContributionDataset(epf), {
    rowCount: 401,
    datasetDigest: epf.datasetDigest,
  });
  assert.deepEqual(validateIndependentReview(epfReview), {
    reviewDigest: epfReview.reviewDigest,
    rowsChecked: 1203,
  });
  assert.equal(epfReview.certifiedDatasetDigest, epf.datasetDigest);
  assert.equal(goldenFixtureDigest(epfFixtures), epfFixtures.fixtureDigest);
});

test("EPF calculator matches all official-backed table and formula fixtures", () => {
  const results = epfFixtures.fixtures.map((fixture) => {
    const input = fixture.input as { wageCents: number; category: EpfContributionCategory };
    const result = calculateEpf({ dataset: epf, ...input });
    assert.deepEqual(
      {
        employeeCents: result.employeeCents,
        employerCents: result.employerCents,
        matchedRowKey: result.matchedRowKey,
      },
      fixture.expected,
    );
    return result;
  });
  assert.match(canonicalDigest(results), /^[a-f0-9]{64}$/);
});

test("all 401 EPF table boundaries and every category formula select deterministically", () => {
  for (const category of ["PART_A", "PART_C", "PART_E"] as const) {
    for (const row of epf.rows) {
      assert.equal(
        calculateEpf({ dataset: epf, wageCents: row.lowerInclusiveCents, category })
          .matchedRowKey,
        row.key,
      );
      assert.equal(
        calculateEpf({ dataset: epf, wageCents: row.upperInclusiveCents!, category })
          .matchedRowKey,
        row.key,
      );
    }
  }
  assert.equal(
    calculateEpf({ dataset: epf, wageCents: 2_000_001, category: "PART_A" })
      .matchedRowKey,
    "EPF-PART_A-FORMULA",
  );
  assert.equal(
    calculateEpf({ dataset: epf, wageCents: 2_000_001, category: "PART_C" })
      .matchedRowKey,
    "EPF-PART_C-FORMULA",
  );
  assert.equal(
    calculateEpf({ dataset: epf, wageCents: 2_000_001, category: "PART_E" })
      .matchedRowKey,
    "EPF-PART_E-FORMULA",
  );
  assert.equal(
    calculateEpf({ dataset: epf, wageCents: 1, category: "PART_F" }).matchedRowKey,
    "EPF-PART_F-FORMULA",
  );
});

test("SOCSO calculator matches every certified first/second-category golden fixture", () => {
  const results = socsoFixtures.fixtures.map((fixture) => {
    const input = fixture.input as { wageCents: number; category: "FIRST" | "SECOND" };
    const result = calculateSocso({ dataset: act4, ...input });
    assert.deepEqual(
      {
        employeeCents: result.employeeCents,
        employerCents: result.employerCents,
        matchedRowKey: result.matchedRowKey,
      },
      fixture.expected,
    );
    return result;
  });
  assert.equal(
    canonicalDigest(results),
    "acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3",
  );
});

test("EIS calculator matches every certified golden fixture and equal-share rule", () => {
  const results = eisFixtures.fixtures.map((fixture) => {
    const input = fixture.input as { wageCents: number };
    const result = calculateEis({ dataset: act800, ...input });
    assert.equal(result.employeeCents, result.employerCents);
    assert.deepEqual(
      {
        employeeCents: result.employeeCents,
        employerCents: result.employerCents,
        matchedRowKey: result.matchedRowKey,
      },
      fixture.expected,
    );
    return result;
  });
  assert.equal(
    canonicalDigest(results),
    "3dbed2c04746e0863d00473f8a281cee401cda574fb19d4882fa07c689742c9b",
  );
});

test("all 65 table boundaries select deterministically, including ceiling and above ceiling", () => {
  assert.deepEqual(validateContributionDataset(act4), {
    rowCount: 65,
    datasetDigest: act4.datasetDigest,
  });
  assert.deepEqual(validateContributionDataset(act800), {
    rowCount: 65,
    datasetDigest: act800.datasetDigest,
  });
  act4.rows.forEach((row) => {
    if (row.lowerInclusiveCents > 0) {
      assert.equal(
        calculateSocso({ dataset: act4, wageCents: row.lowerInclusiveCents, category: "FIRST" })
          .matchedRowKey,
        row.key,
      );
    }
    if (row.upperInclusiveCents !== null) {
      assert.equal(
        calculateSocso({ dataset: act4, wageCents: row.upperInclusiveCents, category: "SECOND" })
          .matchedRowKey,
        row.key,
      );
    }
  });
  act800.rows.forEach((row) => {
    if (row.lowerInclusiveCents > 0) {
      assert.equal(calculateEis({ dataset: act800, wageCents: row.lowerInclusiveCents }).matchedRowKey, row.key);
    }
    if (row.upperInclusiveCents !== null) {
      assert.equal(calculateEis({ dataset: act800, wageCents: row.upperInclusiveCents }).matchedRowKey, row.key);
    }
  });
  assert.equal(calculateSocso({ dataset: act4, wageCents: 600_001, category: "FIRST" }).matchedRowKey, "ACT4-65");
  assert.equal(calculateEis({ dataset: act800, wageCents: 600_001 }).matchedRowKey, "ACT800-65");
});

test("invalid or zero wage never becomes a contribution-table fallback", () => {
  for (const wageCents of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => calculateSocso({ dataset: act4, wageCents, category: "FIRST" }),
      /STATUTORY_POSITIVE_WAGE_REQUIRED/,
    );
    assert.throws(
      () => calculateEis({ dataset: act800, wageCents }),
      /STATUTORY_POSITIVE_WAGE_REQUIRED/,
    );
  }
});

test("invalid EPF inputs and LINDUNG24 production entry point remain fail-closed", () => {
  assert.throws(
    () => calculateEpf({ dataset: epf, wageCents: 0, category: "PART_A" }),
    /STATUTORY_POSITIVE_WAGE_REQUIRED/,
  );
  assert.throws(
    () => calculateLindung24({ dataset: act4, wageCents: 0 }),
    /STATUTORY_POSITIVE_WAGE_REQUIRED/,
  );
});

test("classification or rule provenance changes only stale Draft payroll", () => {
  const identity = {
    scheme: "SOCSO" as const,
    ruleVersion: "V1",
    artifactDigest: "a".repeat(64),
    datasetDigest: "b".repeat(64),
    fixtureDigest: "c".repeat(64),
    classificationVersion: "CLASSIFICATION_V1",
    calculatorVersion: "CALCULATOR_V1",
  };
  assert.deepEqual(
    assessDraftStatutoryRefresh({ payrollStatus: "DRAFT", snapshot: identity, currentRule: identity }),
    { state: "CURRENT", blockerCode: null },
  );
  assert.deepEqual(
    assessDraftStatutoryRefresh({
      payrollStatus: "DRAFT",
      snapshot: identity,
      currentRule: { ...identity, classificationVersion: "CLASSIFICATION_V2" },
    }),
    { state: "REFRESH_REQUIRED", blockerCode: "STATUTORY_RULE_CHANGED" },
  );
  assert.deepEqual(
    assessDraftStatutoryRefresh({
      payrollStatus: "FINALIZED",
      snapshot: identity,
      currentRule: { ...identity, classificationVersion: "CLASSIFICATION_V2" },
    }),
    { state: "HISTORICAL_LOCKED", blockerCode: null },
  );
});

test("classification UNKNOWN blocks activation even after dataset, golden and calculator verification", () => {
  const evidence = verifiedEvidence({
    classificationStatus: "REVIEW_REQUIRED",
    unresolvedBlockers: ["STATUTORY_CLASSIFICATION_REQUIRED"],
  });
  assert.throws(
    () => assertRuleActivationReady(evidence),
    /UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE/,
  );
});

test("controlled activation requires explicit platform actor, reason and exact scheme/version/period", () => {
  const evidence = verifiedEvidence();
  const preview = buildActivationPreview(evidence);
  assert.deepEqual(preview.effectivePeriod, { from: "2026-06-01", to: null });
  assert.equal(preview.rowCount, 65);
  assert.ok(!("employeeId" in preview));

  assert.throws(
    () => prepareControlledActivation({
      actorId: "actor",
      actorRole: "BUSINESS_OWNER",
      reason: "Reviewed production activation",
      expectedScheme: "SOCSO",
      expectedRuleVersion: evidence.ruleVersion,
      expectedEffectiveFrom: evidence.effectiveFrom,
      evidence,
    }),
    /STATUTORY_PLATFORM_ACTOR_REQUIRED/,
  );
  const prepared = prepareControlledActivation({
    actorId: "actor",
    actorRole: "PLATFORM_ADMIN",
    actorType: "HUMAN_USER",
    actorCapabilities: ["ACTIVATE_STATUTORY_RULESET"],
    reviewerActorId: "reviewer",
    reason: "Reviewed production activation",
    expectedScheme: "SOCSO",
    expectedRuleVersion: evidence.ruleVersion,
    expectedEffectiveFrom: evidence.effectiveFrom,
    evidence,
  });
  assert.match(prepared.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => prepareControlledActivation({
      actorId: "reviewer",
      actorRole: "PLATFORM_ADMIN",
      actorType: "HUMAN_USER",
      actorCapabilities: ["ACTIVATE_STATUTORY_RULESET"],
      reviewerActorId: "reviewer",
      reason: "Same reviewer cannot activate the reviewed revision",
      expectedScheme: "SOCSO",
      expectedRuleVersion: evidence.ruleVersion,
      expectedEffectiveFrom: evidence.effectiveFrom,
      evidence,
    }),
    /STATUTORY_REVIEWER_ACTIVATOR_SEPARATION_REQUIRED/,
  );
  const highestAuthorityActivation = prepareControlledActivation({
    actorId: "reviewer",
    actorRole: "PLATFORM_ADMIN",
    actorType: "HUMAN_USER",
    actorCapabilities: ["SIGN_OFF_STATUTORY_RULESET", "ACTIVATE_STATUTORY_RULESET"],
    reviewerActorId: "reviewer",
    reason: "Highest authority approved payroll activation",
    expectedScheme: "SOCSO",
    expectedRuleVersion: evidence.ruleVersion,
    expectedEffectiveFrom: evidence.effectiveFrom,
    evidence,
  });
  assert.match(highestAuthorityActivation.evidenceDigest, /^[a-f0-9]{64}$/);
});

test("human sign-off migration is additive, immutable and capability separated", () => {
  const sql = readFileSync(
    "prisma/migrations/20260810143000_statutory_human_signoff_activation/migration.sql",
    "utf8",
  );
  assert.match(sql, /READY_FOR_HUMAN_SIGN_OFF/);
  assert.match(sql, /HUMAN_SIGNED_OFF/);
  assert.match(sql, /statutory_rule_set_sign_offs/);
  assert.match(sql, /STATUTORY_SIGN_OFF_IMMUTABLE/);
  assert.match(sql, /STATUTORY_SIGNED_ARTIFACT_IMMUTABLE/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i);
});

test("P2C migration is additive and hardens activation provenance and audit", () => {
  const sql = readFileSync(
    "prisma/migrations/20260809070000_statutory_p2c_certification_activation/migration.sql",
    "utf8",
  );
  assert.match(sql, /independent_review_digest/);
  assert.match(sql, /classification_digest/);
  assert.match(sql, /calculator_test_digest/);
  assert.match(sql, /statutory_rule_lifecycle_audits/);
  assert.match(sql, /UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE/);
  assert.match(sql, /STATUTORY_ACTIVE_ARTIFACT_IMMUTABLE/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i);
});

test("classification and LINDUNG24 design are versioned, digest-bound and still blocked", () => {
  const classification = readJson<{
    version: string;
    status: string;
    classificationDigest: string;
    classifications: Array<{ SOCSO: string; EIS: string; LINDUNG24: string }>;
  }>("statutory/official/classification-review.json");
  assert.equal(classification.status, "REVIEW_REQUIRED");
  assert.match(classification.version, /P2C_DRAFT_1/);
  assert.equal(classification.classificationDigest, digestWithout(classification, "classificationDigest"));
  assert.ok(
    classification.classifications.some(
      (item) => item.SOCSO === "UNKNOWN" || item.EIS === "UNKNOWN" || item.LINDUNG24 === "UNKNOWN",
    ),
  );

  const design = readJson<{ activationStatus: string; designDigest: string; remainingBlockers: string[] }>(
    "statutory/official/lindung24-participation-design.json",
  );
  assert.equal(design.activationStatus, "BLOCKED");
  assert.ok(design.remainingBlockers.length > 0);
  assert.equal(design.designDigest, digestWithout(design, "designDigest"));

  const readiness = readJson<{ status: string; readinessDigest: string; automaticActivation: boolean }>(
    "statutory/official/p2c-readiness.json",
  );
  assert.equal(readiness.status, "PARTIAL");
  assert.equal(readiness.automaticActivation, false);
  assert.equal(readiness.readinessDigest, digestWithout(readiness, "readinessDigest"));
});

test("SOCSO/EIS closure matrix is complete, digest-bound and honest about platform approval", () => {
  const review = readJson<{
    version: string;
    previousRevision: string;
    status: string;
    approvalLevel: string;
    platformApprovalStatus: string;
    classificationDigest: string;
    reviewer: { type: string; legalApproval: boolean; governmentCertification: boolean };
    classifications: Array<{
      componentCode: string;
      SOCSO: string;
      EIS: string;
      officialBasis: string[];
      reviewStatus: string;
    }>;
  }>("statutory/official/classifications/malaysia-socso-eis-2026-technical-review-v1.json");
  assert.match(review.version, /SOCSO_EIS_TECHNICAL_REVIEW_1/);
  assert.match(review.previousRevision, /P2C_DRAFT_1/);
  assert.equal(review.status, "READY_FOR_PLATFORM_APPROVAL");
  assert.equal(review.approvalLevel, "AI_ASSISTED_TECHNICAL_EVIDENCE_REVIEW");
  assert.equal(review.platformApprovalStatus, "REQUIRED");
  assert.equal(review.reviewer.type, "AI_ASSISTED_REVIEW");
  assert.equal(review.reviewer.legalApproval, false);
  assert.equal(review.reviewer.governmentCertification, false);
  assert.equal(review.classificationDigest, digestWithout(review, "classificationDigest"));
  assert.equal(new Set(review.classifications.map((item) => item.componentCode)).size, review.classifications.length);
  assert.ok(review.classifications.length >= 25);
  assert.ok(review.classifications.every((item) => item.officialBasis.length > 0));
  for (const code of [
    "BASIC_SALARY",
    "REGULAR_DAILY_PAY",
    "REGULAR_HOURLY_PAY",
    "PAID_LEAVE_PAY",
    "COMMISSION",
    "INCENTIVE",
    "BONUS",
    "ONE_OFF_EARNING",
    "ONE_OFF_DEDUCTION",
    "ARREARS",
    "SALARY_ARREARS",
    "RECOVERY",
    "PAYROLL_RECOVERY",
    "MANUAL_ADJUSTMENT",
    "OVERTIME_PAY",
    "REST_DAY_PAY",
    "PUBLIC_HOLIDAY_PAY",
  ]) {
    assert.ok(review.classifications.some((item) => item.componentCode === code), `missing ${code}`);
  }
  assert.equal(review.classifications.find((item) => item.componentCode === "BONUS")?.SOCSO, "UNKNOWN");
  assert.equal(review.classifications.find((item) => item.componentCode === "COMMISSION")?.EIS, "INCLUDED");
});

test("statutory payroll closure remains local, batched and database-reconciled", () => {
  const materializer = readFileSync("src/lib/payroll/statutory-p2.ts", "utf8");
  const payrollService = readFileSync("src/lib/payroll/service.ts", "utf8");
  const reconciliationMigration = readFileSync(
    "prisma/migrations/20260809100000_statutory_component_reconciliation/migration.sql",
    "utf8",
  );

  assert.doesNotMatch(materializer, /\bfetch\s*\(|https?:\/\/|readFileSync/);
  assert.match(payrollService, /const statutoryRules = await transaction\.statutoryRuleSet\.findMany/);
  assert.match(payrollService, /preloadedRules: statutoryRules/);
  assert.match(reconciliationMigration, /"source_type" <> 'STATUTORY'/);
  assert.doesNotMatch(
    reconciliationMigration,
    /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i,
  );
});

test("sign-off candidate is a new immutable digest-bound revision with transport fail-closed", () => {
  const technicalReview = readJson<{
    version: string;
    classifications: Array<{ componentCode: string; SOCSO: string; EIS: string }>;
  }>("statutory/official/classifications/malaysia-socso-eis-2026-technical-review-v1.json");
  const candidate = readJson<{
    version: string;
    priorTechnicalReviewRevision: string;
    status: string;
    technicalReviewStatus: string;
    approvalStatus: string;
    immutableRevision: boolean;
    classificationDigest: string;
    candidateDigest: string;
    unresolvedComponentCount: number;
    unresolvedComponents: string[];
    humanDecisionComponents: string[];
    activation: { allowed: boolean; blocker: string; productionActivationPerformed: boolean };
    classifications: Array<{
      componentCode: string;
      SOCSO: string;
      EIS: string;
      officialBasis: string[];
      humanDecisionRequired: boolean;
      technicalRecommendation: string;
    }>;
  }>("statutory/official/classifications/malaysia-socso-eis-2026-signoff-candidate-v1.json");

  assert.notEqual(candidate.version, technicalReview.version);
  assert.equal(candidate.priorTechnicalReviewRevision, technicalReview.version);
  assert.equal(candidate.status, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(candidate.technicalReviewStatus, "TECHNICAL_REVIEW_COMPLETE");
  assert.equal(candidate.approvalStatus, "NOT_SIGNED_OFF");
  assert.equal(candidate.immutableRevision, true);
  assert.equal(candidate.classificationDigest, canonicalDigest(candidate.classifications));
  assert.equal(candidate.candidateDigest, digestWithout(candidate, "candidateDigest"));
  assert.equal(candidate.unresolvedComponentCount, candidate.unresolvedComponents.length);
  assert.equal(candidate.unresolvedComponentCount, 10);
  assert.deepEqual(
    candidate.classifications
      .filter((item) => item.SOCSO === "UNKNOWN" || item.EIS === "UNKNOWN")
      .map((item) => item.componentCode)
      .sort(),
    [...candidate.unresolvedComponents].sort(),
  );
  assert.ok(candidate.classifications.every((item) => item.officialBasis.length > 0));
  assert.ok(
    candidate.classifications
      .filter((item) => item.SOCSO === "UNKNOWN" || item.EIS === "UNKNOWN")
      .every((item) => item.humanDecisionRequired),
  );
  assert.equal(candidate.activation.allowed, false);
  assert.equal(candidate.activation.blocker, "HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED");
  assert.equal(candidate.activation.productionActivationPerformed, false);

  const priorTransport = technicalReview.classifications.find(
    (item) => item.componentCode === "TRANSPORT_ALLOWANCE",
  );
  const candidateTransport = candidate.classifications.find(
    (item) => item.componentCode === "TRANSPORT_ALLOWANCE",
  );
  assert.equal(priorTransport?.SOCSO, "EXCLUDED");
  assert.equal(candidateTransport?.SOCSO, "UNKNOWN");
  assert.equal(candidateTransport?.EIS, "UNKNOWN");
  assert.equal(
    candidateTransport?.technicalRecommendation,
    "SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION",
  );
  for (const code of ["BASIC_SALARY", "COMMISSION", "INCENTIVE", "PAID_LEAVE_PAY"]) {
    const item = candidate.classifications.find((entry) => entry.componentCode === code);
    assert.equal(item?.SOCSO, "INCLUDED", `${code} SOCSO`);
    assert.equal(item?.EIS, "INCLUDED", `${code} EIS`);
    assert.equal(item?.humanDecisionRequired, false, `${code} human decision`);
  }
  assert.ok(candidate.humanDecisionComponents.includes("ATTENDANCE_ALLOWANCE"));
});

test("technical review or sign-off candidate cannot activate without human sign-off evidence", () => {
  for (const classificationStatus of ["VERIFIED", "READY_FOR_HUMAN_SIGN_OFF"] as const) {
    const evidence = verifiedEvidence({
      classificationStatus,
      classificationApprovalStatus: "READY_FOR_HUMAN_SIGN_OFF",
      classificationApprovalRecordDigest: null,
      classificationApprovedByActorId: null,
      classificationApprovedAt: null,
    });
    assert.throws(
      () => assertRuleActivationReady(evidence),
      new RegExp(STATUTORY_ARTIFACT_ERRORS.HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED),
    );
  }
});

function verifiedEvidence(
  override: Partial<RuleActivationEvidence> = {},
): RuleActivationEvidence {
  return {
    scheme: "SOCSO",
    ruleVersion: "PERKESO_ACT4_SKBBK_2026_06",
    effectiveFrom: "2026-06-01",
    effectiveTo: null,
    artifactStatus: "VERIFIED",
    datasetStatus: "VERIFIED",
    independentReviewStatus: "PASS",
    fixtureStatus: "VERIFIED",
    classificationStatus: "VERIFIED",
    classificationApprovalStatus: "HUMAN_SIGNED_OFF",
    classificationApprovalRecordDigest: "9".repeat(64),
    classificationApprovedByActorId: "00000000-0000-4000-8000-000000000001",
    classificationApprovedAt: "2026-05-01T00:00:00.000Z",
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256: act4.artifactSha256,
    datasetDigest: act4.datasetDigest,
    independentReviewDigest: socsoReview.reviewDigest,
    fixtureDigest: socsoFixtures.fixtureDigest,
    classificationVersion: "TEST_ONLY_VERIFIED_CLASSIFICATION",
    classificationDigest: "a".repeat(64),
    parserName: act4.parserName,
    parserVersion: act4.parserVersion,
    calculatorVersion: STATUTORY_P2C_CALCULATOR_VERSION,
    calculatorTestDigest: "acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3",
    datasetRowCount: act4.rows.length,
    goldenFixtureCount: socsoFixtures.fixtures.length,
    unresolvedBlockers: [],
    ...override,
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function digestWithout(value: object, field: string) {
  return canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)));
}
