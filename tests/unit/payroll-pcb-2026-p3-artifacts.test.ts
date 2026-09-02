import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const p3 = resolve(root, "statutory/official/certifications/pcb-2026-p3");

async function json(path: string) {
  return JSON.parse(await readFile(resolve(p3, path), "utf8"));
}

test("P3 binds the READY P2 certification and retained official source hashes", async () => {
  const manifest = await json("manifest.json");
  const p2Bytes = await readFile(resolve(root, "statutory/official/certifications/pcb-2026-p2/manifest.json"));
  assert.equal(manifest.p2CertificationDigest, createHash("sha256").update(p2Bytes).digest("hex"));
  assert.equal(manifest.productionTouched, false);
  assert.equal(manifest.testingBusinessDataChanged, false);
});

test("P3 official artifact matrix is the retained Q1-Q5 matrix", async () => {
  const manifest = await json("manifest.json");
  assert.deepEqual(manifest.officialArtifactMatrix.Q1.calculationDetail, ["2026-07", "2026-10"]);
  assert.deepEqual(manifest.officialArtifactMatrix.Q4.payslip, ["2026-10", "2026-12"]);
  assert.deepEqual(manifest.officialArtifactMatrix.Q5.calculationDetail, ["2026-01", "2026-02"]);
});

test("all ten Calculation Detail PDFs and structured sources are certification ready", async () => {
  const expected = { q1: ["07", "10"], q2: ["03", "09"], q3: ["09", "11"], q4: ["08", "11"], q5: ["01", "02"] };
  for (const [question, months] of Object.entries(expected)) {
    for (const month of months) {
      const source = await json(`${question}/calculation-detail/${question}-2026-${month}-calculation-detail.json`);
      assert.equal(source.status, "CERTIFICATION_READY");
      assert.equal(source.facts.finalPcbCents >= 0, true);
      assert.equal(source.rounding.truncatedToSenCents >= 0, true);
      assert.equal(source.rounding.roundedUpToFiveSenCents >= 0, true);
      const pdf = await readFile(resolve(p3, `${question}/calculation-detail/${question}-2026-${month}-calculation-detail.pdf`));
      assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    }
  }
});

test("all seven official-question payslips use the canonical renderer and P2 PCB", async () => {
  const expected = { q1: ["07", "12"], q2: ["03"], q3: ["09"], q4: ["10", "12"], q5: ["01"] };
  for (const [question, months] of Object.entries(expected)) {
    for (const month of months) {
      const source = await json(`${question}/payslip/${question}-2026-${month}-payslip.json`);
      assert.equal(source.renderer, "CANONICAL_PAYSLIP_RENDERER_2026");
      assert.equal(source.netCents, source.grossCents - source.epfCents - source.zakatCents - source.pcbCents);
    }
  }
});

test("Q1 and Q4 EA equivalents exclude previous-employer amounts and disclose their limitation", async () => {
  for (const question of ["q1", "q4"]) {
    const source = await json(`${question}/ea/${question}-ea-testing-question-evidence.json`);
    assert.equal(source.previousEmployerAmountsIncluded, false);
    assert.match(source.label, /SYSTEM-GENERATED EQUIVALENT/);
    assert.match(source.limitation, /does not claim generic EA compliance/);
  }
});

test("Q2 PCB 2(II) refuses to invent mandatory official identity fields", async () => {
  const source = await json("q2/pcb-2ii/q2-pcb-2ii-structured-source.json");
  assert.equal(source.status, "WAITING_FOR_APPLICANT_IDENTITY_AND_TRANSACTION_EVIDENCE");
  assert.equal(source.employeeTin, null);
  assert.equal(source.employerNumber, null);
  assert.equal(source.deductions.length, 4);
});

test("Q1 Q3 and Q4 CP39 generation is blocked before the canonical exporter receives invented IDs", async () => {
  for (const [question, month] of [["q1", "2026-10"], ["q3", "2026-11"], ["q4", "2026-12"]]) {
    const source = await json(`${question}/text-file/${question}-${month}-cp39-blocker.json`);
    assert.equal(source.status, "BLOCKED_MISSING_OFFICIAL_IDENTITIES");
    assert.equal(source.requiredFormat, "LHDN_CP39_EXHIBIT_4_2026");
    assert.ok(source.missingRequiredFields.length >= 5);
  }
});

test("P3 generated artifact hashes are byte-accurate", async () => {
  const manifest = await json("manifest.json");
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(resolve(root, artifact.repositoryPath));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("Q5 January and February bind the certified RM500 monthly housing-interest allocation", async () => {
  const p2 = await json("../pcb-2026-p2/manifest.json");
  assert.equal(p2.q5HousingLoanInterestAllocation.monthlyAmountCents, 50_000);
  for (const month of ["01", "02"]) {
    const source = await json(`q5/calculation-detail/q5-2026-${month}-calculation-detail.json`);
    assert.equal(source.facts.housingLoanInterestReliefCents, 50_000);
    assert.match(source.facts.nonCashOrExemptContext.join(" "), /RM500 monthly housing-loan interest/);
  }
});

test("P3 verdict is PARTIAL only because official identities and submission-format clarification remain", async () => {
  const manifest = await json("manifest.json");
  assert.equal(manifest.verdict, "PARTIAL");
  assert.deepEqual(manifest.openClarifications.map((item: { code: string }) => item.code), [
    "APPLICANT_AND_EMPLOYEE_IDENTITY_INPUT_REQUIRED",
    "HASIL_COUNTRY_CODE_LIST_NOT_RETAINED",
    "SUBMISSION_FORMAT_CLARIFICATION_STILL_REQUIRED",
  ]);
});
