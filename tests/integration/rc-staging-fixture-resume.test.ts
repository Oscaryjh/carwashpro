import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { seedStagingPos } from "../../scripts/lib/rc-staging-pos-data";

test("an exact confirmed-draft checkpoint resumes once and then becomes verify-only", async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.RC_DISPOSABLE_TEST, "1");
  assert.equal(databaseUrl.hostname, "127.0.0.1");
  assert.equal(databaseUrl.pathname, "/rc_pcb_verification_vc1_disposable_synthetic");
  const secretDirectory = mkdtempSync("/tmp/rc-fixture-resume-");
  const secretFile = join(secretDirectory, "credentials.json");
  const password = randomBytes(36).toString("base64url");
  writeFileSync(secretFile, JSON.stringify({ password }), { mode: 0o600 });
  Object.assign(process.env, {
    APP_ENVIRONMENT: "production",
    NODE_ENV: "production",
    APP_DEPLOYMENT_PROFILE: "rc-staging",
    RC_STAGING_FIXTURE_SECRET_FILE: secretFile,
    EMPLOYEE_AUTH_SECRET: randomBytes(48).toString("hex"),
    MFA_ACTIVE_KEY_VERSION: "rc-staging-resume-test",
    MFA_ENCRYPTION_KEYS: JSON.stringify({
      "rc-staging-resume-test": randomBytes(32).toString("base64"),
    }),
    PAYMENT_EXECUTION_ENABLED: "false",
    BANK_PAYMENT_EXECUTION_ENABLED: "false",
    PAYMENT_EXPORT_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false",
    PCB_PRODUCTION_ENABLED: "false",
    OFFICIAL_EXPORT_ELIGIBLE: "false",
  });

  try {
    const { createStagingHrCoreCheckpoint } = await import(
      "../../scripts/lib/rc-staging-hr-core-data"
    );
    const { captureStagingFixtureCheckpoint, reconcileStagingFixtureCheckpoint } = await import(
      "../../scripts/lib/rc-staging-fixture-reconciliation"
    );
    const {
      provisionStagingSynthetic,
      verifyStagingSynthetic,
      withStagingSessionCleanup,
    } = await import("../../scripts/lib/rc-staging-fixture-service");

    await withStagingSessionCleanup(prisma, async () => {
      await seedStagingPos(prisma, password);
      await createStagingHrCoreCheckpoint(prisma, password);
    });
    const captured = await captureStagingFixtureCheckpoint(prisma);
    const canonical = (value: unknown): string => Array.isArray(value)
      ? `[${value.map(canonical).sort().join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`
        : JSON.stringify(value);
    const checkpointEvidence = {
      dataDigest: captured.dataDigest,
      credentialDigest: createHash("sha256").update(canonical(JSON.parse(readFileSync(secretFile, "utf8")))).digest("hex"),
    };
    const localIdentity = await prisma.$queryRaw<Array<{ database: string; address: string | null }>>`
      SELECT current_database() AS database, inet_server_addr()::text AS address
    `;
    assert.equal(localIdentity[0]?.database, "rc_pcb_verification_vc1_disposable_synthetic");
    assert.match(localIdentity[0]?.address ?? "", /^(?:127\.0\.0\.1|::1)(?:\/\d+)?$/);
    assert.equal(process.env.RC_DISPOSABLE_TEST, "1");
    const exact = await reconcileStagingFixtureCheckpoint(prisma, checkpointEvidence);
    assert.equal(exact.checkpoint, "CORE_PCB_CONFIRMED_DRAFT");
    assert.match(exact.manifestDigest, /^[a-f0-9]{64}$/);

    const before = {
      runs: await prisma.payrollRun.count(),
      entries: await prisma.payrollEntry.count(),
      confirmations: await prisma.payrollManualPcbConfirmation.count(),
      publications: await prisma.payrollPayslipPublication.count(),
      audits: await prisma.auditLog.count(),
      corrections: await prisma.payrollPcbSettlementEvent.count(),
    };
    assert.deepEqual(before, {
      runs: 1,
      entries: 6,
      confirmations: 6,
      publications: 0,
      audits: 6,
      corrections: 0,
    });

    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.business.create({
          data: { name: "Unknown row", slug: "unknown-resume-row" },
        });
        await reconcileStagingFixtureCheckpoint(transaction, checkpointEvidence);
      }),
      /RC_STAGING_FIXTURE_RECONCILIATION_REJECTED/,
    );
    assert.equal(await prisma.business.count({ where: { slug: "unknown-resume-row" } }), 0);

    const draft = await prisma.payrollRun.findFirstOrThrow();
    const originalBusiness = await prisma.business.findUniqueOrThrow({ where: { id: draft.businessId } });
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.business.update({
          where: { id: draft.businessId },
          data: { name: "Conflicting checkpoint row" },
        });
        await reconcileStagingFixtureCheckpoint(transaction, checkpointEvidence);
      }),
      /RC_STAGING_FIXTURE_RECONCILIATION_REJECTED/,
    );
    assert.equal(
      (await prisma.business.findUniqueOrThrow({ where: { id: draft.businessId } })).name,
      originalBusiness.name,
    );
    const manager = await prisma.user.findFirstOrThrow({
      where: { email: { startsWith: "hr-core-acceptance.manager+" } },
    });
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: manager.id },
          data: { passwordHash: "conflicting-checkpoint-hash" },
        });
        await reconcileStagingFixtureCheckpoint(transaction, checkpointEvidence);
      }),
      /RC_STAGING_FIXTURE_RECONCILIATION_REJECTED/,
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: manager.id } })).passwordHash,
      manager.passwordHash,
    );
    const permissionUser = (await prisma.user.findMany()).find((user) => user.permissions.length > 1);
    assert.ok(permissionUser);
    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: permissionUser.id },
          data: { permissions: [...permissionUser.permissions].reverse() },
        });
        await reconcileStagingFixtureCheckpoint(transaction, checkpointEvidence);
      }),
      /RC_STAGING_FIXTURE_RECONCILIATION_REJECTED/,
    );
    assert.deepEqual(
      (await prisma.user.findUniqueOrThrow({ where: { id: permissionUser.id } })).permissions,
      permissionUser.permissions,
    );

    const originalHandoff = readFileSync(secretFile);
    const invalidHandoff = JSON.parse(originalHandoff.toString()) as { password: string; mfa?: Record<string, string> };
    invalidHandoff.mfa = {};
    writeFileSync(secretFile, JSON.stringify(invalidHandoff), { mode: 0o600 });
    await assert.rejects(
      provisionStagingSynthetic(prisma, { password, testCheckpointEvidence: checkpointEvidence }),
      /RC_STAGING_FIXTURE_RECONCILIATION_REJECTED/,
    );
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");
    assert.equal(await prisma.user.count({ where: { email: "uat.payroll-admin@tetamu.local" } }), 0);
    assert.equal(await prisma.auditLog.count(), 6);
    writeFileSync(secretFile, originalHandoff, { mode: 0o600 });

    const first = await provisionStagingSynthetic(prisma, { password, testCheckpointEvidence: checkpointEvidence });
    assert.equal(first.mode, "RESUMED");
    assert.equal(first.businessCount, 4);
    assert.equal(first.payrollRunCount, 3);
    assert.equal(first.publicationCount, 14);
    assert.equal(first.duplicateCount, 0);
    assert.equal(first.migrationCount, 216);
    assert.deepEqual(first.active, {
      authSession: 0,
      employeeSession: 0,
      usableOtp: 0,
    });
    const second = await provisionStagingSynthetic(prisma, { password });
    assert.equal(second.mode, "VERIFIED_EXISTING");
    assert.equal(second.dataDigest, first.dataDigest);
    assert.equal((await verifyStagingSynthetic(prisma)).dataDigest, first.dataDigest);
    assert.equal(await prisma.payrollRun.count(), 3);
    assert.equal(await prisma.payrollEntry.count(), 14);
    assert.equal(await prisma.payrollPayslipPublication.count(), 14);
    assert.equal(await prisma.payrollManualPcbConfirmation.count(), 14);
    assert.equal(await prisma.auditLog.count({ where: { action: "RC_STAGING_SYNTHETIC_INSTALLED" } }), 1);
    assert.equal(await prisma.payrollPcbSettlementEvent.count(), 0);
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    assert.ok(Object.keys(JSON.parse(readFileSync(secretFile, "utf8")).mfa ?? {}).length >= 4);
  } finally {
    delete process.env.RC_STAGING_FIXTURE_SECRET_FILE;
    rmSync(secretDirectory, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});

test.after(async () => {
  await new PrismaClient().$disconnect();
});
