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
