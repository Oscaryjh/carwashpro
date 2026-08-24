"use server";

import type { Prisma, SubscriptionPaymentMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext } from "@/lib/audit";
import {
  consumeSensitiveActionAuthorizationInTransaction,
  verifySensitiveActionMfa,
} from "@/lib/auth/sensitive-action-service";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { getSensitiveActionPolicy, type SensitiveActionKey } from "@/lib/auth/sensitive-actions";
import { requireUser, type AppSession } from "@/lib/auth/session";
import {
  createSubscriptionInvoiceDraft,
  issueSubscriptionInvoice,
  recordSubscriptionPayment,
  renewSubscriptionWithInvoice,
  reverseSubscriptionPayment,
  voidSubscriptionInvoice,
} from "@/lib/commercial/billing-service";
import { parseMoneyToCents } from "@/lib/commercial/money";

export async function createInvoiceDraftAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    await createSubscriptionInvoiceDraft(actor, {
      subscriptionId: required(formData, "subscriptionId"),
      billingPeriodStart: date(formData, "billingPeriodStart"),
      billingPeriodEnd: date(formData, "billingPeriodEnd"),
      invoiceDate: date(formData, "invoiceDate"),
      dueDate: date(formData, "dueDate"),
      operationKey: required(formData, "operationKey"),
    });
  }, "Invoice draft created. Draft invoices are not receivables.");
}

export async function issueInvoiceAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    await issueSubscriptionInvoice(actor, {
      invoiceId: required(formData, "invoiceId"),
      expectedRevision: integer(formData, "expectedRevision"),
      operationKey: required(formData, "operationKey"),
    });
  }, "Subscription invoice issued.");
}

export async function recordPaymentAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    const invoiceId = required(formData, "invoiceId");
    const authorize = await verifiedAuthorization(actor, "SUBSCRIPTION_PAYMENT_RECORD", invoiceId, formData);
    const amountCents = parseMoneyToCents(required(formData, "amount"));
    if (amountCents === null) throw new Error("SUBSCRIPTION_PAYMENT_AMOUNT_INVALID");
    await recordSubscriptionPayment(actor, {
      invoiceId,
      amountCents,
      paymentDate: date(formData, "paymentDate"),
      paymentMethod: paymentMethod(formData),
      paymentReference: optional(formData, "paymentReference"),
      notes: optional(formData, "notes"),
      operationKey: required(formData, "operationKey"),
      authorize,
    });
  }, "Subscription payment recorded; receivable reduced.");
}

export async function reversePaymentAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    const paymentId = required(formData, "paymentId");
    const authorize = await verifiedAuthorization(actor, "SUBSCRIPTION_PAYMENT_REVERSE", paymentId, formData);
    await reverseSubscriptionPayment(actor, {
      paymentId,
      reason: required(formData, "reason"),
      operationKey: required(formData, "operationKey"),
      authorize,
    });
  }, "Subscription payment reversed; receivable restored.");
}

export async function voidInvoiceAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    const invoiceId = required(formData, "invoiceId");
    const authorize = await verifiedAuthorization(actor, "SUBSCRIPTION_INVOICE_VOID", invoiceId, formData);
    await voidSubscriptionInvoice(actor, {
      invoiceId,
      expectedRevision: integer(formData, "expectedRevision"),
      reason: required(formData, "reason"),
      operationKey: required(formData, "operationKey"),
      authorize,
    });
  }, "Issued subscription invoice voided.");
}

export async function renewWithInvoiceAction(formData: FormData) {
  const actor = await requirePlatformActor();
  return handled(async () => {
    await renewSubscriptionWithInvoice(actor, {
      subscriptionId: required(formData, "subscriptionId"),
      invoiceDate: date(formData, "invoiceDate"),
      dueDate: date(formData, "dueDate"),
      operationKey: required(formData, "operationKey"),
    });
  }, "Renewal invoice issued and next renewal advanced exactly once.");
}

async function requirePlatformActor() {
  const actor = await requireUser();
  if (actor.role !== "PLATFORM_ADMIN" || actor.status !== "active") throw new Error("COMMERCIAL_PLATFORM_AUTHORITY_REQUIRED");
  return actor;
}

async function verifiedAuthorization(actor: AppSession, actionKey: SensitiveActionKey, resourceId: string, formData: FormData) {
  if (!actor.sessionId) throw new Error("STEP_UP_SESSION_MISMATCH");
  const policy = getSensitiveActionPolicy(actionKey);
  if (!isMfaFeatureEnabled()) {
    return async (transaction: Prisma.TransactionClient): Promise<Prisma.InputJsonObject> => {
      const authorization = await consumeSensitiveActionAuthorizationInTransaction({
        actionKey,
        businessId: null,
        rawToken: null,
        resourceId,
        resourceType: policy.resourceType,
        sessionId: actor.sessionId!,
        userId: actor.userId,
      }, transaction);
      return {
        sensitiveActionAuthorizationId: authorization.id,
        assurance: authorization.assuranceLevel,
        method: authorization.verificationMethod,
      };
    };
  }
  const request = await getAuditRequestContext();
  const factorType = required(formData, "stepUpFactorType");
  if (factorType !== "TOTP" && factorType !== "RECOVERY_CODE") throw new Error("MFA_VERIFICATION_FAILED");
  const verified = await verifySensitiveActionMfa({
    actionKey,
    businessId: null,
    factor: { factorType, code: required(formData, "stepUpCode") },
    password: required(formData, "stepUpPassword"),
    request: { ipAddress: request.ipAddress ?? null, userAgent: request.userAgent ?? null },
    resourceId,
    resourceType: policy.resourceType,
    sessionId: actor.sessionId,
    userId: actor.userId,
  });
  return async (transaction: Prisma.TransactionClient): Promise<Prisma.InputJsonObject> => {
    const authorization = await consumeSensitiveActionAuthorizationInTransaction({
      actionKey,
      businessId: null,
      rawToken: verified.rawToken,
      resourceId,
      resourceType: policy.resourceType,
      sessionId: actor.sessionId!,
      userId: actor.userId,
    }, transaction);
    return {
      sensitiveActionAuthorizationId: authorization.id,
      assurance: authorization.assuranceLevel,
      method: authorization.verificationMethod,
    };
  };
}

function paymentMethod(formData: FormData): SubscriptionPaymentMethod {
  const raw = required(formData, "paymentMethod");
  return (["BANK_TRANSFER", "DUITNOW_QR", "CASH", "CHEQUE", "CARD_MANUAL", "OTHER"] as const).find(value => value === raw) ?? "OTHER";
}

function required(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`SUBSCRIPTION_BILLING_FIELD_REQUIRED:${key}`);
  return value.trim();
}
function optional(formData: FormData, key: string) { const value = formData.get(key); return typeof value === "string" && value.trim() ? value.trim() : null; }
function date(formData: FormData, key: string) { const parsed = new Date(required(formData, key)); if (!Number.isFinite(parsed.getTime())) throw new Error(`SUBSCRIPTION_BILLING_DATE_INVALID:${key}`); return parsed; }
function integer(formData: FormData, key: string) { const parsed = Number(required(formData, key)); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`SUBSCRIPTION_BILLING_INTEGER_INVALID:${key}`); return parsed; }

async function handled(work: () => Promise<void>, success: string) {
  let type = "success";
  let message = success;
  try { await work(); } catch (error) { type = "error"; message = error instanceof Error ? error.message : "Subscription billing operation failed."; }
  revalidatePath("/admin/commercial/billing");
  redirect(`/admin/commercial/billing?type=${type}&message=${encodeURIComponent(message)}`);
}
