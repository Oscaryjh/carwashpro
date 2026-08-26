import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateClaimAttachment } from "../../src/lib/claim/attachment-policy";
import { AttendanceApiError } from "../../src/lib/attendance/api-error";
import {
  ClaimPrivateStorageConfigurationError,
  FileSystemClaimPrivateAttachmentStore,
} from "../../src/lib/claim/private-attachment-storage";
import { normalizeEmployeeLeaveApiError } from "../../src/lib/leave/api-error";
import {
  prepareLeaveDocuments,
  serializeLeaveDocument,
} from "../../src/lib/leave/document-service";

const migrationPath = "prisma/migrations/20260818170000_leave_management_phase2e_supporting_documents/migration.sql";
const minimalPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("Optional Leave evidence does not initialise private storage when no files were selected", async () => {
  assert.deepEqual(await prepareLeaveDocuments([]), []);
});

test("Leave upload configuration failures use a Leave-specific retry response", () => {
  const cause = new ClaimPrivateStorageConfigurationError(
    "Claim private storage is not configured.",
  );
  const mapped = normalizeEmployeeLeaveApiError(cause);

  assert.ok(mapped instanceof AttendanceApiError);
  assert.equal(mapped.code, "INTERNAL_ERROR");
  assert.equal(mapped.status, 503);
  assert.equal(mapped.cause, cause);
  assert.match(mapped.message, /Supporting document upload is temporarily unavailable/);
  assert.doesNotMatch(mapped.message, /attendance/i);
});

test("Leave evidence reuses strict signature validation and stays in the private leave namespace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tetamu-leave-private-"));
  try {
    const attachment = validateClaimAttachment({
      bytes: minimalPng,
      claimedMimeType: "image/png",
      originalFileName: "medical-note.png",
    });
    const store = new FileSystemClaimPrivateAttachmentStore(root, {
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      createId: () => "11111111-1111-4111-8111-111111111111",
      applicationRoot: process.cwd(),
    });
    const saved = await store.putQuarantined(attachment, "leave-evidence");
    assert.equal(saved.objectKey, "leave-evidence/2026/08/11111111-1111-4111-8111-111111111111.png");
    assert.equal(saved.publicUrl, null);
    assert.equal(saved.signedUrl, null);
    assert.deepEqual(await store.readQuarantined({
      objectKey: saved.objectKey,
      expectedChecksumSha256: saved.checksumSha256,
    }), minimalPng);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Leave evidence DTO never exposes object keys, checksums, legacy references or URLs", () => {
  const serialized = serializeLeaveDocument({
    id: "document-id",
    source: "UPLOAD",
    documentType: "MEDICAL_CERTIFICATE",
    sanitizedFileName: "medical-note.pdf",
    mimeType: "application/pdf",
    byteLength: 1024,
    securityStatus: "SCAN_NOT_AVAILABLE",
    lifecycleStatus: "ACTIVE",
    reviewStatus: "NOT_REVIEWED",
    reviewNote: null,
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
  });
  assert.equal(serialized.fileName, "medical-note.pdf");
  assert.equal("objectKey" in serialized, false);
  assert.equal("checksumSha256" in serialized, false);
  assert.equal("legacyReference" in serialized, false);
  assert.equal("signedUrl" in serialized, false);
  assert.equal("publicUrl" in serialized, false);
});

test("Phase 2E migration is additive, tenant-bound and retains legacy evidence explicitly", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "leave_supporting_documents"/);
  assert.match(migration, /FOREIGN KEY \("leave_request_id", "business_id"\)/);
  assert.match(migration, /LeaveSupportingDocumentSource/);
  assert.match(migration, /LEGACY_REFERENCE/);
  assert.match(migration, /retention_class/);
  assert.match(migration, /legal_hold/);
  assert.match(migration, /supporting_evidence_reference_snapshot/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("Staff upload, own-document access and manager review use separate guarded routes", async () => {
  const staffApi = await readFile("src/app/api/employee-leave/route.ts", "utf8");
  const staffDocumentApi = await readFile("src/app/api/employee-leave/documents/[documentId]/route.ts", "utf8");
  const staffAddApi = await readFile("src/app/api/employee-leave/requests/[requestId]/documents/route.ts", "utf8");
  const managerDocumentApi = await readFile("src/app/api/leave/documents/[documentId]/route.ts", "utf8");
  const managerActions = await readFile("src/app/(business)/team/leave/actions.ts", "utf8");
  assert.match(staffApi, /multipart\/form-data/);
  assert.match(staffApi, /prepareLeaveDocuments/);
  assert.match(staffDocumentApi, /requireEmployeeSelfServiceAuthContext/);
  assert.match(staffDocumentApi, /removeOwnLeaveDocument/);
  assert.match(staffAddApi, /attachOwnLeaveDocuments/);
  assert.match(managerDocumentApi, /requireBusinessUser\("VIEW_LEAVE"\)/);
  assert.match(managerDocumentApi, /allowedBranchIds/);
  assert.match(managerActions, /requireBusinessUser\("APPROVE_LEAVE"\)/);
  assert.match(managerActions, /reviewLeaveDocument/);
});

test("Approval is blocked until required active evidence is manager-verified and then freezes minimal facts", async () => {
  const service = await readFile("src/lib/leave/service.ts", "utf8");
  assert.match(service, /supportingEvidenceRequiredSnapshot/);
  assert.match(service, /verified supporting document is required before this Leave can be approved/);
  assert.match(service, /supportingEvidenceStatus !== "VERIFIED"|evidenceStatus !== "VERIFIED"/);
  assert.match(service, /supportingEvidencePresentSnapshot/);
  assert.match(service, /supportingEvidenceStatusSnapshot/);
  assert.match(service, /supportingEvidenceReferenceSnapshot/);
  assert.match(service, /supportingEvidenceDocumentCountSnapshot/);
  assert.match(service, /checksumSha256/);
});

test("Staff and manager UX expose private evidence without a fixed OTP, public URL, or payroll content bridge", async () => {
  const staff = await readFile("src/components/staff-pwa/staff-leave.tsx", "utf8");
  const manager = await readFile("src/app/(business)/team/leave/page.tsx", "utf8");
  const payrollSources = await Promise.all([
    readFile("src/lib/payroll/service.ts", "utf8").catch(() => ""),
    readFile("src/lib/payroll/integration-service.ts", "utf8").catch(() => ""),
  ]);
  assert.match(staff, /Take photo/);
  assert.match(staff, /Upload files/);
  assert.match(staff, /Add document/);
  assert.match(staff, /\/api\/employee-leave\/documents\//);
  assert.match(manager, />Verify</);
  assert.match(manager, /Needs follow-up/);
  assert.match(manager, /Reject evidence/);
  assert.doesNotMatch(staff, /000000|objectKey|checksumSha256|signedUrl/);
  assert.doesNotMatch(manager, /objectKey|checksumSha256|signedUrl/);
  assert.doesNotMatch(payrollSources.join("\n"), /sanitizedFileName|legacyReference|objectKey|mimeType/);
});
