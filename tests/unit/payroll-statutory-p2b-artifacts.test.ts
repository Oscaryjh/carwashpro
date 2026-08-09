import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATUTORY_ARTIFACT_ERRORS,
  assertRuleActivationReady,
  contributionDatasetDigest,
  goldenFixtureDigest,
  lookupContributionRow,
  selectExactActiveRule,
  sha256,
  validateContributionDataset,
  verifyArtifactBytes,
  type GoldenFixtureSet,
  type NormalizedContributionDataset,
  type OfficialArtifactManifest,
  type OfficialArtifactManifestEntry,
  type RuleActivationEvidence,
} from "../../src/lib/payroll/statutory-artifact-pipeline";

const manifest = readJson<OfficialArtifactManifest>("statutory/official/manifest.json");
const act4 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act4-lindung24-2026-06.json",
);
const act800 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act800-2024-10.review.json",
);

test("official manifest is machine-readable, retains verified bytes and has separate LINDUNG24 state", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.runtimeNetworkDependency, false);
  assert.equal(
    manifest.binaryRetentionPolicy,
    "RETAIN_VERIFIED_OFFICIAL_BYTES_AND_NORMALIZED_DATASETS",
  );
  assert.equal(new Set(manifest.artifacts.map((artifact) => artifact.id)).size, manifest.artifacts.length);
  assert.ok(manifest.artifacts.some((artifact) => artifact.scheme === "LINDUNG24"));
  assert.ok(manifest.artifacts.some((artifact) => artifact.scheme === "PCB" && artifact.role === "TESTING_MATERIAL"));
  for (const artifact of manifest.artifacts.filter((item) => item.verificationStatus === "VERIFIED")) {
    assert.match(artifact.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok((artifact.byteSize ?? 0) > 0);
  }
});

test("artifact checksum verification accepts exact bytes and rejects mutation or a wrong manifest", () => {
  const bytes = new TextEncoder().encode("official fixture bytes");
  const artifact = syntheticArtifact(bytes);
  assert.equal(verifyArtifactBytes(artifact, bytes, "application/pdf").ok, true);
  assert.equal(
    verifyArtifactBytes(artifact, new TextEncoder().encode("modified fixture bytes"), "application/pdf").code,
    STATUTORY_ARTIFACT_ERRORS.CHECKSUM_MISMATCH,
  );
  assert.equal(
    verifyArtifactBytes({ ...artifact, sha256: "0".repeat(64) }, bytes, "application/pdf").code,
    STATUTORY_ARTIFACT_ERRORS.CHECKSUM_MISMATCH,
  );
});

test("normalized contribution datasets are deterministic and preserve all 65 official ranges", () => {
  assert.deepEqual(validateContributionDataset(act4), {
    rowCount: 65,
    datasetDigest: act4.datasetDigest,
  });
  assert.deepEqual(validateContributionDataset(act800), {
    rowCount: 65,
    datasetDigest: act800.datasetDigest,
  });
  assert.equal(contributionDatasetDigest(act4), act4.datasetDigest);
  assert.equal(contributionDatasetDigest(JSON.parse(JSON.stringify(act4))), act4.datasetDigest);
  assert.equal(lookupContributionRow(act4, 3_000)?.key, "ACT4-01");
  assert.equal(lookupContributionRow(act4, 3_001)?.key, "ACT4-02");
  assert.equal(lookupContributionRow(act4, 600_001)?.key, "ACT4-65");
});

test("range validation rejects overlap, gap, duplicate and malformed contribution", () => {
  const overlap = structuredClone(act4);
  overlap.rows[1].lowerInclusiveCents = overlap.rows[0].upperInclusiveCents!;
  overlap.datasetDigest = contributionDatasetDigest(overlap);
  assert.throws(() => validateContributionDataset(overlap), /STATUTORY_DATASET_RANGE_OVERLAP/);

  const gap = structuredClone(act4);
  gap.rows[1].lowerInclusiveCents += 1;
  gap.datasetDigest = contributionDatasetDigest(gap);
  assert.throws(() => validateContributionDataset(gap), /STATUTORY_DATASET_RANGE_GAP/);

  const duplicate = structuredClone(act4);
  duplicate.rows[1].key = duplicate.rows[0].key;
  duplicate.datasetDigest = contributionDatasetDigest(duplicate);
  assert.throws(() => validateContributionDataset(duplicate), /STATUTORY_DATASET_DUPLICATE_ROW/);

  const malformed = structuredClone(act4);
  malformed.rows[0].contributions.socsoEmployeeFirstCents = -1;
  malformed.datasetDigest = contributionDatasetDigest(malformed);
  assert.throws(() => validateContributionDataset(malformed), /STATUTORY_DATASET_MALFORMED_AMOUNT/);
});

test("review-required artifacts, datasets or fixtures cannot activate", () => {
  assert.throws(
    () => assertRuleActivationReady({
      ...syntheticActivationEvidence(),
      datasetStatus: act4.verificationStatus,
      fixtureStatus: "REVIEW_REQUIRED",
      artifactSha256: act4.artifactSha256,
      datasetDigest: act4.datasetDigest,
      fixtureDigest: "f".repeat(64),
    }),
    /UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE/,
  );
  assert.doesNotThrow(() => assertRuleActivationReady(syntheticActivationEvidence()));
});

test("rule selection is exact, verified, period-specific and never falls back", () => {
  const rules = [
    { scheme: "SOCSO" as const, effectiveFrom: new Date("2026-06-01"), effectiveTo: new Date("2027-01-01"), status: "ACTIVE" as const, verificationStatus: "VERIFIED" as const, id: "current" },
    { scheme: "SOCSO" as const, effectiveFrom: new Date("2027-01-01"), effectiveTo: null, status: "ACTIVE" as const, verificationStatus: "VERIFIED" as const, id: "future" },
  ];
  assert.equal(selectExactActiveRule(rules, "SOCSO", new Date("2026-08-01")).id, "current");
  assert.equal(selectExactActiveRule(rules, "SOCSO", new Date("2027-02-01")).id, "future");
  assert.throws(
    () => selectExactActiveRule(rules, "SOCSO", new Date("2025-01-01")),
    /STATUTORY_RULE_NOT_AVAILABLE/,
  );
});

test("fixture digests are stable and independently certified sets are verified", () => {
  const fixtureFiles = [
    "statutory/official/fixtures/perkeso-act4-2026-06-boundaries-review-v1.json",
    "statutory/official/fixtures/perkeso-act800-2024-10-boundaries-review-v1.json",
    "statutory/official/fixtures/perkeso-lindung24-2026-06-boundaries-review-v1.json",
  ];
  fixtureFiles.forEach((path) => {
    const fixtureSet = readJson<GoldenFixtureSet>(path);
    assert.equal(fixtureSet.verificationStatus, "VERIFIED");
    assert.equal(goldenFixtureDigest(fixtureSet), fixtureSet.fixtureDigest);
    assert.ok(fixtureSet.fixtures.every((fixture) => fixture.sourceReference.startsWith("official")));
  });
});

test("P2B migration is additive and enforces activation and active provenance immutability", () => {
  const sql = readFileSync(
    "prisma/migrations/20260809040000_statutory_p2b_artifact_verification_pipeline/migration.sql",
    "utf8",
  );
  assert.match(sql, /UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE/);
  assert.match(sql, /STATUTORY_ACTIVE_ARTIFACT_IMMUTABLE/);
  assert.match(sql, /dataset_digest/);
  assert.match(sql, /golden_fixture_digest/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i);
});

test("PCB requirements inventory is partial and retains explicit production blockers", () => {
  const requirements = readJson<{ status: string; requirements: Array<{ status: string }> }>(
    "statutory/official/pcb-2026-requirements.json",
  );
  assert.equal(requirements.status, "PARTIAL");
  assert.ok(requirements.requirements.some((item) => item.status === "BLOCKED"));
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}

function syntheticActivationEvidence(): RuleActivationEvidence {
  return {
    scheme: "SOCSO",
    ruleVersion: "TEST_VERIFIED_RULE",
    effectiveFrom: "2099-01-01",
    effectiveTo: null,
    artifactStatus: "VERIFIED",
    datasetStatus: "VERIFIED",
    independentReviewStatus: "PASS",
    fixtureStatus: "VERIFIED",
    classificationStatus: "VERIFIED",
    classificationApprovalStatus: "HUMAN_SIGNED_OFF",
    classificationApprovalRecordDigest: "9".repeat(64),
    classificationApprovedByActorId: "00000000-0000-4000-8000-000000000001",
    classificationApprovedAt: "2098-12-01T00:00:00.000Z",
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256: "a".repeat(64),
    datasetDigest: "b".repeat(64),
    independentReviewDigest: "c".repeat(64),
    fixtureDigest: "d".repeat(64),
    classificationVersion: "TEST_CLASSIFICATION_V1",
    classificationDigest: "e".repeat(64),
    parserName: "test-parser",
    parserVersion: "1.0.0",
    calculatorVersion: "1.0.0",
    calculatorTestDigest: "f".repeat(64),
    datasetRowCount: 1,
    goldenFixtureCount: 1,
    unresolvedBlockers: [],
  };
}

function syntheticArtifact(bytes: Uint8Array): OfficialArtifactManifestEntry {
  return {
    id: "synthetic",
    scheme: "SOCSO",
    role: "RULE_TABLE",
    authority: "PERKESO",
    title: "Synthetic test only",
    version: "TEST",
    effectiveFrom: "2099-01-01",
    effectiveTo: null,
    landingPageUrl: "https://example.invalid",
    sourceUrl: "https://example.invalid/test.pdf",
    artifactType: "PDF",
    retrievedOn: "2099-01-01",
    mimeType: "application/pdf",
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    parserName: "test",
    parserVersion: "1.0.0",
    parsingStatus: "PARSED",
    verificationStatus: "VERIFIED",
    notes: "Synthetic bytes for unit tests only.",
  };
}
