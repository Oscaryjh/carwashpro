import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  FROZEN_DOMAIN_DENIED,
  FrozenDomainDeniedError,
  assertFrozenDomainDenied,
  classifyPosPilotRoute,
  isPosPilotOperationAllowed,
  validatePosPilotRuntimeContract,
} from "@/lib/release/pos-pilot-contract";

const frozenOperations = [
  "PAYROLL_MUTATION",
  "PCB_CALCULATION",
  "STATUTORY_ACTIVATION",
  "OFFICIAL_STATUTORY_EXPORT",
  "GOVERNMENT_SUBMISSION",
  "PAYROLL_PAYMENT_BATCH",
  "PAYROLL_BANK_EXECUTION",
  "PAYROLL_SETTLEMENT",
  "FROZEN_DOMAIN_JOB",
] as const;

const posOperations = [
  "POS_CHECKOUT",
  "POS_CUSTOMER_PAYMENT",
  "POS_PARTIAL_PAYMENT",
  "POS_REFUND",
  "POS_INVOICE_RECEIPT",
  "POS_PACKAGE_REDEMPTION",
  "POS_DAILY_CLOSING",
  "POS_CUSTOMER_HISTORY",
] as const;

test("every frozen operation fails with the exact stable denial before a dependency can run", () => {
  for (const operation of frozenOperations) {
    let sideEffects = 0;
    assert.throws(
      () => {
        assertFrozenDomainDenied(operation, {
          APP_ENVIRONMENT: "production",
          POS_PILOT_FROZEN_DOMAINS: "true",
          POS_PILOT_RELEASE_MODE: "core-pilot",
        });
        sideEffects += 1;
      },
      (error) =>
        error instanceof FrozenDomainDeniedError &&
        error.code === FROZEN_DOMAIN_DENIED &&
        error.message === FROZEN_DOMAIN_DENIED,
    );
    assert.equal(sideEffects, 0, operation);
  }
});

test("ordinary POS financial operations are explicitly outside the frozen payroll boundary", () => {
  for (const operation of posOperations) {
    assert.equal(isPosPilotOperationAllowed(operation), true, operation);
  }
  for (const operation of frozenOperations) {
    assert.equal(isPosPilotOperationAllowed(operation), false, operation);
  }
});

test("UI and route classifier denies payroll/statutory surfaces without blocking POS", () => {
  for (const route of [
    "/team/payroll",
    "/team/payroll/runs/run-1",
    "/team/payroll/export",
    "/team/payroll/statutory/export",
    "/team/people/11111111-1111-4111-8111-111111111111/payroll",
    "/admin/statutory/rulesets",
  ]) {
    assert.equal(classifyPosPilotRoute(route), "FROZEN", route);
  }
  assert.equal(
    classifyPosPilotRoute(
      "/team/people/11111111-1111-4111-8111-111111111111",
      new URLSearchParams("section=payroll"),
    ),
    "FROZEN",
  );
  assert.equal(
    classifyPosPilotRoute(
      "/team/people/11111111-1111-4111-8111-111111111111",
      new URLSearchParams("section=profile"),
    ),
    "ALLOWED",
  );
  for (const route of [
    "/cashier",
    "/pos",
    "/invoices/123",
    "/closing",
    "/packages",
    "/staff/payslips",
  ]) {
    assert.equal(classifyPosPilotRoute(route), "ALLOWED", route);
  }
});

test("contradictory Railway and application identities always enforce the strict frozen boundary", () => {
  assert.throws(
    () => assertFrozenDomainDenied("PAYROLL_MUTATION", {
      APP_ENVIRONMENT: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
    }),
    FrozenDomainDeniedError,
  );
  assert.throws(
    () => validatePosPilotRuntimeContract({
      APP_ENVIRONMENT: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      POS_PILOT_FROZEN_DOMAINS: "true",
      POS_PILOT_RELEASE_MODE: "core-pilot",
    }),
    /conflicting runtime environment identities/i,
  );
});

test("production and testing require the explicit frozen contract and it can never enable a frozen domain", () => {
  for (const environment of ["production", "testing"]) {
    assert.throws(
      () => validatePosPilotRuntimeContract({
        APP_ENVIRONMENT: environment,
        POS_PILOT_RELEASE_MODE: "core-pilot",
      }),
      /POS_PILOT_FROZEN_DOMAINS=true/,
    );
    assert.deepEqual(
      validatePosPilotRuntimeContract({
        APP_ENVIRONMENT: environment,
        POS_PILOT_FROZEN_DOMAINS: "true",
        POS_PILOT_RELEASE_MODE: "core-pilot",
      }),
      { frozenDomains: true, releaseMode: "core-pilot" },
    );
    assert.throws(
      () =>
        validatePosPilotRuntimeContract({
          APP_ENVIRONMENT: environment,
          POS_PILOT_FROZEN_DOMAINS: "false",
          POS_PILOT_RELEASE_MODE: "core-pilot",
        }),
      /POS_PILOT_FROZEN_DOMAINS=true/,
    );
  }
});

test("high-risk entry files invoke the shared hard deny before transactional or external work", async () => {
  const expectations = new Map<string, RegExp>([
    ["src/lib/payroll/service.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/payment/payment-batch-service.ts", /assertFrozenDomainDenied\("PAYROLL_PAYMENT_BATCH"\)/],
    ["src/lib/payroll/payment/payment-artifact-service.ts", /assertFrozenDomainDenied\("PAYROLL_BANK_EXECUTION"\)/],
    ["src/lib/payroll/statutory-artifact.ts", /assertFrozenDomainDenied\("OFFICIAL_STATUTORY_EXPORT"\)/],
    ["src/lib/payroll/statutory-activation-service.ts", /assertFrozenDomainDenied\("STATUTORY_ACTIVATION"\)/],
    ["src/app/(business)/team/payroll/actions.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/app/(business)/team/payroll/payments/actions.ts", /assertFrozenDomainDenied\("PAYROLL_PAYMENT_BATCH"\)/],
    ["src/app/(business)/team/payroll/statutory/actions.ts", /assertFrozenDomainDenied\("GOVERNMENT_SUBMISSION"\)/],
    ["src/app/(business)/team/people/[personId]/payroll/actions.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/employee-profile-write/common.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/employee-profile-write/statutory-tax.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/lindung24-participation-service.ts", /assertFrozenDomainDenied\("STATUTORY_ACTIVATION"\)/],
    ["src/lib/payroll/component-service.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/payslip-publication.ts", /assertFrozenDomainDenied\("PAYROLL_MUTATION"\)/],
    ["src/lib/payroll/cp38-instruction.ts", /assertFrozenDomainDenied\("STATUTORY_ACTIVATION"\)/],
    ["src/lib/payroll/sabah-work-pay-service.ts", /assertFrozenDomainDenied\("STATUTORY_ACTIVATION"\)/],
  ]);

  for (const [file, pattern] of expectations) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    assert.match(source, pattern, file);
    const denyIndex = source.indexOf("assertFrozenDomainDenied(");
    const transactionIndex = source.indexOf(".$transaction(");
    if (transactionIndex >= 0) assert.ok(denyIndex >= 0 && denyIndex < transactionIndex, file);
  }
});

test("direct service, action and export route calls deny before DB or artifact work", async () => {
  const original = {
    APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
    POS_PILOT_RELEASE_MODE: process.env.POS_PILOT_RELEASE_MODE,
    POS_PILOT_FROZEN_DOMAINS: process.env.POS_PILOT_FROZEN_DOMAINS,
  };
  process.env.APP_ENVIRONMENT = "production";
  process.env.POS_PILOT_RELEASE_MODE = "core-pilot";
  process.env.POS_PILOT_FROZEN_DOMAINS = "true";
  let databaseCalls = 0;

  try {
    const { createPayrollPaymentBatch } = await import(
      "@/lib/payroll/payment/payment-batch-service"
    );
    await assert.rejects(
      () => createPayrollPaymentBatch(
        {} as never,
        {} as never,
        { $transaction: async () => { databaseCalls += 1; } } as never,
      ),
      (error) =>
        error instanceof FrozenDomainDeniedError &&
        error.code === FROZEN_DOMAIN_DENIED,
    );

    const { savePayrollSettingAction } = await import(
      "@/app/(business)/team/payroll/actions"
    );
    await assert.rejects(
      () => savePayrollSettingAction(new FormData()),
      (error) =>
        error instanceof FrozenDomainDeniedError &&
        error.code === FROZEN_DOMAIN_DENIED,
    );

    const { scheduleEmployeeCompensationChangeAction } = await import(
      "@/app/(business)/team/people/[personId]/payroll/actions"
    );
    await assert.rejects(
      () => scheduleEmployeeCompensationChangeAction(new FormData()),
      (error) =>
        error instanceof FrozenDomainDeniedError &&
        error.code === FROZEN_DOMAIN_DENIED,
    );

    const directWrites: Array<() => Promise<unknown>> = [];
    const { addManualPayrollAdjustment } = await import(
      "@/lib/payroll/component-service"
    );
    directWrites.push(() => addManualPayrollAdjustment({} as never, {} as never));
    const { publishPayrollPayslips } = await import(
      "@/lib/payroll/payslip-publication"
    );
    directWrites.push(() => publishPayrollPayslips({} as never, {} as never));
    const { recordCp38Instruction } = await import(
      "@/lib/payroll/cp38-instruction"
    );
    directWrites.push(() => recordCp38Instruction({} as never, {} as never));
    const { registerSabahWorkPayCandidate, materializeSabahWorkPay } = await import(
      "@/lib/payroll/sabah-work-pay-service"
    );
    directWrites.push(() => registerSabahWorkPayCandidate({} as never, {} as never));
    directWrites.push(() => materializeSabahWorkPay({} as never, {} as never));
    for (const directWrite of directWrites) {
      await assert.rejects(
        directWrite,
        (error) =>
          error instanceof FrozenDomainDeniedError &&
          error.code === FROZEN_DOMAIN_DENIED,
      );
    }

    const { GET } = await import(
      "@/app/(business)/team/payroll/export/route"
    );
    const response = await GET(new Request("http://localhost/team/payroll/export"));
    assert.equal(response.status, 403);
    assert.equal(await response.text(), FROZEN_DOMAIN_DENIED);
    assert.equal(databaseCalls, 0);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
