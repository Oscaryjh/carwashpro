import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import type { AuditRequestContext } from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import { deriveAndPersistEntryAggregates } from "@/lib/payroll/component-service";
import { prisma } from "@/lib/prisma";
import {
  markOutsidePayrollPaidInputSchema,
  selectReimbursementChannelInputSchema,
} from "./policy";
import { appendClaimEvent } from "./service";

export const CLAIM_STATUTORY_TREATMENT_NOT_READY = "CLAIM_STATUTORY_TREATMENT_NOT_READY";

type Actor = Pick<AppSession, "userId" | "name" | "email">;
type ReimbursementContext = {
  businessId: string;
  actor: Actor;
  request?: AuditRequestContext;
  rawInput: unknown;
};

export async function selectClaimReimbursementChannel(
  context: ReimbursementContext,
  database: PrismaClient = prisma,
) {
  const input = selectReimbursementChannelInputSchema.parse(context.rawInput);
  return database.$transaction(async (transaction) => {
    const replay = await transaction.claimReimbursement.findFirst({
      where: { businessId: context.businessId, operationKey: input.operationKey },
      include: { payrollSnapshots: true },
    });
    if (replay) return replay;

    const reimbursement = await transaction.claimReimbursement.findFirst({
      where: { id: input.reimbursementId, businessId: context.businessId },
      include: { claim: { include: { lines: true } } },
    });
    if (!reimbursement || reimbursement.status !== "AWAITING_CHANNEL") {
      throw new Error("Claim reimbursement is no longer awaiting a channel.");
    }
    if (reimbursement.revision !== input.expectedRevision) {
      throw new Error("Claim reimbursement changed after this page was loaded. Reload and try again.");
    }

    if (input.channel === "OUTSIDE_PAYROLL") {
      const changed = await transaction.claimReimbursement.updateMany({
        where: {
          id: reimbursement.id,
          businessId: context.businessId,
          status: "AWAITING_CHANNEL",
          revision: input.expectedRevision,
        },
        data: {
          channel: "OUTSIDE_PAYROLL",
          status: "OUTSIDE_PAYROLL_PENDING",
          revision: { increment: 1 },
          operationKey: input.operationKey,
          selectedById: context.actor.userId,
          selectedAt: new Date(),
          note: input.note || null,
        },
      });
      if (changed.count !== 1) throw new Error("Another reimbursement channel won the concurrent update.");
      await appendClaimEvent(transaction, {
        businessId: context.businessId,
        claimId: reimbursement.claimId,
        claimRevision: reimbursement.claim.revision,
        type: "REIMBURSEMENT_CHANNEL_SELECTED",
        actorUserId: context.actor.userId,
        metadata: { channel: "OUTSIDE_PAYROLL" },
      });
      await auditChannel(context, reimbursement.claim.claimNumber, reimbursement.id, "OUTSIDE_PAYROLL", transaction);
      return transaction.claimReimbursement.findUniqueOrThrow({ where: { id: reimbursement.id } });
    }

    if (!input.payrollRunId) throw new Error("Select a Draft Payroll Run.");
    const now = new Date();
    const [claimsModule, payrollModule, run] = await Promise.all([
      transaction.businessModuleEntitlement.findUnique({ where: { businessId_moduleKey: { businessId: context.businessId, moduleKey: "CLAIMS" } } }),
      transaction.businessModuleEntitlement.findUnique({ where: { businessId_moduleKey: { businessId: context.businessId, moduleKey: "PAYROLL" } } }),
      transaction.payrollRun.findFirst({
        where: { id: input.payrollRunId, businessId: context.businessId, status: "DRAFT" },
        include: { entries: { where: { membershipId: reimbursement.membershipId }, take: 1 } },
      }),
    ]);
    if (!isEntitlementActive(claimsModule, now) || !isEntitlementActive(payrollModule, now)) {
      throw new Error("Claims and Payroll modules must both be enabled for the Payroll bridge.");
    }
    const entry = run?.entries[0];
    if (!run || !entry) throw new Error("The selected Draft Payroll Run has no eligible employee entry.");
    const treatmentReady = reimbursement.claim.lines.every((line) => line.statutoryTreatmentStatus === "VERIFIED_NON_WAGE");
    const snapshotStatus = treatmentReady ? "READY" as const : "BLOCKED_STATUTORY" as const;
    const sourceDigest = digest({
      reimbursementId: reimbursement.id,
      claimId: reimbursement.claimId,
      claimRevision: reimbursement.claim.revision,
      amount: reimbursement.amount.toString(),
      payrollRunId: run.id,
      payrollEntryId: entry.id,
      statutoryTreatmentStatus: treatmentReady ? "VERIFIED_NON_WAGE" : "REVIEW_REQUIRED",
    });
    const snapshot = await transaction.payrollClaimReimbursementSnapshot.create({
      data: {
        businessId: context.businessId,
        reimbursementId: reimbursement.id,
        claimId: reimbursement.claimId,
        membershipId: reimbursement.membershipId,
        payrollRunId: run.id,
        payrollEntryId: entry.id,
        claimNumberSnapshot: reimbursement.claim.claimNumber,
        approvedClaimRevision: reimbursement.claim.revision,
        amount: reimbursement.amount,
        currency: "MYR",
        statutoryTreatmentStatus: treatmentReady ? "VERIFIED_NON_WAGE" : "REVIEW_REQUIRED",
        blockerCode: treatmentReady ? null : CLAIM_STATUTORY_TREATMENT_NOT_READY,
        status: snapshotStatus,
        sourceDigest,
        createdById: context.actor.userId,
      },
    });
    const changed = await transaction.claimReimbursement.updateMany({
      where: {
        id: reimbursement.id,
        businessId: context.businessId,
        status: "AWAITING_CHANNEL",
        revision: input.expectedRevision,
      },
      data: {
        channel: "PAYROLL",
        status: "PAYROLL_LINKED",
        revision: { increment: 1 },
        operationKey: input.operationKey,
        selectedById: context.actor.userId,
        selectedAt: now,
        note: input.note || null,
      },
    });
    if (changed.count !== 1) throw new Error("Another reimbursement channel won the concurrent update.");
    if (snapshot.status === "READY") {
      await deriveAndPersistEntryAggregates(transaction, entry, entry.calculationRevision);
    }
    await appendClaimEvent(transaction, {
      businessId: context.businessId,
      claimId: reimbursement.claimId,
      claimRevision: reimbursement.claim.revision,
      type: "PAYROLL_LINKED",
      actorUserId: context.actor.userId,
      metadata: {
        payrollRunId: run.id,
        snapshotId: snapshot.id,
        status: snapshot.status,
        blockerCode: snapshot.blockerCode,
        grossWageChanged: false,
      },
    });
    await auditChannel(context, reimbursement.claim.claimNumber, reimbursement.id, "PAYROLL", transaction, {
      snapshotStatus: snapshot.status,
      blockerCode: snapshot.blockerCode,
    });
    return transaction.claimReimbursement.findUniqueOrThrow({
      where: { id: reimbursement.id },
      include: { payrollSnapshots: true },
    });
  }, { isolationLevel: "Serializable" });
}

export async function markClaimReimbursementPaidOutsidePayroll(
  context: ReimbursementContext,
  database: PrismaClient = prisma,
) {
  const input = markOutsidePayrollPaidInputSchema.parse(context.rawInput);
  return database.$transaction(async (transaction) => {
    const replay = await transaction.claimReimbursement.findFirst({
      where: { businessId: context.businessId, paymentOperationKey: input.operationKey },
    });
    if (replay) return replay;
    const reimbursement = await transaction.claimReimbursement.findFirst({
      where: { id: input.reimbursementId, businessId: context.businessId },
      include: { claim: true },
    });
    if (!reimbursement || reimbursement.status !== "OUTSIDE_PAYROLL_PENDING" || reimbursement.channel !== "OUTSIDE_PAYROLL") {
      throw new Error("Only a pending outside-Payroll reimbursement can be marked paid.");
    }
    if (reimbursement.revision !== input.expectedRevision) {
      throw new Error("Claim reimbursement changed after this page was loaded. Reload and try again.");
    }
    const changed = await transaction.claimReimbursement.updateMany({
      where: {
        id: reimbursement.id,
        businessId: context.businessId,
        status: "OUTSIDE_PAYROLL_PENDING",
        revision: input.expectedRevision,
      },
      data: {
        status: "OUTSIDE_PAYROLL_PAID",
        revision: { increment: 1 },
        paymentOperationKey: input.operationKey,
        paidById: context.actor.userId,
        paidAt: new Date(),
        paymentReference: input.paymentReference,
        note: input.note || reimbursement.note,
      },
    });
    if (changed.count !== 1) throw new Error("Reimbursement changed concurrently and was not paid twice.");
    await appendClaimEvent(transaction, {
      businessId: context.businessId,
      claimId: reimbursement.claimId,
      claimRevision: reimbursement.claim.revision,
      type: "OUTSIDE_PAYROLL_PAID",
      actorUserId: context.actor.userId,
      metadata: { paymentReferenceRecorded: true },
    });
    await writeAuditLog({
      businessId: context.businessId,
      actor: context.actor,
      request: context.request,
      action: "CLAIM_REIMBURSEMENT_PAID_OUTSIDE_PAYROLL",
      entityType: "ClaimReimbursement",
      entityId: reimbursement.id,
      summary: `Claim ${reimbursement.claim.claimNumber} reimbursement marked paid outside Payroll.`,
      metadata: { paymentReferenceRecorded: true, amount: "[REDACTED]" },
    }, transaction);
    return transaction.claimReimbursement.findUniqueOrThrow({ where: { id: reimbursement.id } });
  }, { isolationLevel: "Serializable" });
}

function isEntitlementActive(entitlement: {
  status: string;
  enabledFrom: Date;
  enabledUntil: Date | null;
} | null, now: Date) {
  return Boolean(entitlement && entitlement.status === "ENABLED" && entitlement.enabledFrom <= now && (!entitlement.enabledUntil || entitlement.enabledUntil > now));
}

async function auditChannel(
  context: ReimbursementContext,
  claimNumber: string,
  reimbursementId: string,
  channel: "OUTSIDE_PAYROLL" | "PAYROLL",
  transaction: Parameters<typeof writeAuditLog>[1],
  metadata: Record<string, unknown> = {},
) {
  await writeAuditLog({
    businessId: context.businessId,
    actor: context.actor,
    request: context.request,
    action: "CLAIM_REIMBURSEMENT_CHANNEL_SELECTED",
    entityType: "ClaimReimbursement",
    entityId: reimbursementId,
    summary: `Claim ${claimNumber} reimbursement channel selected: ${channel}.`,
    metadata: { channel, amount: "[REDACTED]", ...metadata },
  }, transaction);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
