import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalDigest,
  type GoldenFixtureSet,
  type NormalizedContributionDataset,
} from "../../src/lib/payroll/statutory-artifact-pipeline";

const root = resolve(process.cwd(), "statutory/official");
const act4 = readDataset("datasets/perkeso-act4-lindung24-2026-06.json");
const act800 = readDataset("datasets/perkeso-act800-2024-10.review.json");
const selectedRows = [0, 1, 8, 9, 63, 64];

writeFixtureSet({
  schemaVersion: 1,
  id: "perkeso-act4-2026-06-boundaries-review-v1",
  scheme: "SOCSO",
  ruleVersion: "PERKESO_ACT4_SKBBK_2026_06",
  artifactId: act4.artifactId,
  artifactSha256: act4.artifactSha256,
  verificationStatus: "REVIEW_REQUIRED",
  fixtures: selectedRows.flatMap((rowIndex) => {
    const row = act4.rows[rowIndex];
    const wageCents = row.upperInclusiveCents ?? 600_001;
    return (["FIRST", "SECOND"] as const).map((category) => ({
      id: `socso-${row.key.toLowerCase()}-${category.toLowerCase()}`,
      sourceReference: row.sourceReference,
      input: { wageCents, category },
      expected:
        category === "FIRST"
          ? {
              employeeCents: row.contributions.socsoEmployeeFirstCents,
              employerCents: row.contributions.socsoEmployerFirstCents,
              matchedRowKey: row.key,
            }
          : {
              employeeCents: 0,
              employerCents: row.contributions.socsoEmployerSecondCents,
              matchedRowKey: row.key,
            },
    }));
  }),
});

writeFixtureSet({
  schemaVersion: 1,
  id: "perkeso-lindung24-2026-06-boundaries-review-v1",
  scheme: "LINDUNG24",
  ruleVersion: "PERKESO_LINDUNG24_PHASE1_2026_06",
  artifactId: act4.artifactId,
  artifactSha256: act4.artifactSha256,
  verificationStatus: "REVIEW_REQUIRED",
  fixtures: selectedRows.map((rowIndex) => {
    const row = act4.rows[rowIndex];
    return {
      id: `lindung24-${row.key.toLowerCase()}`,
      sourceReference: row.sourceReference,
      input: { wageCents: row.upperInclusiveCents ?? 600_001, phase: 1 },
      expected: {
        employeeCents: row.contributions.lindung24EmployeeCents,
        employerCents: 0,
        matchedRowKey: row.key,
      },
    };
  }),
});

writeFixtureSet({
  schemaVersion: 1,
  id: "perkeso-act800-2024-10-boundaries-review-v1",
  scheme: "EIS",
  ruleVersion: "PERKESO_ACT800_2024_10",
  artifactId: act800.artifactId,
  artifactSha256: act800.artifactSha256,
  verificationStatus: "REVIEW_REQUIRED",
  fixtures: selectedRows.map((rowIndex) => {
    const row = act800.rows[rowIndex];
    return {
      id: `eis-${row.key.toLowerCase()}`,
      sourceReference: row.sourceReference,
      input: { wageCents: row.upperInclusiveCents ?? 600_001 },
      expected: {
        employeeCents: row.contributions.eisEmployeeCents,
        employerCents: row.contributions.eisEmployerCents,
        matchedRowKey: row.key,
      },
    };
  }),
});

function readDataset(relativePath: string): NormalizedContributionDataset {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function writeFixtureSet(
  input: Omit<GoldenFixtureSet, "fixtureDigest">,
) {
  const fixtureSet: GoldenFixtureSet = {
    ...input,
    fixtureDigest: canonicalDigest(input),
  };
  const path = resolve(root, "fixtures", `${input.id}.json`);
  mkdirSync(resolve(root, "fixtures"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixtureSet, null, 2)}\n`, "utf8");
  console.log(`Wrote review-required fixture set: ${path}`);
}
