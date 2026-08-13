import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalDigest,
  goldenFixtureDigest,
  validateContributionDataset,
  validateGoldenCertification,
  validateIndependentReview,
  verifyArtifactBytes,
  type GoldenFixtureCertificationRecord,
  type GoldenFixtureSet,
  type IndependentDatasetReviewRecord,
  type NormalizedContributionDataset,
  type OfficialArtifactManifest,
  type OfficialArtifactManifestEntry,
} from "./statutory-artifact-pipeline";

export type EvidencePackScheme = "EPF" | "SOCSO" | "EIS" | "LINDUNG24";
export type EvidencePackBlocker =
  | "OFFICIAL_ARTIFACT_NOT_RETAINED"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_METADATA_INCOMPLETE"
  | "ARTIFACT_CONTENT_INVALID"
  | "EFFECTIVE_PERIOD_INVALID"
  | "DATASET_NOT_VERIFIED"
  | "DATASET_ARTIFACT_TRACE_MISMATCH"
  | "INDEPENDENT_REVIEW_INVALID"
  | "FIXTURE_INVALID"
  | "FIXTURE_PROVENANCE_MISSING"
  | "CLASSIFICATION_SUMMARY_MISSING"
  | "CALCULATOR_EVIDENCE_MISSING";

type EvidencePackRegistry = {
  schemaVersion: 1;
  generatedOn: string;
  humanSignOffExecuted: false;
  runtimeNetworkDependency: false;
  packs: EvidencePackRegistryEntry[];
};

type EvidencePackRegistryEntry = {
  scheme: EvidencePackScheme;
  effectiveFrom: string;
  effectiveTo: string | null;
  primaryArtifactId: string;
  acceptedDatasetArtifactIds: string[];
  requiredArtifactIds: string[];
  datasetPath: string;
  reviewPath: string;
  fixturePath: string;
  certificationPath: string;
  classificationPath: string;
  calculatorVersion: string;
  calculatorTestDigest: string;
  knownLimitations: string[];
};

type ClassificationCandidate = {
  scheme?: string;
  schemes?: string[];
  evidence?: Partial<Record<EvidencePackScheme, unknown>>;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  approvalStatus: string;
  classificationDigest: string;
  unresolvedComponentCount: number;
  unresolvedComponents: string[];
  classifications: Array<Record<string, unknown> & { componentCode: string }>;
  activation: { allowed: boolean };
};

export type StatutoryEvidencePackInput = {
  registry: EvidencePackRegistryEntry;
  artifacts: Array<{ manifest: OfficialArtifactManifestEntry; bytes: Uint8Array | null }>;
  dataset: NormalizedContributionDataset;
  review: IndependentDatasetReviewRecord;
  fixtures: GoldenFixtureSet;
  certification: GoldenFixtureCertificationRecord;
  classification: ClassificationCandidate;
};

export type StatutoryEvidencePackResult = {
  scheme: EvidencePackScheme;
  evidencePack: "COMPLETE" | "INCOMPLETE";
  engineering: "READY" | "PARTIAL";
  humanSignOff: "NOT_EXECUTED";
  activation: "BLOCKED_ENGINEERING" | "BLOCKED_HUMAN_SIGNOFF";
  blockers: EvidencePackBlocker[];
  artifactCount: number;
  verifiedArtifactCount: number;
  artifacts: Array<{
    id: string;
    retainedPath: string | null;
    sha256: string | null;
    verified: boolean;
  }>;
  fixtureProvenance: {
    OFFICIAL_BACKED: number;
    INDEPENDENT_DERIVED: number;
    ENGINEERING_REGRESSION: number;
    MISSING: number;
  };
  unknownComponents: string[];
  evidenceDigest: string;
  knownLimitations: string[];
};

export type StatutoryHumanReviewPackage = {
  scheme: EvidencePackScheme;
  effectiveFrom: string;
  effectiveTo: string | null;
  evidencePack: StatutoryEvidencePackResult["evidencePack"];
  engineering: StatutoryEvidencePackResult["engineering"];
  humanReview: "NOT_EXECUTED";
  humanSignOff: "NOT_EXECUTED";
  activation: StatutoryEvidencePackResult["activation"];
  evidenceDigest: string;
  artifacts: Array<{
    id: string;
    role: OfficialArtifactManifestEntry["role"];
    authority: OfficialArtifactManifestEntry["authority"];
    title: string;
    version: string;
    retainedPath: string | null;
    sourceUrl: string;
    sha256: string | null;
    verified: boolean;
  }>;
  dataset: {
    id: string;
    digest: string;
    parserName: string;
    parserVersion: string;
    verificationStatus: string;
    expectedRowCount: number;
    actualRowCount: number;
    calculationMode: string | null;
    formulaAboveCents: number | null;
    categoryRules: Record<string, unknown> | null;
    rounding: string | null;
  };
  independentReview: {
    id: string;
    method: string;
    reviewerType: string;
    rowsChecked: number;
    ranges: Array<{ from: string; to: string; sourcePages: number[] }>;
    mismatchCount: number;
    status: string;
    digest: string;
  };
  calculator: { version: string; testDigest: string };
  fixtures: Array<{
    id: string;
    sourceReference: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
  fixtureDigest: string;
  fixtureCertificationDigest: string;
  fixtureProvenance: StatutoryEvidencePackResult["fixtureProvenance"];
  classification: {
    version: string;
    digest: string;
    status: string;
    approvalStatus: string;
    entries: StatutoryClassificationReviewEntry[];
  };
  unknownComponents: string[];
  knownLimitations: string[];
};

export type StatutoryClassificationReviewEntry = {
  componentCode: string;
  displayName: string;
  treatments: Partial<Record<EvidencePackScheme, string>>;
  officialEvidence: string[];
  technicalRecommendation: string | null;
  humanDecisionRequired: boolean;
  humanReviewStatus: string;
  reason: string;
};

export async function loadStatutoryHumanReviewPackages(
  root = process.cwd(),
): Promise<StatutoryHumanReviewPackage[]> {
  const inputs = await loadStatutoryEvidencePackInputs(root);
  return inputs.map((input) => {
    const result = evaluateStatutoryEvidencePack(input);
    const verificationById = new Map(result.artifacts.map((item) => [item.id, item.verified]));
    return {
      scheme: input.registry.scheme,
      effectiveFrom: input.registry.effectiveFrom,
      effectiveTo: input.registry.effectiveTo,
      evidencePack: result.evidencePack,
      engineering: result.engineering,
      humanReview: "NOT_EXECUTED",
      humanSignOff: "NOT_EXECUTED",
      activation: result.activation,
      evidenceDigest: result.evidenceDigest,
      artifacts: input.artifacts.map(({ manifest }) => ({
        id: manifest.id,
        role: manifest.role,
        authority: manifest.authority,
        title: manifest.title,
        version: manifest.version,
        retainedPath: manifest.retainedPath ?? null,
        sourceUrl: manifest.sourceUrl,
        sha256: manifest.sha256,
        verified: verificationById.get(manifest.id) === true,
      })),
      dataset: {
        id: input.dataset.id,
        digest: input.dataset.datasetDigest,
        parserName: input.dataset.parserName,
        parserVersion: input.dataset.parserVersion,
        verificationStatus: input.dataset.verificationStatus,
        expectedRowCount: input.dataset.expectedRowCount,
        actualRowCount: input.dataset.rows.length,
        calculationMode: input.dataset.calculationMode ?? null,
        formulaAboveCents: input.dataset.formulaAboveCents ?? null,
        categoryRules: input.dataset.categoryRules ?? null,
        rounding: input.dataset.rounding ?? null,
      },
      independentReview: {
        id: input.review.id,
        method: input.review.reviewMethod,
        reviewerType: input.review.reviewer.type,
        rowsChecked: input.review.rowsChecked.count,
        ranges: input.review.rowsChecked.ranges,
        mismatchCount: input.review.mismatches.length,
        status: input.review.status,
        digest: input.review.reviewDigest,
      },
      calculator: {
        version: input.registry.calculatorVersion,
        testDigest: input.registry.calculatorTestDigest,
      },
      fixtures: input.fixtures.fixtures,
      fixtureDigest: input.fixtures.fixtureDigest,
      fixtureCertificationDigest: input.certification.certificationDigest,
      fixtureProvenance: result.fixtureProvenance,
      classification: {
        version: input.classification.version,
        digest: input.classification.classificationDigest,
        status: input.classification.status,
        approvalStatus: input.classification.approvalStatus,
        entries: input.classification.classifications.map(normalizeClassificationEntry),
      },
      unknownComponents: result.unknownComponents,
      knownLimitations: result.knownLimitations,
    };
  });
}

export async function loadStatutoryOfficialEvidencePacks(
  root = process.cwd(),
): Promise<StatutoryEvidencePackResult[]> {
  const inputs = await loadStatutoryEvidencePackInputs(root);
  return inputs.map(evaluateStatutoryEvidencePack);
}

export async function loadStatutoryEvidencePackInputs(
  root = process.cwd(),
): Promise<StatutoryEvidencePackInput[]> {
  const [manifest, registry] = await Promise.all([
    readJson<OfficialArtifactManifest>(resolve(root, "statutory/official/manifest.json")),
    readJson<EvidencePackRegistry>(
      resolve(root, "statutory/official/evidence-pack-registry.json"),
    ),
  ]);
  if (
    registry.schemaVersion !== 1 ||
    registry.humanSignOffExecuted !== false ||
    registry.runtimeNetworkDependency !== false
  ) throw new Error("STATUTORY_EVIDENCE_PACK_REGISTRY_INVALID");

  return Promise.all(
    registry.packs.map(async (pack) => {
      const artifacts = await Promise.all(
        pack.requiredArtifactIds.map(async (artifactId) => {
          const artifact = manifest.artifacts.find((item) => item.id === artifactId);
          if (!artifact) {
            return {
              manifest: missingManifestEntry(pack.scheme, artifactId),
              bytes: null,
            };
          }
          const bytes = artifact.retainedPath
            ? await readFile(resolve(root, artifact.retainedPath)).catch(() => null)
            : null;
          return { manifest: artifact, bytes };
        }),
      );
      const [dataset, review, fixtures, certification, classification] = await Promise.all([
        readJson<NormalizedContributionDataset>(resolve(root, pack.datasetPath)),
        readJson<IndependentDatasetReviewRecord>(resolve(root, pack.reviewPath)),
        readJson<GoldenFixtureSet>(resolve(root, pack.fixturePath)),
        readJson<GoldenFixtureCertificationRecord>(resolve(root, pack.certificationPath)),
        readJson<ClassificationCandidate>(resolve(root, pack.classificationPath)),
      ]);
      return {
        registry: pack,
        artifacts,
        dataset,
        review,
        fixtures,
        certification,
        classification,
      };
    }),
  );
}

export function evaluateStatutoryEvidencePack(
  input: StatutoryEvidencePackInput,
): StatutoryEvidencePackResult {
  const blockers = new Set<EvidencePackBlocker>();
  let verifiedArtifactCount = 0;
  const artifactIdentities: Array<Record<string, unknown>> = [];
  const artifactSummaries: StatutoryEvidencePackResult["artifacts"] = [];

  for (const { manifest, bytes } of input.artifacts) {
    if (!metadataComplete(manifest)) blockers.add("ARTIFACT_METADATA_INCOMPLETE");
    if (!bytes) {
      blockers.add("OFFICIAL_ARTIFACT_NOT_RETAINED");
      artifactSummaries.push({
        id: manifest.id,
        retainedPath: manifest.retainedPath ?? null,
        sha256: manifest.sha256,
        verified: false,
      });
      continue;
    }
    const verification = verifyArtifactBytes(manifest, bytes, manifest.mimeType);
    if (!verification.ok) blockers.add("ARTIFACT_HASH_MISMATCH");
    if (manifest.artifactType === "PDF" && !hasPdfSignature(bytes)) {
      blockers.add("ARTIFACT_CONTENT_INVALID");
    }
    if (verification.ok && (manifest.artifactType !== "PDF" || hasPdfSignature(bytes))) {
      verifiedArtifactCount += 1;
    }
    artifactSummaries.push({
      id: manifest.id,
      retainedPath: manifest.retainedPath ?? null,
      sha256: manifest.sha256,
      verified: verification.ok &&
        (manifest.artifactType !== "PDF" || hasPdfSignature(bytes)),
    });
    artifactIdentities.push({
      id: manifest.id,
      authority: manifest.authority,
      title: manifest.title,
      version: manifest.version,
      effectiveFrom: manifest.effectiveFrom,
      effectiveTo: manifest.effectiveTo,
      retainedPath: manifest.retainedPath,
      mimeType: manifest.mimeType,
      byteSize: manifest.byteSize,
      sha256: manifest.sha256,
      sourceUrl: manifest.sourceUrl,
      retrievedOn: manifest.retrievedOn,
    });
  }

  if (!validPeriod(input.registry.effectiveFrom, input.registry.effectiveTo)) {
    blockers.add("EFFECTIVE_PERIOD_INVALID");
  }
  const primaryArtifact = input.artifacts.find(
    (item) => item.manifest.id === input.registry.primaryArtifactId,
  )?.manifest;
  if (
    !primaryArtifact ||
    primaryArtifact.effectiveFrom !== input.registry.effectiveFrom ||
    primaryArtifact.effectiveTo !== input.registry.effectiveTo
  ) blockers.add("EFFECTIVE_PERIOD_INVALID");

  try {
    validateContributionDataset(input.dataset);
    if (input.dataset.verificationStatus !== "VERIFIED") {
      blockers.add("DATASET_NOT_VERIFIED");
    }
  } catch {
    blockers.add("DATASET_NOT_VERIFIED");
  }
  if (
    !primaryArtifact ||
    !input.registry.acceptedDatasetArtifactIds.includes(input.dataset.artifactId) ||
    input.dataset.artifactSha256 !== primaryArtifact.sha256 ||
    !input.dataset.schemes.includes(input.registry.scheme)
  ) blockers.add("DATASET_ARTIFACT_TRACE_MISMATCH");

  try {
    validateIndependentReview(input.review);
    if (
      input.review.artifactId !== input.dataset.artifactId ||
      input.review.artifactSha256 !== input.dataset.artifactSha256 ||
      input.review.datasetId !== input.dataset.id ||
      input.review.certifiedDatasetDigest !== input.dataset.datasetDigest
    ) blockers.add("DATASET_ARTIFACT_TRACE_MISMATCH");
  } catch {
    blockers.add("INDEPENDENT_REVIEW_INVALID");
  }

  try {
    if (goldenFixtureDigest(input.fixtures) !== input.fixtures.fixtureDigest) {
      throw new Error("FIXTURE_DIGEST_MISMATCH");
    }
    validateGoldenCertification(input.certification, input.fixtures);
    if (
      input.fixtures.scheme !== input.registry.scheme ||
      input.fixtures.artifactId !== input.dataset.artifactId ||
      input.fixtures.artifactSha256 !== input.dataset.artifactSha256 ||
      input.certification.datasetId !== input.dataset.id ||
      input.certification.datasetDigest !== input.dataset.datasetDigest
    ) throw new Error("FIXTURE_TRACE_MISMATCH");
  } catch {
    blockers.add("FIXTURE_INVALID");
  }

  const missingProvenance = input.fixtures.fixtures.filter(
    (fixture) => !fixture.sourceReference?.trim(),
  ).length;
  if (missingProvenance > 0 || input.certification.officialReferences.length === 0) {
    blockers.add("FIXTURE_PROVENANCE_MISSING");
  }

  const unknownComponents = input.classification.classifications
    .filter((item) => classificationTreatment(item, input.registry.scheme) === "UNKNOWN")
    .map((item) => item.componentCode)
    .concat(input.classification.unresolvedComponents)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort();
  const unresolvedListed = unknownComponents.every((component) =>
    input.classification.unresolvedComponents.includes(component),
  );
  if (
    !classificationMatchesScheme(input.classification, input.registry.scheme) ||
    !input.classification.version?.trim() ||
    !isSha256(input.classification.classificationDigest) ||
    input.classification.status !== "READY_FOR_HUMAN_SIGN_OFF" ||
    input.classification.approvalStatus !== "NOT_SIGNED_OFF" ||
    input.classification.activation.allowed !== false ||
    input.classification.unresolvedComponentCount !==
      input.classification.unresolvedComponents.length ||
    !unresolvedListed
  ) blockers.add("CLASSIFICATION_SUMMARY_MISSING");

  if (
    !input.registry.calculatorVersion?.trim() ||
    !isSha256(input.registry.calculatorTestDigest)
  ) blockers.add("CALCULATOR_EVIDENCE_MISSING");

  const sortedBlockers = [...blockers].sort();
  const evidencePack = sortedBlockers.length === 0 ? "COMPLETE" as const : "INCOMPLETE" as const;
  const evidenceDigest = canonicalDigest({
    scheme: input.registry.scheme,
    effectiveFrom: input.registry.effectiveFrom,
    effectiveTo: input.registry.effectiveTo,
    artifacts: artifactIdentities.sort((a, b) => String(a.id).localeCompare(String(b.id))),
    dataset: {
      id: input.dataset.id,
      digest: input.dataset.datasetDigest,
      parserName: input.dataset.parserName,
      parserVersion: input.dataset.parserVersion,
    },
    reviewDigest: input.review.reviewDigest,
    fixtureDigest: input.fixtures.fixtureDigest,
    certificationDigest: input.certification.certificationDigest,
    fixtureProvenance: "OFFICIAL_BACKED",
    classificationVersion: input.classification.version,
    classificationDigest: input.classification.classificationDigest,
    unresolvedComponents: unknownComponents,
    calculatorVersion: input.registry.calculatorVersion,
    calculatorTestDigest: input.registry.calculatorTestDigest,
    knownLimitations: input.registry.knownLimitations,
  });

  return {
    scheme: input.registry.scheme,
    evidencePack,
    engineering: evidencePack === "COMPLETE" ? "READY" : "PARTIAL",
    humanSignOff: "NOT_EXECUTED",
    activation:
      evidencePack === "COMPLETE" ? "BLOCKED_HUMAN_SIGNOFF" : "BLOCKED_ENGINEERING",
    blockers: sortedBlockers,
    artifactCount: input.artifacts.length,
    verifiedArtifactCount,
    artifacts: artifactSummaries,
    fixtureProvenance: {
      OFFICIAL_BACKED: input.fixtures.fixtures.length - missingProvenance,
      INDEPENDENT_DERIVED: 0,
      ENGINEERING_REGRESSION: 0,
      MISSING: missingProvenance,
    },
    unknownComponents,
    evidenceDigest,
    knownLimitations: input.registry.knownLimitations,
  };
}

function metadataComplete(artifact: OfficialArtifactManifestEntry) {
  return Boolean(
    artifact.authority &&
    artifact.title?.trim() &&
    artifact.version?.trim() &&
    validPeriod(artifact.effectiveFrom, artifact.effectiveTo) &&
    artifact.sourceUrl?.startsWith("https://") &&
    artifact.landingPageUrl?.startsWith("https://") &&
    artifact.retainedPath?.trim() &&
    artifact.mimeType?.trim() &&
    artifact.byteSize &&
    artifact.byteSize > 0 &&
    isSha256(artifact.sha256) &&
    /^\d{4}-\d{2}-\d{2}$/.test(artifact.retrievedOn) &&
    artifact.parserName?.trim() &&
    artifact.parserVersion?.trim(),
  );
}

function validPeriod(from: string, to: string | null) {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    (!to || (/^\d{4}-\d{2}-\d{2}$/.test(to) && from < to));
}

function hasPdfSignature(bytes: Uint8Array) {
  return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
}

function classificationTreatment(item: Record<string, unknown>, scheme: EvidencePackScheme) {
  return item.treatment ?? item[scheme];
}

function normalizeClassificationEntry(
  item: Record<string, unknown> & { componentCode: string },
): StatutoryClassificationReviewEntry {
  const treatments: Partial<Record<EvidencePackScheme, string>> = {};
  for (const scheme of ["EPF", "SOCSO", "EIS"] as const) {
    if (typeof item[scheme] === "string") treatments[scheme] = item[scheme];
  }
  if (typeof item.treatment === "string") treatments.LINDUNG24 = item.treatment;
  const officialBasis = Array.isArray(item.officialBasis)
    ? item.officialBasis.filter((value): value is string => typeof value === "string")
    : [];
  return {
    componentCode: item.componentCode,
    displayName: typeof item.displayName === "string" ? item.displayName : item.componentCode,
    treatments,
    officialEvidence: officialBasis,
    technicalRecommendation:
      typeof item.technicalRecommendation === "string" ? item.technicalRecommendation : null,
    humanDecisionRequired: item.humanDecisionRequired === true,
    humanReviewStatus:
      typeof item.reviewStatus === "string" ? item.reviewStatus : "NOT_REVIEWED",
    reason:
      typeof item.notes === "string"
        ? item.notes
        : typeof item.rationale === "string"
          ? item.rationale
          : "No engineering rationale recorded.",
  };
}

function classificationMatchesScheme(
  candidate: ClassificationCandidate,
  scheme: EvidencePackScheme,
) {
  return candidate.scheme === scheme ||
    candidate.schemes?.includes(scheme) === true ||
    candidate.evidence?.[scheme] !== undefined;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function missingManifestEntry(
  scheme: EvidencePackScheme,
  id: string,
): OfficialArtifactManifestEntry {
  return {
    id,
    scheme,
    role: "RULE_TABLE",
    authority: scheme === "EPF" ? "KWSP" : "PERKESO",
    title: "",
    version: "",
    effectiveFrom: "",
    effectiveTo: null,
    landingPageUrl: "",
    sourceUrl: "",
    artifactType: "PDF",
    retrievedOn: "",
    mimeType: "",
    byteSize: null,
    sha256: null,
    parserName: "",
    parserVersion: "",
    parsingStatus: "NOT_STARTED",
    verificationStatus: "REJECTED",
    notes: "",
  };
}
