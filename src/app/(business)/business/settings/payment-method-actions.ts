"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import {
  configurablePaymentMethods,
  defaultBusinessPaymentMethods,
  getEffectiveBusinessPaymentMethods,
} from "@/lib/payments/business-methods";
import { prisma } from "@/lib/prisma";

const paymentMethodSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  code: z.string().trim().max(80).optional().or(z.literal("")),
  label: z.string().trim().min(2, "Enter a payment method name.").max(40),
  canonicalMethod: z.enum(configurablePaymentMethods),
  active: z.enum(["true", "false"]).default("true"),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(100),
});

const newPaymentMethodSchema = z.object({
  label: z.string().trim().min(2, "Enter a payment method name.").max(40),
  paymentKind: z.enum(["LOCAL_TENDER", "FOREIGN_CURRENCY", "CRYPTO_ASSET"]),
  canonicalMethod: z.enum(configurablePaymentMethods).optional(),
  settlementCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Enter a 3-letter currency code, such as USD."),
  assetSymbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, "Enter an asset symbol, such as BTC.").optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(100),
}).superRefine((input, context) => {
  if (input.paymentKind === "LOCAL_TENDER" && (!input.canonicalMethod || ["FOREIGN_CURRENCY", "CRYPTO"].includes(input.canonicalMethod))) {
    context.addIssue({ code: "custom", path: ["canonicalMethod"], message: "Choose a local reporting category." });
  }
  if (input.paymentKind === "FOREIGN_CURRENCY" && input.settlementCurrency === "MYR") {
    context.addIssue({ code: "custom", path: ["settlementCurrency"], message: "Use a foreign currency code, such as USD." });
  }
  if (input.paymentKind === "CRYPTO_ASSET" && !input.assetSymbol) {
    context.addIssue({ code: "custom", path: ["assetSymbol"], message: "Enter an asset symbol, such as BTC." });
  }
});

const paymentMethodDeleteSchema = z.object({
  id: z.string().uuid(),
});

class PaymentMethodRemovalError extends Error {}

function normalizeLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-MY");
}

function paymentMethodsUrl(
  type: "success" | "error",
  message: string,
  returnToBusinessSettings = false,
) {
  const base = returnToBusinessSettings
    ? "/business/settings?panel=payment-methods"
    : "/business/settings/payment-methods?panel=payment-methods";
  return `${base}&type=${type}&message=${encodeURIComponent(message)}`;
}

async function requireOwner() {
  const context = await requireBusinessUser("MODIFY_BUSINESS_SETTINGS");
  assertRole(context.user, ["BUSINESS_OWNER"]);
  return context;
}

export async function createBusinessPaymentMethodAction(formData: FormData) {
  const { businessId, user } = await requireOwner();
  const returnToBusinessSettings = formData.get("returnTo") === "business-settings";
  const parsed = newPaymentMethodSchema.safeParse({
    label: formData.get("label"),
    paymentKind: formData.get("paymentKind"),
    canonicalMethod: formData.get("canonicalMethod"),
    settlementCurrency: formData.get("settlementCurrency") || "MYR",
    assetSymbol: formData.get("assetSymbol") || "",
    sortOrder: formData.get("sortOrder") || 100,
  });
  if (!parsed.success) {
    redirect(paymentMethodsUrl("error", parsed.error.issues[0]?.message ?? "Payment method is invalid.", returnToBusinessSettings));
  }

  const input = parsed.data;
  const canonicalMethod = input.paymentKind === "FOREIGN_CURRENCY"
    ? "FOREIGN_CURRENCY"
    : input.paymentKind === "CRYPTO_ASSET"
      ? "CRYPTO"
      : input.canonicalMethod!;
  const settlementCurrency = input.paymentKind === "FOREIGN_CURRENCY"
    ? input.settlementCurrency
    : "MYR";
  const assetSymbol = input.paymentKind === "CRYPTO_ASSET" ? input.assetSymbol || null : null;
  const normalizedLabel = normalizeLabel(input.label);
  const effective = await getEffectiveBusinessPaymentMethods(businessId);
  if (effective.some((method) => normalizeLabel(method.label) === normalizedLabel)) {
    redirect(paymentMethodsUrl("error", "A payment method with this name already exists.", returnToBusinessSettings));
  }

  const auditRequest = await getAuditRequestContext();
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.businessPaymentMethod.create({
        data: {
          businessId,
          code: `CUSTOM_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
          label: input.label,
          normalizedLabel,
          canonicalMethod,
          paymentKind: input.paymentKind,
          settlementCurrency,
          assetSymbol,
          behavior: "STANDARD_TENDER",
          builtIn: false,
          active: true,
          sortOrder: input.sortOrder,
        },
      });
      await writeAuditLog({
        businessId,
        actor: user,
        action: "BUSINESS_PAYMENT_METHOD_CREATED",
        entityType: "BusinessPaymentMethod",
        entityId: created.id,
        summary: `Created payment method ${created.label}`,
        after: {
          label: created.label,
          canonicalMethod: created.canonicalMethod,
          paymentKind: created.paymentKind,
          settlementCurrency: created.settlementCurrency,
          assetSymbol: created.assetSymbol,
          active: created.active,
        },
        request: auditRequest,
      }, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(paymentMethodsUrl("error", "A payment method with this name already exists.", returnToBusinessSettings));
    }
    throw error;
  }

  revalidatePath("/business/settings/payment-methods");
  revalidatePath("/business/settings");
  revalidatePath("/cashier");
  redirect(paymentMethodsUrl("success", "Payment method added.", returnToBusinessSettings));
}

export async function updateBusinessPaymentMethodAction(formData: FormData) {
  const { businessId, user } = await requireOwner();
  const returnToBusinessSettings = formData.get("returnTo") === "business-settings";
  const parsed = paymentMethodSchema.safeParse({
    id: formData.get("id")?.toString() || "",
    code: formData.get("code")?.toString() || "",
    label: formData.get("label"),
    canonicalMethod: formData.get("canonicalMethod"),
    active: formData.get("active") === "true" ? "true" : "false",
    sortOrder: formData.get("sortOrder") || 100,
  });
  if (!parsed.success) {
    redirect(paymentMethodsUrl("error", parsed.error.issues[0]?.message ?? "Payment method is invalid.", returnToBusinessSettings));
  }

  const input = parsed.data;
  const normalizedLabel = normalizeLabel(input.label);
  const existing = input.id
    ? await prisma.businessPaymentMethod.findFirst({ where: { id: input.id, businessId } })
    : null;
  const builtInDefault = !input.id
    ? defaultBusinessPaymentMethods.find((method) => method.code === input.code)
    : null;
  if (!existing && !builtInDefault) {
    redirect(paymentMethodsUrl("error", "Payment method was not found.", returnToBusinessSettings));
  }

  if (input.active === "false") {
    const effective = await getEffectiveBusinessPaymentMethods(businessId);
    const currentCode = existing?.code ?? builtInDefault?.code;
    const current = effective.find((method) => method.code === currentCode);
    if (
      current?.active &&
      current.behavior === "STANDARD_TENDER" &&
      effective.filter((method) => method.active && method.behavior === "STANDARD_TENDER").length <= 1
    ) {
      redirect(paymentMethodsUrl("error", "Keep at least one payment method enabled for customer payments.", returnToBusinessSettings));
    }
  }

  const duplicate = await prisma.businessPaymentMethod.findFirst({
    where: {
      businessId,
      normalizedLabel,
      ...(existing ? { id: { not: existing.id } } : {}),
    },
    select: { id: true },
  });
  const duplicateVirtualDefault = defaultBusinessPaymentMethods.some(
    (method) => method.code !== input.code && normalizeLabel(method.label) === normalizedLabel,
  );
  if (duplicate || duplicateVirtualDefault) {
    redirect(paymentMethodsUrl("error", "A payment method with this name already exists.", returnToBusinessSettings));
  }

  const auditRequest = await getAuditRequestContext();
  try {
    await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.businessPaymentMethod.update({
          where: { id: existing.id },
          data: {
            label: input.label,
            normalizedLabel,
            canonicalMethod: existing.builtIn ? existing.canonicalMethod : input.canonicalMethod,
            active: input.active === "true",
            sortOrder: input.sortOrder,
          },
        })
      : await tx.businessPaymentMethod.create({
          data: {
            businessId,
            code: builtInDefault!.code,
            label: input.label,
            normalizedLabel,
            canonicalMethod: builtInDefault!.canonicalMethod,
            behavior: builtInDefault!.behavior,
            paymentKind: builtInDefault!.paymentKind,
            settlementCurrency: builtInDefault!.settlementCurrency,
            assetSymbol: builtInDefault!.assetSymbol,
            builtIn: true,
            active: input.active === "true",
            sortOrder: input.sortOrder,
          },
        });
      await writeAuditLog({
      businessId,
      actor: user,
      action: "BUSINESS_PAYMENT_METHOD_UPDATED",
      entityType: "BusinessPaymentMethod",
      entityId: saved.id,
      summary: `Updated payment method ${saved.label}`,
      before: existing ? {
        label: existing.label,
        canonicalMethod: existing.canonicalMethod,
        active: existing.active,
        sortOrder: existing.sortOrder,
      } : null,
      after: {
        label: saved.label,
        canonicalMethod: saved.canonicalMethod,
        active: saved.active,
        sortOrder: saved.sortOrder,
      },
      request: auditRequest,
      }, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(paymentMethodsUrl("error", "A payment method with this name already exists.", returnToBusinessSettings));
    }
    throw error;
  }

  revalidatePath("/business/settings/payment-methods");
  revalidatePath("/business/settings");
  revalidatePath("/cashier");
  redirect(paymentMethodsUrl("success", "Payment method updated.", returnToBusinessSettings));
}

export async function deleteBusinessPaymentMethodAction(formData: FormData) {
  const { businessId, user } = await requireOwner();
  const returnToBusinessSettings = formData.get("returnTo") === "business-settings";
  const parsed = paymentMethodDeleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    redirect(paymentMethodsUrl("error", "Payment method was not found.", returnToBusinessSettings));
  }

  const effective = await getEffectiveBusinessPaymentMethods(businessId);
  const current = effective.find((method) => method.id === parsed.data.id);
  if (!current || current.builtIn) {
    redirect(paymentMethodsUrl("error", "Standard payment methods cannot be deleted. Hide them from checkout instead.", returnToBusinessSettings));
  }
  if (
    current.active &&
    current.behavior === "STANDARD_TENDER" &&
    effective.filter((method) => method.active && method.behavior === "STANDARD_TENDER").length <= 1
  ) {
    redirect(paymentMethodsUrl("error", "Keep at least one payment method enabled for customer payments.", returnToBusinessSettings));
  }

  const auditRequest = await getAuditRequestContext();
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.businessPaymentMethod.findFirst({
        where: { id: parsed.data.id, businessId, builtIn: false },
      });
      if (!existing) {
        throw new PaymentMethodRemovalError("Only custom payment methods can be removed.");
      }

      const paymentCount = await tx.payment.count({
        where: { businessId, businessPaymentMethodId: existing.id },
      });
      if (paymentCount > 0) {
        throw new PaymentMethodRemovalError(
          "This payment method has payment history. Hide it from checkout instead.",
        );
      }

      await tx.businessPaymentMethod.delete({ where: { id: existing.id } });
      await writeAuditLog({
        businessId,
        actor: user,
        action: "BUSINESS_PAYMENT_METHOD_DELETED",
        entityType: "BusinessPaymentMethod",
        entityId: existing.id,
        summary: `Removed custom payment method ${existing.label}`,
        before: {
          label: existing.label,
          canonicalMethod: existing.canonicalMethod,
          active: existing.active,
        },
        request: auditRequest,
      }, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PaymentMethodRemovalError) {
      redirect(paymentMethodsUrl("error", error.message, returnToBusinessSettings));
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      redirect(paymentMethodsUrl("error", "This payment method has payment history. Hide it from checkout instead.", returnToBusinessSettings));
    }
    throw error;
  }

  revalidatePath("/business/settings/payment-methods");
  revalidatePath("/business/settings");
  revalidatePath("/cashier");
  redirect(paymentMethodsUrl("success", "Custom payment method removed.", returnToBusinessSettings));
}
