import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PrismaClient } from "@prisma/client";

const rcMigration = "20260920000100_controlled_manual_pcb_source";
const root = process.cwd();
const migrations = join(root, "prisma/migrations");
const names = readdirSync(migrations).filter((name) => /^\d{14}_/.test(name)).sort();
const protectedTables = ["businesses", "users", "employee_business_memberships", "employee_compensation_versions", "attendance_monthly_timesheets", "attendance_timesheet_revisions", "payroll_runs", "payroll_entries", "payroll_entry_components", "payroll_entry_statutory_snapshots", "invoices", "payments"];

// This is an upgrade/recovery characterization of the real migration and CLI,
// not a substitute for service workflow or browser tests.
test("r9 to RC preserves payroll/POS rows, verifies every migration checksum, restores and replays idempotently", async () => {
  const source = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.RC_DISPOSABLE_TEST, "1");
  assert.ok(["127.0.0.1", "localhost"].includes(source.hostname));
  assert.equal(source.pathname, "/rc_pcb_verification_vc1_disposable_synthetic");
  const dbName = `tetamu_uat_preview_fixture_${process.pid}_${Date.now()}`;
  const restoreName = `rc_restore_${process.pid}_${Date.now()}`;
  assert.match(dbName, /^tetamu_uat_preview_fixture_\d+_\d+$/);
  assert.match(restoreName, /^rc_restore_\d+_\d+$/);
  const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
  const targetUrl = new URL(source); targetUrl.pathname = `/${dbName}`;
  const restoreUrl = new URL(source); restoreUrl.pathname = `/${restoreName}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
  const restored = new PrismaClient({ datasources: { db: { url: restoreUrl.toString() } } });
  const directory = mkdtempSync(join(process.env.TMPDIR!, "rc-upgrade-"));
  const historical = join(directory, "prisma");
  cpSync(join(root, "prisma"), historical, { recursive: true, filter: (file) => {
    const [kind, name] = relative(join(root, "prisma"), file).split(sep);
    return kind !== "migrations" || !name || !/^\d{14}_/.test(name) || name < rcMigration;
  } });
  const env = { ...process.env, DATABASE_URL: targetUrl.toString() };
  const cli = join(root, "node_modules/prisma/build/index.js");
  const run = (binary: string, args: string[], extra: NodeJS.ProcessEnv = env) => {
    const result = spawnSync(binary, args, { cwd: root, env: extra, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    // Never include SQL row values, credentials, process environment or raw logs.
    assert.equal(result.status, 0, `RC_UPGRADE_SUBPROCESS_FAILED:${binary === process.execPath ? "node" : binary}:` +
      ["PrismaClientKnownRequestError", "P2021", "P2003", "P3018", "version mismatch", "permission denied", "Cannot find"].filter((code) => `${result.stdout}${result.stderr}`.includes(code)).join(","));
  };
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${restoreName}"`);
    run(process.execPath, [cli, "migrate", "deploy", "--schema", join(historical, "schema.prisma")]);
    await verifyLedger(target, names.filter((name) => name < rcMigration));
    run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const {createCanonicalPcbFixture} = (await import('./tests/helpers/manual-pcb-fixture.ts')).default;
      const {prisma} = (await import('./src/lib/prisma.ts')).default;
      try {
        const f = await createCanonicalPcbFixture();
        const invoice = await prisma.invoice.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceNumber:'RC-SENTINEL',subtotal:125,total:125,paidAmount:125,balance:0,status:'PAID'}});
        await prisma.payment.create({data:{businessId:f.business.id,branchId:f.branch.id,invoiceId:invoice.id,amount:125,method:'CASH'}});
      } finally { await prisma.$disconnect(); }
    `]);
    const before = await snapshot(target);
    assert.equal(before.payroll_entries.count, 1);
    assert.equal(before.payments.count, 1);
    run(process.execPath, [cli, "migrate", "deploy"]);
    await verifyLedger(target, names);
    assert.deepEqual(await snapshot(target), before, "RC migration changed protected financial rows");
    assert.equal(await target.payrollManualPcbConfirmation.count(), 0, "Upgrade must not manufacture confirmations");
    run(process.execPath, [cli, "migrate", "deploy"]);
    assert.deepEqual(await snapshot(target), before);
    await verifyLedger(target, names);

    const dump = join(directory, "synthetic.dump");
    const pgEnv = { ...env, PGHOST: source.hostname, PGPORT: source.port, PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) };
    run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dump, dbName], pgEnv);
    run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", restoreName, dump], pgEnv);
    assert.deepEqual(await snapshot(restored), before, "Restore changed protected financial rows");
    await verifyLedger(restored, names);
    assert.equal(await restored.payrollManualPcbConfirmation.count(), 0);
    console.log(`RC_UPGRADE_RECOVERY ${JSON.stringify({ migrationCount: names.length, checksumsMatched: true, protectedTables: protectedTables.length, sentinelsPreserved: true, replayIdempotent: true, restoreMatched: true })}`);
  } finally {
    await target.$disconnect(); await restored.$disconnect();
    for (const name of [dbName, restoreName]) {
      await admin.$executeRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", name);
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    }
    await admin.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function verifyLedger(db: PrismaClient, expected: string[]) {
  const rows = await db.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; started_at: Date }>>`
    SELECT migration_name, checksum, finished_at, rolled_back_at, started_at FROM "_prisma_migrations" ORDER BY started_at, migration_name
  `;
  assert.deepEqual(rows.map((row) => row.migration_name), expected);
  for (const row of rows) {
    assert.ok(row.finished_at); assert.equal(row.rolled_back_at, null);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(join(migrations, row.migration_name, "migration.sql"))).digest("hex"));
  }
}

async function snapshot(db: PrismaClient) {
  const result: Record<string, { count: number; digest: string }> = {};
  for (const table of protectedTables) {
    const rows = await db.$queryRawUnsafe<Array<{ data: string }>>(`SELECT row_to_json(t)::text AS data FROM "${table}" t ORDER BY id`);
    result[table] = { count: rows.length, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return result;
}
