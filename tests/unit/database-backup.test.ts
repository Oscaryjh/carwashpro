import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BACKUP_MAGIC,
  assertRestoreEnvironment,
  buildBackupNames,
  buildManifest,
  buildObjectKeys,
  buildOperationalEvent,
  countRestoreCatalogEntries,
  decryptFile,
  deliverFailureAlert,
  encryptFile,
  formatBackupTimestamp,
  parseDatabaseUrl,
  parseEncryptionKey,
  planRetention,
  redactOperationalText,
  sha256File,
  validateManifest,
// @ts-expect-error Operational backup helpers are authored as native ESM JavaScript.
} from "../../scripts/lib/database-backup-core.mjs";

test("backup names are deterministic and environment-scoped", () => {
  const createdAt = new Date("2026-08-27T18:30:45.123Z");
  assert.equal(formatBackupTimestamp(createdAt), "20260827-183045");
  const names = buildBackupNames({ environment: "testing", createdAt, mode: "predeploy" });
  assert.equal(
    names.encryptedFileName,
    "tetamu-testing-postgres-20260827-183045.dump.enc",
  );
  assert.deepEqual(buildObjectKeys({ prefix: "/database-backups/testing/", names }), {
    archiveKey:
      "database-backups/testing/archives/tetamu-testing-postgres-20260827-183045.dump.enc",
    manifestKey:
      "database-backups/testing/manifests/tetamu-testing-postgres-20260827-183045.manifest.json",
  });
});

test("database URL is parsed without exposing its password", () => {
  const parsed = parseDatabaseUrl(
    "postgresql://tetamu:p%40ssword@example.test:6543/tetamu?sslmode=require&schema=public",
  );
  assert.deepEqual(parsed, {
    host: "example.test",
    port: "6543",
    database: "tetamu",
    user: "tetamu",
    password: "p@ssword",
    sslMode: "require",
  });
  assert.equal(
    redactOperationalText("failed postgresql://tetamu:secret@example.test/db token=abc"),
    "failed [REDACTED_DATABASE_URL] token=[REDACTED]",
  );
});

test("client-side encryption round-trips and rejects a wrong key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tetamu-backup-test-"));
  const source = join(directory, "source.dump");
  const encrypted = join(directory, "source.dump.enc");
  const restored = join(directory, "restored.dump");
  try {
    await writeFile(source, Buffer.from("postgres custom-format fixture\n".repeat(20)));
    const key = parseEncryptionKey("11".repeat(32));
    await encryptFile({ sourcePath: source, destinationPath: encrypted, key });
    const encryptedBytes = await readFile(encrypted);
    assert.ok(encryptedBytes.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC));
    await decryptFile({ sourcePath: encrypted, destinationPath: restored, key });
    assert.deepEqual(await readFile(restored), await readFile(source));
    assert.equal(await sha256File(restored), await sha256File(source));

    await assert.rejects(
      decryptFile({
        sourcePath: encrypted,
        destinationPath: join(directory, "wrong.dump"),
        key: parseEncryptionKey("22".repeat(32)),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manifest contains verification metadata but no encryption secret", () => {
  const manifest = buildManifest({
    environment: "testing",
    mode: "daily",
    createdAt: new Date("2026-08-27T18:30:00Z"),
    archiveKey: "database-backups/testing/archives/a.dump.enc",
    database: "tetamu_testing",
    applicationRelease: "4070f2fdeca66870004065efdad3b0d69d5274c6",
    migrationHead: "20260826000000_release_candidate",
    sourceBytes: 100,
    sourceSha256: "a".repeat(64),
    encryptedBytes: 137,
    encryptedSha256: "b".repeat(64),
    catalogEntries: 999,
    pgDumpVersion: "pg_dump (PostgreSQL) 18.0\n",
    encryptionKeyVersion: "testing-v1",
  });
  assert.equal(manifest.status, "HEALTHY");
  assert.equal(manifest.source.catalogEntries, 999);
  assert.equal(manifest.encrypted.algorithm, "AES-256-GCM");
  assert.equal(JSON.stringify(manifest).includes("BACKUP_ENCRYPTION_KEY"), false);
  assert.equal(validateManifest(manifest, "testing"), manifest);
});

test("retention preserves latest, protected and currently restored backups", () => {
  const item = (name: string, createdAt: string, protectedBackup = false) => ({
    manifestKey: `manifests/${name}.json`,
    manifest: {
      status: "HEALTHY",
      createdAt,
      protected: protectedBackup,
      archiveKey: `archives/${name}.enc`,
    },
  });
  const manifests = [
    item("latest", "2026-08-27T00:00:00Z"),
    item("expired", "2026-06-01T00:00:00Z"),
    item("predeploy", "2026-05-01T00:00:00Z", true),
    item("current-restore", "2026-04-01T00:00:00Z"),
  ];
  const result = planRetention({
    manifests,
    now: new Date("2026-08-27T12:00:00Z"),
    retentionDays: 30,
    currentRestoreManifestKey: "manifests/current-restore.json",
  });
  assert.deepEqual(result.deletions.map((entry: { manifestKey: string }) => entry.manifestKey), [
    "manifests/expired.json",
  ]);
  assert.equal(result.retained.length, 3);
});

test("restore verifier rejects Production", () => {
  assert.throws(() => assertRestoreEnvironment("production"), /never run against Production/);
  assert.equal(assertRestoreEnvironment("testing"), "testing");
});

test("catalog parser counts only pg_restore catalog entries", () => {
  assert.equal(
    countRestoreCatalogEntries(`; Archive created at 2026\n1; 0 0 TABLE public x owner\n2; 0 0 DATA public x owner\n`),
    2,
  );
});

test("failure alert is PARTIAL without destination and delivers to configured hook", async () => {
  const event = buildOperationalEvent({
    event: "BACKUP_JOB_FAILED",
    status: "FAILED",
    environment: "testing",
    details: { reason: "backup failed" },
  });
  assert.deepEqual(await deliverFailureAlert({ event }), {
    delivered: false,
    attempts: 0,
    reason: "ALERT_DESTINATION_NOT_CONFIGURED",
  });

  let capturedBody = "";
  const result = await deliverFailureAlert({
    event,
    webhookUrl: "https://alerts.example.test/hook",
    fetchImpl: async (_url: string | URL, init?: RequestInit) => {
      capturedBody = String(init?.body);
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(result, { delivered: true, attempts: 1 });
  assert.equal(JSON.parse(capturedBody).event, "BACKUP_JOB_FAILED");
  assert.equal(JSON.parse(capturedBody).severity, "CRITICAL");
});

test("failure alert retries bounded transient receiver errors", async () => {
  const event = buildOperationalEvent({
    event: "RESTORE_VERIFICATION_FAILED",
    status: "FAILED",
    environment: "testing",
    details: { reason: "checksum failed" },
  });
  let attempts = 0;
  const result = await deliverFailureAlert({
    event,
    webhookUrl: "https://alerts.example.test/hook",
    fetchImpl: async () => {
      attempts += 1;
      return new Response(attempts < 3 ? null : JSON.stringify({ messageId: "evt-123" }), {
        status: attempts < 3 ? 503 : 200,
        headers: { "content-type": "application/json" },
      });
    },
    sleepImpl: async () => undefined,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(result, { delivered: true, attempts: 3, receiverId: "evt-123" });
});
