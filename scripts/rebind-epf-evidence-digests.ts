import { readFile, writeFile } from "node:fs/promises";
import {
  canonicalDigest,
  contributionDatasetDigest,
  goldenCertificationDigest,
  goldenFixtureDigest,
  independentReviewDigest,
  type GoldenFixtureCertificationRecord,
  type GoldenFixtureSet,
  type IndependentDatasetReviewRecord,
  type NormalizedContributionDataset,
} from "../src/lib/payroll/statutory-artifact-pipeline";

const paths = {
  dataset: "statutory/official/datasets/kwsp-third-schedule-2025-10.json",
  fixtures: "statutory/official/fixtures/kwsp-third-schedule-2025-10-golden-v1.json",
  review: "statutory/official/reviews/kwsp-third-schedule-2025-10-independent-review.json",
  certification:
    "statutory/official/certifications/kwsp-third-schedule-2025-10-golden-certification.json",
  candidate:
    "statutory/official/classifications/malaysia-epf-2025-10-signoff-candidate-v1.json",
  readiness: "statutory/official/p2c-readiness.json",
} as const;

async function main() {
  const dataset = await readJson<NormalizedContributionDataset>(paths.dataset);
  dataset.datasetDigest = contributionDatasetDigest(dataset);

  const fixtures = await readJson<GoldenFixtureSet>(paths.fixtures);
  fixtures.fixtureDigest = goldenFixtureDigest(fixtures);

  const review = await readJson<IndependentDatasetReviewRecord>(paths.review);
  review.baselineDatasetDigest = dataset.datasetDigest;
  review.certifiedDatasetDigest = dataset.datasetDigest;
  review.reviewDigest = independentReviewDigest(review);

  const certification = await readJson<GoldenFixtureCertificationRecord>(paths.certification);
  certification.datasetDigest = dataset.datasetDigest;
  certification.fixtureDigest = fixtures.fixtureDigest;
  certification.certificationDigest = goldenCertificationDigest(certification);

  const candidate = await readJson<EpfCandidate>(paths.candidate);
  candidate.evidence.datasetDigest = dataset.datasetDigest;
  candidate.evidence.independentReviewDigest = review.reviewDigest;
  candidate.evidence.fixtureDigest = fixtures.fixtureDigest;
  candidate.evidence.goldenCertificationDigest = certification.certificationDigest;
  candidate.classificationDigest = canonicalDigest(candidate.classifications);
  candidate.candidateDigest = canonicalDigest(without(candidate, "candidateDigest"));
  const readiness = await readJson<Readiness>(paths.readiness);
  readiness.readinessDigest = canonicalDigest(without(readiness, "readinessDigest"));

  await Promise.all([
    writeJson(paths.dataset, dataset),
    writeJson(paths.fixtures, fixtures),
    writeJson(paths.review, review),
    writeJson(paths.certification, certification),
    writeJson(paths.candidate, candidate),
    writeJson(paths.readiness, readiness),
  ]);
  console.log({
    datasetDigest: dataset.datasetDigest,
    fixtureDigest: fixtures.fixtureDigest,
    reviewDigest: review.reviewDigest,
    certificationDigest: certification.certificationDigest,
    classificationDigest: candidate.classificationDigest,
    candidateDigest: candidate.candidateDigest,
  });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function without(value: object, field: string) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

type EpfCandidate = {
  evidence: {
    datasetDigest: string;
    independentReviewDigest: string;
    fixtureDigest: string;
    goldenCertificationDigest: string;
  };
  classifications: unknown[];
  classificationDigest: string;
  candidateDigest: string;
};

type Readiness = { readinessDigest: string };

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
