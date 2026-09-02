import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildBackupNames,
  buildManifest,
  buildObjectKeys,
  buildOperationalEvent,
  countRestoreCatalogEntries,
  createS3ClientFromEnvironment,
  databaseCommandEnvironment,
  databaseConnectionArgs,
  deleteBackupPair,
  deleteObject,
  deliverFailureAlert,
  encryptFile,
  fileSize,
  listHealthyManifests,
  parseEncryptionKey,
  planRetention,
  runCommand,
  sha256File,
  uploadFile,
  uploadJson,
  withS3Lock,
} from "./lib/database-backup-core.mjs";

const environment = process.env.BACKUP_ENVIRONMENT;
const databaseUrl = process.env.DATABASE_URL;
const bucket = required("BACKUP_S3_BUCKET");
const prefix = process.env.BACKUP_S3_PREFIX ?? `database-backups/${environment}`;
const mode = process.argv.includes("--predeploy") ? "predeploy" : "daily";
const dryRunRetention = process.argv.includes("--dry-run-retention");
const pgDump = process.env.PG_DUMP_BIN ?? "pg_dump";
const pgRestore = process.env.PG_RESTORE_BIN ?? "pg_restore";
const psql = process.env.PG_PSQL_BIN ?? "psql";
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "30");
const encryptionKey = parseEncryptionKey(required("BACKUP_ENCRYPTION_KEY"));
const keyVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION ?? "v1";
const s3 = createS3ClientFromEnvironment();
const workDir = await mkdtemp(join(tmpdir(), "tetamu-backup-"));

try {
  if (process.argv.includes("--test-alert-failure=archive-validation")) {
    assertControlledTestingAlertMode();
    throw new Error("Controlled archive-validation failure for Testing alert delivery.");
  }
  await withS3Lock({
    client: s3,
    bucket,
    key: `${prefix.replace(/\/+$/g, "")}/locks/backup.lock`,
    action: executeBackup,
  });
} catch (error) {
  const event = buildOperationalEvent({
    event: "BACKUP_JOB_FAILED",
    status: "FAILED",
    environment,
    severity: "CRITICAL",
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-db-backup",
    stage: "archive-validation",
    code: "BACKUP_JOB_FAILED",
    message: error.message,
    details: { reason: error.message, mode },
  });
  const alert = await deliverFailureAlert({
    event,
    webhookUrl: process.env.OPS_ALERT_WEBHOOK_URL ?? process.env.BACKUP_ALERT_WEBHOOK_URL,
  }).catch((alertError) => ({ delivered: false, reason: alertError.message }));
  console.error(JSON.stringify({ ...event, alert }));
  process.exitCode = 1;
} finally {
  await rm(workDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  });
}

async function executeBackup() {
  const createdAt = new Date();
  const names = buildBackupNames({ environment, createdAt, mode });
  const keys = buildObjectKeys({ prefix, names });
  const archivePath = join(workDir, names.archiveFileName);
  const encryptedPath = join(workDir, names.encryptedFileName);
  const manifestPath = join(workDir, names.manifestFileName);
  const pgEnv = databaseCommandEnvironment(databaseUrl);
  const connectionArgs = databaseConnectionArgs(databaseUrl);
  const database = new URL(databaseUrl).pathname.replace(/^\//, "");
  const migration = await runCommand(
    psql,
    [
      ...connectionArgs,
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      "--command=SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
    ],
    { env: pgEnv, captureOutput: true },
  );
  const migrationHead = migration.stdout.trim();
  if (!migrationHead) throw new Error("Database migration head could not be determined.");

  const version = await runCommand(pgDump, ["--version"], {
    env: pgEnv,
    captureOutput: true,
  });
  await runCommand(
    pgDump,
    [
      ...connectionArgs,
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      `--file=${archivePath}`,
    ],
    { env: pgEnv },
  );

  const sourceBytes = await fileSize(archivePath);
  if (sourceBytes <= 0) throw new Error("pg_dump created an empty archive.");
  const catalog = await runCommand(pgRestore, ["--list", archivePath], {
    env: pgEnv,
    captureOutput: true,
  });
  const catalogEntries = countRestoreCatalogEntries(catalog.stdout);
  if (catalogEntries <= 0) throw new Error("pg_restore catalog validation returned no entries.");
  const sourceSha256 = await sha256File(archivePath);
  await encryptFile({ sourcePath: archivePath, destinationPath: encryptedPath, key: encryptionKey });
  const encryptedBytes = await fileSize(encryptedPath);
  const encryptedSha256 = await sha256File(encryptedPath);
  const manifest = buildManifest({
    environment,
    mode,
    createdAt,
    archiveKey: keys.archiveKey,
    database,
    applicationRelease: required("BACKUP_RELEASE_COMMIT"),
    migrationHead,
    sourceBytes,
    sourceSha256,
    encryptedBytes,
    encryptedSha256,
    catalogEntries,
    pgDumpVersion: version.stdout,
    encryptionKeyVersion: keyVersion,
    protectedBackup: mode === "predeploy",
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  let archiveUploaded = false;
  try {
    await uploadFile({
      client: s3,
      bucket,
      key: keys.archiveKey,
      filePath: encryptedPath,
      contentType: "application/octet-stream",
    });
    archiveUploaded = true;
    await uploadJson({ client: s3, bucket, key: keys.manifestKey, value: manifest });
  } catch (error) {
    if (archiveUploaded) {
      await deleteObject({ client: s3, bucket, key: keys.archiveKey }).catch(() => {});
    }
    throw error;
  }

  const manifests = await listHealthyManifests({
    client: s3,
    bucket,
    prefix,
    environment,
  });
  const retention = planRetention({ manifests, retentionDays });
  if (!dryRunRetention) {
    for (const item of retention.deletions) {
      await deleteBackupPair({ client: s3, bucket, item });
    }
  }

  console.log(
    JSON.stringify(
      buildOperationalEvent({
        event: "database_backup_retention_completed",
        status: "SUCCESS",
        environment,
        details: {
          dryRun: dryRunRetention,
          cutoff: retention.cutoff,
          candidates: retention.deletions.length,
          deleted: dryRunRetention ? 0 : retention.deletions.length,
          healthyRetained: retention.retained.length,
        },
      }),
    ),
  );

  console.log(
    JSON.stringify(
      buildOperationalEvent({
        event: "database_backup_completed",
        status: "SUCCESS",
        environment,
        details: {
          mode,
          manifestKey: keys.manifestKey,
          archiveBytes: encryptedBytes,
          archiveSha256: encryptedSha256,
          catalogEntries,
          retentionDryRun: dryRunRetention,
          retentionCandidates: retention.deletions.length,
          retentionDeleted: dryRunRetention ? 0 : retention.deletions.length,
        },
      }),
    ),
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertControlledTestingAlertMode() {
  if (String(environment).toLowerCase() !== "testing" || process.env.OPS_ALERT_TEST_MODE !== "true") {
    throw new Error("Controlled backup alert injection requires Testing and OPS_ALERT_TEST_MODE=true.");
  }
}
