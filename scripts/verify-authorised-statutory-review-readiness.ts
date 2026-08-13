import { prisma } from "../src/lib/prisma";
import { statutoryRuleEvidenceDigest } from "../src/lib/payroll/statutory-activation-service";
import {
  evaluateStatutoryEvidencePack,
  loadStatutoryEvidencePackInputs,
} from "../src/lib/payroll/statutory-evidence-pack";
import { statutoryStepUpReadiness } from "../src/lib/payroll/statutory-governance-service";

const SCHEMES = ["EPF", "SOCSO", "EIS", "LINDUNG24"] as const;

async function main() {
  assertLocalDatabase();
  const packs = await loadStatutoryEvidencePackInputs(process.cwd());
  const rows = [];

  for (const scheme of SCHEMES) {
    const pack = packs.find((candidate) => candidate.registry.scheme === scheme);
    if (!pack) throw new Error(`STATUTORY_REVIEW_PACK_MISSING:${scheme}`);
    const evidence = evaluateStatutoryEvidencePack(pack);
    const primary = pack.artifacts.find(
      ({ manifest }) => manifest.id === pack.registry.primaryArtifactId,
    )?.manifest;
    if (!primary) throw new Error(`STATUTORY_PRIMARY_ARTIFACT_MISSING:${scheme}`);

    const rule = await prisma.statutoryRuleSet.findUniqueOrThrow({
      where: {
        scheme_version: {
          scheme,
          version: pack.classification.version,
        },
      },
      include: {
        classifications: true,
        reviewDecisions: true,
        signOffs: true,
      },
    });

    const storedEvidencePackDigest = jsonString(rule.ruleData, "evidencePackDigest");
    const storedArtifacts = jsonArray(rule.ruleData, "officialArtifacts");
    const expectedArtifacts = pack.artifacts.map(({ manifest }) => ({
      id: manifest.id,
      sha256: manifest.sha256,
      retainedPath: manifest.retainedPath ?? null,
    }));
    const actualArtifacts = storedArtifacts.map((artifact) => ({
      id: jsonString(artifact, "id"),
      sha256: jsonString(artifact, "sha256"),
      retainedPath: jsonNullableString(artifact, "retainedPath"),
    }));
    const unknownComponents = rule.classifications
      .filter((classification) => classification.treatment === "UNKNOWN")
      .map((classification) => classification.componentCode)
      .sort();

    assertEqual(evidence.evidencePack, "COMPLETE", `${scheme}:EVIDENCE_PACK`);
    assertEqual(evidence.engineering, "READY", `${scheme}:ENGINEERING`);
    assertEqual(rule.status, "READY_FOR_HUMAN_SIGN_OFF", `${scheme}:RULE_STATUS`);
    assertEqual(rule.readiness, "CALCULATION_VERIFIED", `${scheme}:READINESS`);
    assertEqual(rule.humanReviewStatus, "PENDING", `${scheme}:HUMAN_REVIEW_STATUS`);
    assertEqual(rule.humanReviewRevision, 0, `${scheme}:HUMAN_REVIEW_REVISION`);
    assertEqual(rule.reviewDecisions.length, 0, `${scheme}:REVIEW_DECISIONS`);
    assertEqual(rule.signOffs.length, 0, `${scheme}:SIGN_OFFS`);
    assertEqual(rule.activatedAt, null, `${scheme}:ACTIVATED_AT`);
    assertEqual(rule.activatedById, null, `${scheme}:ACTIVATED_BY`);
    assertEqual(rule.sourceDigest, primary.sha256, `${scheme}:SOURCE_DIGEST`);
    assertEqual(rule.datasetDigest, pack.dataset.datasetDigest, `${scheme}:DATASET_DIGEST`);
    assertEqual(rule.goldenFixtureDigest, pack.fixtures.fixtureDigest, `${scheme}:FIXTURE_DIGEST`);
    assertEqual(
      rule.independentReviewDigest,
      pack.review.reviewDigest,
      `${scheme}:INDEPENDENT_REVIEW_DIGEST`,
    );
    assertEqual(
      rule.classificationVersion,
      pack.classification.version,
      `${scheme}:CLASSIFICATION_VERSION`,
    );
    assertEqual(
      rule.classificationDigest,
      pack.classification.classificationDigest,
      `${scheme}:CLASSIFICATION_DIGEST`,
    );
    assertEqual(rule.parserName, pack.dataset.parserName, `${scheme}:PARSER_NAME`);
    assertEqual(rule.parserVersion, pack.dataset.parserVersion, `${scheme}:PARSER_VERSION`);
    assertEqual(
      rule.calculatorVersion,
      pack.registry.calculatorVersion,
      `${scheme}:CALCULATOR_VERSION`,
    );
    assertEqual(
      rule.calculatorTestDigest,
      pack.registry.calculatorTestDigest,
      `${scheme}:CALCULATOR_TEST_DIGEST`,
    );
    assertEqual(rule.datasetRowCount, pack.dataset.rows.length, `${scheme}:DATASET_ROW_COUNT`);
    assertEqual(storedEvidencePackDigest, evidence.evidenceDigest, `${scheme}:EVIDENCE_DIGEST`);
    assertJsonEqual(actualArtifacts, expectedArtifacts, `${scheme}:OFFICIAL_ARTIFACTS`);
    assertJsonEqual(
      unknownComponents,
      [...evidence.unknownComponents].sort(),
      `${scheme}:UNKNOWN_COMPONENTS`,
    );

    const canonicalEvidenceDigest = statutoryRuleEvidenceDigest(rule);
    if (!/^[a-f0-9]{64}$/.test(canonicalEvidenceDigest)) {
      throw new Error(`STATUTORY_CANONICAL_EVIDENCE_DIGEST_INVALID:${scheme}`);
    }
    const activeCount = await prisma.statutoryRuleSet.count({
      where: { scheme, status: "ACTIVE" },
    });
    assertEqual(activeCount, 0, `${scheme}:ACTIVE_RULE_COUNT`);
    assertEqual(statutoryStepUpReadiness(rule).status, "READY", `${scheme}:MFA_STEP_UP`);

    rows.push({
      scheme,
      ruleSetId: rule.id,
      version: rule.version,
      status: rule.status,
      evidencePack: evidence.evidencePack,
      engineering: evidence.engineering,
      evidencePackDigest: evidence.evidenceDigest,
      canonicalEvidenceDigest,
      artifacts: `${evidence.verifiedArtifactCount}/${evidence.artifactCount}`,
      unknowns: unknownComponents.length,
      humanReview: rule.humanReviewStatus,
      reviewRevision: rule.humanReviewRevision,
      reviewDecisions: rule.reviewDecisions.length,
      humanSignOffs: rule.signOffs.length,
      mfaStepUp: "READY",
      activation: "NOT_ACTIVE",
    });
  }

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    result: "READY_FOR_AUTHORISED_REVIEWER",
    schemes: rows,
  }, null, 2));
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

function jsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function jsonNullableString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function jsonArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
