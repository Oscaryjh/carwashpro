import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import { validateClaimAttachment } from "@/lib/claim/attachment-policy";
import {
  getClaimPrivateAttachmentStore,
  type ClaimPrivateAttachmentStore,
} from "@/lib/claim/private-attachment-storage";
import { prisma } from "@/lib/prisma";
import type {
  LeaveEvidenceStatus,
  LeaveSupportingDocumentType,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export const MAX_LEAVE_DOCUMENTS = 5;

export type UploadedLeaveDocument = Readonly<{
  bytes: Uint8Array;
  claimedMimeType: string;
  originalFileName: string;
  documentType?: LeaveSupportingDocumentType;
}>;

export type PreparedLeaveDocument = Readonly<{
  objectKey: string;
  sanitizedFileName: string;
  mimeType: string;
  byteLength: number;
  checksumSha256: string;
  documentType: LeaveSupportingDocumentType;
}>;

export async function prepareLeaveDocuments(
  uploads: readonly UploadedLeaveDocument[],
  store?: ClaimPrivateAttachmentStore,
) {
  if (uploads.length > MAX_LEAVE_DOCUMENTS) {
    throw new AttendanceApiError("VALIDATION_ERROR", `Upload up to ${MAX_LEAVE_DOCUMENTS} supporting documents per request.`);
  }
  if (uploads.length === 0) {
    return [];
  }
  const attachmentStore = store ?? getClaimPrivateAttachmentStore();
  const prepared: PreparedLeaveDocument[] = [];
  try {
    for (const upload of uploads) {
      const validated = validateClaimAttachment(upload);
      const stored = await attachmentStore.putQuarantined(validated, "leave-evidence");
      prepared.push({
        objectKey: stored.objectKey,
        sanitizedFileName: stored.sanitizedFileName,
        mimeType: stored.mimeType,
        byteLength: stored.byteLength,
        checksumSha256: stored.checksumSha256,
        documentType: upload.documentType ?? "SUPPORTING_DOCUMENT",
      });
    }
    return prepared;
  } catch (error) {
    await Promise.allSettled(prepared.map((item) => attachmentStore.deleteQuarantined(item.objectKey)));
    throw error;
  }
}

export async function discardPreparedLeaveDocuments(
  documents: readonly PreparedLeaveDocument[],
  store?: ClaimPrivateAttachmentStore,
) {
  if (documents.length === 0) {
    return;
  }
  const attachmentStore = store ?? getClaimPrivateAttachmentStore();
  await Promise.allSettled(documents.map((item) => attachmentStore.deleteQuarantined(item.objectKey)));
}

export function leaveDocumentCreateData(input: {
  businessId: string;
  membershipId: string;
  documents: readonly PreparedLeaveDocument[];
}): Prisma.LeaveSupportingDocumentUncheckedCreateWithoutLeaveRequestInput[] {
  return input.documents.map((document) => ({
    membershipId: input.membershipId,
    source: "UPLOAD",
    documentType: document.documentType,
    objectKey: document.objectKey,
    sanitizedFileName: document.sanitizedFileName,
    mimeType: document.mimeType,
    byteLength: document.byteLength,
    checksumSha256: document.checksumSha256,
    securityStatus: "SCAN_NOT_AVAILABLE",
    privacyClass: document.documentType === "MEDICAL_CERTIFICATE" || document.documentType === "HOSPITALISATION_SUPPORT"
      ? "SENSITIVE_MEDICAL"
      : "SENSITIVE_HR",
    lifecycleStatus: "ACTIVE",
    reviewStatus: "NOT_REVIEWED",
    uploadedByMembershipId: input.membershipId,
  }));
}

export async function getAuthorizedLeaveDocument(input: {
  documentId: string;
  businessId: string;
  membershipId?: string;
  allowedBranchIds?: readonly string[];
  actor?: AppSession;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma, store: ClaimPrivateAttachmentStore = getClaimPrivateAttachmentStore()) {
  const document = await database.leaveSupportingDocument.findFirst({
    where: {
      id: input.documentId,
      businessId: input.businessId,
      lifecycleStatus: "ACTIVE",
      source: "UPLOAD",
      objectKey: { not: null },
      checksumSha256: { not: null },
      ...(input.membershipId
        ? { membershipId: input.membershipId }
        : { leaveRequest: { branchId: { in: [...(input.allowedBranchIds ?? [])] } } }),
    },
    include: { leaveRequest: { select: { branchId: true } } },
  });
  if (!document?.objectKey || !document.checksumSha256 || !document.sanitizedFileName || !document.mimeType) {
    throw new Error("Leave supporting document was not found in the authorized scope.");
  }
  const bytes = await store.readQuarantined({ objectKey: document.objectKey, expectedChecksumSha256: document.checksumSha256 });
  await writeAuditLog({
    businessId: input.businessId,
    branchId: document.leaveRequest.branchId,
    actor: input.actor,
    request: input.request,
    action: "LEAVE_SUPPORTING_DOCUMENT_VIEWED",
    entityType: "LeaveSupportingDocument",
    entityId: document.id,
    summary: "Authorized user viewed a private Leave supporting document.",
    metadata: { privacyClass: document.privacyClass, content: "[REDACTED]" },
  });
  return { bytes, fileName: document.sanitizedFileName, mimeType: document.mimeType };
}

export async function removeOwnLeaveDocument(auth: EmployeeAuthContext, documentId: string) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.leaveSupportingDocument.findFirst({
      where: { id: documentId, businessId: auth.businessId, membershipId: auth.membershipId, lifecycleStatus: "ACTIVE" },
      include: { leaveRequest: { select: { id: true, branchId: true, status: true } } },
    });
    if (!document || document.leaveRequest.status !== "PENDING") {
      throw new AttendanceApiError("VALIDATION_ERROR", "This supporting document can no longer be removed.");
    }
    await tx.leaveSupportingDocument.update({
      where: { id: document.id },
      data: { lifecycleStatus: "REMOVED", removedAt: new Date(), removedByMembershipId: auth.membershipId },
    });
    const status = await recomputeLeaveEvidenceStatus(tx, document.leaveRequest.id, auth.businessId);
    await writeAuditLog({
      businessId: auth.businessId,
      branchId: document.leaveRequest.branchId,
      action: "LEAVE_SUPPORTING_DOCUMENT_REMOVED",
      entityType: "LeaveSupportingDocument",
      entityId: document.id,
      summary: "Employee removed a supporting document from a pending Leave request.",
      after: { lifecycleStatus: "REMOVED", requestEvidenceStatus: status },
    }, tx);
    return { status };
  }, { isolationLevel: "Serializable" });
}

export async function attachOwnLeaveDocuments(
  auth: EmployeeAuthContext,
  leaveRequestId: string,
  preparedDocuments: readonly PreparedLeaveDocument[],
) {
  if (preparedDocuments.length === 0) {
    throw new AttendanceApiError("VALIDATION_ERROR", "Choose at least one supporting document to upload.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const leaveRequest = await tx.leaveRequest.findFirst({
        where: {
          id: leaveRequestId,
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          status: "PENDING",
        },
        select: {
          id: true,
          branchId: true,
          _count: { select: { supportingDocuments: { where: { lifecycleStatus: "ACTIVE" } } } },
        },
      });
      if (!leaveRequest) {
        throw new AttendanceApiError("VALIDATION_ERROR", "Supporting documents can only be added to your own pending Leave request.");
      }
      if (leaveRequest._count.supportingDocuments + preparedDocuments.length > MAX_LEAVE_DOCUMENTS) {
        throw new AttendanceApiError("VALIDATION_ERROR", `A Leave request can have up to ${MAX_LEAVE_DOCUMENTS} active supporting documents.`);
      }

      const created = [];
      for (const data of leaveDocumentCreateData({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        documents: preparedDocuments,
      })) {
        created.push(await tx.leaveSupportingDocument.create({
          data: { ...data, businessId: auth.businessId, leaveRequestId: leaveRequest.id },
          select: { id: true, privacyClass: true },
        }));
      }
      const status = await recomputeLeaveEvidenceStatus(tx, leaveRequest.id, auth.businessId);
      for (const document of created) {
        await writeAuditLog({
          businessId: auth.businessId,
          branchId: leaveRequest.branchId,
          action: "LEAVE_SUPPORTING_DOCUMENT_UPLOADED",
          entityType: "LeaveSupportingDocument",
          entityId: document.id,
          summary: "Employee uploaded a private Leave supporting document.",
          after: { privacyClass: document.privacyClass, content: "[REDACTED]" },
        }, tx);
        await writeAuditLog({
          businessId: auth.businessId,
          branchId: leaveRequest.branchId,
          action: "LEAVE_SUPPORTING_DOCUMENT_BOUND",
          entityType: "LeaveSupportingDocument",
          entityId: document.id,
          summary: "Private supporting document was bound to a pending Leave request.",
          after: { leaveRequestId: leaveRequest.id, requestEvidenceStatus: status },
        }, tx);
      }
      return { status, documentCount: leaveRequest._count.supportingDocuments + created.length };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await discardPreparedLeaveDocuments(preparedDocuments);
    throw error;
  }
}

export async function replaceOwnLeaveDocument(
  auth: EmployeeAuthContext,
  documentId: string,
  preparedDocument: PreparedLeaveDocument,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.leaveSupportingDocument.findFirst({
        where: {
          id: documentId,
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          lifecycleStatus: "ACTIVE",
        },
        include: { leaveRequest: { select: { id: true, branchId: true, status: true } } },
      });
      if (!existing || existing.leaveRequest.status !== "PENDING") {
        throw new AttendanceApiError("VALIDATION_ERROR", "This supporting document can no longer be replaced.");
      }

      const [data] = leaveDocumentCreateData({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        documents: [preparedDocument],
      });
      const replacement = await tx.leaveSupportingDocument.create({
        data: {
          ...data,
          businessId: auth.businessId,
          leaveRequestId: existing.leaveRequest.id,
        },
        select: { id: true, privacyClass: true },
      });
      await tx.leaveSupportingDocument.update({
        where: { id: existing.id },
        data: {
          lifecycleStatus: "SUPERSEDED",
          supersededById: replacement.id,
          removedAt: new Date(),
          removedByMembershipId: auth.membershipId,
        },
      });
      const status = await recomputeLeaveEvidenceStatus(tx, existing.leaveRequest.id, auth.businessId);
      await writeAuditLog({
        businessId: auth.businessId,
        branchId: existing.leaveRequest.branchId,
        action: "LEAVE_SUPPORTING_DOCUMENT_REPLACED",
        entityType: "LeaveSupportingDocument",
        entityId: existing.id,
        summary: "Employee replaced a supporting document on a pending Leave request.",
        after: {
          lifecycleStatus: "SUPERSEDED",
          replacementDocumentId: replacement.id,
          privacyClass: replacement.privacyClass,
          requestEvidenceStatus: status,
          content: "[REDACTED]",
        },
      }, tx);
      return { status, documentId: replacement.id };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await discardPreparedLeaveDocuments([preparedDocument]);
    throw error;
  }
}

export async function reviewLeaveDocument(input: {
  documentId: string;
  businessId: string;
  allowedBranchIds: readonly string[];
  actor: AppSession;
  request?: AuditRequestContext;
  status: Extract<LeaveEvidenceStatus, "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED">;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.leaveSupportingDocument.findFirst({
      where: {
        id: input.documentId,
        businessId: input.businessId,
        lifecycleStatus: "ACTIVE",
        leaveRequest: { branchId: { in: [...input.allowedBranchIds] }, status: "PENDING" },
      },
      include: { leaveRequest: { select: { id: true, branchId: true } } },
    });
    if (!document) throw new Error("Leave supporting document is unavailable in your branch scope.");
    const note = input.note?.trim() || null;
    if ((input.status === "REJECTED" || input.status === "REVIEW_REQUIRED") && !note) {
      throw new Error("A review note is required when evidence is rejected or needs review.");
    }
    await tx.leaveSupportingDocument.update({
      where: { id: document.id },
      data: { reviewStatus: input.status, reviewedById: input.actor.userId, reviewedAt: new Date(), reviewNote: note },
    });
    const aggregate = await recomputeLeaveEvidenceStatus(tx, document.leaveRequest.id, input.businessId);
    await writeAuditLog({
      businessId: input.businessId,
      branchId: document.leaveRequest.branchId,
      actor: input.actor,
      request: input.request,
      action: input.status === "VERIFIED" ? "LEAVE_SUPPORTING_DOCUMENT_VERIFIED" : "LEAVE_SUPPORTING_DOCUMENT_REVIEW_REQUIRED",
      entityType: "LeaveSupportingDocument",
      entityId: document.id,
      summary: input.status === "VERIFIED" ? "Leave supporting document verified." : "Leave supporting document requires follow-up.",
      after: { reviewStatus: input.status, requestEvidenceStatus: aggregate, notePresent: Boolean(note) },
    }, tx);
    return { status: aggregate };
  }, { isolationLevel: "Serializable" });
}

export async function recomputeLeaveEvidenceStatus(tx: Prisma.TransactionClient, leaveRequestId: string, businessId: string) {
  const documents = await tx.leaveSupportingDocument.findMany({
    where: { leaveRequestId, businessId, lifecycleStatus: "ACTIVE" },
    select: { reviewStatus: true, source: true },
  });
  const status: LeaveEvidenceStatus = documents.length === 0
    ? "NOT_REVIEWED"
    : documents.some((item) => item.reviewStatus === "REJECTED")
      ? "REJECTED"
      : documents.some((item) => item.reviewStatus === "REVIEW_REQUIRED" || item.source === "LEGACY_REFERENCE")
        ? "REVIEW_REQUIRED"
        : documents.every((item) => item.reviewStatus === "VERIFIED")
          ? "VERIFIED"
          : "NOT_REVIEWED";
  await tx.leaveRequest.update({ where: { id: leaveRequestId }, data: { supportingEvidenceStatus: status } });
  return status;
}

export function serializeLeaveDocument(document: {
  id: string;
  source: string;
  documentType: string;
  sanitizedFileName: string | null;
  mimeType: string | null;
  byteLength: number | null;
  securityStatus: string;
  lifecycleStatus: string;
  reviewStatus: string;
  reviewNote: string | null;
  createdAt: Date;
}) {
  return {
    id: document.id,
    source: document.source,
    documentType: document.documentType,
    fileName: document.sanitizedFileName ?? (document.source === "LEGACY_REFERENCE" ? "Legacy evidence reference" : "Supporting document"),
    mimeType: document.mimeType,
    byteLength: document.byteLength,
    securityStatus: document.securityStatus,
    lifecycleStatus: document.lifecycleStatus,
    reviewStatus: document.reviewStatus,
    reviewNote: document.reviewNote,
    createdAt: document.createdAt.toISOString(),
  };
}
