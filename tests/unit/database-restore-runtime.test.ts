import assert from "node:assert/strict";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import {
  buildDisposablePostgresPaths,
  buildDisposablePostgresStartArgs,
  cleanupDisposablePostgres,
  prepareDisposablePostgres,
  startDisposablePostgres,
// @ts-expect-error Restore runtime helpers are authored as native ESM JavaScript.
} from "../../scripts/lib/database-restore-runtime.mjs";

test("disposable PostgreSQL uses a fixture-owned writable socket directory", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "tetamu-restore-runtime-test-"));
  const paths = buildDisposablePostgresPaths(workDir);
  try {
    assert.equal(relative(workDir, paths.socketDir), "pg-socket");
    await prepareDisposablePostgres(paths);
    assert.equal((await stat(paths.socketDir)).mode & 0o777, 0o700);
  } finally {
    await cleanupDisposablePostgres({ pgCtl: "pg_ctl", paths, startAttempted: false });
  }
});

test("pg_ctl is restricted to localhost and the disposable socket path", () => {
  const paths = buildDisposablePostgresPaths("/tmp/tetamu-restore-runtime-test");
  const args = buildDisposablePostgresStartArgs({ paths, port: 54321 });
  assert.deepEqual(args.slice(0, 4), ["-D", paths.pgData, "-l", paths.startupLog]);
  assert.equal(args[5], `-p 54321 -h 127.0.0.1 -k ${paths.socketDir}`);
  assert.equal(args.includes("/var/run/postgresql"), false);
});

test("startup failure emits a sanitized PostgreSQL log", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "tetamu-restore-runtime-test-"));
  const paths = buildDisposablePostgresPaths(workDir);
  try {
    await writeFile(
      paths.startupLog,
      "FATAL: socket permission denied password=hunter2 postgresql://user:secret@example/db",
    );
    await assert.rejects(
      startDisposablePostgres({
        pgCtl: "pg_ctl",
        paths,
        port: 54321,
        runCommandImpl: async () => {
          throw new Error("pg_ctl exited with code 1");
        },
      }),
      (error: Error) => {
        assert.match(error.message, /socket permission denied/);
        assert.equal(error.message.includes("hunter2"), false);
        assert.equal(error.message.includes("user:secret"), false);
        return true;
      },
    );
  } finally {
    await cleanupDisposablePostgres({ pgCtl: "pg_ctl", paths, startAttempted: false });
  }
});

test("failure cleanup attempts a fast stop and removes every disposable artifact", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "tetamu-restore-runtime-test-"));
  const paths = buildDisposablePostgresPaths(workDir);
  await prepareDisposablePostgres(paths);
  await writeFile(join(paths.socketDir, "fixture.lock"), "fixture");
  let stopAttempted = false;
  await cleanupDisposablePostgres({
    pgCtl: "pg_ctl",
    paths,
    startAttempted: true,
    runCommandImpl: async (_command: string, args: string[]) => {
      stopAttempted = args.includes("stop");
      throw new Error("fixture startup never completed");
    },
  });
  assert.equal(stopAttempted, true);
  await assert.rejects(access(workDir));
});

test("restore runtime contains no canonical database target", async () => {
  const source = await readFile(
    join(process.cwd(), "scripts/db-restore-verify.mjs"),
    "utf8",
  );
  assert.match(source, /const pgDatabase = "tetamu_restore_verify"/);
  assert.match(source, /'migrationCount'/);
  assert.match(source, /'failedMigrations'/);
  assert.equal(source.includes("prisma migrate reset"), false);
  assert.equal(source.includes("Postgres-Canonical-Testing"), false);
});

test("database operations image includes the restore runtime helper", async () => {
  const dockerfile = await readFile(
    join(process.cwd(), "Dockerfile.database-ops"),
    "utf8",
  );
  assert.match(
    dockerfile,
    /COPY scripts\/lib\/database-restore-runtime\.mjs scripts\/lib\/database-restore-runtime\.mjs/,
  );
});
