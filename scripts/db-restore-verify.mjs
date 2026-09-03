import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertRestoreEnvironment,
  buildOperationalEvent,
  countRestoreCatalogEntries,
  createS3ClientFromEnvironment,
  decryptFile,
  deliverFailureAlert,
  downloadObjectToFile,
  fileSize,
  listHealthyManifests,
  parseEncryptionKey,
  redactOperationalText,
  runCommand,
  sha256File,
  uploadJson,
  validateManifest,
  withS3Lock,
} from "./lib/database-backup-core.mjs";

if (!process.argv.includes("--disposable")) {
  throw new Error("Restore verification requires the explicit --disposable flag.");
}

const environment = assertRestoreEnvironment(process.env.BACKUP_ENVIRONMENT);
const bucket = required("BACKUP_S3_BUCKET");
const prefix = process.env.BACKUP_S3_PREFIX ?? `database-backups/${environment}`;
const key = parseEncryptionKey(required("BACKUP_ENCRYPTION_KEY"));
const s3 = createS3ClientFromEnvironment();
const pgBin = (name) => process.env[`PG_${name.toUpperCase()}_BIN`] ?? name;
const workDir = await mkdtemp(join(tmpdir(), "tetamu-restore-verify-"));
let pgStarted = false;
let pgData;
let port;

try {
  if (process.argv.includes("--test-alert-failure=checksum")) {
    assertControlledTestingAlertMode();
    throw new Error("Controlled checksum failure for Testing restore alert delivery.");
  }
  await withS3Lock({
    client: s3,
    bucket,
    key: `${prefix.replace(/\/+$/g, "")}/locks/restore-verify.lock`,
    action: executeRestoreVerification,
  });
} catch (error) {
  const event = buildOperationalEvent({
    event: "RESTORE_VERIFICATION_FAILED",
    status: "FAILED",
    environment,
    severity: "CRITICAL",
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-db-restore-verify",
    stage: "checksum-validation",
    code: "RESTORE_VERIFICATION_FAILED",
    message: error.message,
    details: { reason: error.message },
  });
  const alert = await deliverFailureAlert({
    event,
    webhookUrl: process.env.OPS_ALERT_WEBHOOK_URL ?? process.env.BACKUP_ALERT_WEBHOOK_URL,
  }).catch((alertError) => ({ delivered: false, reason: alertError.message }));
  console.error(JSON.stringify({ ...event, alert }));
  process.exitCode = 1;
} finally {
  if (pgStarted && pgData) {
    await runCommand(pgBin("pg_ctl"), ["-D", pgData, "-m", "fast", "stop"], {
      timeoutMs: 60_000,
    }).catch(() => {});
  }
  await rm(workDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  });
}

async function executeRestoreVerification() {
  const manifests = await listHealthyManifests({
    client: s3,
    bucket,
    prefix,
    environment,
  });
  const selected = selectManifest(manifests);
  validateManifest(selected.manifest, environment);

  const encryptedPath = join(workDir, "backup.dump.enc");
  const archivePath = join(workDir, "backup.dump");
  await downloadObjectToFile({
    client: s3,
    bucket,
    key: selected.manifest.archiveKey,
    filePath: encryptedPath,
  });
  const encryptedSha = await sha256File(encryptedPath);
  if (encryptedSha !== selected.manifest.encrypted.sha256) {
    throw new Error("Encrypted backup SHA-256 does not match its manifest.");
  }
  await decryptFile({ sourcePath: encryptedPath, destinationPath: archivePath, key });
  const sourceSha = await sha256File(archivePath);
  if (sourceSha !== selected.manifest.source.sha256) {
    throw new Error("Decrypted backup SHA-256 does not match its manifest.");
  }
  if ((await fileSize(archivePath)) <= 0) throw new Error("Decrypted backup is empty.");
  const catalog = await runCommand(pgBin("pg_restore"), ["--list", archivePath], {
    captureOutput: true,
  });
  const catalogEntries = countRestoreCatalogEntries(catalog.stdout);
  if (catalogEntries !== selected.manifest.source.catalogEntries) {
    throw new Error("Restore catalog count does not match the manifest.");
  }

  pgData = join(workDir, "postgres-data");
  const postgresLog = join(workDir, "postgres.log");
  port = await availablePort();
  const pgUser = "tetamu_restore_verifier";
  const pgDatabase = "tetamu_restore_verify";
  await runCommand(
    pgBin("initdb"),
    ["-D", pgData, "-U", pgUser, "--auth=trust", "--encoding=UTF8", "--locale=C"],
    { timeoutMs: 120_000 },
  );
  // Mark the disposable server as needing cleanup before startup. If pg_ctl
  // starts PostgreSQL but exits unexpectedly, the finally block will still
  // attempt a safe stop before deleting the temporary data directory.
  pgStarted = true;
  try {
    await runCommand(
      pgBin("pg_ctl"),
      [
        "-D",
        pgData,
        "-l",
        postgresLog,
        "-o",
        `-p ${port} -h 127.0.0.1`,
        "-w",
        "start",
      ],
      { timeoutMs: 120_000, resolveOnExit: true },
    );
  } catch (error) {
    const startupLog = await readFile(postgresLog, "utf8").catch(
      () => "PostgreSQL startup log was unavailable.",
    );
    throw new Error(
      `${error.message} PostgreSQL startup log: ${redactOperationalText(startupLog)}`,
    );
  }
  await runCommand(
    pgBin("createdb"),
    ["-h", "127.0.0.1", "-p", String(port), "-U", pgUser, pgDatabase],
  );
  await runCommand(
    pgBin("pg_restore"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      pgUser,
      "-d",
      pgDatabase,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      archivePath,
    ],
  );

  const checks = await queryJson(pgUser, pgDatabase, `
    SELECT json_build_object(
      'migrationHead', (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1),
      'businesses', (SELECT count(*) FROM businesses),
      'employeeAccounts', (SELECT count(*) FROM employee_accounts),
      'memberships', (SELECT count(*) FROM employee_business_memberships),
      'attendancePunches', (SELECT count(*) FROM attendance_punches),
      'leaveRequests', (SELECT count(*) FROM leave_requests),
      'claimLines', (SELECT count(*) FROM claim_lines),
      'timesheets', (SELECT count(*) FROM attendance_monthly_timesheets),
      'payrollRuns', (SELECT count(*) FROM payroll_runs),
      'payrollEntries', (SELECT count(*) FROM payroll_entries),
      'payslipPublications', (SELECT count(*) FROM payroll_payslip_publications),
      'auditLogs', (SELECT count(*) FROM audit_logs),
      'foreignKeys', (SELECT count(*) FROM pg_constraint WHERE contype = 'f'),
      'uniqueConstraints', (SELECT count(*) FROM pg_constraint WHERE contype = 'u'),
      'checkConstraints', (SELECT count(*) FROM pg_constraint WHERE contype = 'c'),
      'userTriggers', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)
    );
  `);
  if (!checks.migrationHead || Number(checks.businesses) <= 0) {
    throw new Error("Restored database failed core schema/data verification.");
  }

  const knownArtifacts = await queryJson(pgUser, pgDatabase, `
    SELECT json_build_object(
      'payrollRun', EXISTS(SELECT 1 FROM payroll_runs WHERE id = '2972941a-8067-4076-bf3b-24ddf08b308a'::uuid AND status = 'FINALIZED'),
      'payrollEntry', EXISTS(SELECT 1 FROM payroll_entries WHERE id = '09a34a1a-fc19-40f6-bede-7ce2956b84eb'::uuid),
      'payslipPublication', EXISTS(SELECT 1 FROM payroll_payslip_publications WHERE id = '34993730-8dfb-4754-a32a-9594123f11a3'::uuid)
    );
  `);
  if (!knownArtifacts.payrollRun || !knownArtifacts.payrollEntry || !knownArtifacts.payslipPublication) {
    throw new Error("Known immutable Payroll/Payslip artifacts are missing after restore.");
  }

  const requiredGuards = await queryJson(pgUser, pgDatabase, `
    SELECT json_build_object(
      'finalizedPayrollRunGuard', EXISTS(
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'payroll_runs_finalized_lock' AND NOT tgisinternal
      ),
      'payrollEntryGuard', EXISTS(
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'payroll_entries_non_draft_guard_update' AND NOT tgisinternal
      ),
      'payslipPublicationGuard', EXISTS(
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'payroll_payslip_publication_immutable_guard' AND NOT tgisinternal
      ),
      'statutorySnapshotGuard', EXISTS(
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'payroll_entry_statutory_snapshots_immutable' AND NOT tgisinternal
      )
    );
  `);
  if (Object.values(requiredGuards).some((value) => value !== true)) {
    throw new Error("Required Payroll/Payslip/statutory database guards are missing after restore.");
  }

  const result = buildOperationalEvent({
    event: "database_restore_verification_completed",
    status: "SUCCESS",
    environment,
    details: {
      manifestKey: selected.manifestKey,
      catalogEntries,
      checks,
      knownArtifacts,
      requiredGuards,
      disposableDatabase: true,
    },
  });
  const resultKey = `${prefix.replace(/\/+$/g, "")}/restore-verifications/${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  await uploadJson({ client: s3, bucket, key: resultKey, value: result });
  console.log(JSON.stringify({ ...result, resultKey }));
}

function selectManifest(manifests) {
  const requested = process.env.BACKUP_RESTORE_MANIFEST_KEY?.trim();
  const selected = requested
    ? manifests.find((item) => item.manifestKey === requested)
    : manifests.sort(
        (a, b) =>
          new Date(b.manifest.createdAt).valueOf() -
          new Date(a.manifest.createdAt).valueOf(),
      )[0];
  if (!selected) throw new Error("No healthy backup manifest is available for restore verification.");
  return selected;
}

async function queryJson(user, database, sql) {
  const result = await runCommand(
    pgBin("psql"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      user,
      "-d",
      database,
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { captureOutput: true },
  );
  return JSON.parse(result.stdout.trim());
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertControlledTestingAlertMode() {
  if (environment !== "testing" || process.env.OPS_ALERT_TEST_MODE !== "true") {
    throw new Error("Controlled restore alert injection requires Testing and OPS_ALERT_TEST_MODE=true.");
  }
}
