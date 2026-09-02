import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAGIC = Buffer.from("TETAMUDB1", "ascii");
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

const ALLOWED_ENVIRONMENTS = new Set(["testing", "production"]);
const HEALTHY_MANIFEST_STATUS = "HEALTHY";

export function assertSupportedEnvironment(value) {
  const environment = String(value ?? "").trim().toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error("BACKUP_ENVIRONMENT must be testing or production.");
  }
  return environment;
}

export function assertRestoreEnvironment(value) {
  const environment = assertSupportedEnvironment(value);
  if (environment === "production") {
    throw new Error(
      "Disposable restore verification must never run against Production.",
    );
  }
  return environment;
}

export function formatBackupTimestamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new Error("A valid backup timestamp is required.");
  }
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function buildBackupNames({ environment, createdAt = new Date() }) {
  const safeEnvironment = assertSupportedEnvironment(environment);
  const timestamp = formatBackupTimestamp(createdAt);
  const baseName = `tetamu-${safeEnvironment}-postgres-${timestamp}`;
  return {
    baseName,
    archiveFileName: `${baseName}.dump`,
    encryptedFileName: `${baseName}.dump.enc`,
    manifestFileName: `${baseName}.manifest.json`,
  };
}

export function buildObjectKeys({ prefix, names }) {
  const cleanPrefix = String(prefix ?? "database-backups")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.{2,}/g, "");
  return {
    archiveKey: `${cleanPrefix}/archives/${names.encryptedFileName}`,
    manifestKey: `${cleanPrefix}/manifests/${names.manifestFileName}`,
  };
}

export function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("DATABASE_URL must include a database name.");
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: url.searchParams.get("sslmode") ?? undefined,
  };
}

export function databaseCommandEnvironment(databaseUrl, environment = process.env) {
  const parsed = parseDatabaseUrl(databaseUrl);
  return {
    ...environment,
    PGPASSWORD: parsed.password,
    ...(parsed.sslMode ? { PGSSLMODE: parsed.sslMode } : {}),
  };
}

export function databaseConnectionArgs(databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  return [
    "--host",
    parsed.host,
    "--port",
    parsed.port,
    "--username",
    parsed.user,
    "--dbname",
    parsed.database,
  ];
}

export function parseEncryptionKey(value) {
  const text = String(value ?? "").trim();
  const key = /^[a-f\d]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : Buffer.from(text, "base64");
  if (key.length !== 32) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64.",
    );
  }
  return key;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function encryptFile({ sourcePath, destinationPath, key }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const output = createWriteStream(destinationPath, { flags: "wx" });
  output.write(BACKUP_MAGIC);
  output.write(iv);
  await pipeline(createReadStream(sourcePath), cipher, output, { end: false });
  const authTag = cipher.getAuthTag();
  await new Promise((resolve, reject) => {
    output.end(authTag, (error) => (error ? reject(error) : resolve()));
  });
  return { algorithm: "AES-256-GCM", ivBytes: iv.length, authTagBytes: authTag.length };
}

export async function decryptFile({ sourcePath, destinationPath, key }) {
  const encryptedBytes = (await stat(sourcePath)).size;
  const minimumLength = BACKUP_MAGIC.length + 12 + 16;
  if (encryptedBytes <= minimumLength) {
    throw new Error("Encrypted backup is truncated.");
  }
  const handle = await open(sourcePath, "r");
  const header = Buffer.alloc(BACKUP_MAGIC.length + 12);
  const authTag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(authTag, 0, authTag.length, encryptedBytes - authTag.length);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("Encrypted backup magic header is invalid.");
  }
  const ivStart = BACKUP_MAGIC.length;
  const iv = header.subarray(ivStart, ivStart + 12);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  await pipeline(
    createReadStream(sourcePath, {
      start: header.length,
      end: encryptedBytes - authTag.length - 1,
    }),
    decipher,
    createWriteStream(destinationPath, { flags: "wx" }),
  );
}

export function countRestoreCatalogEntries(catalogText) {
  return String(catalogText ?? "")
    .split(/\r?\n/)
    .filter((line) => /^\d+;/.test(line.trim())).length;
}

export async function runCommand(
  command,
  args,
  {
    env = process.env,
    cwd = process.cwd(),
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    captureOutput = false,
    resolveOnExit = false,
    input,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${basename(command)} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (captureOutput) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once(resolveOnExit ? "exit" : "close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${basename(command)} exited with code ${code}. ${redactOperationalText(stderr)}`.trim(),
          ),
        );
      }
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export function buildManifest({
  environment,
  mode,
  createdAt,
  archiveKey,
  database,
  applicationRelease,
  migrationHead,
  sourceBytes,
  sourceSha256,
  encryptedBytes,
  encryptedSha256,
  catalogEntries,
  pgDumpVersion,
  encryptionKeyVersion,
  protectedBackup = false,
}) {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    status: HEALTHY_MANIFEST_STATUS,
    environment: assertSupportedEnvironment(environment),
    mode: mode === "predeploy" ? "predeploy" : "daily",
    createdAt: new Date(createdAt).toISOString(),
    archiveKey,
    database: String(database),
    applicationRelease: String(applicationRelease),
    migrationHead: String(migrationHead),
    source: {
      bytes: Number(sourceBytes),
      sha256: sourceSha256,
      format: "postgres-custom",
      catalogEntries: Number(catalogEntries),
      pgDumpVersion: pgDumpVersion.trim(),
    },
    encrypted: {
      bytes: Number(encryptedBytes),
      sha256: encryptedSha256,
      algorithm: "AES-256-GCM",
      keyVersion: String(encryptionKeyVersion),
    },
    protected: Boolean(protectedBackup || mode === "predeploy"),
  };
}

export function validateManifest(manifest, expectedEnvironment) {
  if (!manifest || manifest.status !== HEALTHY_MANIFEST_STATUS) {
    throw new Error("Backup manifest is not healthy.");
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("Backup manifest format is not supported.");
  }
  if (manifest.environment !== assertSupportedEnvironment(expectedEnvironment)) {
    throw new Error("Backup manifest environment does not match the requested environment.");
  }
  if (
    !manifest.archiveKey ||
    !manifest.database ||
    !manifest.applicationRelease ||
    !manifest.migrationHead ||
    !manifest.source?.sha256 ||
    !manifest.encrypted?.sha256
  ) {
    throw new Error("Backup manifest is incomplete.");
  }
  return manifest;
}

export function planRetention({
  manifests,
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
  currentRestoreManifestKey,
  minimumHealthyBackups = 1,
}) {
  const healthy = manifests
    .filter((item) => item.manifest?.status === HEALTHY_MANIFEST_STATUS)
    .sort(
      (a, b) =>
        new Date(b.manifest.createdAt).valueOf() -
        new Date(a.manifest.createdAt).valueOf(),
    );
  const protectedKeys = new Set(
    healthy
      .filter(
        (item, index) =>
          index < minimumHealthyBackups ||
          item.manifest.protected ||
          item.manifestKey === currentRestoreManifestKey,
      )
      .map((item) => item.manifestKey),
  );
  const cutoff = new Date(now.valueOf() - retentionDays * 24 * 60 * 60 * 1000);
  const deletions = [];
  const retained = [];
  for (const item of healthy) {
    const expired = new Date(item.manifest.createdAt) < cutoff;
    if (expired && !protectedKeys.has(item.manifestKey)) deletions.push(item);
    else retained.push(item);
  }
  return { cutoff: cutoff.toISOString(), deletions, retained, protectedKeys };
}

export function createS3ClientFromEnvironment(environment = process.env) {
  const endpoint = requiredValue(environment.BACKUP_S3_ENDPOINT, "BACKUP_S3_ENDPOINT");
  const region = requiredValue(environment.BACKUP_S3_REGION, "BACKUP_S3_REGION");
  const accessKeyId = requiredValue(
    environment.BACKUP_S3_ACCESS_KEY_ID,
    "BACKUP_S3_ACCESS_KEY_ID",
  );
  const secretAccessKey = requiredValue(
    environment.BACKUP_S3_SECRET_ACCESS_KEY,
    "BACKUP_S3_SECRET_ACCESS_KEY",
  );
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function uploadFile({ client, bucket, key, filePath, contentType }) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    }),
  );
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function uploadJson({ client, bucket, key, value }) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );
  return body.length;
}

export async function downloadObjectToFile({ client, bucket, key, filePath }) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Backup object ${key} has no body.`);
  await pipeline(response.Body, createWriteStream(filePath, { flags: "wx" }));
}

export async function readJsonObject({ client, bucket, key }) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Manifest ${key} has no body.`);
  return JSON.parse(await response.Body.transformToString());
}

export async function listHealthyManifests({ client, bucket, prefix, environment }) {
  const manifestPrefix = `${String(prefix).replace(/\/+$/g, "")}/manifests/`;
  const keys = [];
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: manifestPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith(".manifest.json")) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const manifests = [];
  for (const manifestKey of keys) {
    try {
      const manifest = await readJsonObject({ client, bucket, key: manifestKey });
      validateManifest(manifest, environment);
      manifests.push({ manifestKey, manifest });
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "database_backup_manifest_ignored",
          manifestKey,
          reason: redactOperationalText(error.message),
        }),
      );
    }
  }
  return manifests;
}

export async function deleteBackupPair({ client, bucket, item }) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.manifest.archiveKey }));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.manifestKey }));
}

export async function deleteObject({ client, bucket, key }) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function withS3Lock({ client, bucket, key, action }) {
  const owner = `${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify({ owner, createdAt: new Date().toISOString() }),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    throw new Error(`Database backup lock is already held: ${redactOperationalText(error.message)}`);
  }
  try {
    return await action();
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
  }
}

export function buildOperationalEvent({
  event,
  status,
  environment,
  severity = status === "FAILED" ? "CRITICAL" : "INFO",
  service = "database-operations",
  stage = "database-operation",
  code = event,
  message,
  details = {},
}) {
  const timestamp = new Date().toISOString();
  return {
    event: stableOperationalIdentifier(event),
    status,
    environment: assertSupportedEnvironment(environment),
    severity,
    service: redactOperationalText(service),
    timestamp,
    occurredAt: timestamp,
    stage: stableOperationalIdentifier(stage),
    code: stableOperationalIdentifier(code),
    message: redactOperationalText(message ?? details.reason ?? event),
    metadata: redactObject(details),
  };
}

export async function deliverFailureAlert({
  event,
  webhookUrl,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  if (!webhookUrl) {
    return { delivered: false, attempts: 0, reason: "ALERT_DESTINATION_NOT_CONFIGURED" };
  }
  const parsed = new URL(webhookUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("Operational alert webhook must use HTTPS.");
  }
  let lastReason = "ALERT_DELIVERY_FAILED";
  let attempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        return {
          delivered: true,
          attempts: attempt,
          ...(await operationalReceiverIdentity(response)),
        };
      }
      lastReason = `ALERT_HTTP_${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastReason = redactOperationalText(error instanceof Error ? error.message : error);
    }
    if (attempt < 3) await sleepImpl(100 * 2 ** (attempt - 1));
  }
  console.error(
    JSON.stringify({
      event: "ALERT_DELIVERY_FAILED",
      environment: event.environment,
      severity: "ERROR",
      service: event.service,
      timestamp: new Date().toISOString(),
      code: lastReason,
      originalEvent: event.event,
    }),
  );
  return { delivered: false, attempts, reason: lastReason };
}

export function redactOperationalText(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b\d{6}\b/g, "[REDACTED_OTP]")
    .slice(0, 2_000);
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactOperationalText(value) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /(authorization|cookie|password|secret|token|key|credential|otp|bank)/i.test(key)
        ? "[REDACTED]"
        : redactObject(entry),
    ]),
  );
}

function stableOperationalIdentifier(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{2,95}$/.test(normalized)) {
    throw new Error("Operational event identifiers must be stable uppercase values.");
  }
  return normalized;
}

async function operationalReceiverIdentity(response) {
  const headerId = response.headers.get("x-request-id") ?? response.headers.get("x-message-id");
  if (headerId) return { receiverId: redactOperationalText(headerId).slice(0, 160) };
  try {
    const payload = await response.clone().json();
    const value = payload.messageId ?? payload.eventId ?? payload.id;
    return typeof value === "string" && value
      ? { receiverId: redactOperationalText(value).slice(0, 160) }
      : {};
  } catch {
    return {};
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredValue(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

export async function fileSize(path) {
  return (await stat(path)).size;
}
