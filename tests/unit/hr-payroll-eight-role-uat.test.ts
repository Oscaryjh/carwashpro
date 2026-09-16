import assert from "node:assert/strict";
import test from "node:test";
import {
  HR_PAYROLL_EIGHT_ROLE_PERSONAS,
  assertEightRoleUatEnvironment,
  resolveEightRoleUatDeviceWrite,
} from "../../scripts/hr-payroll-eight-role-uat-contract";

const EXPECTED_PERSONAS = [
  "BUSINESS_OWNER",
  "PAYROLL_ADMIN",
  "HR_MANAGER",
  "BRANCH_MANAGER",
  "SUPERVISOR",
  "GROUP_OWNER",
  "GROUP_MANAGER",
  "STAFF",
] as const;

test("local HR/Payroll UAT fixture defines exactly the approved eight roles", () => {
  assert.deepEqual(
    HR_PAYROLL_EIGHT_ROLE_PERSONAS.map((persona) => persona.key),
    EXPECTED_PERSONAS,
  );
  assert.equal(new Set(HR_PAYROLL_EIGHT_ROLE_PERSONAS.map((persona) => persona.email)).size, 7);
  const payrollAdmin = HR_PAYROLL_EIGHT_ROLE_PERSONAS.find((persona) => persona.key === "PAYROLL_ADMIN");
  const groupManager = HR_PAYROLL_EIGHT_ROLE_PERSONAS.find((persona) => persona.key === "GROUP_MANAGER");
  assert.ok(payrollAdmin && payrollAdmin.kind === "DIRECT_USER");
  assert.ok(groupManager && groupManager.kind === "GROUP_USER");
  if (payrollAdmin.kind === "DIRECT_USER") {
    const permissions: readonly string[] = payrollAdmin.permissions;
    assert.ok(permissions.includes("VIEW_PAYROLL_RUN"));
    assert.ok(permissions.includes("EDIT_PAYROLL_ENTRY"));
    assert.equal(permissions.includes("SUBMIT_STATUTORY"), false);
    assert.equal(permissions.includes("EXPORT_PAYMENT_FILE"), false);
  }
});

test("eight-role fixture rejects production, remote databases and weak credentials", () => {
  assert.throws(() => assertEightRoleUatEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/local",
    HR_EIGHT_ROLE_UAT_PASSWORD: "local-password-123",
  }), /FORBIDDEN_IN_PRODUCTION/);
  assert.throws(() => assertEightRoleUatEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@db.example.com:5432/shared",
    HR_EIGHT_ROLE_UAT_PASSWORD: "local-password-123",
  }), /REQUIRES_A_LOCAL_DATABASE/);
  assert.throws(() => assertEightRoleUatEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/local",
    HR_EIGHT_ROLE_UAT_PASSWORD: "short",
  }), /MUST_BE_AT_LEAST_12_CHARACTERS/);
  assert.equal(assertEightRoleUatEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/local",
    HR_EIGHT_ROLE_UAT_PASSWORD: "local-password-123",
  }), "local-password-123");
});

test("eight-role fixture reuses an existing active punch device", () => {
  assert.deepEqual(
    resolveEightRoleUatDeviceWrite({ id: "existing-device" }, {
      employeeAccountId: "employee-account",
      deviceIdentifierHash: "new-browser-hash",
    }),
    {
      mode: "UPDATE",
      where: { id: "existing-device" },
      data: {
        displayName: "Eight-role UAT staff browser",
        platform: "Browser",
        browser: "Codex browser",
        canView: true,
        canPunch: true,
        status: "ACTIVE",
        revokedAt: null,
        revokeReason: null,
      },
    },
  );

  assert.equal(
    resolveEightRoleUatDeviceWrite(null, {
      employeeAccountId: "employee-account",
      deviceIdentifierHash: "new-browser-hash",
    }).mode,
    "CREATE",
  );
});
