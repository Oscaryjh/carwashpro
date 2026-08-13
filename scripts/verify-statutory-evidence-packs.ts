import { loadStatutoryOfficialEvidencePacks } from "../src/lib/payroll/statutory-evidence-pack";

async function main() {
  const results = await loadStatutoryOfficialEvidencePacks();
  for (const result of results) {
    console.log([
      result.scheme,
      `EVIDENCE_PACK=${result.evidencePack}`,
      `ENGINEERING=${result.engineering}`,
      `HUMAN_SIGN_OFF=${result.humanSignOff}`,
      `ACTIVATION=${result.activation}`,
      `ARTIFACTS=${result.verifiedArtifactCount}/${result.artifactCount}`,
      `OFFICIAL_BACKED_FIXTURES=${result.fixtureProvenance.OFFICIAL_BACKED}`,
      `UNKNOWNS=${result.unknownComponents.length}`,
      `DIGEST=${result.evidenceDigest}`,
      `BLOCKERS=${result.blockers.join(",") || "NONE"}`,
    ].join(" "));
  }
  if (results.some((result) => result.evidencePack !== "COMPLETE")) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
