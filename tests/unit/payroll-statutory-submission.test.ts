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

test("first release does not generate CP39 even when all legacy validation fields are present", () => {
  assert.equal(validateStatutorySubmission("PCB", profile, run).ready, true);
  assert.throws(() => buildOfficialSubmissionFile("PCB", profile, run), /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
});

test("explicit PCB and CP38 amounts cannot unlock official CP39 bytes", () => {
  assert.throws(() => buildOfficialSubmissionFile("PCB", profile, run), /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
  assert.equal(statutorySubmissionFileName("PCB", profile, run), "000065432108_2026.txt");
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

test("CP39 blocks identity normalization or truncation instead of silently changing official identifiers", () => {
  const invalid = structuredClone(run);
  invalid.entries[0].employeeCode = "EMP-001";
  invalid.entries[0].membership.taxIdentificationNumber = "123-45678901";
  invalid.entries[0].membership.statutoryIdentityType = "PASSPORT";
  invalid.entries[0].membership.statutoryIdentityNumber = "P123456789012";
  invalid.entries[0].membership.statutoryCountryCode = "MY";
  invalid.entries[0].fullName = "A".repeat(61);
  const result = validateStatutorySubmission("PCB", profile, invalid);
  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.errors.map((item) => item.code)),
    new Set(["TIN_INVALID", "PASSPORT_INVALID", "EMPLOYEE_CODE_INVALID", "EMPLOYEE_NAME_TOO_LONG"]),
  );
  assert.throws(() => buildOfficialSubmissionFile("PCB", profile, invalid), /PCB_OFFICIAL_EXPORT_NOT_ENABLED/);
});
