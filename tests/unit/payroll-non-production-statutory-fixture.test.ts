import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  assertStatutoryEvidenceReadAllowed,
  assertStatutoryEvidenceWriteAllowed,
  SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION,
  validateStatutoryEvidenceProvenance,
} from "../../src/lib/payroll/statutory-evidence";
import {
  buildPayslipPdf,
  buildStatutoryExport,
  type PayrollDocumentEntry,
  type PayrollDocumentRun,
} from "../../src/lib/payroll/export";
import { recordEmployeeLindung24Participation } from "../../src/lib/payroll/lindung24-participation-service";

const testingEnv = { APP_ENVIRONMENT: "testing" };
const productionEnv = { APP_ENVIRONMENT: "production" };

test("synthetic evidence is allowed only outside production", () => {
  assert.doesNotThrow(() =>
    assertStatutoryEvidenceWriteAllowed("SYNTHETIC_TESTING", testingEnv),
  );
  assert.throws(
    () => assertStatutoryEvidenceWriteAllowed("SYNTHETIC_TESTING", productionEnv),
    new RegExp(SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION),
  );
  assert.throws(
    () => assertStatutoryEvidenceReadAllowed(
      { evidenceNature: "SYNTHETIC_TESTING" },
      productionEnv,
    ),
    new RegExp(SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION),
  );
  assert.doesNotThrow(() =>
    assertStatutoryEvidenceReadAllowed({ evidenceNature: "REAL" }, productionEnv),
  );
});

test("real and synthetic provenance have disjoint contracts", () => {
  assert.doesNotThrow(() => validateStatutoryEvidenceProvenance({
    evidenceNature: "REAL",
    evidenceEnvironment: null,
    fixturePurpose: null,
    officialExportEligible: true,
    statutoryNationalitySnapshot: null,
  }));
  assert.doesNotThrow(() => validateStatutoryEvidenceProvenance({
    evidenceNature: "SYNTHETIC_TESTING",
    evidenceEnvironment: "TESTING",
    fixturePurpose: "PAYROLL_PAYSLIP_UAT",
    officialExportEligible: false,
    statutoryNationalitySnapshot: "MALAYSIAN",
  }));
  assert.throws(() => validateStatutoryEvidenceProvenance({
    evidenceNature: "SYNTHETIC_TESTING",
    evidenceEnvironment: "TESTING",
    fixturePurpose: "PAYROLL_PAYSLIP_UAT",
    officialExportEligible: true,
    statutoryNationalitySnapshot: "MALAYSIAN",
  }), /STATUTORY_EVIDENCE_CONTRACT_INVALID/);
});

test("production rejects a synthetic canonical write before any database access", async () => {
  await assert.rejects(
    recordEmployeeLindung24Participation(
      {
        command: {
          act4Covered: true,
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          employerContext: "SINGLE_EMPLOYER",
          evidenceNature: "SYNTHETIC_TESTING",
          evidenceEnvironment: "TESTING",
          fixturePurpose: "PAYROLL_PAYSLIP_UAT",
          statutoryNationalitySnapshot: "MALAYSIAN",
          expectedRevision: 0,
          membershipId: "00000000-0000-4000-8000-000000000001",
          officialSubmittedAt: null,
          reason: "Testing payroll and payslip fixture",
          selectedEmployer: "CURRENT_BUSINESS",
          sourceReference: null,
          sourceType: null,
          status: "DEFAULT_PARTICIPATING",
        },
        context: {} as never,
      },
      {} as PrismaClient,
      { environment: productionEnv },
    ),
    new RegExp(SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION),
  );
});

test("testing payslip is visibly marked and official statutory export is denied", () => {
  const entry = documentEntry();
  const run = documentRun(entry);
  const pdf = buildPayslipPdf(run, entry).toString("latin1");
  assert.match(pdf, /TESTING \/ NON-PRODUCTION STATUTORY FIXTURE/);
  assert.throws(
    () => buildStatutoryExport({ ...run, entries: [entry] }, "csv"),
    /SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE/,
  );
});

test("payslip distinguishes calculated zero from PCB that was not configured", () => {
  const entry = documentEntry();
  entry.epfEmployee = 330;
  entry.socsoEmployee = 14.75;
  entry.eisEmployee = 5.9;
  entry.lindung24Employee = 0;
  entry.employerEpf = 390;
  entry.employerSocso = 51.65;
  entry.employerEis = 5.9;
  entry.netPay = 2649.35;
  entry.statutorySnapshots = [
    {
      scheme: "EPF",
      status: "CALCULATED",
      blockerCode: null,
      employeeContribution: 330,
      employerContribution: 390,
    },
    {
      scheme: "SOCSO",
      status: "CALCULATED",
      blockerCode: null,
      employeeContribution: 14.75,
      employerContribution: 51.65,
    },
    {
      scheme: "EIS",
      status: "CALCULATED",
      blockerCode: null,
      employeeContribution: 5.9,
      employerContribution: 5.9,
    },
    {
      scheme: "LINDUNG24",
      status: "CALCULATED",
      blockerCode: null,
      employeeContribution: 0,
      employerContribution: 0,
    },
    {
      scheme: "PCB",
      status: "BLOCKED",
      blockerCode: "PCB_PROFILE_INCOMPLETE",
      employeeContribution: 0,
      employerContribution: 0,
    },
  ];
  const pdf = buildPayslipPdf(documentRun(entry), entry).toString("latin1");
  assertPdfRow(pdf, "EPF (Employee)", "RM 330.00");
  assertPdfRow(pdf, "SOCSO (Employee)", "RM 14.75");
  assertPdfRow(pdf, "EIS (Employee)", "RM 5.90");
  assertPdfRow(pdf, "LINDUNG24", "RM 0.00");
  assert.ok(pdf.includes("PCB \/ MTD: Pending configuration"));
  assert.doesNotMatch(pdf, /PCB \/ MTD: RM0\.00/);
  assertPdfRow(pdf, "Current deductions (excludes pending PCB)", "RM 350.65");
  assertPdfRow(pdf, "ESTIMATED NET PAY (BEFORE PCB)", "RM 2,649.35");
  assertPdfRow(pdf, "EPF (Employer)", "RM 390.00");
  assertPdfRow(pdf, "SOCSO (Employer)", "RM 51.65");
  assertPdfRow(pdf, "EIS (Employer)", "RM 5.90");
  assertPdfRow(pdf, "TOTAL EMPLOYER CONTRIBUTIONS", "RM 447.55");
});

function assertPdfRow(pdf: string, label: string, amount: string) {
  const encodedLabel = `(${pdfText(label)}) Tj`;
  const encodedAmount = `(${pdfText(amount)}) Tj`;
  const labelIndex = pdf.indexOf(encodedLabel);
  const amountIndex = pdf.indexOf(encodedAmount, Math.max(0, labelIndex));
  assert.ok(labelIndex >= 0, `Missing PDF row label: ${label}`);
  assert.ok(
    amountIndex > labelIndex && amountIndex - labelIndex < 320,
    `Missing paired PDF row amount for ${label}: ${amount}`,
  );
}

function pdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

test("migration enforces evidence, immutability and exportability contracts", () => {
  const migration = readFileSync(
    "prisma/migrations/20260826173000_non_production_statutory_fixture_evidence_facility/migration.sql",
    "utf8",
  );
  assert.match(migration, /StatutoryEvidenceNature/);
  assert.match(migration, /SYNTHETIC_TESTING/);
  assert.match(migration, /official_export_eligible/);
  assert.match(migration, /source_type" IS NULL/);
  assert.match(migration, /statutory_nationality_snapshot" IS NOT NULL/);
  assert.match(migration, /LINDUNG24_PARTICIPATION_VERSION_IMMUTABLE/);
});

function documentRun(entry: PayrollDocumentEntry): PayrollDocumentRun {
  return {
    id: "run-1",
    business: {
      name: "Testing Salon",
      companyNo: null,
      address: null,
      phone: null,
      email: null,
    },
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    status: "FINALIZED",
    submittedAt: null,
    finalizedAt: new Date("2026-08-31T00:00:00.000Z"),
    entries: [entry],
  };
}

function documentEntry(): PayrollDocumentEntry {
  return {
    id: "entry-1",
    employeeCode: "UAT-1",
    fullName: "Testing Staff",
    payBasis: "MONTHLY",
    attendanceDays: 26,
    regularMinutes: 12_480,
    overtimeMinutes: 0,
    publicHolidayMinutes: 0,
    basicPay: 3000,
    overtimePay: 0,
    publicHolidayPay: 0,
    allowances: 0,
    otherDeductions: 0,
    epfEmployee: 0,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 10,
    pcb: 0,
    cp38: 0,
    employerEpf: 0,
    employerSocso: 0,
    employerEis: 0,
    grossPay: 3000,
    netPay: 2990,
    statutoryStatus: "CALCULATED",
    statutoryRuleVersion: "TEST",
    notes: null,
    statutoryEvidenceNature: "SYNTHETIC_TESTING",
    statutoryEvidenceEnvironment: "TESTING",
    statutoryFixturePurpose: "PAYROLL_PAYSLIP_UAT",
    officialStatutoryExportEligible: false,
  };
}
