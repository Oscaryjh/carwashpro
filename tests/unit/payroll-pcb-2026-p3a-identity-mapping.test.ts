import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import {
  EXHIBIT_3_IDENTITY_FIELDS,
  EXHIBIT_4_IDENTITY_FIELDS,
  buildP3aIdentitySourceMatrix,
  validateP3aCertificationIdentity,
  type PcbCertificationIdentityInput,
} from "../../src/lib/payroll/pcb-certification-identity";

const root = resolve(process.cwd());
const packageRoot = resolve(root, "statutory/official/certifications/pcb-2026-p3");
const inputPath = resolve(root, "statutory/official/fixtures/pcb-2026-p3a-submission-identity.json");

async function json<T>(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

test("Exhibit 4 identity mapping retains exact official positions and widths", () => {
  assert.deepEqual(EXHIBIT_4_IDENTITY_FIELDS.map((item) => [item.officialField, item.start, item.end, item.length]), [
    ["Employer No. (HQ)", 2, 11, 10],
    ["Employer No.", 12, 21, 10],
    ["Tax Identification Number", 2, 12, 11],
    ["Employee's Name", 13, 72, 60],
    ["Old IC No.", 73, 84, 12],
    ["New IC No.", 85, 96, 12],
    ["Passport No.", 97, 108, 12],
    ["Country Code", 109, 110, 2],
    ["Employee No. or Salary No.", 127, 136, 10],
  ]);
});

test("Exhibit 3 identity mapping preserves every labeled employer and employee field", () => {
  assert.deepEqual(EXHIBIT_3_IDENTITY_FIELDS.map((item) => item.officialField), [
    "Cawangan", "Tarikh", "Potongan Cukai Yang Dibuat Dalam Tahun", "Nama Pekerja",
    "No. Kad Pengenalan/No. Passpot", "No. Pengenalan Cukai Pekerja (IG)", "No. Pekerja",
    "No. Majikan (E)", "Nama pegawai", "Jawatan", "No. Telefon", "Nama Dan Alamat Majikan",
  ]);
});

test("governed identity input does not invent applicant or Employee A-D statutory identifiers", async () => {
  const input = await json<PcbCertificationIdentityInput>(inputPath);
  assert.equal(input.applicant.lhdnEmployerNumber.value, null);
  assert.equal(input.applicant.lhdnEmployerNumberHq.value, null);
  for (const questionId of ["Q1", "Q2", "Q3", "Q4"] as const) {
    assert.equal(input.employees[questionId].taxIdentificationNumber.value, null);
    assert.equal(input.employees[questionId].identityNumber.value, null);
    assert.equal(input.employees[questionId].employeeNumber.value, null);
  }
});

test("identity validator reports exact applicant and employee inputs instead of fake placeholders", async () => {
  const input = await json<PcbCertificationIdentityInput>(inputPath);
  const validation = validateP3aCertificationIdentity(input);
  assert.equal(validation.ready, false);
  assert.equal(validation.exhibit4Ready, false);
  assert.equal(validation.exhibit3Ready, false);
  assert.ok(validation.byQuestion.Q1.issues.some((item) => item.code === "EMPLOYER_HQ_REQUIRED"));
  assert.ok(validation.byQuestion.Q2.issues.some((item) => item.code === "PCB_TRANSACTION_REFERENCE_REQUIRED"));
  assert.ok(validation.byQuestion.Q4.issues.some((item) => item.code === "HASIL_COUNTRY_CODE_LIST_NOT_RETAINED"));
});

test("identity source matrix separates official labels, applicant input and certification fixture fields", async () => {
  const input = await json<PcbCertificationIdentityInput>(inputPath);
  const matrix = buildP3aIdentitySourceMatrix(input);
  assert.ok(matrix.some((item) => item.artifact === "CP39_EXHIBIT_4" && item.officialField === "Employer No. (HQ)"));
  assert.ok(matrix.some((item) => item.questionId === "Q2" && item.certificationFixtureField === "employees.Q2.identityNumber"));
  assert.ok(matrix.some((item) => item.questionId === "Q5" && item.status === "NOT_REQUIRED"));
});

test("Q1 Q3 and Q4 blockers list field-level identity causes", async () => {
  for (const [question, month] of [["q1", "2026-10"], ["q3", "2026-11"], ["q4", "2026-12"]] as const) {
    const blocker = await json<{ missingRequiredFields: Array<{ code: string; field: string }> }>(resolve(packageRoot, question, "text-file", `${question}-${month}-cp39-blocker.json`));
    assert.ok(blocker.missingRequiredFields.some((item) => item.code === "EMPLOYER_NUMBER_REQUIRED"));
    assert.ok(blocker.missingRequiredFields.some((item) => item.code === "EMPLOYEE_TIN_REQUIRED"));
  }
});

test("Q2 PCB 2(II) source records identity and transaction evidence gaps", async () => {
  const source = await json<{ status: string; unresolvedIdentityInputs: Array<{ code: string }>; deductions: Array<{ pcbReceiptOrTransactionNumber: string | null }> }>(resolve(packageRoot, "q2/pcb-2ii/q2-pcb-2ii-structured-source.json"));
  assert.equal(source.status, "WAITING_FOR_APPLICANT_IDENTITY_AND_TRANSACTION_EVIDENCE");
  assert.ok(source.unresolvedIdentityInputs.some((item) => item.code === "APPLICANT_FIELD_REQUIRED"));
  assert.ok(source.unresolvedIdentityInputs.some((item) => item.code === "PCB_TRANSACTION_REFERENCE_REQUIRED"));
  assert.ok(source.deductions.every((item) => item.pcbReceiptOrTransactionNumber === null));
});

test("question manifests record identity provenance and unresolved inputs", async () => {
  const manifest = await json<{ identitySource: string; identityStatus: string; unresolvedIdentityInputs: unknown[] }>(resolve(packageRoot, "q4/manifest/manifest.json"));
  assert.equal(manifest.identitySource, "statutory/official/fixtures/pcb-2026-p3a-submission-identity.json");
  assert.equal(manifest.identityStatus, "INPUT_REQUIRED");
  assert.ok(manifest.unresolvedIdentityInputs.length > 0);
});

test("master manifest hash-binds governed identity input", async () => {
  const bytes = await readFile(inputPath);
  const manifest = await json<{ identitySource: { repositoryPath: string; sha256: string; status: string } }>(resolve(packageRoot, "manifest.json"));
  assert.equal(manifest.identitySource.repositoryPath, "statutory/official/fixtures/pcb-2026-p3a-submission-identity.json");
  assert.equal(manifest.identitySource.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(manifest.identitySource.status, "INPUT_REQUIRED");
});

test("P3A identity work leaves every P2-certified PCB amount unchanged", async () => {
  for (const question of ["q1", "q2", "q3", "q4", "q5"] as const) {
    const p2 = await json<{ records: Array<{ month: string; tetamuPcbCents: number }> }>(resolve(root, "statutory/official/certifications/pcb-2026-p2", question, "reconciliation.json"));
    const p3 = await json<{ generatedArtifacts: Array<{ month?: string; pcbCents?: number }> }>(resolve(packageRoot, question, "manifest/manifest.json"));
    for (const artifact of p3.generatedArtifacts.filter((item) => item.month && item.pcbCents != null)) {
      assert.equal(artifact.pcbCents, p2.records.find((item) => item.month === artifact.month)?.tetamuPcbCents);
    }
  }
});
