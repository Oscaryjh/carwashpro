import { createHash } from "node:crypto";

export const STATUTORY_ARTIFACT_ERRORS = {
  CHECKSUM_MISMATCH: "OFFICIAL_ARTIFACT_CHECKSUM_MISMATCH",
  BYTE_SIZE_MISMATCH: "OFFICIAL_ARTIFACT_BYTE_SIZE_MISMATCH",
  CONTENT_TYPE_MISMATCH: "OFFICIAL_ARTIFACT_CONTENT_TYPE_MISMATCH",
  SOURCE_DRIFT: "SOURCE_DRIFT_DETECTED",
  PARSE_REVIEW_REQUIRED: "ARTIFACT_PARSE_REVIEW_REQUIRED",
  RANGE_OVERLAP: "STATUTORY_DATASET_RANGE_OVERLAP",
  RANGE_GAP: "STATUTORY_DATASET_RANGE_GAP",
  DUPLICATE_ROW: "STATUTORY_DATASET_DUPLICATE_ROW",
  MALFORMED_AMOUNT: "STATUTORY_DATASET_MALFORMED_AMOUNT",
  DATASET_DIGEST_MISMATCH: "STATUTORY_DATASET_DIGEST_MISMATCH",
  REVIEW_DIGEST_MISMATCH: "STATUTORY_REVIEW_DIGEST_MISMATCH",
  CERTIFICATION_DIGEST_MISMATCH: "STATUTORY_CERTIFICATION_DIGEST_MISMATCH",
  INDEPENDENT_REVIEW_REQUIRED: "STATUTORY_INDEPENDENT_REVIEW_REQUIRED",
  GOLDEN_FIXTURE_REQUIRED: "STATUTORY_GOLDEN_FIXTURE_REQUIRED",
  CLASSIFICATION_REQUIRED: "STATUTORY_CLASSIFICATION_REQUIRED",
  CALCULATOR_NOT_VERIFIED: "STATUTORY_CALCULATOR_NOT_VERIFIED",
  EFFECTIVE_PERIOD_REQUIRED: "STATUTORY_EFFECTIVE_PERIOD_REQUIRED",
  PLATFORM_ACTOR_REQUIRED: "STATUTORY_PLATFORM_ACTOR_REQUIRED",
  HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED: "HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED",
  ACTIVATION_REASON_REQUIRED: "STATUTORY_ACTIVATION_REASON_REQUIRED",
  WAGE_REQUIRED: "STATUTORY_POSITIVE_WAGE_REQUIRED",
  PARTICIPATION_REQUIRED: "LINDUNG24_PARTICIPATION_EVIDENCE_REQUIRED",
  UNVERIFIED_ACTIVATION: "UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE",
  RULE_OVERLAP: "STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP",
  RULE_NOT_AVAILABLE: "STATUTORY_RULE_NOT_AVAILABLE",
} as const;

export type OfficialStatutoryScheme =
  | "EPF"
  | "SOCSO"
  | "EIS"
  | "LINDUNG24"
  | "PCB";

export type OfficialArtifactStatus =
  | "DISCOVERED"
  | "INGESTED"
  | "PARSED"
  | "VERIFIED"
  | "FETCH_REVIEW_REQUIRED"
  | "SOURCE_DRIFT_DETECTED"
  | "REJECTED";

export type OfficialArtifactManifestEntry = {
  id: string;
  scheme: OfficialStatutoryScheme;
  role:
    | "RULE_TABLE"
    | "ELIGIBILITY_GUIDANCE"
    | "EMPLOYER_SELECTION_GUIDANCE"
    | "PARTICIPATION_FORM"
    | "OPT_OUT_NOTICE"
    | "ALGORITHM_SPEC"
    | "TESTING_MATERIAL"
    | "EMPLOYEE_FORM"
    | "EXPLANATORY_NOTES";
  authority: "KWSP" | "PERKESO" | "HASIL";
  title: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  landingPageUrl: string;
  sourceUrl: string;
  artifactType: "PDF" | "HTML" | "XLS" | "CSV";
  retrievedOn: string;
  mimeType: string;
  byteSize: number | null;
  sha256: string | null;
  retainedPath?: string;
  parserName: string;
  parserVersion: string;
  parsingStatus: "NOT_STARTED" | "PARSED" | "REVIEWED" | "REVIEW_REQUIRED";
  verificationStatus: OfficialArtifactStatus;
  notes: string;
};

export type OfficialArtifactManifest = {
  schemaVersion: 1;
  binaryRetentionPolicy:
    | "MANIFEST_AND_NORMALIZED_DATASET_ONLY"
    | "RETAIN_VERIFIED_OFFICIAL_BYTES_AND_NORMALIZED_DATASETS";
  runtimeNetworkDependency: false;
  artifacts: OfficialArtifactManifestEntry[];
};

export type NormalizedContributionRow = {
  key: string;
  lowerInclusiveCents: number;
  upperInclusiveCents: number | null;
  contributions: Record<string, number>;
  sourceReference: string;
};

export type NormalizedContributionDataset = {
  schemaVersion: 1;
  id: string;
  schemes: OfficialStatutoryScheme[];
  artifactId: string;
  artifactSha256: string;
  parserName: string;
  parserVersion: string;
  extractionMode: "TEXT_EXTRACTED" | "MANUALLY_TRANSCRIBED";
  verificationStatus: "PARSED" | "REVIEW_REQUIRED" | "VERIFIED";
  expectedRowCount: number;
  calculationMode?: "TABLE_ONLY" | "TABLE_THEN_FORMULA";
  formulaAboveCents?: number;
  categoryRules?: Record<
    string,
    {
      table: boolean;
      employerBasisPoints?: number;
      employeeBasisPoints?: number;
      employerBasisPointsAboveThreshold?: number;
      employeeBasisPointsAboveThreshold?: number;
    }
  >;
  rounding?: "EACH_SHARE_CEIL_TO_NEXT_RINGGIT";
  effectiveFrom?: string;
  effectiveTo?: string | null;
  datasetDigest: string;
  rows: NormalizedContributionRow[];
};

export type GoldenFixtureSet = {
  schemaVersion: 1;
  id: string;
  scheme: OfficialStatutoryScheme;
  ruleVersion: string;
  artifactId: string;
  artifactSha256: string;
  verificationStatus: "REVIEW_REQUIRED" | "VERIFIED";
  fixtureDigest: string;
  fixtures: Array<{
    id: string;
    sourceReference: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
};

export type IndependentDatasetReviewRecord = {
  schemaVersion: 1;
  id: string;
  scheme: OfficialStatutoryScheme;
  artifactId: string;
  artifactSha256: string;
  datasetId: string;
  baselineDatasetDigest: string;
  certifiedDatasetDigest: string;
  reviewMethod: "RENDERED_OFFICIAL_PDF_VISUAL_TABLE_REVIEW";
  reviewer: {
    id: string;
    type: "AI_ASSISTED_SECOND_PATH" | "HUMAN_SECOND_PATH";
    independentFromExtraction: true;
  };
  reviewedAt: string;
  rowsChecked: {
    count: number;
    ranges: Array<{ from: string; to: string; sourcePages: number[] }>;
  };
  mismatches: Array<{ rowKey: string; field: string; expected: unknown; actual: unknown }>;
  status: "PASS" | "FAILED";
  notes: string;
  reviewDigest: string;
};

export type GoldenFixtureCertificationRecord = {
  schemaVersion: 1;
  id: string;
  fixtureSetId: string;
  scheme: OfficialStatutoryScheme;
  effectiveFrom: string;
  effectiveTo: string | null;
  artifactId: string;
  artifactSha256: string;
  datasetId: string;
  datasetDigest: string;
  fixtureDigest: string;
  fixtureCount: number;
  officialReferences: string[];
  reviewStatus: "VERIFIED" | "REJECTED";
  reviewedBy: {
    id: string;
    type: "AI_ASSISTED_SECOND_PATH" | "HUMAN_SECOND_PATH";
  };
  reviewedAt: string;
  notes: string;
  certificationDigest: string;
};

export type RuleActivationEvidence = {
  scheme: OfficialStatutoryScheme;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  artifactStatus: OfficialArtifactStatus;
  datasetStatus: NormalizedContributionDataset["verificationStatus"];
  independentReviewStatus: IndependentDatasetReviewRecord["status"];
  fixtureStatus: GoldenFixtureSet["verificationStatus"];
  classificationStatus: "VERIFIED" | "READY_FOR_HUMAN_SIGN_OFF" | "REVIEW_REQUIRED";
  classificationApprovalStatus:
    | "HUMAN_SIGNED_OFF"
    | "READY_FOR_HUMAN_SIGN_OFF"
    | "REVIEW_REQUIRED";
  classificationApprovalRecordDigest: string | null;
  classificationApprovedByActorId: string | null;
  classificationApprovedAt: string | null;
  calculatorStatus: "VERIFIED" | "REVIEW_REQUIRED";
  boundaryTestStatus: "PASS" | "FAILED";
  artifactSha256: string | null;
  datasetDigest: string | null;
  independentReviewDigest: string | null;
  fixtureDigest: string | null;
  classificationVersion: string | null;
  classificationDigest: string | null;
  parserName: string | null;
  parserVersion: string | null;
  calculatorVersion: string | null;
  calculatorTestDigest: string | null;
  datasetRowCount: number;
  goldenFixtureCount: number;
  unresolvedBlockers: string[];
};

export type StatutoryActivationPreview = {
  scheme: OfficialStatutoryScheme;
  ruleVersion: string;
  effectivePeriod: { from: string; to: string | null };
  artifactDigest: string;
  datasetDigest: string;
  fixtureDigest: string;
  independentReviewDigest: string;
  parserVersion: string;
  rowCount: number;
  classificationVersion: string;
  classificationApprovalRecordDigest: string;
  goldenFixtureCount: number;
  calculatorVersion: string;
};

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function verifyArtifactBytes(
  artifact: OfficialArtifactManifestEntry,
  bytes: Uint8Array,
  contentType: string | null,
) {
  if (!artifact.sha256 || artifact.byteSize === null) {
    return { ok: false as const, code: STATUTORY_ARTIFACT_ERRORS.PARSE_REVIEW_REQUIRED };
  }
  if (bytes.byteLength !== artifact.byteSize) {
    return { ok: false as const, code: STATUTORY_ARTIFACT_ERRORS.BYTE_SIZE_MISMATCH };
  }
  if (sha256(bytes) !== artifact.sha256) {
    return { ok: false as const, code: STATUTORY_ARTIFACT_ERRORS.CHECKSUM_MISMATCH };
  }
  if (contentType && !contentType.toLowerCase().includes(artifact.mimeType.toLowerCase())) {
    return { ok: false as const, code: STATUTORY_ARTIFACT_ERRORS.CONTENT_TYPE_MISMATCH };
  }
  return { ok: true as const, code: null };
}

export function validateContributionDataset(dataset: NormalizedContributionDataset) {
  if (dataset.rows.length !== dataset.expectedRowCount || dataset.rows.length === 0) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.PARSE_REVIEW_REQUIRED);
  }
  const keys = new Set<string>();
  dataset.rows.forEach((row, index) => {
    if (keys.has(row.key)) throw new Error(STATUTORY_ARTIFACT_ERRORS.DUPLICATE_ROW);
    keys.add(row.key);
    if (!Number.isSafeInteger(row.lowerInclusiveCents) || row.lowerInclusiveCents < 0) {
      throw new Error(STATUTORY_ARTIFACT_ERRORS.PARSE_REVIEW_REQUIRED);
    }
    if (
      row.upperInclusiveCents !== null &&
      (!Number.isSafeInteger(row.upperInclusiveCents) ||
        row.upperInclusiveCents < row.lowerInclusiveCents)
    ) {
      throw new Error(STATUTORY_ARTIFACT_ERRORS.RANGE_OVERLAP);
    }
    for (const amount of Object.values(row.contributions)) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.MALFORMED_AMOUNT);
      }
    }
    const previous = dataset.rows[index - 1];
    if (previous) {
      if (previous.upperInclusiveCents === null) {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.RANGE_OVERLAP);
      }
      const expectedLower = previous.upperInclusiveCents + 1;
      if (row.lowerInclusiveCents < expectedLower) {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.RANGE_OVERLAP);
      }
      if (row.lowerInclusiveCents > expectedLower) {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.RANGE_GAP);
      }
    }
  });
  const lastUpper = dataset.rows.at(-1)?.upperInclusiveCents;
  const validFormulaBoundary =
    dataset.calculationMode === "TABLE_THEN_FORMULA" &&
    Number.isSafeInteger(dataset.formulaAboveCents) &&
    dataset.formulaAboveCents === lastUpper;
  if (lastUpper !== null && !validFormulaBoundary) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.RANGE_GAP);
  }
  const actualDigest = contributionDatasetDigest(dataset);
  if (actualDigest !== dataset.datasetDigest) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.DATASET_DIGEST_MISMATCH);
  }
  return { rowCount: dataset.rows.length, datasetDigest: actualDigest };
}

export function contributionDatasetDigest(
  dataset: Omit<NormalizedContributionDataset, "datasetDigest"> | NormalizedContributionDataset,
) {
  return canonicalDigest(
    Object.fromEntries(
      Object.entries(dataset).filter(([key]) => key !== "datasetDigest"),
    ),
  );
}

export function goldenFixtureDigest(
  fixtures: Omit<GoldenFixtureSet, "fixtureDigest"> | GoldenFixtureSet,
) {
  return canonicalDigest(
    Object.fromEntries(
      Object.entries(fixtures).filter(([key]) => key !== "fixtureDigest"),
    ),
  );
}

export function independentReviewDigest(
  review: Omit<IndependentDatasetReviewRecord, "reviewDigest"> | IndependentDatasetReviewRecord,
) {
  return canonicalDigest(
    Object.fromEntries(Object.entries(review).filter(([key]) => key !== "reviewDigest")),
  );
}

export function goldenCertificationDigest(
  certification:
    | Omit<GoldenFixtureCertificationRecord, "certificationDigest">
    | GoldenFixtureCertificationRecord,
) {
  return canonicalDigest(
    Object.fromEntries(
      Object.entries(certification).filter(([key]) => key !== "certificationDigest"),
    ),
  );
}

export function validateIndependentReview(review: IndependentDatasetReviewRecord) {
  if (
    review.status !== "PASS" ||
    review.reviewer.independentFromExtraction !== true ||
    review.rowsChecked.count <= 0 ||
    review.mismatches.length > 0
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.INDEPENDENT_REVIEW_REQUIRED);
  }
  const digest = independentReviewDigest(review);
  if (digest !== review.reviewDigest) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.REVIEW_DIGEST_MISMATCH);
  }
  return { reviewDigest: digest, rowsChecked: review.rowsChecked.count };
}

export function validateGoldenCertification(
  certification: GoldenFixtureCertificationRecord,
  fixtureSet: GoldenFixtureSet,
) {
  if (
    certification.reviewStatus !== "VERIFIED" ||
    fixtureSet.verificationStatus !== "VERIFIED" ||
    certification.fixtureSetId !== fixtureSet.id ||
    certification.fixtureDigest !== fixtureSet.fixtureDigest ||
    certification.fixtureCount !== fixtureSet.fixtures.length ||
    certification.fixtureCount <= 0
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.GOLDEN_FIXTURE_REQUIRED);
  }
  const digest = goldenCertificationDigest(certification);
  if (digest !== certification.certificationDigest) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.CERTIFICATION_DIGEST_MISMATCH);
  }
  return { certificationDigest: digest, fixtureCount: certification.fixtureCount };
}

export function lookupContributionRow(
  dataset: NormalizedContributionDataset,
  wageCents: number,
) {
  if (!Number.isSafeInteger(wageCents) || wageCents < 0) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.MALFORMED_AMOUNT);
  }
  return dataset.rows.find(
    (row) =>
      row.lowerInclusiveCents <= wageCents &&
      (row.upperInclusiveCents === null || wageCents <= row.upperInclusiveCents),
  ) ?? null;
}

export function assertRuleActivationReady(input: RuleActivationEvidence) {
  assertRuleEngineeringReady(input);
  const humanSignOffReady =
    input.classificationApprovalStatus === "HUMAN_SIGNED_OFF" &&
    /^[a-f0-9]{64}$/.test(input.classificationApprovalRecordDigest ?? "") &&
    Boolean(input.classificationApprovedByActorId?.trim()) &&
    Boolean(
      input.classificationApprovedAt &&
      !Number.isNaN(Date.parse(input.classificationApprovedAt)),
    );
  if (!humanSignOffReady) {
    throw new Error(
      STATUTORY_ARTIFACT_ERRORS.HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED,
    );
  }
  const ready =
    input.classificationStatus === "VERIFIED" &&
    input.unresolvedBlockers.length === 0;
  if (!ready) throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
}

export function assertRuleEngineeringReady(input: RuleActivationEvidence) {
  const ready =
    input.artifactStatus === "VERIFIED" &&
    input.datasetStatus === "VERIFIED" &&
    input.independentReviewStatus === "PASS" &&
    input.fixtureStatus === "VERIFIED" &&
    (input.classificationStatus === "VERIFIED" ||
      input.classificationStatus === "READY_FOR_HUMAN_SIGN_OFF") &&
    input.calculatorStatus === "VERIFIED" &&
    input.boundaryTestStatus === "PASS" &&
    /^[a-f0-9]{64}$/.test(input.artifactSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(input.datasetDigest ?? "") &&
    /^[a-f0-9]{64}$/.test(input.independentReviewDigest ?? "") &&
    /^[a-f0-9]{64}$/.test(input.fixtureDigest ?? "") &&
    /^[a-f0-9]{64}$/.test(input.classificationDigest ?? "") &&
    /^[a-f0-9]{64}$/.test(input.calculatorTestDigest ?? "") &&
    Boolean(input.classificationVersion?.trim()) &&
    Boolean(input.parserName?.trim()) &&
    Boolean(input.parserVersion?.trim()) &&
    Boolean(input.calculatorVersion?.trim()) &&
    input.datasetRowCount > 0 &&
    input.goldenFixtureCount > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) &&
    (!input.effectiveTo || /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) &&
    (!input.effectiveTo || input.effectiveFrom < input.effectiveTo);
  if (!ready) throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
}

export function buildActivationPreview(input: RuleActivationEvidence): StatutoryActivationPreview {
  assertRuleActivationReady(input);
  return {
    scheme: input.scheme,
    ruleVersion: input.ruleVersion,
    effectivePeriod: { from: input.effectiveFrom, to: input.effectiveTo },
    artifactDigest: input.artifactSha256!,
    datasetDigest: input.datasetDigest!,
    fixtureDigest: input.fixtureDigest!,
    independentReviewDigest: input.independentReviewDigest!,
    parserVersion: input.parserVersion!,
    rowCount: input.datasetRowCount,
    classificationVersion: input.classificationVersion!,
    classificationApprovalRecordDigest: input.classificationApprovalRecordDigest!,
    goldenFixtureCount: input.goldenFixtureCount,
    calculatorVersion: input.calculatorVersion!,
  };
}

export function prepareControlledActivation(input: {
  actorId: string;
  actorRole: string;
  actorType?: string;
  actorCapabilities?: readonly string[];
  reviewerActorId?: string | null;
  reason: string;
  expectedScheme: OfficialStatutoryScheme;
  expectedRuleVersion: string;
  expectedEffectiveFrom: string;
  evidence: RuleActivationEvidence;
}) {
  if (
    input.actorRole !== "PLATFORM_ADMIN" ||
    !input.actorId.trim() ||
    (input.actorType !== undefined && input.actorType !== "HUMAN_USER")
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.PLATFORM_ACTOR_REQUIRED);
  }
  if (
    input.actorCapabilities !== undefined &&
    !input.actorCapabilities.includes("ACTIVATE_STATUTORY_RULESET")
  ) throw new Error("STATUTORY_CAPABILITY_REQUIRED:ACTIVATE_STATUTORY_RULESET");
  if (input.reviewerActorId && input.reviewerActorId === input.actorId) {
    throw new Error("STATUTORY_REVIEWER_ACTIVATOR_SEPARATION_REQUIRED");
  }
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.ACTIVATION_REASON_REQUIRED);
  }
  if (
    input.evidence.scheme !== input.expectedScheme ||
    input.evidence.ruleVersion !== input.expectedRuleVersion ||
    input.evidence.effectiveFrom !== input.expectedEffectiveFrom
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
  const preview = buildActivationPreview(input.evidence);
  return {
    preview,
    reason,
    actorId: input.actorId,
    evidenceDigest: canonicalDigest({ preview, reason, actorId: input.actorId }),
  };
}

export function selectExactActiveRule<T extends {
  scheme: OfficialStatutoryScheme;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "ACTIVE" | "INACTIVE";
  verificationStatus: "VERIFIED" | "UNVERIFIED";
}>(rules: readonly T[], scheme: OfficialStatutoryScheme, period: Date): T {
  const matches = rules.filter(
    (rule) =>
      rule.scheme === scheme &&
      rule.status === "ACTIVE" &&
      rule.verificationStatus === "VERIFIED" &&
      rule.effectiveFrom <= period &&
      (!rule.effectiveTo || period < rule.effectiveTo),
  );
  if (matches.length > 1) throw new Error(STATUTORY_ARTIFACT_ERRORS.RULE_OVERLAP);
  if (matches.length === 0) throw new Error(STATUTORY_ARTIFACT_ERRORS.RULE_NOT_AVAILABLE);
  return matches[0];
}
