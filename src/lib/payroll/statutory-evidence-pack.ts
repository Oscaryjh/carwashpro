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

export type EvidencePackScheme = "EPF" | "SOCSO" | "EIS" | "LINDUNG24" | "PCB";
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

type PcbRequirementsInventory = {
  schemaVersion: 2;
  ruleVersion: string;
  artifactId: string;
  artifactSha256: string;
  status: "PARTIAL" | "COMPLETE";
  requirements: Array<{
    requirement: string;
    officialSection: string;
    status: string;
  }>;
  remainingBlockers: string[];
};

type PcbTechnicalVerification = {
  id: string;
  ruleVersion: string;
  fixtureCount: number;
  calculatorVersion: string;
  supportedScopeTestCount: number;
  closureGateResult: "PASS" | "FAIL";
  closureStatus: "COMPLETE" | "PARTIAL";
  hasilSoftwareVerificationStatus: "APPROVED" | "PENDING";
  requirementsDigest: string;
  recordDigest: string;
};

type PcbClassificationCandidate = {
  id: string;
  scheme: "PCB";
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  classificationDigest: string;
  classifications: Array<{
    componentCode: string;
    businessMeaning: string;
    pcbTreatment: string;
    officialBasis: string;
    technicalStatus: string;
    humanReviewRequired: boolean;
  }>;
  unresolvedUnknowns: string[];
  activationAllowed: boolean;
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
  const contributionPackages: StatutoryHumanReviewPackage[] = inputs.map((input) => {
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
  return [...contributionPackages, await loadPcbHumanReviewPackage(root)];
}

async function loadPcbHumanReviewPackage(
  root: string,
): Promise<StatutoryHumanReviewPackage> {
  const artifactIds = [
    "hasil-pcb-computerised-spec-2026",
    "hasil-mtd-testing-questions-2026",
    "hasil-pcb-tp1-2026-bm",
    "hasil-pcb-tp3-2026-bm",
    "hasil-pcb-tp1-explanatory-notes-2026",
    "hasil-pcb-tp3-explanatory-notes-2026",
  ];
  const [manifest, requirements, fixtures, verification, classification] = await Promise.all([
    readJson<OfficialArtifactManifest>(resolve(root, "statutory/official/manifest.json")),
    readJson<PcbRequirementsInventory>(
      resolve(root, "statutory/official/pcb-2026-requirements.json"),
    ),
    readJson<GoldenFixtureSet>(
      resolve(root, "statutory/official/fixtures/hasil-pcb-2026-official-golden-v1.json"),
    ),
    readJson<PcbTechnicalVerification>(
      resolve(
        root,
        "statutory/official/certifications/hasil-pcb-2026-technical-verification-v1.json",
      ),
    ),
    readJson<PcbClassificationCandidate>(
      resolve(
        root,
        "statutory/official/classifications/malaysia-pcb-2026-signoff-candidate-v1.json",
      ),
    ),
  ]);

  const artifacts = await Promise.all(artifactIds.map(async (id) => {
    const artifact = manifest.artifacts.find((item) => item.id === id);
    if (!artifact) throw new Error(`PCB_OFFICIAL_ARTIFACT_MISSING_${id}`);
    const bytes = artifact.retainedPath
      ? await readFile(resolve(root, artifact.retainedPath)).catch(() => null)
      : null;
    const verified = Boolean(
      bytes &&
      artifact.verificationStatus === "VERIFIED" &&
      verifyArtifactBytes(artifact, bytes, artifact.mimeType).ok &&
      (artifact.artifactType !== "PDF" || hasPdfSignature(bytes)),
    );
    return {
      id: artifact.id,
      role: artifact.role,
      authority: artifact.authority,
      title: artifact.title,
      version: artifact.version,
      retainedPath: artifact.retainedPath ?? null,
      sourceUrl: artifact.sourceUrl,
      sha256: artifact.sha256,
      verified,
    };
  }));

  if (goldenFixtureDigest(fixtures) !== fixtures.fixtureDigest) {
    throw new Error("PCB_GOLDEN_FIXTURE_DIGEST_MISMATCH");
  }
  if (canonicalDigest(requirements) !== verification.requirementsDigest) {
    throw new Error("PCB_REQUIREMENTS_DIGEST_MISMATCH");
  }
  const { recordDigest, ...verificationRecord } = verification;
  if (canonicalDigest(verificationRecord) !== recordDigest) {
    throw new Error("PCB_VERIFICATION_DIGEST_MISMATCH");
  }

  const engineeringReady =
    requirements.status === "COMPLETE" &&
    requirements.remainingBlockers.length === 0 &&
    verification.closureGateResult === "PASS" &&
    verification.closureStatus === "COMPLETE" &&
    verification.hasilSoftwareVerificationStatus === "APPROVED" &&
    classification.activationAllowed === true &&
    artifacts.every((artifact) => artifact.verified);
  const implementedRequirements = requirements.requirements.filter(
    (item) => item.status !== "BLOCKED",
  ).length;
  const knownLimitations = requirements.remainingBlockers.map(friendlyPcbBlocker);
  const entries: StatutoryClassificationReviewEntry[] = classification.classifications.map(
    (item) => ({
      componentCode: item.componentCode,
      displayName: item.businessMeaning,
      treatments: { PCB: item.pcbTreatment },
      officialEvidence: [item.officialBasis],
      technicalRecommendation: item.pcbTreatment,
      humanDecisionRequired: item.humanReviewRequired,
      humanReviewStatus: item.technicalStatus,
      reason: item.officialBasis,
    }),
  );

  return {
    scheme: "PCB",
    effectiveFrom: classification.effectiveFrom,
    effectiveTo: classification.effectiveTo,
    evidencePack: engineeringReady ? "COMPLETE" : "INCOMPLETE",
    engineering: engineeringReady ? "READY" : "PARTIAL",
    humanReview: "NOT_EXECUTED",
    humanSignOff: "NOT_EXECUTED",
    activation: engineeringReady ? "BLOCKED_HUMAN_SIGNOFF" : "BLOCKED_ENGINEERING",
    evidenceDigest: canonicalDigest({
      scheme: "PCB",
      ruleVersion: requirements.ruleVersion,
      artifacts: artifacts.map((artifact) => ({ id: artifact.id, sha256: artifact.sha256 })),
      requirementsDigest: verification.requirementsDigest,
      fixtureDigest: fixtures.fixtureDigest,
      verificationDigest: verification.recordDigest,
      classificationDigest: classification.classificationDigest,
      blockers: requirements.remainingBlockers,
    }),
    artifacts,
    dataset: {
      id: "hasil-pcb-2026-requirements",
      digest: verification.requirementsDigest,
      parserName: "hasil-pcb-requirements-inventory",
      parserVersion: "2.0.0",
      verificationStatus: requirements.status,
      expectedRowCount: requirements.requirements.length,
      actualRowCount: implementedRequirements,
      calculationMode: "Official formula",
      formulaAboveCents: null,
      categoryRules: null,
      rounding: "Integer cents with final five-sen rounding",
    },
    independentReview: {
      id: verification.id,
      method: "Official HASiL worked examples and retained calculator result",
      reviewerType: "TECHNICAL_VERIFICATION",
      rowsChecked: verification.fixtureCount,
      ranges: [{ from: "Official example 1", to: `Official example ${verification.fixtureCount}`, sourcePages: [46, 47, 48, 49, 50, 51, 52] }],
      mismatchCount: requirements.remainingBlockers.length,
      status: verification.closureStatus,
      digest: verification.recordDigest,
    },
    calculator: {
      version: verification.calculatorVersion,
      testDigest: fixtures.fixtureDigest,
    },
    fixtures: fixtures.fixtures,
    fixtureDigest: fixtures.fixtureDigest,
    fixtureCertificationDigest: verification.recordDigest,
    fixtureProvenance: {
      OFFICIAL_BACKED: fixtures.fixtures.length,
      INDEPENDENT_DERIVED: 0,
      ENGINEERING_REGRESSION: 0,
      MISSING: 0,
    },
    classification: {
      version: classification.id,
      digest: classification.classificationDigest,
      status: classification.status,
      approvalStatus: "NOT_SIGNED_OFF",
      entries,
    },
    unknownComponents: [...classification.unresolvedUnknowns],
    knownLimitations,
  };
}

function friendlyPcbBlocker(blocker: string) {
  const labels: Record<string, string> = {
    PCB_TAX_PROFILE_INCOMPLETE: "Employee tax profile inputs are not complete enough for an official PCB calculation.",
    PCB_TP1_DOMAIN_NOT_AVAILABLE: "TP1 relief declarations are not yet available as governed payroll inputs.",
    PCB_TP3_DOMAIN_NOT_AVAILABLE: "Previous-employer TP3 amounts are not yet available as governed payroll inputs.",
    PCB_YTD_LEDGER_INCOMPLETE: "The tax-year ledger does not yet provide every finalized year-to-date input required by PCB.",
    PCB_CLASSIFICATION_REQUIRED: "Several pay items still need an evidence-backed PCB treatment decision.",
    PCB_SNAPSHOT_NOT_AVAILABLE: "A complete, frozen PCB calculation snapshot is not yet available for payroll audit.",
    PCB_SPECIAL_REGIME_PROFILE_REQUIRED: "Approved special tax regimes cannot yet be evidenced in the employee profile.",
    PCB_NON_RESIDENT_CLASSIFICATION_REQUIRED: "Non-resident and exempt-income treatment is not yet fully classified.",
    HASIL_SOFTWARE_VERIFICATION_REQUIRED: "HASiL software verification has not been completed for this calculator version.",
  };
  return labels[blocker] ?? blocker.replaceAll("_", " ").toLowerCase();
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
  return scheme === "PCB" ? item.pcbTreatment : item.treatment ?? item[scheme];
}

function normalizeClassificationEntry(
  item: Record<string, unknown> & { componentCode: string },
): StatutoryClassificationReviewEntry {
  const treatments: Partial<Record<EvidencePackScheme, string>> = {};
  for (const scheme of ["EPF", "SOCSO", "EIS"] as const) {
    if (typeof item[scheme] === "string") treatments[scheme] = item[scheme];
  }
  if (typeof item.treatment === "string") treatments.LINDUNG24 = item.treatment;
  if (typeof item.pcbTreatment === "string") treatments.PCB = item.pcbTreatment;
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
