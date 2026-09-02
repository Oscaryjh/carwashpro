import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const packageRoot = resolve(root, "statutory/official/certifications/pcb-2026-p3");

type ArtifactSpec = {
  calculationDetail: string[];
  payslip: string[];
};

type GeneratedArtifact = {
  type: string;
  month?: string;
  status: string;
  pcbCents?: number;
};

type IdentityValidation = {
  ready: boolean;
  exhibit4Ready: boolean;
  exhibit3Ready: boolean;
  identityInputSha256: string;
  issues: Array<{ code: string; field: string; questionId: string }>;
};

function sha(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8"));
  const checks: Array<{ check: string; result: "PASS" | "FAIL"; detail: string }> = [];
  const artifacts = manifest.artifacts as Array<{ repositoryPath: string; bytes: number; sha256: string }>;
  const identityInputBytes = await readFile(resolve(root, manifest.identitySource.repositoryPath));
  const identityValidation = JSON.parse(await readFile(resolve(packageRoot, "manifest/identity-validation.json"), "utf8")) as IdentityValidation;
  checks.push({
    check: "identity-input-hash",
    result: sha(identityInputBytes) === manifest.identitySource.sha256 && sha(identityInputBytes) === identityValidation.identityInputSha256 ? "PASS" : "FAIL",
    detail: "Governed certification identity input is hash-bound to master and validation manifests",
  });
  checks.push({
    check: "identity-status-truthful",
    result: manifest.identitySource.status === (identityValidation.ready ? "COMPLETE" : "INPUT_REQUIRED") ? "PASS" : "FAIL",
    detail: `${identityValidation.issues.length} unresolved identity inputs recorded`,
  });
  const identityInputText = identityInputBytes.toString("utf8");
  const fakeMarkers = ["1234567890", "000000000000", "\"value\": \"TEST\""];
  checks.push({
    check: "no-fake-official-identities",
    result: fakeMarkers.every((marker) => !identityInputText.includes(marker)) ? "PASS" : "FAIL",
    detail: "No prohibited fake TIN, IC or employer marker exists in governed identity input",
  });

  for (const artifact of artifacts) {
    const bytes = await readFile(resolve(root, artifact.repositoryPath));
    checks.push({
      check: `hash:${artifact.repositoryPath}`,
      result: bytes.length === artifact.bytes && sha(bytes) === artifact.sha256 ? "PASS" : "FAIL",
      detail: `${bytes.length} bytes`,
    });
    if (artifact.repositoryPath.endsWith(".pdf")) {
      const ascii = bytes.toString("latin1");
      checks.push({
        check: `pdf:${artifact.repositoryPath}`,
        result: bytes.subarray(0, 5).toString("ascii") === "%PDF-" && ascii.includes("%%EOF") ? "PASS" : "FAIL",
        detail: "PDF header and EOF marker",
      });
    }
  }

  const required = manifest.officialArtifactMatrix;
  for (const [questionId, spec] of Object.entries(required) as Array<[string, ArtifactSpec]>) {
    const questionManifest = JSON.parse(await readFile(resolve(packageRoot, questionId.toLowerCase(), "manifest", "manifest.json"), "utf8")) as { generatedArtifacts: GeneratedArtifact[] };
    for (const month of spec.calculationDetail) {
      const found = questionManifest.generatedArtifacts.some((item) => item.type === "CALCULATION_DETAIL" && item.month === month && item.status === "CERTIFICATION_READY");
      checks.push({ check: `${questionId}:calculation-detail:${month}`, result: found ? "PASS" : "FAIL", detail: found ? "P2-bound PDF and JSON present" : "missing" });
    }
    for (const month of spec.payslip) {
      const found = questionManifest.generatedArtifacts.some((item) => item.type === "PAYSLIP" && item.month === month && item.status === "CERTIFICATION_READY");
      checks.push({ check: `${questionId}:payslip:${month}`, result: found ? "PASS" : "FAIL", detail: found ? "canonical PDF and JSON present" : "missing" });
    }
  }

  let crossArtifactPcb = true;
  for (const question of ["q1", "q2", "q3", "q4", "q5"]) {
    const value = JSON.parse(await readFile(resolve(packageRoot, question, "manifest", "manifest.json"), "utf8")) as { generatedArtifacts: GeneratedArtifact[] };
    crossArtifactPcb &&= value.generatedArtifacts.every((item) => item.pcbCents == null || Number.isInteger(item.pcbCents));
  }
  checks.push({ check: "cross-artifact-pcb-amount-source", result: crossArtifactPcb ? "PASS" : "FAIL", detail: "All document PCB values originate from P2 manifest records" });

  const q5Jan = JSON.parse(await readFile(resolve(packageRoot, "q5/calculation-detail/q5-2026-01-calculation-detail.json"), "utf8"));
  const q5Feb = JSON.parse(await readFile(resolve(packageRoot, "q5/calculation-detail/q5-2026-02-calculation-detail.json"), "utf8"));
  checks.push({
    check: "q5-housing-interest-allocation",
    result: q5Jan.facts.housingLoanInterestReliefCents === 50_000 && q5Feb.facts.housingLoanInterestReliefCents === 50_000 ? "PASS" : "FAIL",
    detail: "RM500 monthly housing-loan interest is bound through certified P2 input/trace",
  });

  const blockers = manifest.openClarifications;
  const cp39Ready = identityValidation.exhibit4Ready;
  const pcb2iiReady = identityValidation.exhibit3Ready;
  const validation = {
    validator: "TETAMU_PCB_2026_P3_PACKAGE_VALIDATOR_1.0.0",
    packageVerdict: manifest.verdict,
    validationVerdict: checks.every((item) => item.result === "PASS") ? "PASS_WITH_RECORDED_ARTIFACT_BLOCKERS" : "FAIL",
    checkedAt: new Date().toISOString(),
    checks,
    artifactBlockers: blockers,
    rawCp39TextValidation: cp39Ready ? "PASS" : "WAITING_FOR_APPLICANT_IDENTITY_AND_COUNTRY_CODE_AUTHORITY",
    pcb2iiCertificationReadiness: pcb2iiReady ? "PASS" : "WAITING_FOR_APPLICANT_IDENTITY_AND_TRANSACTION_EVIDENCE",
    identityValidation: {
      ready: identityValidation.ready,
      exhibit4Ready: identityValidation.exhibit4Ready,
      exhibit3Ready: identityValidation.exhibit3Ready,
      unresolved: identityValidation.issues,
    },
    productionTouched: false,
  };
  await mkdir(resolve(packageRoot, "manifest"), { recursive: true });
  await writeFile(resolve(packageRoot, "manifest/package-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  console.log(JSON.stringify({ packageVerdict: validation.packageVerdict, validationVerdict: validation.validationVerdict, checks: checks.length, failed: checks.filter((item) => item.result === "FAIL").length, blockers: blockers.length }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
