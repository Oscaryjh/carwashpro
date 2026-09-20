import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { resolveBusinessAccess, hasBusinessCapability } from "@/lib/business-groups/business-access";
import { loadBusinessModuleContext } from "@/lib/modules/entitlements";
import { isProductionRuntime } from "@/lib/release/environment";
import { consumePayrollHighRiskAuthorization, type PayrollHighRiskStepUp } from "./high-risk-mfa";
import { deriveAndPersistEntryAggregates } from "./component-service";
import { isManualPcbCurrent, MANUAL_PCB_INPUT_VERSION, manualPcbDigest, parseManualPcbConfirmation } from "./manual-pcb-contract";
import { authoritativePcbHistory } from "./pcb-history";

type Database = Pick<Prisma.TransactionClient, "payrollEntry" | "payrollManualPcbConfirmation" | "payrollPcbPublicationVersion">;

export function requiresManualPcb(snapshots: ReadonlyArray<{ scheme: string; evidenceNature: string; evidenceEnvironment?: string | null; officialExportEligible: boolean }>) {
  // Only explicitly labelled synthetic, nonofficial test calculations are exempt.
  const pcb = snapshots.filter((snapshot) => snapshot.scheme === "PCB");
  return isProductionRuntime() || pcb.length !== 1 || pcb.some((s) => s.evidenceNature !== "SYNTHETIC_TESTING" || s.officialExportEligible || !["LOCAL", "TESTING"].includes(s.evidenceEnvironment ?? ""));
}

export async function assertManualPcbForEntry(database: Database, businessId: string, entryId: string) {
  const { entry } = await loadInputs(database, businessId, entryId);
  const source = await resolveManualPcb(database, businessId, entryId);
  const existing = await database.payrollManualPcbConfirmation.count({ where: { businessId, payrollEntryId: entryId } });
  if ((requiresManualPcb(entry.statutorySnapshots) || existing > 0) && !source) throw new Error("PCB_MANUAL_CONFIRMATION_REQUIRED");
  return source;
}

export async function loadManualPcbInputs(database: Database, businessId: string, entryId: string) {
  const entry = await database.payrollEntry.findFirst({ where: { id: entryId, businessId }, include: {
    payrollRun: true,
    payslipPublication: { select: { id: true } },
    membership: { select: { id: true, businessId: true, pcbProfile: true, taxProfileRevision: true, statutoryProfileRevision: true, statutoryNationality: true, dateOfBirth: true, taxIdentificationNumber: true, compensationRevision: true, recurringPayRevision: true } },
    components: { orderBy: { lineKey: "asc" } },
    statutorySnapshots: { orderBy: { scheme: "asc" } },
  } });
  if (!entry || entry.membership.businessId !== businessId || entry.payrollRun.businessId !== businessId) throw new Error("PCB_ENTRY_NOT_FOUND");
  const { payrollRun, payslipPublication: _publication, components, membership, statutorySnapshots, updatedAt: _updatedAt, createdAt: _createdAt, ...amounts } = entry;
  const priorPcbHistory = await authoritativePcbHistory(database, businessId, entry.membershipId, payrollRun.periodStart);
  // Plain immutable evidence: no session/token or current user's authentication data.
  const inputEvidence = JSON.parse(JSON.stringify({
    entry: amounts,
    membership,
    periodStart: payrollRun.periodStart,
    periodEnd: payrollRun.periodEnd,
    components: components.map(({ updatedAt: _updated, createdAt: _created, ...line }) => line),
    statutorySnapshots,
    priorPcbHistory: priorPcbHistory.map(({ calculationMetadata: _metadata, ...source }) => source),
  })) as Prisma.InputJsonObject;
  const binding = { businessId, membershipId: entry.membershipId, payrollEntryId: entry.id,
    payrollMonth: payrollRun.periodStart.toISOString().slice(0, 7), inputRevision: entry.calculationRevision, inputDigest: manualPcbDigest(inputEvidence) };
  return { entry, inputEvidence, binding };
}

const loadInputs = loadManualPcbInputs;

export async function assertWholeBusinessPcbAuthority(transaction: Prisma.TransactionClient, businessId: string, actorId: string) {
  const access = await resolveBusinessAccess({ userId: actorId, requestedBusinessId: businessId, capability: "EDIT_PAYROLL_ENTRY" }, transaction);
  if (!access.granted || access.businessId !== businessId || !hasBusinessCapability(access, "EDIT_PAYROLL_ENTRY") || access.actorRole === "GROUP_MANAGER" ||
    !(access.actorRole === "BUSINESS_OWNER" || access.actorRole === "GROUP_OWNER" || (access.source === "DIRECT_BUSINESS" && access.permissions.includes("ALL_BRANCHES") && access.permissions.includes("EDIT_PAYROLL_ENTRY")))) throw new Error("PCB_MANUAL_PERMISSION_DENIED");
  const modules = await loadBusinessModuleContext(businessId, { database: transaction });
  if (!modules.enabledModules.has("PAYROLL")) throw new Error("MODULE_NOT_ENABLED");
}

export async function resolveManualPcb(database: Database, businessId: string, entryId: string) {
  const { entry, binding } = await loadInputs(database, businessId, entryId);
  const source = await database.payrollManualPcbConfirmation.findFirst({ where: { businessId, payrollEntryId: entryId }, orderBy: { sourceVersion: "desc" }, include: { invalidations: true } });
  const frozen = entry.payrollRun.status === "FINALIZED" && !!entry.payslipPublication && source &&
    source.invalidations.length === 0 && source.inputRevision === entry.calculationRevision && source.membershipId === entry.membershipId;
  if ((!frozen && !isManualPcbCurrent(source, binding)) || !source || !entry.pcb.equals(source.amount)) return null;
  const lines = entry.components.filter((line) => line.code === "PCB");
  if (source.amount.isZero()) { if (lines.length !== 0) return null; }
  else if (lines.length !== 1 || lines[0].sourceType !== "STATUTORY" || !lines[0].amount.equals(source.amount)) return null;
  return source;
}

// Bind the browser's reviewed inputs, not merely the payroll calculation counter.
export async function manualPcbInputDigest(database: Database, businessId: string, entryId: string) {
  return (await loadInputs(database, businessId, entryId)).binding.inputDigest;
}

export async function confirmManualPcb(input: {
  businessId: string; entryId: string; actorId: string; expectedRevision: number; expectedInputDigest: string;
  amount: unknown; externalReference: unknown; confirmed: unknown; stepUp?: PayrollHighRiskStepUp;
}, database: PrismaClient = prisma) {
  if (!isMfaFeatureEnabled()) throw new Error("PCB_MANUAL_MFA_REQUIRED");
  if (!input.stepUp) throw new Error("STEP_UP_REQUIRED");
  const parsed = parseManualPcbConfirmation(input);
  return database.$transaction(async (transaction) => {
    await assertWholeBusinessPcbAuthority(transaction, input.businessId, input.actorId);
    const { entry, binding } = await loadInputs(transaction, input.businessId, input.entryId);
    if (entry.payrollRun.status !== "DRAFT" || entry.calculationRevision !== input.expectedRevision) throw new Error("PCB_INPUT_REVISION_CHANGED");
    if (input.expectedInputDigest !== binding.inputDigest) throw new Error("PCB_INPUT_DIGEST_CHANGED");
    const mfa = await consumePayrollHighRiskAuthorization({ actionKey: "PCB_MANUAL_CONFIRM", businessId: input.businessId, resourceId: input.entryId, userId: input.actorId, stepUp: input.stepUp }, transaction);
    if (mfa.stepUpAssurance !== "MFA" || !["TOTP", "RECOVERY_CODE"].includes(mfa.stepUpVerificationMethod)) throw new Error("PCB_MANUAL_MFA_REQUIRED");
    const amount = new Prisma.Decimal(parsed.amountCents).div(100);
    await transaction.payrollEntryComponent.deleteMany({ where: { businessId: input.businessId, payrollEntryId: entry.id, code: "PCB" } });
    if (!amount.isZero()) await transaction.payrollEntryComponent.create({ data: {
      businessId: input.businessId, membershipId: entry.membershipId, payrollRunId: entry.payrollRunId, payrollEntryId: entry.id,
      lineKey: "STATUTORY:PCB", type: "DEDUCTION", code: "PCB", name: "PCB — Manually confirmed", amount, sourceType: "STATUTORY", origin: "SYSTEM",
      calculationBasis: "CONTROLLED_MANUAL_CONFIRMATION", sortOrder: 9004, createdById: input.actorId,
    } });
    await transaction.payrollEntry.update({ where: { id: entry.id }, data: { pcb: amount } });
    await deriveAndPersistEntryAggregates(transaction, { ...entry, pcb: amount }, input.expectedRevision);
    const current = await loadInputs(transaction, input.businessId, input.entryId);
    const previous = await transaction.payrollManualPcbConfirmation.findFirst({ where: { payrollEntryId: entry.id }, orderBy: { sourceVersion: "desc" }, select: { sourceVersion: true } });
    return transaction.payrollManualPcbConfirmation.create({ data: {
      ...current.binding, payrollRunId: entry.payrollRunId, amount, externalReference: parsed.externalReference,
      inputVersion: MANUAL_PCB_INPUT_VERSION, sourceVersion: (previous?.sourceVersion ?? 0) + 1,
      confirmedById: input.actorId, authorizationId: mfa.sensitiveActionAuthorizationId, inputEvidence: current.inputEvidence,
    } });
  }, { isolationLevel: "Serializable" });
}
