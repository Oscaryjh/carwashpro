import type {
  BusinessPaymentMethodBehavior,
  BusinessPaymentMethodKind,
  PaymentMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const configurablePaymentMethods = [
  "CASH",
  "CARD",
  "DUITNOW",
  "EWALLET",
  "BANK_TRANSFER",
  "FOREIGN_CURRENCY",
  "CRYPTO",
] as const satisfies readonly PaymentMethod[];

export type ConfigurablePaymentMethod = (typeof configurablePaymentMethods)[number];

export type BusinessPaymentMethodRow = {
  id: string;
  code: string;
  label: string;
  canonicalMethod: PaymentMethod;
  paymentKind: BusinessPaymentMethodKind;
  settlementCurrency: string;
  assetSymbol: string | null;
  behavior: BusinessPaymentMethodBehavior;
  builtIn: boolean;
  active: boolean;
  sortOrder: number;
};

export type EffectiveBusinessPaymentMethod = {
  id: string | null;
  code: string;
  label: string;
  canonicalMethod: ConfigurablePaymentMethod;
  paymentKind: BusinessPaymentMethodKind;
  settlementCurrency: string;
  assetSymbol: string | null;
  behavior: BusinessPaymentMethodBehavior;
  builtIn: boolean;
  active: boolean;
  sortOrder: number;
};

export const defaultBusinessPaymentMethods: readonly EffectiveBusinessPaymentMethod[] = [
  { id: null, code: "BUILTIN_CASH", label: "Cash", canonicalMethod: "CASH", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER", builtIn: true, active: true, sortOrder: 10 },
  { id: null, code: "BUILTIN_CARD", label: "Card", canonicalMethod: "CARD", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER", builtIn: true, active: true, sortOrder: 20 },
  { id: null, code: "BUILTIN_DUITNOW", label: "DuitNow QR", canonicalMethod: "DUITNOW", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER", builtIn: true, active: true, sortOrder: 30 },
  { id: null, code: "BUILTIN_EWALLET", label: "E-Wallet", canonicalMethod: "EWALLET", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER", builtIn: true, active: true, sortOrder: 40 },
  { id: null, code: "BUILTIN_BANK_TRANSFER", label: "Bank Transfer", canonicalMethod: "BANK_TRANSFER", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "STANDARD_TENDER", builtIn: true, active: true, sortOrder: 50 },
  { id: null, code: "BUILTIN_TRAINING_COMPLIMENTARY", label: "Training / Complimentary", canonicalMethod: "CASH", paymentKind: "LOCAL_TENDER", settlementCurrency: "MYR", assetSymbol: null, behavior: "TRAINING_COMPLIMENTARY", builtIn: true, active: true, sortOrder: 60 },
];

export function isConfigurablePaymentMethod(
  value: PaymentMethod,
): value is ConfigurablePaymentMethod {
  return configurablePaymentMethods.includes(value as ConfigurablePaymentMethod);
}

export function mergeBusinessPaymentMethods(
  rows: BusinessPaymentMethodRow[],
): EffectiveBusinessPaymentMethod[] {
  const builtInOverrides = new Map(
    rows.filter((row) => row.builtIn).map((row) => [row.code, row]),
  );
  const builtIns = defaultBusinessPaymentMethods.map((method) => {
    const override = builtInOverrides.get(method.code);
    if (!override || !isConfigurablePaymentMethod(override.canonicalMethod)) {
      return method;
    }
    return {
      id: override.id,
      code: override.code,
      label: override.label,
      canonicalMethod: override.canonicalMethod,
      paymentKind: override.paymentKind,
      settlementCurrency: override.settlementCurrency,
      assetSymbol: override.assetSymbol,
      behavior: override.behavior,
      builtIn: true,
      active: override.active,
      sortOrder: override.sortOrder,
    };
  });
  const custom = rows.flatMap((row): EffectiveBusinessPaymentMethod[] => {
    if (row.builtIn || !isConfigurablePaymentMethod(row.canonicalMethod)) {
      return [];
    }
    return [{
      id: row.id,
      code: row.code,
      label: row.label,
      canonicalMethod: row.canonicalMethod,
      paymentKind: row.paymentKind,
      settlementCurrency: row.settlementCurrency,
      assetSymbol: row.assetSymbol,
      behavior: row.behavior,
      builtIn: false,
      active: row.active,
      sortOrder: row.sortOrder,
    }];
  });

  return [...builtIns, ...custom].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label),
  );
}

export async function getEffectiveBusinessPaymentMethods(
  businessId: string,
  options: { activeOnly?: boolean } = {},
) {
  const rows = await prisma.businessPaymentMethod.findMany({
    where: { businessId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      id: true,
      code: true,
      label: true,
      canonicalMethod: true,
      paymentKind: true,
      settlementCurrency: true,
      assetSymbol: true,
      behavior: true,
      builtIn: true,
      active: true,
      sortOrder: true,
    },
  });
  const methods = mergeBusinessPaymentMethods(rows);
  return options.activeOnly ? methods.filter((method) => method.active) : methods;
}

export function paymentMethodCategoryLabel(method: ConfigurablePaymentMethod) {
  switch (method) {
    case "CASH": return "Cash";
    case "CARD": return "Card";
    case "DUITNOW": return "DuitNow";
    case "EWALLET": return "E-Wallet";
    case "BANK_TRANSFER": return "Bank Transfer";
    case "FOREIGN_CURRENCY": return "Foreign currency";
    case "CRYPTO": return "Crypto asset";
  }
}

export function paymentMethodSettlementLabel(method: EffectiveBusinessPaymentMethod) {
  if (method.paymentKind === "FOREIGN_CURRENCY") {
    return `Foreign currency · ${method.settlementCurrency}`;
  }
  if (method.paymentKind === "CRYPTO_ASSET") {
    return `Crypto asset · ${method.assetSymbol ?? "Asset"}`;
  }
  return paymentMethodCategoryLabel(method.canonicalMethod);
}
