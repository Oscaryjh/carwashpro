import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertMigrationHistory } from "./lib/canonical-migration-history.mjs";
import {
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const pg = createEmbeddedPostgres();
const databaseName = `tetamu_migration_verify_${process.pid}_${Date.now()}`;
const databaseUrl = `postgresql://postgres:postgres@localhost:5432/${databaseName}?schema=public`;
let ownsPostgres = false;

try {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, databaseName);
  await waitForPostgres(pg, databaseName);
  await runPrismaMigrateDeploy(databaseUrl);
  await verifyMigrationHistory(databaseName);
  if (process.argv.includes("--schema-diff")) {
    await inspectPrismaDiff(databaseUrl);
    await inspectCatalog(databaseName);
  }
  console.log(`Fresh migration rebuild passed for disposable database ${databaseName}.`);
} finally {
  await dropDisposableDatabase(databaseName);
  await stopOwnedPostgres(pg, ownsPostgres);
}

async function inspectPrismaDiff(url) {
  const prismaCommand = resolve("node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
  const child = spawn(prismaCommand, ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], {
    shell: process.platform === "win32", env: { ...process.env, DATABASE_URL: url },
  });
  let output = "";
  for await (const chunk of child.stdout) output += chunk;
  let errors = "";
  for await (const chunk of child.stderr) errors += chunk;
  const code = await new Promise((resolvePromise) => child.once("close", resolvePromise));
  const expected = [
    "[*] Changed the `attendance_timesheet_p2_segment_snapshots` table",
    '  [*] Renamed the foreign key "attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i" to "att_ts_p2_segment_source_day_snapshot_fkey_probe"',
  ].join("\n");
  if (code !== 2 || output.trim().replaceAll("\r\n", "\n") !== expected) {
    throw new Error(`Unexpected Prisma/database drift (exit ${code}):\n${output}\n${errors}`);
  }
  console.log("Verified Prisma schema diff: only the documented same-name FK/index representation limitation.");
}

async function inspectCatalog(targetName) {
  const client = pg.getPgClient(targetName, "127.0.0.1");
  try {
    await client.connect();
    const counts = await client.query(`SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') AS tables,
      (SELECT count(*)::int FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped) AS columns,
      (SELECT count(*)::int FROM pg_indexes WHERE schemaname='public') AS indexes,
      (SELECT count(*)::int FROM pg_constraint x JOIN pg_namespace n ON n.oid=x.connamespace WHERE n.nspname='public' AND x.contype='f') AS foreign_keys,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS user_triggers`);
    const name = "attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i";
    const fk = await client.query("SELECT count(*)::int AS total FROM pg_constraint WHERE conname=$1 AND contype='f'", [name]);
    const index = await client.query("SELECT count(*)::int AS total FROM pg_indexes WHERE schemaname='public' AND indexname=$1", [name]);
    const performance = await client.query("SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [[
      "performance_attributions", "performance_shares", "performance_receipts", "performance_target_versions", "performance_contributions", "performance_source_issues",
    ]]);
    const expectedCounts = { tables: 247, columns: 3869, indexes: 1186, foreign_keys: 835, user_triggers: 291 };
    if (JSON.stringify(counts.rows[0]) !== JSON.stringify(expectedCounts)) {
      throw new Error(`Fresh 222 catalog drift: expected ${JSON.stringify(expectedCounts)}, got ${JSON.stringify(counts.rows[0])}`);
    }
    if (fk.rows[0].total !== 1 || index.rows[0].total !== 1 || performance.rows[0].total !== 6) {
      throw new Error(`Fresh catalog objects incomplete: FK=${fk.rows[0].total}, index=${index.rows[0].total}, Performance=${performance.rows[0].total}`);
    }
    console.log(`[catalog] ${JSON.stringify(counts.rows[0])}; same-name FK/index and six Performance tables verified.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyMigrationHistory(targetName) {
  const migrationRoot = resolve("prisma", "migrations");
  const expected = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      checksum: createHash("sha256")
        .update(readFileSync(resolve(migrationRoot, entry.name, "migration.sql")))
        .digest("hex"),
    }));
  if (expected.length !== 222) {
    throw new Error(`Expected 222 canonical SQL migrations, got ${expected.length}`);
  }
  const client = pg.getPgClient(targetName, "127.0.0.1");
  try {
    await client.connect();
    const result = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    assertMigrationHistory(expected, result.rows);
    console.log(`Verified ${result.rows.length}/222 completed migration history rows and SQL checksums.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function runPrismaMigrateDeploy(url) {
  const prismaCommand = resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(prismaCommand, ["migrate", "deploy"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, DATABASE_URL: url },
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`prisma migrate deploy exited with code ${code}`));
    });
  });
}

async function dropDisposableDatabase(targetName) {
  if (!/^tetamu_migration_verify_\d+_\d+$/.test(targetName)) {
    throw new Error(`Refusing to drop unexpected database name: ${targetName}`);
  }
  const client = pg.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [targetName],
    );
    await client.query(`DROP DATABASE ${client.escapeIdentifier(targetName)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
