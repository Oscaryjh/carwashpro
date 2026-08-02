import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  decryptStatutoryArtifact,
  encryptStatutoryArtifact,
  type StatutoryArtifactIdentity,
} from "../../src/lib/payroll/statutory-artifact-crypto";

const root = process.cwd();
const identity: StatutoryArtifactIdentity = {
  artifactId: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  exportVersion: "KWSP_ECARUMAN_CSV_2020",
  payrollRunId: "33333333-3333-4333-8333-333333333333",
  provider: "EPF",
  revision: 1,
};
const keyV1 = Buffer.alloc(32, 7).toString("base64");
const keyV2 = Buffer.alloc(32, 9).toString("base64");

test("statutory artifact AES-256-GCM round-trips exact bytes", () => {
  const body = Buffer.from("employee,identity,amount\r\n", "utf8");
  const encrypted = encryptStatutoryArtifact(body, identity, environment("v1"));

  assert.equal(encrypted.encryptionAlgorithm, "AES-256-GCM");
  assert.equal(encrypted.encryptionKeyVersion, "v1");
  assert.equal(encrypted.initializationVector.length, 12);
  assert.equal(encrypted.authenticationTag.length, 16);
  assert.notDeepEqual(encrypted.ciphertext, body);
  assert.deepEqual(
    decryptStatutoryArtifact({ ...identity, ...encrypted }, environment("v1")),
    body,
  );
});

test("artifact authentication rejects ciphertext and metadata tampering", () => {
  const encrypted = encryptStatutoryArtifact(
    Buffer.from("immutable statutory bytes"),
    identity,
    environment("v1"),
  );
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
  tamperedCiphertext[0] ^= 1;

  assert.throws(
    () => decryptStatutoryArtifact(
      { ...identity, ...encrypted, ciphertext: tamperedCiphertext },
      environment("v1"),
    ),
  );
  assert.throws(
    () => decryptStatutoryArtifact(
      { ...identity, ...encrypted, revision: 2 },
      environment("v1"),
    ),
  );
});

test("keyring retains old keys for immutable artifact download after rotation", () => {
  const encrypted = encryptStatutoryArtifact(
    Buffer.from("retained artifact"),
    identity,
    environment("v1"),
  );
  const rotated = {
    STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION: "v2",
    STATUTORY_ARTIFACT_ENCRYPTION_KEYS: JSON.stringify({ v1: keyV1, v2: keyV2 }),
  };
  assert.equal(
    decryptStatutoryArtifact({ ...identity, ...encrypted }, rotated).toString(),
    "retained artifact",
  );
});

test("invalid or missing artifact key configuration fails closed", () => {
  assert.throws(
    () => encryptStatutoryArtifact(Buffer.from("x"), identity, {}),
    /not configured/,
  );
  assert.throws(
    () => encryptStatutoryArtifact(Buffer.from("x"), identity, {
      STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION: "v1",
      STATUTORY_ARTIFACT_ENCRYPTION_KEYS: JSON.stringify({ v1: "too-short" }),
    }),
    /base64 or 64-character hex encoding/,
  );
});

test("Phase 4.0B migration is additive, marks legacy rows, and enforces immutable artifacts", async () => {
  const sql = await readFile(
    path.join(root, "prisma/migrations/20260802170000_statutory_export_artifact_foundation/migration.sql"),
    "utf8",
  );
  assert.match(sql, /LEGACY_UNVERIFIED/);
  assert.match(sql, /payroll_statutory_export_artifacts/);
  assert.match(sql, /ciphertext" BYTEA NOT NULL/);
  assert.match(sql, /AES-256-GCM/);
  assert.match(sql, /BEFORE UPDATE OR DELETE[\s\S]*prevent_payroll_statutory_artifact_mutation/);
  assert.match(sql, /UNIQUE INDEX "payroll_statutory_export_artifacts_submission_key"/);
  assert.doesNotMatch(sql, /DROP TABLE\s+"?(businesses|payroll_runs|payroll_entries)"?/i);

  const identityGuard = await readFile(
    path.join(root, "prisma/migrations/20260802171000_statutory_artifact_identity_guard/migration.sql"),
    "utf8",
  );
  assert.match(identityGuard, /validate_payroll_statutory_artifact_identity/);
  assert.match(identityGuard, /business_id[\s\S]*payroll_run_id[\s\S]*provider[\s\S]*revision/);
  assert.match(identityGuard, /BEFORE INSERT ON "payroll_statutory_export_artifacts"/);
});

test("statutory GET creates or downloads artifacts and never regenerates in the route", async () => {
  const [route, page, service, payrollService] = await Promise.all([
    source("src/app/(business)/team/payroll/statutory/export/route.ts"),
    source("src/app/(business)/team/payroll/statutory/page.tsx"),
    source("src/lib/payroll/statutory-artifact.ts"),
    source("src/lib/payroll/service.ts"),
  ]);
  assert.match(route, /downloadOrCreateStatutoryArtifact/);
  assert.match(route, /requireWholeBusinessPayroll\("VIEW_STATUTORY_SUBMISSION"\)/);
  assert.match(route, /hasBusinessCapability\(context\.access, "EXPORT_STATUTORY"\)/);
  assert.doesNotMatch(route, /buildOfficialSubmissionFile|loadStatutorySubmissionData/);
  assert.match(service, /latest\?\.artifact[\s\S]*decryptAndAuditDownload/);
  assert.ok(
    service.indexOf("const artifactIndex = await transaction.payrollRun.findUnique") <
      service.indexOf("const data = await loadStatutorySubmissionData"),
    "retained artifact lookup must happen before the sensitive current-profile query",
  );
  assert.match(service, /retained-artifact path intentionally does not load employee/);
  assert.match(service, /PAYROLL_STATUTORY_ARTIFACT_CREATED/);
  assert.match(service, /PAYROLL_OFFICIAL_STATUTORY_ARTIFACT_DOWNLOADED/);
  assert.match(service, /isolationLevel: "Serializable"/);
  assert.doesNotMatch(page, /Confirm downloaded file|markStatutoryFileExportedAction/);
  assert.match(
    page,
    /statutory\/export[^>]+prefetch=\{false\}/,
    "artifact download links must not be prefetched because GET creates the first retained artifact",
  );
  assert.match(page, /Create correction revision/);
  assert.match(page, /Create new revision/);
  assert.match(page, /Download revision/);
  assert.match(service, /status: \{ in: \["EXPORTED", "REJECTED"\] \}/);
  assert.match(service, /recordCount/);
  assert.match(payrollService, /statutory export or correction record cannot be reopened directly/);
});

function environment(activeVersion: "v1" | "v2") {
  return {
    STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION: activeVersion,
    STATUTORY_ARTIFACT_ENCRYPTION_KEYS: JSON.stringify({ v1: keyV1, v2: keyV2 }),
  };
}

function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}
