import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialSubmissionFile,
  statutorySubmissionFileName,
  validateStatutorySubmission,
  type StatutoryBusinessProfile,
  type StatutorySubmissionRun,
} from "../../src/lib/payroll/statutory-submission";

const profile: StatutoryBusinessProfile = {
  epfEmployerNumber: "E1234567",
  perkesoEmployerCode: "A12345678901",
  perkesoRegistrationNumber: "202601234567",
  lhdnEmployerNumberHq: "0000123456",
  lhdnEmployerNumber: "0000654321",
};

const run: StatutorySubmissionRun = {
  id: "run-1",
  status: "FINALIZED",
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  entries: [{
    id: "entry-1",
    membershipId: "member-1",
    employeeCode: "EMP001",
    fullName: "Oscar Staff",
    epfWageBase: 3250,
    perkesoWageBase: 3250,
    epfEmployee: 359,
    employerEpf: 424,
    socsoEmployee: 16.25,
    employerSocso: 56.85,
    eisEmployee: 6.5,
    employerEis: 6.5,
    lindung24Employee: 0,
    pcb: 12.5,
    cp38: 7.25,
    membership: {
      statutoryIdentityType: "NEW_IC",
      statutoryIdentityNumber: "900101145555",
      statutoryCountryCode: null,
      epfMemberNumber: "123456789",
      socsoMemberNumber: null,
      taxIdentificationNumber: "12345678901",
    },
  }],
};

test("all three official statutory exports require a finalized and complete profile", () => {
  for (const provider of ["EPF", "PERKESO", "PCB"] as const) {
    const result = validateStatutorySubmission(provider, profile, run);
    assert.equal(result.ready, true, `${provider}: ${result.errors.map((issue) => issue.message).join(", ")}`);
    assert.equal(result.eligibleEntries.length, 1);
  }
});

test("KWSP e-Caruman CSV uses the official six-column order", () => {
  const csv = buildOfficialSubmissionFile("EPF", profile, run).toString("utf8");
  assert.equal(csv, "Oscar Staff,900101-14-5555,123456789,3250.00,424,359\r\n");
});

test("PERKESO combined v2.0 record is exactly 278 characters", () => {
  const text = buildOfficialSubmissionFile("PERKESO", profile, run).toString("utf8");
  const line = text.replace(/\r\n$/, "");
  assert.equal(line.length, 278);
  assert.equal(line.slice(0, 12), "A12345678901");
  assert.equal(line.slice(194, 200), "082026");
  assert.equal(line.slice(200, 214), "00000000325000");
  assert.equal(line.slice(214, 220), "005685");
  assert.equal(line.slice(220, 226), "001625");
});

test("LHDN CP39 file has a 57-character header and 136-character detail", () => {
  const text = buildOfficialSubmissionFile("PCB", profile, run).toString("utf8");
  const [header, detail] = text.replace(/\r\n$/, "").split("\r\n");
  assert.equal(header.length, 57);
  assert.equal(detail.length, 136);
  assert.equal(header.slice(0, 1), "H");
  assert.equal(header.slice(21, 27), "202608");
  assert.equal(detail.slice(0, 1), "D");
  assert.equal(detail.slice(1, 12), "12345678901");
  assert.equal(detail.slice(84, 96), "900101145555");
  assert.equal(header.slice(27, 37), "0000001250");
  assert.equal(header.slice(37, 42), "00001");
  assert.equal(header.slice(42, 52), "0000000725");
  assert.equal(header.slice(52, 57), "00001");
  assert.equal(detail.slice(110, 118), "00001250");
  assert.equal(detail.slice(118, 126), "00000725");
  assert.equal(statutorySubmissionFileName("PCB", profile, run), "000065432108_2026.txt");
});

test("LHDN CP39 Exhibit 4 output is byte-stable for PCB and CP38 amounts", () => {
  const text = buildOfficialSubmissionFile("PCB", profile, run).toString("utf8");
  const expectedHeader =
    "H00001234560000654321202608000000125000001000000072500001";
  const expectedDetail = [
    "D",
    "12345678901",
    "Oscar Staff".padEnd(60, " "),
    " ".repeat(12),
    "900101145555",
    " ".repeat(12),
    "  ",
    "00001250",
    "00000725",
    "EMP001".padEnd(10, " "),
  ].join("");
  assert.deepEqual(Buffer.from(text, "utf8"), Buffer.from(`${expectedHeader}\r\n${expectedDetail}\r\n`, "utf8"));
});

test("validation lists employee-specific blocking fields instead of guessing", () => {
  const incomplete = structuredClone(run);
  incomplete.entries[0].membership.taxIdentificationNumber = null;
  incomplete.entries[0].membership.statutoryIdentityNumber = null;
  const result = validateStatutorySubmission("PCB", profile, incomplete);
  assert.equal(result.ready, false);
  assert.deepEqual(new Set(result.errors.map((issue) => issue.code)), new Set(["IDENTITY_MISSING", "TIN_INVALID"]));
  assert.equal(result.errors[0]?.employeeName, "Oscar Staff");
});

test("draft payroll never produces an official file", () => {
  const draft = { ...run, status: "DRAFT" as const };
  const result = validateStatutorySubmission("EPF", profile, draft);
  assert.equal(result.ready, false);
  assert.equal(result.errors[0]?.code, "RUN_NOT_FINALIZED");
  assert.throws(() => buildOfficialSubmissionFile("EPF", profile, draft), /Only finalized payroll/);
});
