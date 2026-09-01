import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculatePayrollComponentAggregates } from "../../src/lib/payroll/component-calculation";

test("Staff Pay surfaces never derive deductions from gross minus net", async () => {
  const [payPage, payslipsPage, payslipsView] = await Promise.all([
    readFile("src/app/staff/pay/page.tsx", "utf8"),
    readFile("src/app/staff/payslips/page.tsx", "utf8"),
    readFile("src/components/staff-pwa/staff-payslips-v2.tsx", "utf8"),
  ]);

  for (const source of [payPage, payslipsPage, payslipsView]) {
    assert.doesNotMatch(source, /Deductions/i);
    assert.doesNotMatch(source, /grossPay\)[\s\S]{0,120}-\s*Number\([^)]*netPay/);
  }
  assert.match(payPage, /payrollEntry\.grossPay/);
  assert.match(payPage, /payrollEntry\.netPay/);
  assert.match(payslipsPage, /payrollEntry\.netPay/);
  assert.doesNotMatch(payslipsPage, /payrollEntry\.grossPay/);
  assert.doesNotMatch(payslipsView, /Gross pay|grossPay/);
});

test("a non-wage reimbursement changes net but never gross or canonical deductions", () => {
  const statutoryDeductionsCents = 39_000;
  const reimbursementCents = 12_345;
  const totals = calculatePayrollComponentAggregates([
    {
      lineKey: "SYSTEM:BASIC_SALARY",
      type: "EARNING",
      code: "BASIC_SALARY",
      name: "Basic Salary",
      amountCents: 300_000,
      currency: "MYR",
      sourceType: "BASIC_SALARY",
      sourceId: null,
      sourceVersionId: null,
      sourceRevision: null,
      effectiveFromMonth: null,
      calculationBasis: "MONTHLY",
      origin: "SYSTEM",
      reason: null,
      sortOrder: 100,
    },
  ], {
    epfEmployeeCents: 33_000,
    socsoEmployeeCents: 1_500,
    eisEmployeeCents: 500,
    lindung24EmployeeCents: 0,
    pcbCents: 4_000,
    cp38Cents: 0,
  }, reimbursementCents);

  assert.equal(totals.grossPayCents, 300_000);
  assert.equal(totals.netPayCents, 300_000 - statutoryDeductionsCents + reimbursementCents);
  assert.notEqual(totals.grossPayCents - totals.netPayCents, statutoryDeductionsCents);
});

test("employee commission read model enforces period current revision and safe statuses", async () => {
  const [reader, page] = await Promise.all([
    readFile("src/lib/commission/read.ts", "utf8"),
    readFile("src/app/staff/commission/page.tsx", "utf8"),
  ]);

  assert.match(reader, /statement\."calculation_revision" = period\."current_revision"/);
  assert.match(reader, /businessId: input\.businessId/);
  assert.match(reader, /membershipId: input\.membershipId/);
  assert.match(reader, /"CALCULATED", "APPROVED", "APPLIED_TO_PAYROLL"/);
  assert.doesNotMatch(page, /\bPaid\b/);
  assert.match(page, /Estimated · pending review/);
  assert.match(page, /Approved · frozen/);
  assert.match(page, /Approved · sent to Payroll/);
});

test("payslip download keeps self-service auth, ownership, module and private response guards", async () => {
  const [route, publication, serviceWorker] = await Promise.all([
    readFile("src/app/staff/payslips/[publicationId]/route.ts", "utf8"),
    readFile("src/lib/payroll/payslip-publication.ts", "utf8"),
    readFile("public/sw.js", "utf8"),
  ]);

  assert.match(route, /getEmployeeSelfServiceAuthContext\(request\)/);
  assert.doesNotMatch(route, /getEmployeeAuthContext\(request\)/);
  assert.match(route, /isBusinessModuleEnabled\(auth\.businessId, "PAYROLL"\)/);
  assert.match(route, /businessId: auth\.businessId/);
  assert.match(route, /membershipId: auth\.membershipId/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /Content-Disposition": `attachment;/);
  assert.match(route, /Content-Type": "application\/pdf"/);
  assert.match(publication, /id: input\.publicationId/);
  assert.match(publication, /businessId: input\.businessId/);
  assert.match(publication, /membershipId: input\.membershipId/);
  assert.doesNotMatch(serviceWorker, /staff\/payslips/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/pwa\/"\)/);
});

test("Claim Payroll settlement currently has no canonical closing writer", async () => {
  const [reimbursement, payrollService] = await Promise.all([
    readFile("src/lib/claim/reimbursement.ts", "utf8"),
    readFile("src/lib/payroll/service.ts", "utf8"),
  ]);

  assert.match(reimbursement, /status: "PAYROLL_LINKED"/);
  assert.match(reimbursement, /status: "READY"/);
  assert.doesNotMatch(reimbursement, /PAYROLL_SETTLED/);
  assert.doesNotMatch(reimbursement, /status:\s*"SETTLED"/);
  assert.doesNotMatch(payrollService, /payrollClaimReimbursementSnapshot\.(?:update|updateMany)/);
  assert.doesNotMatch(payrollService, /PAYROLL_SETTLED/);
});
