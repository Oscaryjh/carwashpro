import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test, { before, after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { databaseConnectionFingerprint } from "../../scripts/uat-preview-database-guard";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import { reopenPayrollRun } from "../../src/lib/payroll/service";
import approved from "../fixtures/uat-preview-approved-boundary-periods.json";

const targets = approved.targets;
const ids = targets.map(t => t.run.id);
const databaseName = `tetamu_r5_maintenance_${process.pid}_${Date.now()}`;
const cli = "scripts/maintain-hr-payroll-uat-preview-periods.ts";
const projectId = "ec8b25a7-4fb9-4959-8353-b4af000f4e80";
const environmentId = "29581a37-4291-497a-91aa-25a9432b3227";
const webId = "909f20b1-8901-4072-b7ca-5dd147f20c45";
const dbId = "ad89c158-aa04-485f-8efe-2a50f46b63ac";
const oldEnd = new Date("2026-09-30T00:00:00.000Z");
const newEnd = new Date("2026-10-01T00:00:00.000Z");
let db: PrismaClient;
let admin: PrismaClient;
let databaseUrl: string;

before(async () => {
  const source = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(source.hostname));
  const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
  source.pathname = `/${databaseName}`; databaseUrl = source.toString();
  admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  assert.match(databaseName, /^tetamu_r5_maintenance_\d+_\d+$/);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  const result = spawnSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 120_000,
  });
  assert.equal(result.status, 0, "disposable migration setup failed");
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await seedApprovedSyntheticRows();
});

after(async () => {
  await db?.$disconnect();
  if (admin) {
    await admin.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", databaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    await admin.$disconnect();
  }
});

function environment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const secret = "local-disposable-maintenance-fingerprint-secret-32-bytes";
  return {
    ...process.env, NODE_ENV: "production", APP_ENVIRONMENT: "uat-preview", DATABASE_URL: databaseUrl,
    RAILWAY_PROJECT_ID: projectId, RAILWAY_ENVIRONMENT_ID: environmentId, RAILWAY_SERVICE_ID: webId,
    RAILWAY_DATABASE_SERVICE_ID: dbId, RAILWAY_DEPLOYMENT_ID: "",
    UAT_PREVIEW_EXPECTED_PROJECT_ID: projectId, UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: environmentId,
    UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: webId, UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID: dbId,
    UAT_PREVIEW_LOCAL_SIMULATION: "true", UAT_PREVIEW_DATABASE_NAME: databaseName,
    UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET: secret,
    UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT: databaseConnectionFingerprint(databaseUrl, dbId, secret),
    UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: "ac9ef980-6805-4bf2-99f2-72dc7579d99d,bef43b86-32dc-486e-a1ef-bb9f9699e4f5",
    UAT_PREVIEW_FORBIDDEN_SERVICE_IDS: "protected-web,protected-database",
    UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: "tetamu_testing,tetamu_production",
    UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS: "a".repeat(64),
    UAT_PREVIEW_GUARD_SECRET: "local-disposable-maintenance-guard-secret-32-bytes",
    UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED: "true", UAT_PREVIEW_ACCESS_ENABLED: "true",
    UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true", OTP_PROVIDER: "uat_preview_intercept",
    PRODUCTION_ELIGIBLE: "false", OFFICIAL_EXPORT_ELIGIBLE: "false", BANK_PAYMENT_EXECUTION_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false", PCB_PRODUCTION_ENABLED: "false",
    SMS123_API_KEY: "", TWILIO_AUTH_TOKEN: "", TWILIO_ACCOUNT_SID: "", TWILIO_API_KEY_SECRET: "",
    TWILIO_API_KEY_SID: "", TWILIO_VERIFY_SERVICE_SID: "", WHATSAPP_ACCESS_TOKEN: "",
    WHATSAPP_WEBHOOK_SECRET: "", RESEND_API_KEY: "", SMTP_PASSWORD: "", ...overrides,
  };
}

function invoke(overrides: Partial<NodeJS.ProcessEnv> = {}, args: string[] = []) {
  const env = environment(overrides);
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { env, encoding: "utf8", timeout: 30_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  for (const sensitive of [databaseUrl, env.UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET!, env.UAT_PREVIEW_GUARD_SECRET!]) {
    assert.equal(output.includes(sensitive), false, "CLI must not print connection or secret material");
  }
  return result;
}

async function rows() {
  return db.payrollRun.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, include: {
    entries: { orderBy: { id: "asc" } }, components: { orderBy: { id: "asc" } },
    payslipPublications: { orderBy: { id: "asc" } },
  } });
}

// Disposable-test setup only; retain real triggers and original metadata.
async function editRun(id: string, data: Prisma.PayrollRunUncheckedUpdateInput) {
  assert.ok(ids.includes(id)); assert.equal(new URL(databaseUrl).pathname, `/${databaseName}`);
  await db.$transaction(async tx => {
    const prior = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
    await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${id}, TRUE)`;
    await tx.payrollRun.update({ where: { id }, data: { status: "DRAFT", submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null, updatedAt: prior.updatedAt } });
    await tx.payrollRun.update({ where: { id }, data: {
      status: prior.status, submittedAt: prior.submittedAt, submittedById: prior.submittedById,
      finalizedAt: prior.finalizedAt, finalizedById: prior.finalizedById, updatedAt: prior.updatedAt, ...data,
    } });
  });
}

test("approved sanitized sample binds both old projections independently", () => {
  assert.equal(createHash("sha256").update(JSON.stringify(targets)).digest("hex"), "7f213eaa04d56a2ab0d57d763704933b806b11daee5e51b121fa24115f22ebe7");
  const expected = ["1b726728c0d76f7f18836fc3bd23e7cff4b41fc81f6c58619486943a99b12f1a", "ff9bcccb8e94b55bed3053492f8ca5c7896adc5143096dc5d55d02a96e581451"];
  targets.forEach((t, i) => assert.equal(createHash("sha256").update(JSON.stringify(t.run)).digest("hex"), expected[i]));
});

test("ordinary runtime callers and wrong Preview identities are rejected before any write", async () => {
  const beforeRows = await rows();
  for (const override of [
    { APP_ENVIRONMENT: "production" }, { APP_ENVIRONMENT: "development" }, { APP_ENVIRONMENT: "" },
    { RAILWAY_PROJECT_ID: "wrong", UAT_PREVIEW_EXPECTED_PROJECT_ID: "wrong" },
    { RAILWAY_ENVIRONMENT_ID: "wrong", UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "wrong" },
    { RAILWAY_SERVICE_ID: "wrong", UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "wrong" },
    { RAILWAY_DATABASE_SERVICE_ID: "wrong", UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID: "wrong" },
    { UAT_PREVIEW_DATABASE_NAME: "wrong" }, { UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT: "0".repeat(64) },
    { UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: databaseName },
    { UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS: environment().UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT },
    { UAT_PREVIEW_FORBIDDEN_SERVICE_IDS: dbId }, { UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: environmentId },
  ]) {
    const result = invoke(override);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_(?:PERIOD_MAINTENANCE|FIXTURE)_[A-Z_]+/);
    assert.deepEqual(await rows(), beforeRows);
  }
  const arbitraryRun = invoke({}, ["--run-id", randomUUID()]);
  assert.notEqual(arbitraryRun.status, 0);
  assert.match(arbitraryRun.stderr, /HR_UAT_PERIOD_MAINTENANCE_ARGUMENTS_FORBIDDEN/);
});

test("maintenance rejects non-synthetic employee and business markers without relabelling", async () => {
  const memberId = targets[0].run.entries[0].membershipId;
  await db.employeeBusinessMembership.update({ where: { id: memberId }, data: { isTestAccount: false } });
  try {
    const beforeRows = await rows(); const result = invoke();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /HR_UAT_PERIOD_MAINTENANCE_(?:SCOPE|FINGERPRINT)_MISMATCH/);
    assert.deepEqual(await rows(), beforeRows);
    assert.equal((await db.employeeBusinessMembership.findUniqueOrThrow({ where: { id: memberId } })).isTestAccount, false);
  } finally { await db.employeeBusinessMembership.update({ where: { id: memberId }, data: { isTestAccount: true } }); }
  const business = targets[1].run.business;
  await db.business.update({ where: { id: business.id }, data: { name: "Not the synthetic tenant" } });
  try {
    const result = invoke(); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_(?:PERIOD_MAINTENANCE|FIXTURE)_[A-Z_]+/);
  } finally { await db.business.update({ where: { id: business.id }, data: { name: business.name } }); }
});

test("unexpected date, metadata fingerprint drift and mixed target state fail atomically", async () => {
  for (const change of [
    { periodEnd: new Date("2026-09-29T00:00:00.000Z") },
    { periodEnd: newEnd },
    { updatedAt: new Date("2026-09-20T00:00:00.000Z") },
  ]) {
    const original = await db.payrollRun.findUniqueOrThrow({ where: { id: ids[1] } });
    await editRun(ids[1], change);
    try {
      const beforeRows = await rows(), result = invoke();
      assert.notEqual(result.status, 0); assert.match(result.stderr, /HR_UAT_PERIOD_MAINTENANCE_[A-Z_]+/);
      assert.deepEqual(await rows(), beforeRows);
    } finally { await editRun(ids[1], { periodEnd: oldEnd, updatedAt: original.updatedAt }); }
  }
});

test("same-month canonical collision rejects without touching existing publications", async () => {
  const scalar = await db.payrollRun.findUniqueOrThrow({ where: { id: ids[0] } });
  const collision = await db.payrollRun.create({ data: {
    ...scalar, id: randomUUID(), periodEnd: newEnd, status: "DRAFT",
    submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null,
  } });
  try {
    const beforeRows = await rows(), result = invoke();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /HR_UAT_PERIOD_MAINTENANCE_COLLISION/);
    assert.deepEqual(await rows(), beforeRows);
  } finally { await db.payrollRun.delete({ where: { id: collision.id } }); }
});

test("unknown extra relation is rejected even when run scalar data is unchanged", async () => {
  const extraId = randomUUID();
  const extraAccount = await db.employeeAccount.create({ data: {
    name: "Synthetic unapproved relation", phoneNumber: "+60119993009", phoneNormalized: "+60119993009",
  } });
  const extraMember = await db.employeeBusinessMembership.create({ data: {
    businessId: targets[0].run.businessId, employeeAccountId: extraAccount.id,
    employeeCode: "EXTRA", fullName: "Synthetic unapproved relation", isTestAccount: true,
    phoneNumber: extraAccount.phoneNumber, phoneNumberNormalized: extraAccount.phoneNormalized,
  } });
  await db.$transaction(async tx => {
    const r = await tx.payrollRun.findUniqueOrThrow({ where: { id: ids[0] } });
    await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${r.id}, TRUE)`;
    await tx.payrollRun.update({ where: { id: r.id }, data: { status: "DRAFT", submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null } });
    await tx.payrollEntry.create({ data: {
      id: extraId, payrollRunId: r.id, businessId: r.businessId, membershipId: extraMember.id,
      employeeCodeSnapshot: "EXTRA", fullNameSnapshot: "Synthetic unapproved relation",
      payBasisSnapshot: "MONTHLY", baseRateSnapshot: 0, workingDaysSnapshot: 26, normalWorkMinutesSnapshot: 480,
    } });
    await tx.payrollRun.update({ where: { id: r.id }, data: { status: "FINALIZED", submittedAt: r.submittedAt, submittedById: r.submittedById, finalizedAt: r.finalizedAt, finalizedById: r.finalizedById, updatedAt: r.updatedAt } });
  });
  try {
    const beforeRows = await rows(), result = invoke();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /HR_UAT_PERIOD_MAINTENANCE_[A-Z_]+/);
    assert.deepEqual(await rows(), beforeRows);
  } finally {
    await db.$transaction(async tx => {
      const r = await tx.payrollRun.findUniqueOrThrow({ where: { id: ids[0] } });
      await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${r.id}, TRUE)`;
      await tx.payrollRun.update({ where: { id: r.id }, data: { status: "DRAFT", submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null } });
      await tx.payrollEntry.delete({ where: { id: extraId } });
      await tx.payrollRun.update({ where: { id: r.id }, data: { status: "FINALIZED", submittedAt: r.submittedAt, submittedById: r.submittedById, finalizedAt: r.finalizedAt, finalizedById: r.finalizedById, updatedAt: r.updatedAt } });
    });
    await db.employeeBusinessMembership.delete({ where: { id: extraMember.id } });
    await db.employeeAccount.delete({ where: { id: extraAccount.id } });
  }
});

test("database failure after a first correction rolls the whole maintenance transaction back", async () => {
  const mod = await import(resolve("scripts/uat-preview-boundary-payroll-maintenance.ts"));
  const beforeRows = await rows(); let firstRestored = false;
  const failing = db.$extends({ query: { payrollRun: { async update({ args, query }) {
    if (args.data.status === "FINALIZED" && args.data.periodEnd) {
      if (firstRestored) throw new Error("DISPOSABLE_FAULT_AFTER_FIRST_CORRECTION");
      firstRestored = true;
    }
    return query(args);
  } } } });
  await assert.rejects(mod.maintainApprovedBoundaryPeriods(failing, environment()), /DISPOSABLE_FAULT_AFTER_FIRST_CORRECTION/);
  assert.equal(firstRestored, true);
  assert.deepEqual(await rows(), beforeRows);
});

test("all target locks block concurrent synthetic marker updates until the transaction ends", async () => {
  const mod = await import(resolve("scripts/uat-preview-boundary-payroll-maintenance.ts"));
  const beforeRows = await rows(); let observedLock = false;
  const checking = db.$extends({ query: { async $queryRaw({ args, query }) {
    const result = await query(args);
    const sql = (args as { sql?: string }).sql ?? "";
    if (sql.includes("payroll_payslip_publications") && sql.includes("FOR UPDATE")) {
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '150ms'`;
        await tx.employeeBusinessMembership.update({
          where: { id: targets[0].run.entries[0].membershipId }, data: { isTestAccount: false },
        });
      }), /lock timeout/);
      observedLock = true;
      throw new Error("DISPOSABLE_STOP_AFTER_LOCK_VERIFICATION");
    }
    return result;
  } } });
  await assert.rejects(mod.maintainApprovedBoundaryPeriods(checking, environment()), /DISPOSABLE_STOP_AFTER_LOCK_VERIFICATION/);
  assert.equal(observedLock, true);
  assert.deepEqual(await rows(), beforeRows);
});

test("maintenance corrects both approved targets preserving metadata and publication bytes then returns exact no-op", async () => {
  const beforeRows = await rows();
  const first = invoke(); assert.equal(first.status, 0, first.stderr);
  const proof = JSON.parse(first.stdout);
  assert.equal(proof.changedRuns, 2); assert.equal(proof.noOp, false);
  const corrected = await rows();
  corrected.forEach((r, i) => {
    assert.equal(r.periodEnd.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.deepEqual({ ...r, periodEnd: oldEnd }, beforeRows[i], "every scalar, relation and document byte is unchanged except periodEnd");
  });
  for (const run of corrected) {
    const readiness = await getPayrollPeriodReadiness({ businessId: run.businessId, month: "2026-09", runId: run.id }, db);
    assert.equal(readiness.runId, run.id);
  }
  const second = invoke(); assert.equal(second.status, 0, second.stderr);
  const again = JSON.parse(second.stdout);
  assert.equal(again.changedRuns, 0); assert.equal(again.noOp, true);
  assert.equal(again.projectionDigest, proof.projectionDigest);
  assert.deepEqual(await rows(), corrected);
  await assert.rejects(getPayrollPeriodReadiness({ businessId: corrected[0].businessId, month: "2026-09", runId: corrected[1].id }, db), /Payroll run not found/);
});

test("ordinary published-payroll Reopen and direct finalized update remain forbidden after maintenance", async () => {
  const run = await db.payrollRun.findUniqueOrThrow({ where: { id: ids[0] } });
  await assert.rejects(db.payrollRun.update({ where: { id: run.id }, data: { periodEnd: oldEnd } }), /Finalized payroll runs are immutable/);
  await assert.rejects(reopenPayrollRun({
    businessId: run.businessId, runId: run.id, reason: "Synthetic verification of continued immutability",
    actor: { userId: run.createdById!, name: "Synthetic owner", email: "maintenance-owner@tetamu.local" },
    stepUp: { rawToken: "not-consumed-for-published-payroll", sessionId: randomUUID() },
  }, db), /published payslips cannot be reopened/);
});

test("corrected dates do not bypass fingerprint validation in the no-op path", async () => {
  const original = await db.payrollRun.findUniqueOrThrow({ where: { id: ids[1] } });
  await editRun(ids[1], { updatedAt: new Date("2026-09-21T00:00:00.000Z") });
  try {
    const beforeRows = await rows(), result = invoke();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HR_UAT_PERIOD_MAINTENANCE_FINGERPRINT_MISMATCH/);
    assert.deepEqual(await rows(), beforeRows);
  } finally { await editRun(ids[1], { updatedAt: original.updatedAt }); }
});

test("a correction committed after identity read but before locks is visible and rejects maintenance", async () => {
  // Last case: correction audit records intentionally remain until this disposable DB is dropped.
  for (const id of ids) await editRun(id, { periodEnd: oldEnd });
  const beforeRows = await rows(); let concurrentCommitted = false;
  const mod = await import(resolve("scripts/uat-preview-boundary-payroll-maintenance.ts"));
  const interleaved = db.$extends({ query: { async $queryRaw({ args, query }) {
    const result = await query(args);
    if (!concurrentCommitted) {
      concurrentCommitted = true;
      const run = targets[0].run;
      await db.$transaction(tx => tx.payrollCorrection.create({ data: {
        businessId: run.businessId, membershipId: run.entries[0].membershipId,
        originalPayrollEntryId: run.entries[0].id, applyToPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        originalAmount: 0, correctedAmount: 1, deltaType: "EARNING", deltaAmount: 1,
        code: "RACE_TEST", name: "Synthetic concurrent correction", reason: "Disposable concurrency verification",
        createdById: run.createdById,
      } }), { isolationLevel: "ReadCommitted" });
    }
    return result;
  } } });
  await assert.rejects(mod.maintainApprovedBoundaryPeriods(interleaved, environment()), /HR_UAT_PERIOD_MAINTENANCE_UNKNOWN_RELATION/);
  assert.equal(concurrentCommitted, true);
  assert.deepEqual(await rows(), beforeRows);
});

async function seedApprovedSyntheticRows() {
  // Entry/component reconciliation is deferred until commit, exactly as in the formal fixture.
  await db.$transaction(async tx => {
  const group = await tx.businessGroup.create({ data: { name: "Synthetic maintenance integration", code: `local-${randomUUID()}` } });
  for (const [index, t] of targets.entries()) {
    const { business, entries, components, payslipPublications, _count: ignored, ...run } = t.run; void ignored;
    await tx.business.create({ data: business });
    for (let n = 0; n < (index === 0 ? 2 : 1); n++) await tx.branch.create({ data: { businessId: business.id, name: `Synthetic branch ${n}` } });
    await tx.businessGroupMember.create({ data: { groupId: group.id, businessId: business.id, status: "ACTIVE" } });
    await tx.user.create({ data: { id: run.createdById, businessId: business.id, name: "Synthetic approved owner", email: `maintenance-${index}@tetamu.local`, role: "BUSINESS_OWNER" } });
    const member = entries[0].membership;
    const account = await tx.employeeAccount.create({ data: { name: entries[0].fullNameSnapshot, phoneNumber: `+6000000000${index + 1}`, phoneNormalized: `+6000000000${index + 1}` } });
    await tx.employeeBusinessMembership.create({ data: { ...member, employeeAccountId: account.id, fullName: entries[0].fullNameSnapshot, phoneNumber: account.phoneNumber, phoneNumberNormalized: account.phoneNormalized } });
    await tx.payrollRun.create({ data: { ...run, status: "DRAFT", submittedAt: null, submittedById: null, finalizedAt: null, finalizedById: null } as Prisma.PayrollRunUncheckedCreateInput });
    for (const row of entries) {
      const { membership: ignoredMember, _count: ignoredCounts, ...entry } = row; void ignoredMember; void ignoredCounts;
      await tx.payrollEntry.create({ data: entry as Prisma.PayrollEntryUncheckedCreateInput });
    }
    for (const row of components) {
      const { _count: ignoredCounts, ...component } = row; void ignoredCounts;
      await tx.payrollEntryComponent.create({ data: component as Prisma.PayrollEntryComponentUncheckedCreateInput });
    }
    await tx.payrollRun.update({ where: { id: run.id }, data: {
      status: "FINALIZED", submittedAt: run.submittedAt, submittedById: run.submittedById,
      finalizedAt: run.finalizedAt, finalizedById: run.finalizedById, updatedAt: run.updatedAt,
    } });
    for (const pub of payslipPublications) await tx.payrollPayslipPublication.create({ data: { ...pub, documentBytes: Buffer.from(`synthetic-payslip:${t.key}`) } });
  }
  });
}
