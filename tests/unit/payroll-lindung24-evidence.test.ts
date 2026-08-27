import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalDigest, goldenFixtureDigest } from "../../src/lib/payroll/statutory-artifact-pipeline";

test("retained LINDUNG24 official artifacts match manifest byte counts and SHA-256", () => {
  const manifest = readJson<{
    runtimeNetworkDependency: boolean;
    artifacts: Array<{
      id: string;
      scheme: string;
      byteSize: number | null;
      sha256: string | null;
      retainedPath?: string;
    }>;
  }>("statutory/official/manifest.json");
  const artifacts = manifest.artifacts.filter(
    (artifact) => artifact.scheme === "LINDUNG24" && artifact.retainedPath,
  );
  assert.equal(manifest.runtimeNetworkDependency, false);
  assert.equal(artifacts.length, 5);
  for (const artifact of artifacts) {
    const bytes = readFileSync(artifact.retainedPath!);
    assert.equal(bytes.byteLength, artifact.byteSize, artifact.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, artifact.id);
  }
});

test("participation source register, classification and golden certification are digest-bound", () => {
  const register = readJson<Record<string, unknown> & { reviewDigest: string }>(
    "statutory/official/reviews/perkeso-lindung24-participation-source-register-v1.json",
  );
  assert.equal(register.reviewDigest, digestWithout(register, "reviewDigest"));

  const classification = readJson<{
    approvalStatus: string;
    status: string;
    activation: { allowed: boolean; productionActivationPerformed: boolean };
    classifications: unknown[];
    classificationDigest: string;
    candidateDigest: string;
  }>("statutory/official/classifications/malaysia-lindung24-2026-signoff-candidate-v1.json");
  assert.equal(classification.status, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(classification.approvalStatus, "NOT_SIGNED_OFF");
  assert.equal(classification.activation.allowed, false);
  assert.equal(classification.activation.productionActivationPerformed, false);
  assert.equal(classification.classificationDigest, canonicalDigest(classification.classifications));
  assert.equal(classification.candidateDigest, digestWithout(classification, "candidateDigest"));

  const fixtures = readJson<{
    verificationStatus: string;
    fixtureDigest: string;
    fixtures: unknown[];
  }>("statutory/official/fixtures/perkeso-lindung24-2026-06-boundaries-review-v1.json");
  assert.equal(fixtures.verificationStatus, "VERIFIED");
  assert.equal(goldenFixtureDigest(fixtures as never), fixtures.fixtureDigest);

  const certification = readJson<Record<string, unknown> & {
    certificationDigest: string;
    reviewStatus: string;
    fixtureCount: number;
  }>("statutory/official/certifications/perkeso-lindung24-2026-06-golden-certification-v1.json");
  assert.equal(certification.reviewStatus, "VERIFIED");
  assert.equal(certification.fixtureCount, 6);
  assert.equal(certification.certificationDigest, digestWithout(certification, "certificationDigest"));
});

test("current-policy alignment manifest is official-source bound and cannot activate production", () => {
  const alignment = readJson<{
    authority: string;
    ruleVersion: string;
    engineeringStatus: string;
    legalHumanSignOffStatus: string;
    productionActivationStatus: string;
    effectiveDateConfidence: string;
    effectiveDateInterpretation: {
      schemeCommenced: string;
      currentPolicyStatedEffective: string;
      transitionOptOutOpened: string;
      transitionOptOutClosed: string;
      currentPolicyFirstUnambiguousMonthlyPeriod: string;
      interpretation: string;
      historicalRewriteAllowed: boolean;
    };
    sourceConflict: { status: string; engineeringTreatment: string };
    sources: Array<{ id: string; sha256: string; effectiveFrom: string }>;
    contribution: {
      phase1: { rate: string; effectiveFrom: string; effectiveTo: string };
      borneBy: string;
      employerContribution: string;
      basis: string;
      wageCeiling: string;
    };
    activation: {
      testingRulePackActivationPerformed: boolean;
      productionRulePackActivationPerformed: boolean;
      productionAllowed: boolean;
    };
  }>("statutory/official/lindung24/current-policy-alignment-manifest-v1.json");

  assert.equal(alignment.authority, "PERKESO");
  assert.equal(alignment.ruleVersion, "PERKESO_LINDUNG24_CURRENT_POLICY_ALIGNMENT_2026_08_V1");
  assert.equal(alignment.engineeringStatus, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(alignment.legalHumanSignOffStatus, "REQUIRED");
  assert.equal(alignment.productionActivationStatus, "NOT_ACTIVE");
  assert.equal(alignment.effectiveDateConfidence, "REVIEW_REQUIRED");
  assert.deepEqual(alignment.effectiveDateInterpretation, {
    schemeCommenced: "2026-06-01",
    currentPolicyStatedEffective: "2026-07-08",
    transitionOptOutOpened: "2026-07-13",
    transitionOptOutClosed: "2026-08-31T15:59:59.999Z",
    currentPolicyFirstUnambiguousMonthlyPeriod: "2026-08-01",
    interpretation: alignment.effectiveDateInterpretation.interpretation,
    historicalRewriteAllowed: false,
  });
  assert.equal(alignment.sourceConflict.status, "HUMAN_LEGAL_SIGN_OFF_REQUIRED");
  assert.match(alignment.sourceConflict.engineeringTreatment, /LOCAL_TRANSITION_REVIEW/);
  assert.equal(alignment.contribution.phase1.rate, "0.75%");
  assert.equal(alignment.contribution.phase1.effectiveFrom, "2026-06-01");
  assert.equal(alignment.contribution.phase1.effectiveTo, "2028-05-31");
  assert.equal(alignment.contribution.borneBy, "EMPLOYEE");
  assert.equal(alignment.contribution.employerContribution, "0");
  assert.equal(alignment.contribution.basis, "OFFICIAL_FIXED_CONTRIBUTION_TABLE");
  assert.equal(alignment.contribution.wageCeiling, "MYR 6000.00");
  assert.equal(alignment.activation.testingRulePackActivationPerformed, false);
  assert.equal(alignment.activation.productionRulePackActivationPerformed, false);
  assert.equal(alignment.activation.productionAllowed, false);

  const hashes = new Map(alignment.sources.map((source) => [source.id, source.sha256]));
  assert.equal(
    hashes.get("perkeso-lindung24-faq-2026-06-v2.1"),
    "a7b212187d5a66934e9dc5f0369d1bf45ff97d81adeac1031600358957b87fab",
  );
  assert.equal(
    hashes.get("perkeso-lindung24-schedule-2026-06"),
    "e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1",
  );
  assert.equal(
    hashes.get("perkeso-lindung24-opt-out-notice-v2.1"),
    "95a1ae1549eeca7ee24a9d61fb154f420fad52fdd2d5ffe88766bd3a404d303e",
  );
});

test("LINDUNG24 migration is additive and protects version, tenant and refund history", () => {
  const sql = readFileSync(
    "prisma/migrations/20260809130000_lindung24_participation_closure/migration.sql",
    "utf8",
  );
  assert.match(sql, /CREATE TABLE "employee_lindung24_participation_versions"/);
  assert.match(sql, /LINDUNG24_PARTICIPATION_PERIOD_OVERLAP/);
  assert.match(sql, /LINDUNG24_PARTICIPATION_VERSION_IMMUTABLE/);
  assert.match(sql, /employee_lindung24_participation_versions_membership_fkey/);
  assert.match(sql, /LINDUNG24_REFUND_EVENT_IMMUTABLE/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE/);
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function digestWithout<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const copy = { ...value };
  delete copy[key];
  return canonicalDigest(copy);
}
