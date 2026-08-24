import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  getSensitiveActionPolicy,
  SENSITIVE_ACTION_KEYS,
} from "../../src/lib/auth/sensitive-actions";
import { payrollBankAccountHighRisk } from "../../src/lib/payroll/payment/bank-account-security";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

test("Payroll high-risk registry requires true MFA without changing normal actions", () => {
  const expected = {
    PAYROLL_FINALIZE: ["APPROVE_PAYROLL", "PAYROLL_RUN"],
    PAYROLL_REOPEN: ["REOPEN_PAYROLL", "PAYROLL_RUN"],
    PAYMENT_FILE_EXPORT: ["EXPORT_PAYMENT_FILE", "PAYMENT_BATCH"],
    BANK_ACCOUNT_EDIT: ["EDIT_BANK_ACCOUNT", "EMPLOYEE_BANK_ACCOUNT"],
    STATUTORY_EXPORT: ["EXPORT_STATUTORY", "STATUTORY_SUBMISSION"],
    STATUTORY_SUBMIT: ["SUBMIT_STATUTORY", "STATUTORY_SUBMISSION"],
    PAYROLL_PAYMENT_PROCESS: ["PROCESS_PAYMENT", "PAYMENT_BATCH"],
  } as const;
  for (const [actionKey, [capability, resourceType]] of Object.entries(expected)) {
    const policy = getSensitiveActionPolicy(actionKey as keyof typeof expected);
    assert.equal(policy.requiredAssurance, "MFA");
    assert.equal(policy.requiredCapability, capability);
    assert.equal(policy.resourceType, resourceType);
    assert.equal(policy.oneTime, true);
    assert.ok(policy.ttlSeconds <= 300);
  }
  assert.equal(SENSITIVE_ACTION_KEYS.includes("PAYSLIP_PUBLISH" as never), false);
  assert.equal(SENSITIVE_ACTION_KEYS.includes("EDIT_COMPENSATION" as never), false);
  assert.equal(SENSITIVE_ACTION_KEYS.includes("EDIT_STATUTORY_PROFILE" as never), false);
});

test("Finalize and reopen preflight before MFA and consume inside the mutation transaction", () => {
  const actions = read("src/app/(business)/team/payroll/actions.ts");
  const service = read("src/lib/payroll/service.ts");
  assert.ok(actions.indexOf("preflightPayrollFinalize") < actions.indexOf('"PAYROLL_FINALIZE"'));
  assert.ok(actions.indexOf("preflightPayrollReopen") < actions.indexOf('"PAYROLL_REOPEN"'));
  const finalize = service.slice(
    service.indexOf("export async function finalizePayrollRun"),
    service.indexOf("export async function reopenPayrollRun"),
  );
  assert.ok(finalize.indexOf("assertPayrollReadinessCanProceed") < finalize.indexOf("consumePayrollHighRiskAuthorization"));
  assert.ok(finalize.indexOf("consumePayrollHighRiskAuthorization") < finalize.indexOf("payrollRun.update"));
  const reopen = service.slice(service.indexOf("export async function reopenPayrollRun"));
  assert.ok(reopen.indexOf("publishedPayslipCount") < reopen.indexOf("consumePayrollHighRiskAuthorization"));
  assert.ok(reopen.indexOf("consumePayrollHighRiskAuthorization") < reopen.indexOf("payrollRun.update"));
});

test("Bank, statutory and provider-blocked payment export use canonical scoped authorization", () => {
  const bank = read("src/lib/payroll/payment/bank-account-service.ts");
  const paymentArtifact = read("src/lib/payroll/payment/payment-artifact-service.ts");
  const statutory = read("src/lib/payroll/statutory-artifact.ts");
  const statutoryRoute = read("src/app/(business)/team/payroll/statutory/export/route.ts");
  assert.deepEqual(
    payrollBankAccountHighRisk("membership-1", {
      MFA_FEATURE_ENABLED: "on",
      NODE_ENV: "test",
      PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "on",
    }),
    { actionKey: "BANK_ACCOUNT_EDIT", resourceId: "membership-1" },
  );
  assert.match(bank, /highRisk: payrollBankAccountHighRisk\(command\.membershipId\)/);
  assert.match(paymentArtifact, /actionKey: "PAYMENT_FILE_EXPORT"/);
  assert.match(paymentArtifact, /process\.env\.NODE_ENV !== "test"/);
  assert.match(statutory, /actionKey: "STATUTORY_EXPORT"/);
  assert.match(statutoryRoute, /SENSITIVE_ACTION_COOKIE/);
  assert.match(statutoryRoute, /requireWholeBusinessPayroll\("EXPORT_STATUTORY"\)/);
  assert.doesNotMatch(paymentArtifact, /PUBLIC_BANK|provider.*PUBLIC_BANK/i);
});

test("High-risk Payroll UX retains canonical MFA fields behind the temporary feature switch", () => {
  const fields = read("src/components/payroll-high-risk-mfa-fields.tsx");
  const runPage = read("src/app/(business)/team/payroll/runs/[runId]/page.tsx");
  const bankPage = read("src/app/(business)/team/people/[personId]/payroll/bank/edit/page.tsx");
  assert.match(fields, /name="stepUpPassword"/);
  assert.match(fields, /name="stepUpFactorType"/);
  assert.match(fields, /name="stepUpCode"/);
  assert.match(fields, /isMfaFeatureEnabled/);
  assert.match(fields, /if \(!isMfaFeatureEnabled\(\)\) return null/);
  assert.match(runPage, /Finalize this Payroll Run/);
  assert.match(runPage, /Reopen this Payroll Run/);
  assert.match(bankPage, /isPayrollBankAccountMfaEnabled/);
  assert.match(bankPage, /Confirm bank account/);
});
