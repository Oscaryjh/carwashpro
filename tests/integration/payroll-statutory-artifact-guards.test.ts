import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";
import {
  createStatutoryCorrectionRevision,
  downloadOrCreateStatutoryArtifact,
} from "../../src/lib/payroll/statutory-artifact";

test("immutable statutory artifact rejects database update and delete", async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({
    data: {
      name: `Artifact Guard ${suffix}`,
      slug: `artifact-guard-${suffix}`,
    },
  });
  const payrollRun = await prisma.payrollRun.create({
    data: {
      businessId: business.id,
      breakMinutesPerDaySnapshot: 60,
      normalWorkMinutesPerDaySnapshot: 480,
      overtimeMultiplierSnapshot: "1.50",
      periodEnd: new Date("2040-02-01T00:00:00.000Z"),
      periodStart: new Date("2040-01-01T00:00:00.000Z"),
      publicHolidayExtraMultiplierSnapshot: "2.00",
      status: "DRAFT",
      workingDaysPerMonthSnapshot: 26,
    },
  });
  const submission = await prisma.payrollStatutorySubmission.create({
    data: {
      businessId: business.id,
      exportVersion: "INTEGRATION_TEST_V1",
      exportedAt: new Date(),
      integrityStatus: "VERIFIED",
      payrollRunId: payrollRun.id,
      provider: "EPF",
      revision: 1,
      status: "EXPORTED",
    },
  });
  const artifact = await prisma.payrollStatutoryExportArtifact.create({
    data: {
      aadVersion: "v1",
      authenticationTag: Uint8Array.from(Buffer.alloc(16, 3)),
      businessId: business.id,
      byteLength: 4,
      ciphertext: Uint8Array.from(Buffer.from("test")),
      contentType: "text/csv",
      encryptionAlgorithm: "AES-256-GCM",
      encryptionKeyVersion: "integration-v1",
      exportVersion: "INTEGRATION_TEST_V1",
      fileName: "statutory.csv",
      initializationVector: Uint8Array.from(Buffer.alloc(12, 2)),
      payrollRunId: payrollRun.id,
      plaintextSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      provider: "EPF",
      revision: 1,
      submissionId: submission.id,
    },
  });

  await assert.rejects(
    prisma.payrollStatutoryExportArtifact.update({
      where: { id: artifact.id },
      data: { fileName: "changed.csv" },
    }),
    /immutable and cannot be updated or deleted/i,
  );
  await assert.rejects(
    prisma.payrollStatutoryExportArtifact.delete({ where: { id: artifact.id } }),
    /immutable and cannot be updated or deleted/i,
  );

  const retained = await prisma.payrollStatutoryExportArtifact.findUniqueOrThrow({
    where: { id: artifact.id },
  });
  assert.equal(retained.fileName, "statutory.csv");
  assert.equal(Buffer.from(retained.ciphertext).toString(), "test");

  // Submission workflow metadata remains append-forward while exact bytes stay locked.
  await prisma.payrollStatutorySubmission.update({
    where: { id: submission.id },
    data: {
      rejectionReason: "Portal validation rejected the file.",
      resolvedAt: new Date(),
      status: "REJECTED",
      submittedAt: new Date(),
    },
  });
  const correction = await createStatutoryCorrectionRevision({
    actor: null,
    businessId: business.id,
    reason: "Portal correction required.",
    request: {},
    submissionId: submission.id,
  });
  assert.equal(correction.revision, 2);
  assert.equal(correction.status, "DRAFT");
  assert.equal(correction.supersedesSubmissionId, submission.id);
  await assert.rejects(
    createStatutoryCorrectionRevision({
      actor: null,
      businessId: business.id,
      reason: "Duplicate correction request.",
      request: {},
      submissionId: submission.id,
    }),
    /newer statutory correction revision already exists/i,
  );

  const identityGuardSubmission = await prisma.payrollStatutorySubmission.create({
    data: {
      businessId: business.id,
      integrityStatus: "PENDING_ARTIFACT",
      payrollRunId: payrollRun.id,
      provider: "PCB",
      revision: 1,
      status: "DRAFT",
    },
  });
  await assert.rejects(
    prisma.payrollStatutoryExportArtifact.create({
      data: {
        aadVersion: "v1",
        authenticationTag: Uint8Array.from(Buffer.alloc(16, 3)),
        businessId: business.id,
        byteLength: 4,
        ciphertext: Uint8Array.from(Buffer.from("test")),
        contentType: "text/plain",
        encryptionAlgorithm: "AES-256-GCM",
        encryptionKeyVersion: "integration-v1",
        exportVersion: "IDENTITY_GUARD_TEST_V1",
        fileName: "mismatch.txt",
        initializationVector: Uint8Array.from(Buffer.alloc(12, 2)),
        payrollRunId: payrollRun.id,
        plaintextSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        provider: "PERKESO",
        revision: 1,
        submissionId: identityGuardSubmission.id,
      },
    }),
    /artifact identity does not match its submission/i,
  );

  await prisma.payrollStatutorySubmission.create({
    data: {
      businessId: business.id,
      exportVersion: "LEGACY_TEST_V1",
      exportedAt: new Date(),
      integrityStatus: "LEGACY_UNVERIFIED",
      payrollRunId: payrollRun.id,
      provider: "PERKESO",
      revision: 1,
      status: "EXPORTED",
    },
  });
  await assert.rejects(
    downloadOrCreateStatutoryArtifact({
      actor: null,
      allowCreate: true,
      businessId: business.id,
      month: "2040-01",
      provider: "PERKESO",
      request: {},
    }),
    /legacy submission did not retain exact export bytes and cannot be regenerated/i,
  );
  assert.equal(
    await prisma.payrollStatutoryExportArtifact.count({
      where: { payrollRunId: payrollRun.id, provider: "PERKESO" },
    }),
    0,
  );
});

test("subsequent statutory downloads return exact retained bytes without current profile data", async () => {
  const suffix = randomUUID();
  const previousVersion = process.env.STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION;
  const previousKeys = process.env.STATUTORY_ARTIFACT_ENCRYPTION_KEYS;
  process.env.STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION = "integration-v1";
  process.env.STATUTORY_ARTIFACT_ENCRYPTION_KEYS = JSON.stringify({
    "integration-v1": Buffer.alloc(32, 11).toString("base64"),
  });

  try {
    const phone = `+601${Number.parseInt(suffix.slice(0, 8), 16).toString().padStart(10, "0").slice(-8)}`;
    const business = await prisma.business.create({
      data: {
        name: `Artifact Download ${suffix}`,
        slug: `artifact-download-${suffix}`,
      },
    });
    const employeeAccount = await prisma.employeeAccount.create({
      data: {
        name: "Artifact Employee",
        phoneNumber: phone,
        phoneNormalized: phone,
      },
    });
    const membership = await prisma.employeeBusinessMembership.create({
      data: {
        businessId: business.id,
        employeeAccountId: employeeAccount.id,
        employeeCode: "ART001",
        epfMemberNumber: "12345678",
        fullName: "Original Employee Name",
        phoneNumber: employeeAccount.phoneNumber,
        phoneNumberNormalized: employeeAccount.phoneNormalized,
        statutoryIdentityNumber: "900101123456",
        statutoryIdentityType: "NEW_IC",
      },
    });
    await prisma.businessStatutoryProfile.create({
      data: {
        businessId: business.id,
        epfEmployerNumber: "E1234567",
      },
    });
    const payrollRun = await prisma.payrollRun.create({
      data: {
        businessId: business.id,
        breakMinutesPerDaySnapshot: 60,
        normalWorkMinutesPerDaySnapshot: 480,
        overtimeMultiplierSnapshot: "1.50",
        periodEnd: new Date("2041-03-01T00:00:00.000Z"),
        periodStart: new Date("2041-02-01T00:00:00.000Z"),
        publicHolidayExtraMultiplierSnapshot: "2.00",
        status: "DRAFT",
        workingDaysPerMonthSnapshot: 26,
      },
    });
    await prisma.payrollEntry.create({
      data: {
        baseRateSnapshot: "2600.00",
        businessId: business.id,
        employeeCodeSnapshot: membership.employeeCode,
        employerEpf: "260.00",
        epfEmployee: "220.00",
        epfWageBase: "2000.00",
        fullNameSnapshot: membership.fullName,
        membershipId: membership.id,
        normalWorkMinutesSnapshot: 480,
        payBasisSnapshot: "MONTHLY",
        payrollRunId: payrollRun.id,
        workingDaysSnapshot: 26,
      },
    });
    const now = new Date();
    await prisma.payrollRun.update({
      where: { id: payrollRun.id },
      data: { finalizedAt: now, status: "FINALIZED", submittedAt: now },
    });

    const downloadInput = {
      actor: null,
      allowCreate: true,
      businessId: business.id,
      month: "2041-02",
      provider: "EPF",
      request: { ipAddress: "127.0.0.1", userAgent: "integration-test" },
    } as const;
    const [first, concurrent] = await Promise.all([
      downloadOrCreateStatutoryArtifact(downloadInput),
      downloadOrCreateStatutoryArtifact(downloadInput),
    ]);
    assert.equal(concurrent.artifactId, first.artifactId);
    assert.deepEqual(concurrent.body, first.body);
    assert.match(first.body.toString(), /Original Employee Name/);
    assert.match(first.body.toString(), /12345678/);

    // Make current employee and employer profiles unusable for a new EPF file.
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command_maintenance', 'on', true)`;
      await transaction.employeeBusinessMembership.update({
        where: { id: membership.id },
        data: {
          epfMemberNumber: null,
          fullName: "Changed Current Name",
          statutoryIdentityNumber: null,
          statutoryIdentityType: null,
        },
      });
    });
    await prisma.businessStatutoryProfile.update({
      where: { businessId: business.id },
      data: { epfEmployerNumber: null },
    });

    const second = await downloadOrCreateStatutoryArtifact(downloadInput);
    assert.equal(second.artifactId, first.artifactId);
    assert.deepEqual(second.body, first.body);
    assert.equal(second.checksumSha256, first.checksumSha256);
    assert.doesNotMatch(second.body.toString(), /Changed Current Name/);
    assert.equal(
      await prisma.payrollStatutoryExportArtifact.count({
        where: { payrollRunId: payrollRun.id, provider: "EPF" },
      }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          businessId: business.id,
          action: "PAYROLL_OFFICIAL_STATUTORY_ARTIFACT_DOWNLOADED",
        },
      }),
      3,
    );
  } finally {
    restoreEnvironment("STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION", previousVersion);
    restoreEnvironment("STATUTORY_ARTIFACT_ENCRYPTION_KEYS", previousKeys);
  }
});

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
