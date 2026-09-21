import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { provisionStagingSynthetic, verifyStagingSynthetic, verifyStagingSemanticData, withStagingReviewer, withStagingSessionCleanup } from "../../scripts/lib/rc-staging-fixture-service";

test("Staging installer preserves scenarios, MFA and eight roles; second install is verify-only", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.RC_DISPOSABLE_TEST, "1");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/rc_pcb_verification_vc1_disposable_synthetic");
  process.env.APP_ENVIRONMENT = "production";
  process.env.APP_DEPLOYMENT_PROFILE = "rc-staging";
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.EMPLOYEE_AUTH_SECRET = randomBytes(48).toString("hex");
  process.env.MFA_ACTIVE_KEY_VERSION = "rc-staging-test";
  process.env.MFA_ENCRYPTION_KEYS = JSON.stringify({ "rc-staging-test": randomBytes(32).toString("base64") });
  for (const name of ["PAYMENT_EXECUTION_ENABLED", "BANK_PAYMENT_EXECUTION_ENABLED", "PAYMENT_EXPORT_ENABLED", "GOVERNMENT_SUBMISSION_ENABLED", "PCB_PRODUCTION_ENABLED", "OFFICIAL_EXPORT_ELIGIBLE"]) process.env[name] = "false";
  const prisma = new PrismaClient({ log: [] });
  const secretDirectory = mkdtempSync("/tmp/rc-fixture-mfa-test-");
  const secretFile = join(secretDirectory, "credentials.json");
  writeFileSync(secretFile, JSON.stringify({ password: "synthetic-only" }), { mode: 0o600 });
  process.env.RC_STAGING_FIXTURE_SECRET_FILE = secretFile;
  try {
    const password = randomBytes(36).toString("base64url");
    writeFileSync(secretFile, JSON.stringify({ password }), { mode: 0o600 });
    const initial = await Promise.all([provisionStagingSynthetic(prisma, { password }), provisionStagingSynthetic(prisma, { password })]);
    const first = initial.find(result => result.mode === "INSTALLED")!;
    assert.equal(initial.filter(result => result.mode === "VERIFIED_EXISTING").length, 1);
    assert.equal(first.mode, "INSTALLED");
    assert.equal(first.businessCount, 4);
    assert.equal(first.coreScenarioCount, 6);
    assert.equal(first.personaCount, 8);
    assert.equal(first.duplicateCount, 0);
    assert.equal(first.migrationCount, 216);
    assert.deepEqual(first.active, { authSession: 0, employeeSession: 0, usableOtp: 0 });
    const publications = await prisma.payrollPayslipPublication.count();
    assert.equal(publications, 14);
    const manual = await prisma.payrollManualPcbConfirmation.count();
    assert.equal(manual, 14);
    const stored = JSON.parse(readFileSync(secretFile, "utf8"));
    assert.equal(Object.keys(stored.mfa ?? {}).length, 4);
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    assert.ok(Object.values(stored.mfa).every(value => typeof value === "string" && value.length > 10));
    const second = await provisionStagingSynthetic(prisma, { password });
    assert.equal(second.mode, "VERIFIED_EXISTING");
    assert.equal(second.dataDigest, first.dataDigest);
    assert.equal(await prisma.payrollPayslipPublication.count(), publications);
    assert.equal(await prisma.payrollManualPcbConfirmation.count(), manual);
    assert.equal((await verifyStagingSynthetic(prisma)).dataDigest, first.dataDigest);
    const secretBytes = readFileSync(secretFile);
    writeFileSync(secretFile, JSON.stringify({ password: randomBytes(36).toString("base64url") }), { mode: 0o600 });
    await assert.rejects(verifyStagingSynthetic(prisma), /RC_STAGING_FIXTURE_CREDENTIALS_REJECTED/);
    writeFileSync(secretFile, secretBytes, { mode: 0o600 });
    const concurrent = await Promise.all([provisionStagingSynthetic(prisma, { password }), provisionStagingSynthetic(prisma, { password })]);
    assert.ok(concurrent.every(result => result.mode === "VERIFIED_EXISTING" && result.duplicateCount === 0));
    const semantic = await verifyStagingSemanticData(prisma);
    assert.equal(semantic.personaCount, 8);
    assert.equal(semantic.publicationCount, 14);
    assert.equal(semantic.payrollRunCount, 3);
    const groupManager = await prisma.businessGroupUser.findFirstOrThrow({ where: { role: "GROUP_MANAGER" } });
    await prisma.businessGroupUser.update({ where: { id: groupManager.id }, data: { accessScope: "ALL_GROUP_BUSINESSES" } });
    await assert.rejects(verifyStagingSemanticData(prisma), /RC_STAGING_FIXTURE_STATE_REJECTED/);
    await prisma.businessGroupUser.update({ where: { id: groupManager.id }, data: { accessScope: groupManager.accessScope } });
    const reviewer = await prisma.user.findUniqueOrThrow({ where: { email: "uat.boundary-owner@tetamu.local" } });
    await assert.rejects(withStagingSessionCleanup(prisma, () => withStagingReviewer(prisma, reviewer.id, password, async () => {
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: reviewer.id } })).loginEnabled, true);
      const { persistSessionContext } = await import("../../src/lib/auth/session");
      await persistSessionContext({ userId: reviewer.id, sessionId: randomUUID(), homeBusinessId: reviewer.businessId, activeBusinessId: reviewer.businessId, contextVersion: 1, status: reviewer.status, name: reviewer.name, email: reviewer.email!, role: reviewer.role, permissions: reviewer.permissions }, { database: prisma });
      throw new Error("EXPECTED_SYNTHETIC_FAILURE");
    })), /EXPECTED_SYNTHETIC_FAILURE/);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: reviewer.id } });
    assert.equal(restored.loginEnabled, false);
    assert.equal(restored.passwordHash, null);
    assert.equal(await prisma.authSession.count({ where: { revokedAt: null } }), 0);
    // Any unrelated row must invalidate the complete marker, never be overwritten.
    await prisma.business.create({ data: { name: "Unrelated synthetic test", slug: "unrelated-staging-test" } });
    await assert.rejects(provisionStagingSynthetic(prisma, { password }), /RC_STAGING_FIXTURE_/);
  } catch (error) {
    const { getPayrollPeriodReadiness } = await import("../../src/lib/payroll/readiness");
    for (const run of await prisma.payrollRun.findMany({ take: 3 })) {
      const readiness = await getPayrollPeriodReadiness({ businessId: run.businessId, month: run.periodStart.toISOString().slice(0, 7), runId: run.id }, prisma);
      if (!readiness.canProceed) {
        const codes: Record<string, number> = {};
        for (const issue of readiness.blockers) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
        console.log(`RC_READINESS ${JSON.stringify({ blockerCount: readiness.blockers.length, codes })}`);
      }
    }
    const message = error instanceof Error ? error.message : "";
    const classes = ["RC_STAGING_FIXTURE_STATE_REJECTED", "PAYROLL_READINESS_BLOCKED", "PCB_MANUAL_MFA_REQUIRED", "MODULE_NOT_ENABLED", "MFA_RECOVERY_CODE_INVALID", "STEP_UP_SCOPE_MISMATCH", "MFA_RATE_LIMITED", "ReferenceError"];
    const matched = classes.filter(code => message.includes(code));
    if (/^RC_STAGING_FIXTURE_[A-Z_]+$/.test(message)) matched.push(message);
    if (/void/.test(message)) matched.push("UNSUPPORTED_VOID");
    if (/connection pool/i.test(message)) matched.push("POOL_TIMEOUT");
    if (/timeout|timed out/i.test(message)) matched.push("TIMEOUT");
    if (/guard is not defined/.test(message)) matched.push("UNEXTRACTED_GUARD_REFERENCE");
    console.log(`RC_READINESS ${JSON.stringify({ blockerCount: 1, codes: Object.fromEntries((matched.length ? matched : ["UNCLASSIFIED_FIXTURE_FAILURE"]).map(code => [code, 1])) })}`);
    throw error;
  } finally {
    delete process.env.RC_STAGING_FIXTURE_SECRET_FILE;
    rmSync(secretDirectory, { recursive: true, force: true });
    await prisma.$disconnect();
    const { prisma: servicePrisma } = await import("../../src/lib/prisma");
    await servicePrisma.$disconnect();
  }
});
