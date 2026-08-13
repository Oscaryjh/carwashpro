import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalDigest,
  goldenFixtureDigest,
  independentReviewDigest,
  validateContributionDataset,
  validateGoldenCertification,
  validateIndependentReview,
  type GoldenFixtureCertificationRecord,
  type GoldenFixtureSet,
  type IndependentDatasetReviewRecord,
  type NormalizedContributionDataset,
} from "../src/lib/payroll/statutory-artifact-pipeline";
import {
  STATUTORY_P2C_CALCULATOR_VERSION,
  calculateEpf,
  calculateEis,
  calculateLindung24,
  calculateSocso,
  type EpfContributionCategory,
} from "../src/lib/payroll/statutory-p2c";

const paths = {
  epfDataset: "statutory/official/datasets/kwsp-third-schedule-2025-10.json",
  epfFixtures: "statutory/official/fixtures/kwsp-third-schedule-2025-10-golden-v1.json",
  epfReview: "statutory/official/reviews/kwsp-third-schedule-2025-10-independent-review.json",
  epfCertification: "statutory/official/certifications/kwsp-third-schedule-2025-10-golden-certification.json",
  epfClassification: "statutory/official/classifications/malaysia-epf-2025-10-signoff-candidate-v1.json",
  act4Dataset: "statutory/official/datasets/perkeso-act4-lindung24-2026-06.json",
  act800Dataset: "statutory/official/datasets/perkeso-act800-2024-10.review.json",
  act4Fixtures:
    "statutory/official/fixtures/perkeso-act4-2026-06-boundaries-review-v1.json",
  act800Fixtures:
    "statutory/official/fixtures/perkeso-act800-2024-10-boundaries-review-v1.json",
  act4Review: "statutory/official/reviews/perkeso-act4-2026-06-independent-review.json",
  act800Review:
    "statutory/official/reviews/perkeso-act800-2024-10-independent-review.json",
  lindung24AmountReview:
    "statutory/official/reviews/perkeso-lindung24-2026-06-amount-review.json",
  act4Certification:
    "statutory/official/certifications/perkeso-act4-2026-06-golden-certification.json",
  act800Certification:
    "statutory/official/certifications/perkeso-act800-2024-10-golden-certification.json",
  classification: "statutory/official/classification-review.json",
  lindung24Design: "statutory/official/lindung24-participation-design.json",
  lindung24Fixtures:
    "statutory/official/fixtures/perkeso-lindung24-2026-06-boundaries-review-v1.json",
  lindung24Certification:
    "statutory/official/certifications/perkeso-lindung24-2026-06-golden-certification-v1.json",
  lindung24Classification:
    "statutory/official/classifications/malaysia-lindung24-2026-signoff-candidate-v1.json",
  lindung24SourceRegister:
    "statutory/official/reviews/perkeso-lindung24-participation-source-register-v1.json",
} as const;

async function main() {
  const [
    epf,
    epfFixtures,
    epfReview,
    epfCertification,
    epfClassification,
    act4,
    act800,
    act4Fixtures,
    act800Fixtures,
    act4Review,
    act800Review,
    lindung24AmountReview,
    act4Certification,
    act800Certification,
    classification,
    lindung24Design,
    lindung24Fixtures,
    lindung24Certification,
    lindung24Classification,
    lindung24SourceRegister,
  ] = await Promise.all([
    readJson<NormalizedContributionDataset>(paths.epfDataset),
    readJson<GoldenFixtureSet>(paths.epfFixtures),
    readJson<IndependentDatasetReviewRecord>(paths.epfReview),
    readJson<GoldenFixtureCertificationRecord>(paths.epfCertification),
    readJson<EpfClassificationCandidate>(paths.epfClassification),
    readJson<NormalizedContributionDataset>(paths.act4Dataset),
    readJson<NormalizedContributionDataset>(paths.act800Dataset),
    readJson<GoldenFixtureSet>(paths.act4Fixtures),
    readJson<GoldenFixtureSet>(paths.act800Fixtures),
    readJson<IndependentDatasetReviewRecord>(paths.act4Review),
    readJson<IndependentDatasetReviewRecord>(paths.act800Review),
    readJson<IndependentDatasetReviewRecord>(paths.lindung24AmountReview),
    readJson<GoldenFixtureCertificationRecord>(paths.act4Certification),
    readJson<GoldenFixtureCertificationRecord>(paths.act800Certification),
    readJson<ClassificationReview>(paths.classification),
    readJson<Lindung24Design>(paths.lindung24Design),
    readJson<GoldenFixtureSet>(paths.lindung24Fixtures),
    readJson<GoldenFixtureCertificationRecord>(paths.lindung24Certification),
    readJson<Lindung24Classification>(paths.lindung24Classification),
    readJson<Lindung24SourceRegister>(paths.lindung24SourceRegister),
  ]);

  verifyDatasetChain(epf, epfReview, epfFixtures, epfCertification);
  verifyDatasetChain(act4, act4Review, act4Fixtures, act4Certification);
  verifyDatasetChain(act800, act800Review, act800Fixtures, act800Certification);
  validateIndependentReview(lindung24AmountReview);
  assert.equal(lindung24AmountReview.certifiedDatasetDigest, act4.datasetDigest);

  const socsoResults = act4Fixtures.fixtures.map((fixture) => {
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
  const eisResults = act800Fixtures.fixtures.map((fixture) => {
    const input = fixture.input as { wageCents: number };
    const result = calculateEis({ dataset: act800, ...input });
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
  const epfResults = epfFixtures.fixtures.map((fixture) => {
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

  for (const category of ["PART_A", "PART_C", "PART_E"] as const) {
    epf.rows.forEach((row) => {
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
    });
  }
  assert.equal(
    calculateEpf({ dataset: epf, wageCents: 2_000_001, category: "PART_A" })
      .matchedRowKey,
    "EPF-PART_A-FORMULA",
  );
  assert.equal(epfReview.rowsChecked.count, 1203);
  assert.equal(epfClassification.status, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(epfClassification.approvalStatus, "NOT_SIGNED_OFF");
  assert.equal(
    epfClassification.classificationDigest,
    canonicalDigest(epfClassification.classifications),
  );
  assert.equal(
    epfClassification.candidateDigest,
    digestWithout(epfClassification, "candidateDigest"),
  );
  assert.ok(epfClassification.unresolvedComponentCount > 0);
  assert.equal(epfClassification.activation.allowed, false);

  verifyEveryBoundary(act4, "SOCSO");
  verifyEveryBoundary(act800, "EIS");
  assert.ok(
    act800.rows.every(
      (row) => row.contributions.eisEmployeeCents === row.contributions.eisEmployerCents,
    ),
  );

  assert.equal(classification.status, "REVIEW_REQUIRED");
  assert.equal(
    classification.classificationDigest,
    digestWithout(classification, "classificationDigest"),
  );
  assert.ok(
    classification.classifications.some(
      (item) => item.SOCSO === "UNKNOWN" || item.EIS === "UNKNOWN",
    ),
  );
  assert.equal(lindung24Design.activationStatus, "BLOCKED");
  assert.equal(lindung24Design.designDigest, digestWithout(lindung24Design, "designDigest"));
  assert.equal(goldenFixtureDigest(lindung24Fixtures), lindung24Fixtures.fixtureDigest);
  validateGoldenCertification(lindung24Certification, lindung24Fixtures);
  assert.equal(lindung24Classification.status, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(lindung24Classification.approvalStatus, "NOT_SIGNED_OFF");
  assert.equal(
    lindung24Classification.classificationDigest,
    canonicalDigest(lindung24Classification.classifications),
  );
  assert.equal(
    lindung24Classification.candidateDigest,
    digestWithout(lindung24Classification, "candidateDigest"),
  );
  assert.equal(
    lindung24SourceRegister.reviewDigest,
    digestWithout(lindung24SourceRegister, "reviewDigest"),
  );
  const lindung24Results = lindung24Fixtures.fixtures.map((fixture) => {
    const result = calculateLindung24({
      dataset: act4,
      wageCents: (fixture.input as { wageCents: number }).wageCents,
    });
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

  console.log(
    `EPF DATASET_VERIFIED REVIEW_PASS GOLDEN_VERIFIED CALCULATOR_VERIFIED fixtures=${epfFixtures.fixtures.length} calculatorDigest=${canonicalDigest(epfResults)} classification=READY_FOR_HUMAN_SIGN_OFF`,
  );
  console.log(
    `SOCSO DATASET_VERIFIED REVIEW_PASS GOLDEN_VERIFIED CALCULATOR_VERIFIED fixtures=${act4Fixtures.fixtures.length} calculatorDigest=${canonicalDigest(socsoResults)}`,
  );
  console.log(
    `EIS DATASET_VERIFIED REVIEW_PASS GOLDEN_VERIFIED CALCULATOR_VERIFIED fixtures=${act800Fixtures.fixtures.length} calculatorDigest=${canonicalDigest(eisResults)}`,
  );
  console.log(
    `CLASSIFICATION REVIEW_REQUIRED ${classification.classificationDigest} calculator=${STATUTORY_P2C_CALCULATOR_VERSION}`,
  );
  console.log(
    `LINDUNG24 DATASET_VERIFIED PARTICIPATION_TECHNICAL_REVIEW_COMPLETE GOLDEN_VERIFIED CALCULATOR_VERIFIED fixtures=${lindung24Fixtures.fixtures.length} calculatorDigest=${canonicalDigest(lindung24Results)} classification=READY_FOR_HUMAN_SIGN_OFF humanSignOff=NOT_EXECUTED`,
  );
}

function verifyDatasetChain(
  dataset: NormalizedContributionDataset,
  review: IndependentDatasetReviewRecord,
  fixtureSet: GoldenFixtureSet,
  certification: GoldenFixtureCertificationRecord,
) {
  validateContributionDataset(dataset);
  validateIndependentReview(review);
  validateGoldenCertification(certification, fixtureSet);
  assert.equal(dataset.verificationStatus, "VERIFIED");
  assert.equal(review.certifiedDatasetDigest, dataset.datasetDigest);
  assert.equal(certification.datasetDigest, dataset.datasetDigest);
  assert.equal(goldenFixtureDigest(fixtureSet), fixtureSet.fixtureDigest);
  assert.equal(independentReviewDigest(review), review.reviewDigest);
}

function verifyEveryBoundary(dataset: NormalizedContributionDataset, scheme: "SOCSO" | "EIS") {
  dataset.rows.forEach((row) => {
    if (row.lowerInclusiveCents > 0) verifyMatch(row.lowerInclusiveCents, row.key);
    if (row.upperInclusiveCents !== null) verifyMatch(row.upperInclusiveCents, row.key);
  });

  function verifyMatch(wageCents: number, expectedKey: string) {
    const matched =
      scheme === "SOCSO"
        ? calculateSocso({ dataset, wageCents, category: "FIRST" }).matchedRowKey
        : calculateEis({ dataset, wageCents }).matchedRowKey;
    assert.equal(matched, expectedKey);
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function digestWithout(value: object, field: string) {
  return canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)));
}

type ClassificationReview = {
  status: string;
  classificationDigest: string;
  classifications: Array<{ SOCSO: string; EIS: string }>;
};

type Lindung24Design = {
  activationStatus: string;
  designDigest: string;
};

type Lindung24Classification = {
  status: string;
  approvalStatus: string;
  classificationDigest: string;
  candidateDigest: string;
  classifications: unknown[];
};

type Lindung24SourceRegister = {
  reviewDigest: string;
  sources: unknown[];
};

type EpfClassificationCandidate = {
  status: string;
  approvalStatus: string;
  classificationDigest: string;
  candidateDigest: string;
  unresolvedComponentCount: number;
  activation: { allowed: boolean };
  classifications: unknown[];
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
