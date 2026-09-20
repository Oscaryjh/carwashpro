import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { assertWholeBusinessPcbAuthority, loadManualPcbInputs, resolveManualPcb } from "./manual-pcb-service";
import { manualPcbDigest, parseManualPcbConfirmation } from "./manual-pcb-contract";
import { consumePayrollHighRiskAuthorization, type PayrollHighRiskStepUp } from "./high-risk-mfa";
import { buildPayslipPdf, type PayrollDocumentEntry, type PayrollDocumentRun } from "./export";
import { correctionAmounts, correctionSettlementState, correctedFrozenNetPay } from "./pcb-correction-contract";
import { applyPendingPcbCorrections, validPcbSettlementComponents } from "./pcb-correction-settlement";
const moneyToCents = (value: Prisma.Decimal) => value.mul(100).toNumber();

type DocumentRun = Omit<PayrollDocumentRun, "entries">;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

export async function freezePcbPublication(transaction: Prisma.TransactionClient, input: {
  publicationId: string; businessId: string; entryId: string; actorId: string;
  run: DocumentRun; entry: PayrollDocumentEntry; bytes: Uint8Array;
}) {
  const { entry, inputEvidence, binding } = await loadManualPcbInputs(transaction, input.businessId, input.entryId);
  const manual = await resolveManualPcb(transaction, input.businessId, input.entryId);
  return transaction.payrollPcbPublicationVersion.create({ data: {
    businessId: input.businessId, membershipId: entry.membershipId, payrollRunId: entry.payrollRunId, payrollEntryId: entry.id,
    publicationId: input.publicationId, payrollMonth: binding.payrollMonth, version: 1, amount: entry.pcb, delta: 0,
    sourceKind: manual ? "MANUAL" : "CALCULATED", confirmationId: manual?.id,
    originalInputDigest: manual?.inputDigest ?? binding.inputDigest, inputDigest: manual?.inputDigest ?? binding.inputDigest,
    inputVersion: 1, inputEvidence, documentRun: json(input.run), documentEntry: json(input.entry),
    documentBytes: Buffer.from(input.bytes), documentSha256: createHash("sha256").update(input.bytes).digest("hex"),
    reason: "Original published snapshot", externalReference: manual?.externalReference ?? "Frozen calculated snapshot (nonofficial)", actorId: input.actorId,
  } });
}

export async function correctPublishedPcb(input: {
  businessId: string; publicationId: string; actorId: string; expectedVersion: number; expectedInputDigest: string;
  amount: unknown; externalReference: unknown; confirmed: unknown; reason: string; stepUp?: PayrollHighRiskStepUp;
}, database: PrismaClient = prisma) {
  if (!isMfaFeatureEnabled()) throw new Error("PCB_MANUAL_MFA_REQUIRED");
  if (!input.stepUp) throw new Error("STEP_UP_REQUIRED");
  const parsed = parseManualPcbConfirmation(input);
  if (input.reason.trim().length < 5 || input.reason.length > 500) throw new Error("PCB_CORRECTION_REASON_REQUIRED");
  return database.$transaction(async (tx) => {
    await assertWholeBusinessPcbAuthority(tx, input.businessId, input.actorId);
    const original = await tx.payrollPayslipPublication.findFirst({ where: { id: input.publicationId, businessId: input.businessId }, include: { payrollRun: true, membership: true } });
    if (!original || original.payrollRun.status !== "FINALIZED") throw new Error("PCB_PUBLICATION_NOT_FOUND");
    const previous = await tx.payrollPcbPublicationVersion.findFirst({ where: { publicationId: original.id, businessId: input.businessId }, orderBy: { version: "desc" } });
    if (!previous) throw new Error("PCB_FROZEN_SOURCE_REQUIRED");
    if (previous.version !== input.expectedVersion) throw new Error("PCB_VERSION_CONFLICT");
    const current = await loadManualPcbInputs(tx, input.businessId, original.payrollEntryId);
    if (current.binding.inputDigest !== input.expectedInputDigest) throw new Error("PCB_INPUT_DIGEST_CHANGED");
    const authorization = await consumePayrollHighRiskAuthorization({ actionKey: "PCB_HISTORICAL_CORRECT", businessId: input.businessId,
      resourceId: original.id, userId: input.actorId, stepUp: input.stepUp }, tx);
    if (authorization.stepUpAssurance !== "MFA" || !["TOTP", "RECOVERY_CODE"].includes(authorization.stepUpVerificationMethod)) throw new Error("PCB_MANUAL_MFA_REQUIRED");
    const amounts = correctionAmounts(moneyToCents(previous.amount), parsed.amountCents);
    const correctedEvidence = json({ canonicalInputs: current.inputEvidence, correction: { originalPublicationId: original.id,
      supersedesId: previous.id, version: previous.version + 1, amountCents: amounts.amountCents,
      reason: input.reason.trim(), externalReference: parsed.externalReference } });
    const recordedAt = new Date();
    const documentEntry = previous.documentEntry as unknown as PayrollDocumentEntry;
    const documentRun = previous.documentRun as unknown as DocumentRun;
    const restoredRun = { ...documentRun, periodStart: new Date(documentRun.periodStart), periodEnd: new Date(documentRun.periodEnd),
      submittedAt: documentRun.submittedAt ? new Date(documentRun.submittedAt) : null, finalizedAt: documentRun.finalizedAt ? new Date(documentRun.finalizedAt) : null };
    const correctedEntry: PayrollDocumentEntry = { ...documentEntry, pcb: amounts.amountCents / 100,
      netPay: correctedFrozenNetPay(documentEntry, amounts.amountCents / 100),
      pcbCorrection: { version: previous.version + 1, recordedAt: recordedAt.toISOString(), reference: parsed.externalReference },
      statutorySnapshots: documentEntry.statutorySnapshots?.map((s) => s.scheme === "PCB" ? { ...s, status: "MANUAL", employeeContribution: amounts.amountCents / 100, blockerCode: null } : s),
      components: [...(documentEntry.components ?? []).filter((c) => !(c.sourceType === "STATUTORY" && c.name.startsWith("PCB"))),
        ...(amounts.amountCents ? [{ name: "PCB — Manually confirmed", type: "DEDUCTION" as const, amount: amounts.amountCents / 100, sourceType: "STATUTORY" }] : [])],
    };
    const bytes = buildPayslipPdf(restoredRun, correctedEntry);
    const version = await tx.payrollPcbPublicationVersion.create({ data: {
      businessId: input.businessId, membershipId: original.membershipId, payrollRunId: original.payrollRunId, payrollEntryId: original.payrollEntryId,
      publicationId: original.id, payrollMonth: previous.payrollMonth, version: previous.version + 1, supersedesId: previous.id,
      amount: new Prisma.Decimal(amounts.amountCents).div(100), delta: new Prisma.Decimal(amounts.deltaCents).div(100), sourceKind: "MANUAL",
      confirmationId: previous.confirmationId, originalInputDigest: previous.originalInputDigest, inputDigest: manualPcbDigest(correctedEvidence),
      inputVersion: 1, inputEvidence: correctedEvidence, documentRun: previous.documentRun as Prisma.InputJsonObject, documentEntry: json(correctedEntry),
      documentBytes: bytes, documentSha256: createHash("sha256").update(bytes).digest("hex"), reason: input.reason.trim(),
      externalReference: parsed.externalReference, actorId: input.actorId, recordedAt, authorizationId: authorization.sensitiveActionAuthorizationId,
    } });
    const next = await tx.payrollEntry.findFirst({ where: { businessId: input.businessId, membershipId: original.membershipId,
      payrollRun: { status: { in: ["DRAFT", "REVIEW"] }, periodStart: { gt: original.payrollRun.periodStart } } }, orderBy: { payrollRun: { periodStart: "asc" } } });
    if (next) await applyPendingPcbCorrections(tx, input.businessId, next.id, input.actorId);
    const applied = (await validPcbSettlementComponents(tx, input.businessId, [version.id])).length > 0;
    const nextRun = next ? await tx.payrollRun.findUniqueOrThrow({ where: { id: next.payrollRunId }, select: { status: true } }) : null;
    const settlementState = correctionSettlementState({ activeEmployee: original.membership.status === "ACTIVE", hasNextRun: nextRun?.status === "REVIEW", applied });
    await tx.payrollPcbSettlementEvent.create({ data: { businessId: input.businessId, correctionId: version.id, state: settlementState, actorId: input.actorId } });
    return { ...version, settlementState };
  }, { isolationLevel: "Serializable" });
}

export async function loadPcbPublicationHistory(input: { businessId: string; publicationId: string; actorId: string }, database: PrismaClient = prisma) {
  return database.$transaction(async (tx) => {
    await assertWholeBusinessPcbAuthority(tx, input.businessId, input.actorId);
    return tx.payrollPcbPublicationVersion.findMany({ where: { businessId: input.businessId, publicationId: input.publicationId }, orderBy: { version: "asc" } });
  });
}
