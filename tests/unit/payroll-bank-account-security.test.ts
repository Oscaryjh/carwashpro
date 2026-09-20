import assert from "node:assert/strict";
import test from "node:test";
import {
  isPayrollBankAccountMfaEnabled,
  payrollBankAccountHighRisk,
} from "../../src/lib/payroll/payment/bank-account-security";

test("bank-account MFA stays hidden in Local when the flag is absent", () => {
  assert.equal(
    isPayrollBankAccountMfaEnabled({ APP_ENVIRONMENT: "development" }),
    false,
  );
});

test("local and Testing can explicitly enable or disable bank-account MFA", () => {
  assert.equal(
    isPayrollBankAccountMfaEnabled({
      APP_ENVIRONMENT: "testing",
      TETAMU_MFA_ENABLED: "true",
      PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "true",
    }),
    true,
  );
  assert.deepEqual(
    payrollBankAccountHighRisk("employee-1", {
      APP_ENVIRONMENT: "development",
      TETAMU_MFA_ENABLED: "true",
      PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "on",
    }),
    {
      actionKey: "BANK_ACCOUNT_EDIT",
      resourceId: "employee-1",
    },
  );
  assert.equal(
    isPayrollBankAccountMfaEnabled({
      APP_ENVIRONMENT: "testing",
      TETAMU_MFA_ENABLED: "true",
      PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    payrollBankAccountHighRisk("employee-1", {
      APP_ENVIRONMENT: "development",
      TETAMU_MFA_ENABLED: "true",
      PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "off",
    }),
    undefined,
  );
});

test("Production bank-account MFA cannot be disabled by either switch", () => {
  const env = {
    APP_ENVIRONMENT: "production",
    TETAMU_MFA_ENABLED: "false",
    PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "false",
  };

  assert.equal(isPayrollBankAccountMfaEnabled(env), true);
  assert.ok(payrollBankAccountHighRisk("employee-1", env));
});

test("Production enforces bank-account MFA after the master switch is restored", () => {
  const env = {
    APP_ENVIRONMENT: "production",
    TETAMU_MFA_ENABLED: "true",
    PAYROLL_BANK_ACCOUNT_MFA_ENABLED: "false",
  };

  assert.equal(isPayrollBankAccountMfaEnabled(env), true);
  assert.deepEqual(payrollBankAccountHighRisk("employee-1", env), {
    actionKey: "BANK_ACCOUNT_EDIT",
    resourceId: "employee-1",
  });
});
