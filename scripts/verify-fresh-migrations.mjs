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
  console.log(`Fresh migration rebuild passed for disposable database ${databaseName}.`);
} finally {
  await dropDisposableDatabase(databaseName);
  await stopOwnedPostgres(pg, ownsPostgres);
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
