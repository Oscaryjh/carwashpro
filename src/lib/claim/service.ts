import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth";
import { prisma } from "@/lib/prisma";
import { deriveAndPersistEntryAggregates } from "@/lib/payroll/component-service";
import {
  getClaimPrivateAttachmentStore,
  type ClaimPrivateAttachmentStore,
} from "./private-attachment-storage";
import { validateClaimAttachment } from "./attachment-policy";
import {
  centsToMoney,
  cancelApprovedClaimInputSchema,
  claimCategoryRevisionInputSchema,
  moneyToCents,
  parseClaimDate,
  parseMoneyCents,
  parseNonNegativeMoneyCents,
  reviewClaimInputSchema,
  submitClaimInputSchema,
  withdrawClaimInputSchema,
} from "./policy";

type ClaimActor = Pick<AppSession, "userId" | "name" | "email">;
type UploadedClaimFile = {
  lineNumber: number;
  bytes: Uint8Array;
  claimedMimeType: string;
  originalFileName: string;
};

export async function getEmployeeClaimOverview(
  auth: EmployeeAuthContext,
  database: PrismaClient = prisma,
) {
  const today = startOfUtcDay(new Date());
  const [membership, categories, claims] = await Promise.all([
    database.employeeBusinessMembership.findFirst({
      where: { id: auth.membershipId, businessId: auth.businessId, status: "ACTIVE" },
      select: { fullName: true, employeeCode: true },
    }),
    database.claimCategory.findMany({
      where: { businessId: auth.businessId, active: true },
      orderBy: [{ name: "asc" }],
      include: {
        policyRevisions: {
          where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
          take: 1,
        },
      },
    }),
    database.employeeClaim.findMany({
      where: { businessId: auth.businessId, membershipId: auth.membershipId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        lines: { orderBy: { lineNumber: "asc" }, include: { attachments: true } },
        reimbursement: true,
      },
    }),
  ]);
  if (!membership) throw new Error("Employee membership is not active.");

  return {
    employee: membership,
    categories: categories.flatMap((category) => {
      const policy = category.policyRevisions[0];
      return policy ? [{
        id: category.id,
        code: category.code,
        name: category.name,
        nature: category.nature,
        policyRevisionId: policy.id,
        receiptRequired: policy.receiptRequired,
        maxLineAmount: policy.maxLineAmount?.toString() ?? null,
        mileageRatePerKm: policy.mileageRatePerKm?.toString() ?? null,
      }] : [];
    }),
    claims: claims.map(serializeClaim),
  };
}

export async function submitEmployeeClaim(
  auth: EmployeeAuthContext,
  rawInput: unknown,
  uploadedFiles: UploadedClaimFile[],
  options: { database?: PrismaClient; store?: ClaimPrivateAttachmentStore } = {},
) {
  const input = submitClaimInputSchema.parse(rawInput);
  const database = options.database ?? prisma;
  const existing = await database.employeeClaim.findFirst({
    where: { businessId: auth.businessId, membershipId: auth.membershipId, clientRequestId: input.clientRequestId },
    include: { lines: true, reimbursement: true },
  });
  if (existing) return serializeClaim(existing);

  const store = uploadedFiles.length ? (options.store ?? getClaimPrivateAttachmentStore()) : null;
  const storedFiles: Array<{
    lineNumber: number;
    stored: Awaited<ReturnType<ClaimPrivateAttachmentStore["putQuarantined"]>>;
    malwareStatus: "NOT_SCANNED";
    privacyMetadataStatus: "NOT_CHECKED" | "DETECTED";
  }> = [];
  try {
    for (const file of uploadedFiles) {
      if (!input.lines.some((line) => line.lineNumber === file.lineNumber)) {
        throw new Error("A receipt references an unknown Claim line.");
      }
      const validated = validateClaimAttachment(file);
      const stored = await store!.putQuarantined(validated);
      storedFiles.push({
        lineNumber: file.lineNumber,
        stored,
        malwareStatus: validated.malwareStatus,
        privacyMetadataStatus: validated.privacyMetadataStatus,
      });
    }

    return await database.$transaction(async (transaction) => {
      const membership = await transaction.employeeBusinessMembership.findFirst({
        where: {
          id: auth.membershipId,
          businessId: auth.businessId,
          status: "ACTIVE",
          branchAssignments: {
            some: { branchId: auth.primaryBranchId, businessId: auth.businessId, status: "ACTIVE", isPrimary: true },
          },
        },
        select: { id: true },
      });
      if (!membership) throw new Error("Employee Claim scope is no longer active.");

      const prepared = [] as Array<{
        lineNumber: number;
        category: { id: string; code: string; name: string; nature: "GENERAL" | "MILEAGE" };
        policy: {
          id: string;
          receiptRequired: boolean;
          descriptionRequired: boolean;
          maxLineAmount: { toString(): string } | null;
          mileageRatePerKm: { toString(): string } | null;
          statutoryTreatmentStatus: "VERIFIED_NON_WAGE" | "REVIEW_REQUIRED";
        };
        expenseDate: Date;
        merchant: string | null;
        description: string;
        amountCents: number;
        mileageKm: string | null;
      }>;
      for (const line of input.lines.sort((a, b) => a.lineNumber - b.lineNumber)) {
        const expenseDate = parseClaimDate(line.expenseDate);
        const category = await transaction.claimCategory.findFirst({
          where: { id: line.categoryId, businessId: auth.businessId, active: true },
          include: {
            policyRevisions: {
              where: { effectiveFrom: { lte: expenseDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: expenseDate } }] },
              orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
              take: 1,
            },
          },
        });
        const policy = category?.policyRevisions[0];
        if (!category || !policy) throw new Error("Claim category policy is not effective for the expense date.");
        if (policy.descriptionRequired && line.description.trim().length < 3) throw new Error("Claim description is required.");
        let amountCents = parseMoneyCents(line.amount);
        let mileageKm: string | null = null;
        if (category.nature === "MILEAGE") {
          const km = Number(line.mileageKm);
          const rate = Number(policy.mileageRatePerKm);
          if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(rate) || rate <= 0) {
            throw new Error("Mileage Claims require positive kilometres and an effective company rate.");
          }
          mileageKm = km.toFixed(2);
          amountCents = Math.round(km * rate * 100);
        }
        if (policy.maxLineAmount && amountCents > moneyToCents(policy.maxLineAmount)) {
          throw new Error(`${category.name} exceeds the company line limit.`);
        }
        if (policy.receiptRequired && !storedFiles.some((file) => file.lineNumber === line.lineNumber)) {
          throw new Error(`${category.name} requires a receipt.`);
        }
        prepared.push({
          lineNumber: line.lineNumber,
          category,
          policy,
          expenseDate,
          merchant: line.merchant?.trim() || null,
          description: line.description.trim(),
          amountCents,
          mileageKm,
        });
      }
      const submittedTotalCents = prepared.reduce((sum, line) => sum + line.amountCents, 0);
      if (!Number.isSafeInteger(submittedTotalCents) || submittedTotalCents <= 0) throw new Error("Claim total is invalid.");

      const duplicateMatches = await Promise.all(prepared.map((line) =>
        transaction.claimLine.findFirst({
          where: {
            businessId: auth.businessId,
            categoryId: line.category.id,
            expenseDate: line.expenseDate,
            submittedAmount: centsToMoney(line.amountCents),
            claim: { membershipId: auth.membershipId, status: { notIn: ["REJECTED", "WITHDRAWN"] } },
          },
          select: { id: true },
        }),
      ));
      const duplicateWarning = duplicateMatches.some(Boolean);
      const business = await transaction.business.update({
        where: { id: auth.businessId },
        data: { claimSequence: { increment: 1 } },
        select: { claimSequence: true },
      });
      const claim = await transaction.employeeClaim.create({
        data: {
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          branchId: auth.primaryBranchId,
          claimNumber: String(business.claimSequence),
          clientRequestId: input.clientRequestId,
          purpose: input.purpose,
          currency: "MYR",
          status: "SUBMITTED",
          submittedTotal: centsToMoney(submittedTotalCents),
          approvedTotal: "0.00",
          duplicateWarning,
          duplicateWarningNote: duplicateWarning ? "Possible duplicate: same employee, category, expense date and amount." : null,
          revision: 1,
          submittedAt: new Date(),
        },
      });
      await transaction.claimLine.createMany({
        data: prepared.map((line) => ({
          businessId: auth.businessId,
          claimId: claim.id,
          lineNumber: line.lineNumber,
          categoryId: line.category.id,
          policyRevisionId: line.policy.id,
          categoryCodeSnapshot: line.category.code,
          categoryNameSnapshot: line.category.name,
          expenseNatureSnapshot: line.category.nature,
          expenseDate: line.expenseDate,
          merchant: line.merchant,
          description: line.description,
          submittedAmount: centsToMoney(line.amountCents),
          approvedAmount: "0.00",
          mileageKm: line.mileageKm,
          mileageRateSnapshot: line.policy.mileageRatePerKm?.toString() ?? null,
          receiptRequiredSnapshot: line.policy.receiptRequired,
          statutoryTreatmentStatus: line.policy.statutoryTreatmentStatus,
        })),
      });
      const createdLines = await transaction.claimLine.findMany({
        where: { claimId: claim.id, businessId: auth.businessId },
        select: { id: true, lineNumber: true },
      });
      const lineByNumber = new Map(createdLines.map((line) => [line.lineNumber, line]));
      if (storedFiles.length) {
        await transaction.claimAttachment.createMany({
          data: storedFiles.map((file) => ({
            businessId: auth.businessId,
            claimId: claim.id,
            lineId: lineByNumber.get(file.lineNumber)?.id,
            membershipId: auth.membershipId,
            objectKey: file.stored.objectKey,
            sanitizedFileName: file.stored.sanitizedFileName,
            mimeType: file.stored.mimeType,
            byteLength: file.stored.byteLength,
            checksumSha256: file.stored.checksumSha256,
            malwareStatus: file.malwareStatus,
            privacyMetadataStatus: file.privacyMetadataStatus,
          })),
        });
      }
      await appendClaimEvent(transaction, {
        businessId: auth.businessId,
        claimId: claim.id,
        claimRevision: 1,
        type: "SUBMITTED",
        actorMembershipId: auth.membershipId,
        metadata: { lineCount: prepared.length, duplicateWarning },
      });
      if (duplicateWarning) {
        await appendClaimEvent(transaction, {
          businessId: auth.businessId,
          claimId: claim.id,
          claimRevision: 1,
          type: "DUPLICATE_WARNING_RECORDED",
          actorMembershipId: auth.membershipId,
          metadata: { warningOnly: true },
        });
      }
      await writeAuditLog({
        businessId: auth.businessId,
        branchId: auth.primaryBranchId,
        action: "CLAIM_SUBMITTED",
        entityType: "EmployeeClaim",
        entityId: claim.id,
        summary: `Employee Claim ${claim.claimNumber} submitted.`,
        metadata: { membershipId: auth.membershipId, lineCount: prepared.length, amount: "[REDACTED]", duplicateWarning },
      }, transaction);
      return serializeClaim(await transaction.employeeClaim.findUniqueOrThrow({
        where: { id: claim.id },
        include: { lines: { orderBy: { lineNumber: "asc" }, include: { attachments: true } }, reimbursement: true },
      }));
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (store) await Promise.allSettled(storedFiles.map((file) => store.deleteQuarantined(file.stored.objectKey)));
    throw error;
  }
}

export async function withdrawEmployeeClaim(
  auth: EmployeeAuthContext,
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  const input = withdrawClaimInputSchema.parse(rawInput);
  return database.$transaction(async (transaction) => {
    const updated = await transaction.employeeClaim.updateMany({
      where: {
        id: input.claimId,
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        status: "SUBMITTED",
        revision: input.expectedRevision,
      },
      data: {
        status: "WITHDRAWN",
        revision: { increment: 1 },
        withdrawnAt: new Date(),
        withdrawalReason: input.reason,
      },
    });
    if (updated.count !== 1) throw new Error("Claim changed or can no longer be withdrawn. Reload and try again.");
    await appendClaimEvent(transaction, {
      businessId: auth.businessId,
      claimId: input.claimId,
      claimRevision: input.expectedRevision + 1,
      type: "WITHDRAWN",
      actorMembershipId: auth.membershipId,
      reason: input.reason,
    });
    return { ok: true };
  }, { isolationLevel: "Serializable" });
}

export async function getManagerClaimDashboard(input: {
  businessId: string;
  allowedBranchIds: string[];
}, database: PrismaClient = prisma) {
  const [categories, claims, payrollRuns] = await Promise.all([
    database.claimCategory.findMany({
      where: { businessId: input.businessId },
      orderBy: { name: "asc" },
      include: { policyRevisions: { orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }] } },
    }),
    database.employeeClaim.findMany({
      where: { businessId: input.businessId, branchId: { in: input.allowedBranchIds } },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        membership: { select: { id: true, fullName: true, employeeCode: true, staffUser: { select: { id: true } } } },
        branch: { select: { id: true, name: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { attachments: true } },
        reimbursement: { include: { payrollSnapshots: true } },
      },
    }),
    database.payrollRun.findMany({
      where: { businessId: input.businessId, status: "DRAFT" },
      orderBy: { periodStart: "desc" },
      select: { id: true, periodStart: true, periodEnd: true },
    }),
  ]);
  return {
    categories: categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      nature: category.nature,
      active: category.active,
      revisions: category.policyRevisions.map((revision) => ({
        ...revision,
        effectiveFrom: revision.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: revision.effectiveTo?.toISOString().slice(0, 10) ?? null,
        maxLineAmount: revision.maxLineAmount?.toString() ?? null,
        mileageRatePerKm: revision.mileageRatePerKm?.toString() ?? null,
      })),
    })),
    claims: claims.map((claim) => ({
      ...serializeClaim(claim),
      membership: claim.membership,
      branch: claim.branch,
      payrollSnapshots: claim.reimbursement?.payrollSnapshots ?? [],
    })),
    payrollRuns: payrollRuns.map((run) => ({
      id: run.id,
      label: `${run.periodStart.toISOString().slice(0, 7)} Draft`,
    })),
  };
}

export async function reviewEmployeeClaim(context: {
  businessId: string;
  allowedBranchIds: string[];
  actor: ClaimActor;
  request?: AuditRequestContext;
  rawInput: unknown;
}, database: PrismaClient = prisma) {
  const input = reviewClaimInputSchema.parse(context.rawInput);
  return database.$transaction(async (transaction) => {
    const claim = await transaction.employeeClaim.findFirst({
      where: { id: input.claimId, businessId: context.businessId, branchId: { in: context.allowedBranchIds } },
      include: { lines: true, membership: { select: { staffUser: { select: { id: true } } } } },
    });
    if (!claim || claim.status !== "SUBMITTED") throw new Error("Submitted Claim was not found in the authorized scope.");
    if (claim.revision !== input.expectedRevision) throw new Error("Claim changed after this page was loaded. Reload and try again.");
    if (claim.membership.staffUser?.id === context.actor.userId) throw new Error("Employees cannot approve their own Claims.");
    if (input.lines.length !== claim.lines.length || new Set(input.lines.map((line) => line.lineId)).size !== claim.lines.length) {
      throw new Error("Every Claim line must receive exactly one decision.");
    }
    const sourceLine = new Map(claim.lines.map((line) => [line.id, line]));
    let approvedTotalCents = 0;
    const decisions = input.lines.map((decision) => {
      const line = sourceLine.get(decision.lineId);
      if (!line) throw new Error("Claim line is outside this Claim.");
      const submitted = moneyToCents(line.submittedAmount);
      const approved = parseNonNegativeMoneyCents(decision.approvedAmount);
      if (approved > submitted) throw new Error("Approved Claim amount cannot exceed submitted amount.");
      const isReduced = approved < submitted;
      if (isReduced && !decision.reason?.trim() && !input.reason?.trim()) {
        throw new Error("Partial approval or rejection requires a reason.");
      }
      approvedTotalCents += approved;
      return {
        line,
        approved,
        reviewStatus: approved === 0 ? "REJECTED" as const : approved === submitted ? "APPROVED" as const : "PARTIALLY_APPROVED" as const,
        reason: decision.reason?.trim() || (isReduced ? input.reason?.trim() : null) || null,
      };
    });
    const submittedTotalCents = moneyToCents(claim.submittedTotal);
    const status = approvedTotalCents === 0 ? "REJECTED" as const : approvedTotalCents === submittedTotalCents ? "APPROVED" as const : "PARTIALLY_APPROVED" as const;
    const nextRevision = claim.revision + 1;
    const decisionDigest = digest({
      claimId: claim.id,
      revision: nextRevision,
      status,
      lines: decisions.map((item) => ({ id: item.line.id, approved: item.approved, reason: item.reason })),
    });
    const changed = await transaction.employeeClaim.updateMany({
      where: { id: claim.id, businessId: context.businessId, status: "SUBMITTED", revision: input.expectedRevision },
      data: {
        status,
        approvedTotal: centsToMoney(approvedTotalCents),
        revision: { increment: 1 },
        reviewedById: context.actor.userId,
        reviewedAt: new Date(),
        reviewReason: input.reason?.trim() || null,
        decisionDigest,
      },
    });
    if (changed.count !== 1) throw new Error("Claim changed concurrently. Reload and try again.");
    for (const decision of decisions) {
      await transaction.claimLine.update({
        where: { id: decision.line.id },
        data: { approvedAmount: centsToMoney(decision.approved), reviewStatus: decision.reviewStatus, reviewReason: decision.reason },
      });
    }
    if (approvedTotalCents > 0) {
      await transaction.claimReimbursement.create({
        data: {
          businessId: context.businessId,
          claimId: claim.id,
          membershipId: claim.membershipId,
          amount: centsToMoney(approvedTotalCents),
          currency: "MYR",
          status: "AWAITING_CHANNEL",
        },
      });
    }
    await appendClaimEvent(transaction, {
      businessId: context.businessId,
      claimId: claim.id,
      claimRevision: nextRevision,
      type: status === "APPROVED" ? "APPROVED" : status === "PARTIALLY_APPROVED" ? "PARTIALLY_APPROVED" : "REJECTED",
      actorUserId: context.actor.userId,
      reason: input.reason?.trim() || null,
      metadata: { lineCount: decisions.length, amount: "[REDACTED]", decisionDigest },
    });
    await writeAuditLog({
      businessId: context.businessId,
      branchId: claim.branchId,
      actor: context.actor,
      request: context.request,
      action: `CLAIM_${status}`,
      entityType: "EmployeeClaim",
      entityId: claim.id,
      summary: `Claim ${claim.claimNumber} ${status.toLowerCase().replaceAll("_", " ")}.`,
      metadata: { membershipId: claim.membershipId, amount: "[REDACTED]", decisionDigest },
    }, transaction);
    return { status, revision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function cancelApprovedEmployeeClaim(context: {
  businessId: string;
  allowedBranchIds: string[];
  actor: ClaimActor;
  request?: AuditRequestContext;
  rawInput: unknown;
}, database: PrismaClient = prisma) {
  const input = cancelApprovedClaimInputSchema.parse(context.rawInput);
  return database.$transaction(async (transaction) => {
    const claim = await transaction.employeeClaim.findFirst({
      where: { id: input.claimId, businessId: context.businessId, branchId: { in: context.allowedBranchIds } },
      include: {
        reimbursement: { include: { payrollSnapshots: { include: { payrollEntry: true } } } },
      },
    });
    if (!claim || !["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status)) {
      throw new Error("Approved Claim was not found in the authorized scope.");
    }
    if (claim.revision !== input.expectedRevision) throw new Error("Claim changed after this page was loaded. Reload and try again.");
    if (!claim.reimbursement) throw new Error("Approved Claim reimbursement obligation is missing.");
    if (["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED"].includes(claim.reimbursement.status)) {
      throw new Error("CLAIM_ALREADY_REIMBURSED");
    }
    const nextRevision = claim.revision + 1;
    const changed = await transaction.employeeClaim.updateMany({
      where: { id: claim.id, businessId: context.businessId, revision: input.expectedRevision, status: claim.status },
      data: { status: "CANCELLED", revision: { increment: 1 }, reviewReason: input.reason },
    });
    if (changed.count !== 1) throw new Error("Claim changed concurrently. Reload and try again.");
    await transaction.claimReimbursement.update({
      where: { id: claim.reimbursement.id },
      data: { status: "CANCELLED", revision: { increment: 1 }, note: input.reason },
    });
    for (const snapshot of claim.reimbursement.payrollSnapshots) {
      await transaction.payrollClaimReimbursementSnapshot.update({
        where: { id: snapshot.id },
        data: { status: "CANCELLED", blockerCode: null },
      });
      if (snapshot.status === "READY") {
        await deriveAndPersistEntryAggregates(transaction, snapshot.payrollEntry, snapshot.payrollEntry.calculationRevision);
      }
    }
    await appendClaimEvent(transaction, {
      businessId: context.businessId,
      claimId: claim.id,
      claimRevision: nextRevision,
      type: "CLAIM_CANCELLED",
      actorUserId: context.actor.userId,
      reason: input.reason,
    });
    await appendClaimEvent(transaction, {
      businessId: context.businessId,
      claimId: claim.id,
      claimRevision: nextRevision,
      type: "REIMBURSEMENT_CANCELLED",
      actorUserId: context.actor.userId,
      reason: input.reason,
    });
    await writeAuditLog({
      businessId: context.businessId,
      branchId: claim.branchId,
      actor: context.actor,
      request: context.request,
      action: "CLAIM_APPROVED_CANCELLED",
      entityType: "EmployeeClaim",
      entityId: claim.id,
      summary: `Approved Claim ${claim.claimNumber} cancelled before reimbursement.`,
      metadata: { reimbursementCancelled: true, amount: "[REDACTED]" },
    }, transaction);
    return { status: "CANCELLED" as const, revision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function installClaimCategoryStarters(
  context: { businessId: string; actor: ClaimActor; request?: AuditRequestContext },
  database: PrismaClient = prisma,
) {
  const starters = [
    ["GENERAL", "General reimbursement", "GENERAL"],
    ["MEALS", "Meals", "GENERAL"],
    ["TRAVEL", "Travel", "GENERAL"],
    ["MILEAGE", "Mileage", "MILEAGE"],
  ] as const;
  return database.$transaction(async (transaction) => {
    for (const [code, name, nature] of starters) {
      const category = await transaction.claimCategory.upsert({
        where: { businessId_code: { businessId: context.businessId, code } },
        create: { businessId: context.businessId, code, name, nature, description: "Company reimbursement policy; not a statutory classification." },
        update: {},
      });
      const existing = await transaction.claimPolicyRevision.findFirst({ where: { categoryId: category.id } });
      if (!existing) {
        await transaction.claimPolicyRevision.create({
          data: {
            businessId: context.businessId,
            categoryId: category.id,
            revision: 1,
            effectiveFrom: new Date("2000-01-01T00:00:00.000Z"),
            nameSnapshot: name,
            natureSnapshot: nature,
            receiptRequired: code !== "MILEAGE",
            descriptionRequired: true,
            mileageRatePerKm: code === "MILEAGE" ? "0.85" : null,
            statutoryTreatmentStatus: "REVIEW_REQUIRED",
            reason: "Company starter; statutory treatment intentionally requires review.",
            createdById: context.actor.userId,
          },
        });
      }
    }
    await writeAuditLog({
      businessId: context.businessId,
      actor: context.actor,
      request: context.request,
      action: "CLAIM_CATEGORY_STARTERS_INSTALLED",
      entityType: "ClaimCategory",
      summary: "Company Claim category starters installed with fail-closed statutory treatment.",
    }, transaction);
    return { installed: starters.length };
  }, { isolationLevel: "Serializable" });
}

export async function createClaimCategoryRevision(context: {
  businessId: string;
  actor: ClaimActor;
  request?: AuditRequestContext;
  rawInput: unknown;
}, database: PrismaClient = prisma) {
  const input = claimCategoryRevisionInputSchema.parse(context.rawInput);
  return database.$transaction(async (transaction) => {
    const category = input.categoryId
      ? await transaction.claimCategory.findFirst({ where: { id: input.categoryId, businessId: context.businessId } })
      : await transaction.claimCategory.create({
          data: { businessId: context.businessId, code: input.code, name: input.name, description: input.description || null, nature: input.nature },
        });
    if (!category) throw new Error("Claim category was not found.");
    if (category.code !== input.code || category.nature !== input.nature) {
      throw new Error("Category identity and expense nature are immutable; create a new category instead.");
    }
    const latest = await transaction.claimPolicyRevision.findFirst({
      where: { categoryId: category.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const mileageRate = input.nature === "MILEAGE" ? Number(input.mileageRatePerKm) : null;
    if (input.nature === "MILEAGE" && (!Number.isFinite(mileageRate) || mileageRate! <= 0)) {
      throw new Error("Mileage policy requires a positive RM per km rate.");
    }
    const revision = await transaction.claimPolicyRevision.create({
      data: {
        businessId: context.businessId,
        categoryId: category.id,
        revision: (latest?.revision ?? 0) + 1,
        effectiveFrom: parseClaimDate(input.effectiveFrom),
        nameSnapshot: input.name,
        natureSnapshot: input.nature,
        receiptRequired: input.receiptRequired,
        descriptionRequired: input.descriptionRequired,
        maxLineAmount: input.maxLineAmount ? centsToMoney(parseMoneyCents(input.maxLineAmount)) : null,
        mileageRatePerKm: mileageRate === null ? null : mileageRate.toFixed(4),
        statutoryTreatmentStatus: "REVIEW_REQUIRED",
        reason: input.reason,
        createdById: context.actor.userId,
      },
    });
    await writeAuditLog({
      businessId: context.businessId,
      actor: context.actor,
      request: context.request,
      action: "CLAIM_POLICY_REVISION_CREATED",
      entityType: "ClaimPolicyRevision",
      entityId: revision.id,
      summary: `Immutable Claim policy revision ${revision.revision} created for ${category.code}.`,
      metadata: { categoryId: category.id, statutoryTreatmentStatus: "REVIEW_REQUIRED" },
    }, transaction);
    return revision;
  }, { isolationLevel: "Serializable" });
}

export async function getAuthorizedClaimAttachment(input: {
  attachmentId: string;
  businessId: string;
  membershipId?: string;
  allowedBranchIds?: string[];
}, database: PrismaClient = prisma, store: ClaimPrivateAttachmentStore = getClaimPrivateAttachmentStore()) {
  const attachment = await database.claimAttachment.findFirst({
    where: {
      id: input.attachmentId,
      businessId: input.businessId,
      ...(input.membershipId
        ? { membershipId: input.membershipId }
        : { claim: { branchId: { in: input.allowedBranchIds ?? [] } } }),
    },
  });
  if (!attachment) throw new Error("Claim receipt was not found in the authorized scope.");
  const bytes = await store.readQuarantined({ objectKey: attachment.objectKey, expectedChecksumSha256: attachment.checksumSha256 });
  return { bytes, fileName: attachment.sanitizedFileName, mimeType: attachment.mimeType };
}

function serializeClaim(claim: {
  id: string;
  claimNumber: string;
  purpose: string;
  currency: string;
  status: string;
  submittedTotal: { toString(): string };
  approvedTotal: { toString(): string };
  duplicateWarning: boolean;
  duplicateWarningNote: string | null;
  revision: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  withdrawalReason: string | null;
  createdAt: Date;
  lines: Array<{
    id: string;
    lineNumber: number;
    categoryId: string;
    categoryCodeSnapshot: string;
    categoryNameSnapshot: string;
    expenseNatureSnapshot: string;
    expenseDate: Date;
    merchant: string | null;
    description: string;
    submittedAmount: { toString(): string };
    approvedAmount: { toString(): string };
    mileageKm: { toString(): string } | null;
    mileageRateSnapshot: { toString(): string } | null;
    receiptRequiredSnapshot: boolean;
    statutoryTreatmentStatus: string;
    reviewStatus: string;
    reviewReason: string | null;
    attachments?: Array<{ id: string; sanitizedFileName: string; mimeType: string; malwareStatus: string; privacyMetadataStatus: string }>;
  }>;
  reimbursement?: {
    id: string;
    amount: { toString(): string };
    channel: string | null;
    status: string;
    revision: number;
    paymentReference: string | null;
    paidAt: Date | null;
  } | null;
}) {
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    purpose: claim.purpose,
    currency: claim.currency,
    status: claim.status,
    submittedTotal: claim.submittedTotal.toString(),
    approvedTotal: claim.approvedTotal.toString(),
    duplicateWarning: claim.duplicateWarning,
    duplicateWarningNote: claim.duplicateWarningNote,
    revision: claim.revision,
    submittedAt: claim.submittedAt?.toISOString() ?? null,
    reviewedAt: claim.reviewedAt?.toISOString() ?? null,
    reviewReason: claim.reviewReason,
    withdrawalReason: claim.withdrawalReason,
    createdAt: claim.createdAt.toISOString(),
    lines: claim.lines.map((line) => ({
      ...line,
      expenseDate: line.expenseDate.toISOString().slice(0, 10),
      submittedAmount: line.submittedAmount.toString(),
      approvedAmount: line.approvedAmount.toString(),
      mileageKm: line.mileageKm?.toString() ?? null,
      mileageRateSnapshot: line.mileageRateSnapshot?.toString() ?? null,
      attachments: line.attachments?.map((attachment) => ({
        id: attachment.id,
        sanitizedFileName: attachment.sanitizedFileName,
        mimeType: attachment.mimeType,
        malwareStatus: attachment.malwareStatus,
        privacyMetadataStatus: attachment.privacyMetadataStatus,
      })) ?? [],
    })),
    reimbursement: claim.reimbursement ? {
      id: claim.reimbursement.id,
      amount: claim.reimbursement.amount.toString(),
      channel: claim.reimbursement.channel,
      status: claim.reimbursement.status,
      revision: claim.reimbursement.revision,
      paymentReference: claim.reimbursement.paymentReference,
      paidAt: claim.reimbursement.paidAt?.toISOString() ?? null,
    } : null,
  };
}

export async function appendClaimEvent(transaction: Prisma.TransactionClient, input: {
  businessId: string;
  claimId: string;
  claimRevision: number;
  type: Prisma.ClaimEventUncheckedCreateInput["type"];
  actorUserId?: string;
  actorMembershipId?: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const sourceDigest = digest({ ...input, metadata: input.metadata ?? null });
  return transaction.claimEvent.create({
    data: {
      businessId: input.businessId,
      claimId: input.claimId,
      claimRevision: input.claimRevision,
      type: input.type,
      actorUserId: input.actorUserId ?? null,
      actorMembershipId: input.actorMembershipId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata,
      sourceDigest,
    },
  });
}

function digest(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
