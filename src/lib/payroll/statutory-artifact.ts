import { randomUUID } from "node:crypto";
import { Prisma, type PayrollStatutoryProvider, type PrismaClient } from "@prisma/client";
import {
  writeAuditLog,
  type AuditRequestContext,
  type WriteAuditLogInput,
} from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  decryptStatutoryArtifact,
  encryptStatutoryArtifact,
} from "@/lib/payroll/statutory-artifact-crypto";
import { loadStatutorySubmissionData } from "@/lib/payroll/statutory-data";
import {
  buildOfficialSubmissionFile,
  STATUTORY_EXPORT_VERSION,
  statutorySubmissionContentType,
  statutorySubmissionFileName,
  validateStatutorySubmission,
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";
import { parsePayrollMonth } from "@/lib/payroll/service";
import {
  consumePayrollHighRiskAuthorization,
  type PayrollHighRiskAuditLink,
  type PayrollHighRiskStepUp,
} from "@/lib/payroll/high-risk-mfa";

type ArtifactActor = WriteAuditLogInput["actor"];

export type StatutoryArtifactDownload = {
  artifactId: string;
  body: Buffer;
  byteLength: number;
  checksumSha256: string;
  contentType: string;
  fileName: string;
  provider: StatutorySubmissionProvider;
  recordCount: number | null;
  revision: number;
  submissionId: string;
};

export class StatutoryArtifactError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 403 | 404 | 409 | 500 | 503 = 409,
  ) {
    super(message);
    this.name = "StatutoryArtifactError";
  }
}

export async function downloadOrCreateStatutoryArtifact(
  input: {
    actor: ArtifactActor;
    businessId: string;
    month: string;
    provider: StatutorySubmissionProvider;
    request: AuditRequestContext;
    revision?: number;
    allowCreate?: boolean;
    stepUp: PayrollHighRiskStepUp;
    stepUpResourceId: string;
  },
  database: PrismaClient = prisma,
): Promise<StatutoryArtifactDownload> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(
        async (transaction) => {
          const period = parsePayrollMonth(input.month);
          const artifactIndex = await transaction.payrollRun.findUnique({
            where: {
              businessId_periodStart_periodEnd: {
                businessId: input.businessId,
                periodStart: period.start,
                periodEnd: period.end,
              },
            },
            select: {
              id: true,
              status: true,
              statutorySubmissions: {
                where: {
                  provider: input.provider,
                  ...(input.revision ? { revision: input.revision } : {}),
                },
                orderBy: { revision: "desc" },
                take: 1,
                include: { artifact: true },
              },
            },
          });
          const latest = artifactIndex?.statutorySubmissions[0];
          if (input.revision && !latest) {
            throw new StatutoryArtifactError("The retained statutory artifact revision was not found.", 404);
          }
          // The retained-artifact path intentionally does not load employee,
          // employer profile, payroll entry, or current statutory identity data.
          if (latest?.artifact) {
            const stepUpAudit = await consumePayrollHighRiskAuthorization(
              {
                actionKey: "STATUTORY_EXPORT",
                businessId: input.businessId,
                resourceId: input.stepUpResourceId,
                stepUp: input.stepUp,
                userId: input.actor?.userId ?? "",
              },
              transaction,
            );
            return decryptAndAuditDownload({
              actor: input.actor,
              artifact: latest.artifact,
              businessId: input.businessId,
              request: input.request,
              submissionId: latest.id,
              stepUpAudit,
            }, transaction);
          }
          if (input.revision) {
            throw new StatutoryArtifactError("The requested statutory revision has no retained artifact.");
          }
          if (latest?.integrityStatus === "LEGACY_UNVERIFIED") {
            throw new StatutoryArtifactError(
              "This legacy submission did not retain exact export bytes and cannot be regenerated. Create a controlled correction only if the submission was rejected.",
            );
          }
          if (latest && latest.status !== "DRAFT") {
            throw new StatutoryArtifactError(
              "The statutory submission has no verified artifact and cannot be downloaded.",
              500,
            );
          }
          if (!input.allowCreate) {
            throw new StatutoryArtifactError(
              "EXPORT_STATUTORY is required to create the first retained statutory artifact.",
              403,
            );
          }

          const data = await loadStatutorySubmissionData(
            input.businessId,
            input.month,
            transaction,
          );
          if (!data.profile || !data.run || data.run.status !== "FINALIZED") {
            throw new StatutoryArtifactError(
              "Only finalized payroll with a complete statutory profile can produce an official file.",
            );
          }
          const stepUpAudit = await consumePayrollHighRiskAuthorization(
            {
              actionKey: "STATUTORY_EXPORT",
              businessId: input.businessId,
              resourceId: input.stepUpResourceId,
              stepUp: input.stepUp,
              userId: input.actor?.userId ?? "",
            },
            transaction,
          );

          const document = buildOfficialSubmissionFile(
            input.provider,
            data.profile,
            data.run,
          );
          const recordCount = validateStatutorySubmission(
            input.provider,
            data.profile,
            data.run,
          ).eligibleEntries.length;
          const now = new Date();
          const submission = latest ?? await transaction.payrollStatutorySubmission.create({
            data: {
              businessId: input.businessId,
              integrityStatus: "PENDING_ARTIFACT",
              payrollRunId: data.run.id,
              provider: input.provider,
              revision: 1,
              status: "DRAFT",
            },
          });
          const artifactId = randomUUID();
          const exportVersion = STATUTORY_EXPORT_VERSION[input.provider];
          const identity = {
            artifactId,
            businessId: input.businessId,
            exportVersion,
            payrollRunId: data.run.id,
            provider: input.provider,
            revision: submission.revision,
          } as const;
          const encrypted = encryptStatutoryArtifact(document, identity);
          const fileName = statutorySubmissionFileName(input.provider, data.profile, data.run);
          const contentType = statutorySubmissionContentType(input.provider);
          const artifact = await transaction.payrollStatutoryExportArtifact.create({
            data: {
              id: artifactId,
              aadVersion: encrypted.aadVersion,
              authenticationTag: Uint8Array.from(encrypted.authenticationTag),
              businessId: input.businessId,
              byteLength: document.length,
              ciphertext: Uint8Array.from(encrypted.ciphertext),
              contentType,
              createdById: input.actor?.userId ?? null,
              encryptionAlgorithm: encrypted.encryptionAlgorithm,
              encryptionKeyVersion: encrypted.encryptionKeyVersion,
              exportVersion,
              fileName,
              initializationVector: Uint8Array.from(encrypted.initializationVector),
              payrollRunId: data.run.id,
              plaintextSha256: encrypted.plaintextSha256,
              provider: input.provider,
              revision: submission.revision,
              submissionId: submission.id,
            },
          });
          await transaction.payrollStatutorySubmission.update({
            where: { id: submission.id },
            data: {
              exportVersion,
              exportedAt: now,
              exportedById: input.actor?.userId ?? null,
              integrityStatus: "VERIFIED",
              status: "EXPORTED",
            },
          });
          await writeAuditLog({
            businessId: input.businessId,
            actor: input.actor,
            request: input.request,
            action: "PAYROLL_STATUTORY_ARTIFACT_CREATED",
            entityType: "PayrollStatutoryExportArtifact",
            entityId: artifact.id,
            summary: `${input.provider} immutable statutory export artifact created.`,
            after: {
              byteLength: artifact.byteLength,
              checksumSha256: artifact.plaintextSha256,
              exportVersion: artifact.exportVersion,
              provider: artifact.provider,
              recordCount,
              revision: artifact.revision,
            },
            metadata: {
              encryptionAlgorithm: artifact.encryptionAlgorithm,
              encryptionKeyVersion: artifact.encryptionKeyVersion,
              payrollRunId: artifact.payrollRunId,
              submissionId: artifact.submissionId,
              ...stepUpAudit,
            },
          }, transaction);
          await writeDownloadAudit({
            actor: input.actor,
            artifact,
            businessId: input.businessId,
            request: input.request,
            submissionId: submission.id,
            stepUpAudit,
          }, transaction);

          return {
            artifactId: artifact.id,
            body: document,
            byteLength: artifact.byteLength,
            checksumSha256: artifact.plaintextSha256,
            contentType: artifact.contentType,
            fileName: artifact.fileName,
            provider: artifact.provider,
            recordCount,
            revision: artifact.revision,
            submissionId: submission.id,
          };
        },
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new StatutoryArtifactError("Unable to create the statutory artifact.", 500);
}

export async function createStatutoryCorrectionRevision(
  input: {
    actor: ArtifactActor;
    businessId: string;
    reason: string;
    request: AuditRequestContext;
    submissionId: string;
  },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const source = await transaction.payrollStatutorySubmission.findFirst({
      where: {
        businessId: input.businessId,
        id: input.submissionId,
        status: { in: ["EXPORTED", "REJECTED"] },
      },
      include: { artifact: { select: { id: true } } },
    });
    if (!source) throw new StatutoryArtifactError("Exported or rejected statutory submission was not found.");
    if (!source.artifact || source.integrityStatus !== "VERIFIED") {
      throw new StatutoryArtifactError(
        "Legacy unverified submissions cannot create an artifact-backed correction revision.",
      );
    }
    const latest = await transaction.payrollStatutorySubmission.findFirstOrThrow({
      where: {
        businessId: input.businessId,
        payrollRunId: source.payrollRunId,
        provider: source.provider,
      },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true },
    });
    if (latest.id !== source.id) {
      throw new StatutoryArtifactError("A newer statutory correction revision already exists.");
    }

    const correction = await transaction.payrollStatutorySubmission.create({
      data: {
        businessId: input.businessId,
        integrityStatus: "PENDING_ARTIFACT",
        payrollRunId: source.payrollRunId,
        provider: source.provider,
        revision: source.revision + 1,
        status: "DRAFT",
        supersedesSubmissionId: source.id,
      },
    });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "PAYROLL_STATUTORY_CORRECTION_REVISION_CREATED",
      entityType: "PayrollStatutorySubmission",
      entityId: correction.id,
      summary: `${correction.provider} statutory correction revision created.`,
      before: { revision: source.revision, status: source.status },
      after: { revision: correction.revision, status: correction.status },
      metadata: {
        payrollRunId: correction.payrollRunId,
        reason: input.reason,
        supersedesSubmissionId: source.id,
      },
    }, transaction);
    return correction;
  }, { isolationLevel: "Serializable" });
}

export async function payrollRunHasImmutableStatutoryArtifacts(
  businessId: string,
  payrollRunId: string,
  database: Pick<PrismaClient, "payrollStatutoryExportArtifact"> = prisma,
) {
  return (await database.payrollStatutoryExportArtifact.count({
    where: { businessId, payrollRunId },
  })) > 0;
}

async function decryptAndAuditDownload(
  input: {
    actor: ArtifactActor;
    artifact: ArtifactRecord;
    businessId: string;
    request: AuditRequestContext;
    submissionId: string;
    stepUpAudit: PayrollHighRiskAuditLink;
  },
  transaction: Prisma.TransactionClient,
): Promise<StatutoryArtifactDownload> {
  let body: Buffer;
  try {
    body = decryptStatutoryArtifact({
      artifactId: input.artifact.id,
      aadVersion: input.artifact.aadVersion,
      authenticationTag: input.artifact.authenticationTag,
      businessId: input.artifact.businessId,
      ciphertext: input.artifact.ciphertext,
      encryptionAlgorithm: input.artifact.encryptionAlgorithm,
      encryptionKeyVersion: input.artifact.encryptionKeyVersion,
      exportVersion: input.artifact.exportVersion,
      initializationVector: input.artifact.initializationVector,
      payrollRunId: input.artifact.payrollRunId,
      plaintextSha256: input.artifact.plaintextSha256,
      provider: input.artifact.provider,
      revision: input.artifact.revision,
    });
  } catch (error) {
    throw new StatutoryArtifactError(
      error instanceof Error ? error.message : "Statutory artifact verification failed.",
      500,
    );
  }
  if (body.length !== input.artifact.byteLength) {
    throw new StatutoryArtifactError("Statutory artifact length verification failed.", 500);
  }
  await writeDownloadAudit(input, transaction);
  return {
    artifactId: input.artifact.id,
    body,
    byteLength: input.artifact.byteLength,
    checksumSha256: input.artifact.plaintextSha256,
    contentType: input.artifact.contentType,
    fileName: input.artifact.fileName,
    provider: input.artifact.provider,
    recordCount: null,
    revision: input.artifact.revision,
    submissionId: input.submissionId,
  };
}

async function writeDownloadAudit(
  input: {
    actor: ArtifactActor;
    artifact: ArtifactRecord;
    businessId: string;
    request: AuditRequestContext;
    submissionId: string;
    stepUpAudit: PayrollHighRiskAuditLink;
  },
  transaction: Prisma.TransactionClient,
) {
  await writeAuditLog({
    businessId: input.businessId,
    actor: input.actor,
    request: input.request,
    action: "PAYROLL_OFFICIAL_STATUTORY_ARTIFACT_DOWNLOADED",
    entityType: "PayrollStatutoryExportArtifact",
    entityId: input.artifact.id,
    summary: `${input.artifact.provider} immutable statutory artifact downloaded.`,
    metadata: {
      byteLength: input.artifact.byteLength,
      checksumSha256: input.artifact.plaintextSha256,
      exportVersion: input.artifact.exportVersion,
      payrollRunId: input.artifact.payrollRunId,
      provider: input.artifact.provider,
      revision: input.artifact.revision,
      submissionId: input.submissionId,
      ...input.stepUpAudit,
    },
  }, transaction);
}

type ArtifactRecord = {
  aadVersion: string;
  authenticationTag: Uint8Array;
  businessId: string;
  byteLength: number;
  ciphertext: Uint8Array;
  contentType: string;
  encryptionAlgorithm: string;
  encryptionKeyVersion: string;
  exportVersion: string;
  fileName: string;
  id: string;
  initializationVector: Uint8Array;
  payrollRunId: string;
  plaintextSha256: string;
  provider: PayrollStatutoryProvider;
  revision: number;
};

function isRetryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002");
}
