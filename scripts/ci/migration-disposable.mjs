// CI-only migration verification. Never loads dotenv or starts a database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertMigrationHistory } from "../lib/canonical-migration-history.mjs";

assert.equal(process.env.CI, "true", "CI runner required");
assert.equal(process.env.TETAMU_CI_DISPOSABLE_DATABASE, "true", "Disposable database opt-in required");
const target = new URL(process.env.DATABASE_URL ?? "");
assert.equal(target.protocol, "postgresql:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "5432");
assert.equal(target.pathname, "/tetamu_ci_disposable");
assert.equal(target.username, "postgres");
assert.equal(target.search, "?schema=public");
const db = new PrismaClient({ log: [] });
const prisma = resolve("node_modules/prisma/build/index.js");
function run(args) {
  const result = spawnSync(process.execPath, [prisma, ...args], { stdio: "inherit", env: process.env });
  assert.equal(result.status, 0, "Disposable migration validation failed");
}
try {
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  assert.equal(tables.length, 0, "Refusing to migrate a non-empty database");
  run(["migrate", "deploy"]);
  const expected = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => ({
      name: entry.name,
      checksum: createHash("sha256").update(readFileSync(`prisma/migrations/${entry.name}/migration.sql`)).digest("hex"),
    }));
  const rows = await db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  assertMigrationHistory(expected, rows);
  run(["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  console.log(`Disposable migration history and schema verified: ${expected.length} migrations.`);
} finally {
  await db.$disconnect();
}
