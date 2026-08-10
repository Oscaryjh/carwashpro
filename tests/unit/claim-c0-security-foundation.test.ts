import assert from "node:assert/strict";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLAIM_ARCHITECTURE_POLICY,
  CLAIM_C0_BOUNDARY,
} from "../../src/lib/claim/architecture";
import {
  assertClaimAttachmentCanBeReleased,
  ClaimAttachmentSecurityError,
  validateClaimAttachment,
} from "../../src/lib/claim/attachment-policy";
import {
  ClaimPrivateStorageConfigurationError,
  ClaimPrivateStorageIntegrityError,
  FileSystemClaimPrivateAttachmentStore,
  getClaimPrivateAttachmentStore,
  S3ClaimPrivateAttachmentStore,
  type ClaimS3CommandClient,
} from "../../src/lib/claim/private-attachment-storage";
import {
  canDirectStaff,
  canGroupManager,
  canGroupOwner,
} from "../../src/lib/business-groups/capabilities";
import { normalizeStaffPermissions } from "../../src/lib/auth/staff-permissions";
import { sanitizeAuditValue } from "../../src/lib/audit/sanitize";

const minimalPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("C0 records the approved Claim product boundary without claiming workflow support", () => {
  assert.equal(CLAIM_ARCHITECTURE_POLICY.structure, "HEADER_WITH_ITEMS");
  assert.equal(
    CLAIM_ARCHITECTURE_POLICY.reimbursementMode,
    "SEPARATE_REIMBURSEMENT",
  );
  assert.equal(
    CLAIM_ARCHITECTURE_POLICY.payrollEligibility,
    "VERIFIED_NON_WAGE_ONLY",
  );
  assert.deepEqual(CLAIM_ARCHITECTURE_POLICY.approvalStages, [
    "EMPLOYEE_SUBMIT",
    "MANAGER_REVIEW",
    "FINANCE_VERIFICATION",
  ]);
  assert.equal(CLAIM_ARCHITECTURE_POLICY.approvedMeansPaid, false);
  assert.equal(CLAIM_C0_BOUNDARY.domainWorkflowImplemented, true);
  assert.equal(CLAIM_C0_BOUNDARY.payrollBridgeImplemented, true);
  assert.equal(CLAIM_C0_BOUNDARY.malwareScannerImplemented, false);
  assert.equal(CLAIM_C0_BOUNDARY.s3CompatiblePrivateStorageImplemented, true);
});

test("Claim capabilities are explicit, dependency-aware and unavailable to group managers", () => {
  assert.equal(canGroupManager("VIEW_CLAIM"), false);
  assert.equal(canGroupManager("REVIEW_CLAIM"), false);
  assert.equal(canGroupManager("VERIFY_CLAIM"), false);
  assert.equal(canGroupManager("LINK_CLAIM_TO_PAYROLL"), false);
  assert.equal(canGroupOwner("VIEW_CLAIM"), true);
  assert.equal(canGroupOwner("VERIFY_CLAIM"), true);
  assert.equal(canDirectStaff(["VIEW_CLAIM"], "VIEW_CLAIM"), true);
  assert.equal(canDirectStaff(["VIEW_CLAIM"], "REVIEW_CLAIM"), false);

  const verifier = normalizeStaffPermissions(["VERIFY_CLAIM"]);
  assert.deepEqual(new Set(verifier), new Set(["VIEW_CLAIM", "VERIFY_CLAIM"]));

  const payrollLinker = normalizeStaffPermissions(["LINK_CLAIM_TO_PAYROLL"]);
  assert.deepEqual(
    new Set(payrollLinker),
    new Set([
      "VIEW_CLAIM",
      "VIEW_PAYROLL_RUN",
      "PAYROLL_READ",
      "LINK_CLAIM_TO_PAYROLL",
    ]),
  );
});

test("Claim private storage identifiers and URLs are redacted from Audit DTOs", () => {
  assert.deepEqual(
    sanitizeAuditValue({
      objectKey: "claim-receipts/2026/08/private.pdf",
      storageObjectKey: "private-object",
      signedUrl: "https://private.example/signed",
      attachmentUrl: "/private/attachment",
      storageBucket: "private-claim-bucket",
      storageEndpoint: "https://private-storage.example",
      originalFileName: "employee-private-receipt.pdf",
      receiptCount: 2,
    }),
    {
      objectKey: "[REDACTED]",
      storageObjectKey: "[REDACTED]",
      signedUrl: "[REDACTED]",
      attachmentUrl: "[REDACTED]",
      storageBucket: "[REDACTED]",
      storageEndpoint: "[REDACTED]",
      originalFileName: "[REDACTED]",
      receiptCount: 2,
    },
  );
});

test("attachment validation uses content signatures, checksums and safe names", () => {
  const result = validateClaimAttachment({
    bytes: minimalPng,
    claimedMimeType: "image/png",
    originalFileName: "../Receipt <July>.exe",
  });

  assert.equal(result.detectedMimeType, "image/png");
  assert.equal(result.extension, "png");
  assert.equal(result.byteLength, minimalPng.length);
  assert.match(result.checksumSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.sanitizedFileName, "Receipt -July.png");
  assert.equal(result.disposition, "QUARANTINED");
  assert.equal(result.malwareStatus, "NOT_SCANNED");
});

test("attachment validation rejects MIME spoofing and malformed PDFs", () => {
  assert.throws(
    () =>
      validateClaimAttachment({
        bytes: minimalPng,
        claimedMimeType: "application/pdf",
        originalFileName: "receipt.pdf",
      }),
    ClaimAttachmentSecurityError,
  );
  assert.throws(
    () =>
      validateClaimAttachment({
        bytes: Buffer.from("%PDF-1.7 no final marker"),
        claimedMimeType: "application/pdf",
        originalFileName: "receipt.pdf",
      }),
    ClaimAttachmentSecurityError,
  );
});

test("privacy metadata is detected and unscanned files fail closed", () => {
  const jpegWithExif = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from("Exif\0\0GPS"),
  ]);
  const result = validateClaimAttachment({
    bytes: jpegWithExif,
    claimedMimeType: "image/jpeg",
    originalFileName: "receipt.jpg",
  });
  assert.equal(result.privacyMetadataStatus, "DETECTED");
  assert.throws(
    () =>
      assertClaimAttachmentCanBeReleased({
        malwareStatus: result.malwareStatus,
        privacyMetadataStatus: result.privacyMetadataStatus,
      }),
    ClaimAttachmentSecurityError,
  );
  assert.doesNotThrow(() =>
    assertClaimAttachmentCanBeReleased({
      malwareStatus: "CLEAN",
      privacyMetadataStatus: "SANITIZED",
    }),
  );
});

test("private filesystem storage has no URL and verifies bytes on server read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tetamu-claim-private-"));
  try {
    const attachment = validateClaimAttachment({
      bytes: minimalPng,
      claimedMimeType: "image/png",
      originalFileName: "receipt.png",
    });
    const store = new FileSystemClaimPrivateAttachmentStore(root, {
      now: () => new Date("2026-08-03T00:00:00.000Z"),
      createId: () => "11111111-1111-4111-8111-111111111111",
      applicationRoot: process.cwd(),
    });
    const saved = await store.putQuarantined(attachment);

    assert.equal(saved.publicUrl, null);
    assert.equal(saved.signedUrl, null);
    assert.equal(saved.disposition, "QUARANTINED");
    assert.equal(
      saved.objectKey,
      "claim-receipts/2026/08/11111111-1111-4111-8111-111111111111.png",
    );
    assert.deepEqual(
      await store.readQuarantined({
        objectKey: saved.objectKey,
        expectedChecksumSha256: saved.checksumSha256,
      }),
      minimalPng,
    );
    assert.deepEqual(await store.getQuarantinedMetadata(saved.objectKey), {
      objectKey: saved.objectKey,
      byteLength: saved.byteLength,
      checksumSha256: saved.checksumSha256,
      mimeType: saved.mimeType,
      disposition: "QUARANTINED",
    });
    assert.deepEqual(
      await readFile(path.join(root, ...saved.objectKey.split("/"))),
      minimalPng,
    );
    await assert.rejects(
      store.readQuarantined({
        objectKey: saved.objectKey,
        expectedChecksumSha256: "0".repeat(64),
      }),
      ClaimPrivateStorageIntegrityError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S3-compatible private storage uses conditional quarantine writes and verifies metadata", async () => {
  const fake = createFakeS3Client();
  const attachment = validateClaimAttachment({
    bytes: minimalPng,
    claimedMimeType: "image/png",
    originalFileName: "receipt.png",
  });
  const store = new S3ClaimPrivateAttachmentStore(
    validS3Configuration(),
    {
      client: fake.client,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
      createId: () => "22222222-2222-4222-8222-222222222222",
    },
  );

  const saved = await store.putQuarantined(attachment);
  assert.equal(saved.publicUrl, null);
  assert.equal(saved.signedUrl, null);
  assert.equal(saved.disposition, "QUARANTINED");
  assert.equal(fake.putCommands.length, 1);
  assert.equal(fake.putCommands[0]?.input.IfNoneMatch, "*");
  assert.equal(fake.putCommands[0]?.input.CacheControl, "private, no-store");
  assert.equal(
    fake.putCommands[0]?.input.Key,
    "testing/claims/claim-receipts/2026/08/22222222-2222-4222-8222-222222222222.png",
  );
  assert.equal(fake.putCommands[0]?.input.Metadata?.disposition, "quarantined");
  assert.deepEqual(
    await store.readQuarantined({
      objectKey: saved.objectKey,
      expectedChecksumSha256: saved.checksumSha256,
    }),
    minimalPng,
  );
});

test("S3-compatible reads fail closed on metadata, byte-length, and checksum tampering", async () => {
  const fake = createFakeS3Client();
  const attachment = validateClaimAttachment({
    bytes: minimalPng,
    claimedMimeType: "image/png",
    originalFileName: "receipt.png",
  });
  const store = new S3ClaimPrivateAttachmentStore(validS3Configuration(), {
    client: fake.client,
    now: () => new Date("2026-08-03T00:00:00.000Z"),
    createId: () => "33333333-3333-4333-8333-333333333333",
  });
  const saved = await store.putQuarantined(attachment);
  const storageKey = `testing/claims/${saved.objectKey}`;
  const object = fake.objects.get(storageKey);
  assert.ok(object);

  object.bytes = Buffer.concat([object.bytes, Buffer.from([0x00])]);
  await assert.rejects(
    store.readQuarantined({
      objectKey: saved.objectKey,
      expectedChecksumSha256: saved.checksumSha256,
    }),
    ClaimPrivateStorageIntegrityError,
  );

  object.bytes = Buffer.from(minimalPng);
  object.metadata.checksumsha256 = "0".repeat(64);
  await assert.rejects(
    store.readQuarantined({
      objectKey: saved.objectKey,
      expectedChecksumSha256: saved.checksumSha256,
    }),
    ClaimPrivateStorageIntegrityError,
  );
});

test("S3-compatible storage never overwrites an existing opaque object key", async () => {
  const fake = createFakeS3Client();
  const attachment = validateClaimAttachment({
    bytes: minimalPng,
    claimedMimeType: "image/png",
    originalFileName: "receipt.png",
  });
  const store = new S3ClaimPrivateAttachmentStore(validS3Configuration(), {
    client: fake.client,
    now: () => new Date("2026-08-03T00:00:00.000Z"),
    createId: () => "44444444-4444-4444-8444-444444444444",
  });

  await store.putQuarantined(attachment);
  await assert.rejects(store.putQuarantined(attachment), /Precondition failed/);
  assert.equal(fake.objects.size, 1);
});

test("S3-compatible configuration is explicit, HTTPS-only, and fail-closed", () => {
  assert.throws(
    () =>
      getClaimPrivateAttachmentStore({
        CLAIM_PRIVATE_STORAGE_PROVIDER: "s3",
      }),
    ClaimPrivateStorageConfigurationError,
  );
  assert.throws(
    () =>
      new S3ClaimPrivateAttachmentStore({
        ...validS3Configuration(),
        endpoint: "http://private-storage.example",
      }),
    ClaimPrivateStorageConfigurationError,
  );
  assert.throws(
    () =>
      new S3ClaimPrivateAttachmentStore({
        ...validS3Configuration(),
        objectPrefix: "../production",
      }),
    ClaimPrivateStorageConfigurationError,
  );
  assert.ok(
    getClaimPrivateAttachmentStore({
      CLAIM_PRIVATE_STORAGE_PROVIDER: "s3",
      CLAIM_PRIVATE_STORAGE_S3_ENDPOINT:
        "https://testing-account.r2.cloudflarestorage.com",
      CLAIM_PRIVATE_STORAGE_S3_REGION: "auto",
      CLAIM_PRIVATE_STORAGE_S3_BUCKET: "tetamu-claim-testing",
      CLAIM_PRIVATE_STORAGE_S3_ACCESS_KEY_ID: "testing-access-key",
      CLAIM_PRIVATE_STORAGE_S3_SECRET_ACCESS_KEY: "testing-secret-key",
      CLAIM_PRIVATE_STORAGE_S3_PREFIX: "testing/claims",
    }) instanceof S3ClaimPrivateAttachmentStore,
  );
});

function validS3Configuration() {
  return {
    endpoint: "https://testing-account.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "tetamu-claim-testing",
    accessKeyId: "testing-access-key",
    secretAccessKey: "testing-secret-key",
    objectPrefix: "testing/claims",
  };
}

function createFakeS3Client() {
  type FakeObject = {
    bytes: Buffer;
    contentType: string;
    metadata: Record<string, string>;
  };
  const objects = new Map<string, FakeObject>();
  const putCommands: PutObjectCommand[] = [];

  const client = {
    async send(command: PutObjectCommand | HeadObjectCommand | GetObjectCommand) {
      if (command instanceof PutObjectCommand) {
        putCommands.push(command);
        const key = String(command.input.Key);
        if (command.input.IfNoneMatch === "*" && objects.has(key)) {
          throw Object.assign(new Error("Precondition failed"), {
            name: "PreconditionFailed",
          });
        }
        const bytes = Buffer.from(command.input.Body as Uint8Array);
        objects.set(key, {
          bytes,
          contentType: String(command.input.ContentType),
          metadata: { ...(command.input.Metadata ?? {}) },
        });
        return { $metadata: { httpStatusCode: 200 } } as PutObjectCommandOutput;
      }

      const key = String(command.input.Key);
      const object = objects.get(key);
      if (!object) {
        throw Object.assign(new Error("Not found"), { name: "NoSuchKey" });
      }
      if (command instanceof HeadObjectCommand) {
        return {
          $metadata: { httpStatusCode: 200 },
          ContentLength: object.bytes.length,
          ContentType: object.contentType,
          Metadata: { ...object.metadata },
        } as HeadObjectCommandOutput;
      }
      return {
        $metadata: { httpStatusCode: 200 },
        ContentLength: object.bytes.length,
        ContentType: object.contentType,
        Metadata: { ...object.metadata },
        Body: {
          transformToByteArray: async () => Uint8Array.from(object.bytes),
        },
      } as unknown as GetObjectCommandOutput;
    },
  } as unknown as ClaimS3CommandClient;

  return { client, objects, putCommands };
}

test("private storage configuration rejects public roots and missing configuration", async () => {
  assert.throws(
    () => getClaimPrivateAttachmentStore({}),
    ClaimPrivateStorageConfigurationError,
  );

  const publicRoot = path.join(process.cwd(), "public", "claim-test-private");
  const store = new FileSystemClaimPrivateAttachmentStore(publicRoot, {
    applicationRoot: process.cwd(),
  });
  try {
    await assert.rejects(
      store.putQuarantined(
        validateClaimAttachment({
          bytes: minimalPng,
          claimedMimeType: "image/png",
          originalFileName: "receipt.png",
        }),
      ),
      ClaimPrivateStorageConfigurationError,
    );
  } finally {
    await rm(publicRoot, { recursive: true, force: true });
  }
});
