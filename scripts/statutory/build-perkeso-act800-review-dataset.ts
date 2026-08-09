import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalDigest } from "../../src/lib/payroll/statutory-artifact-pipeline";

const artifactSha256 = "3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a";
const upperBounds = [
  3_000,
  5_000,
  7_000,
  10_000,
  14_000,
  20_000,
  ...Array.from({ length: 58 }, (_, index) => (300 + index * 100) * 100),
  null,
] as const;
const employeeOrEmployerCents = [
  5,
  10,
  15,
  20,
  25,
  35,
  50,
  70,
  90,
  ...Array.from({ length: 55 }, (_, index) => 110 + index * 20),
  1190,
] as const;

const rows = upperBounds.map((upperInclusiveCents, index) => ({
  key: `ACT800-${String(index + 1).padStart(2, "0")}`,
  lowerInclusiveCents: index === 0 ? 0 : (upperBounds[index - 1] as number) + 1,
  upperInclusiveCents,
  contributions: {
    eisEmployerCents: employeeOrEmployerCents[index],
    eisEmployeeCents: employeeOrEmployerCents[index],
  },
  sourceReference: `official image table row ${index + 1}`,
}));

const datasetWithoutDigest = {
  schemaVersion: 1 as const,
  id: "perkeso-act800-2024-10-review-v1",
  schemes: ["EIS" as const],
  artifactId: "perkeso-act800-2024-10",
  artifactSha256,
  parserName: "perkeso-act800-image-table",
  parserVersion: "1.0.0",
  extractionMode: "MANUALLY_TRANSCRIBED" as const,
  verificationStatus: "REVIEW_REQUIRED" as const,
  expectedRowCount: 65,
  rows,
};
const dataset = {
  ...datasetWithoutDigest,
  datasetDigest: canonicalDigest(datasetWithoutDigest),
};
const outputPath = resolve(
  process.argv[2] ?? "statutory/official/datasets/perkeso-act800-2024-10.review.json",
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(`Wrote review-required dataset: ${outputPath}`);
