import type { PaymentBankAdapter } from "./contract";

export const paymentProviderKeys = ["PUBLIC_BANK"] as const;

export type PaymentProviderKey = (typeof paymentProviderKeys)[number];

export type PaymentProviderReadiness = Readonly<{
  providerKey: PaymentProviderKey;
  reason: "PUBLIC_BANK_SPEC_NOT_READY" | null;
  releaseReady: boolean;
  status: "NOT_RELEASE_READY" | "RELEASE_READY";
}>;

export const paymentProviderReadiness = {
  PUBLIC_BANK: {
    providerKey: "PUBLIC_BANK",
    reason: "PUBLIC_BANK_SPEC_NOT_READY",
    releaseReady: false,
    status: "NOT_RELEASE_READY",
  },
} as const satisfies Readonly<Record<PaymentProviderKey, PaymentProviderReadiness>>;

export type PaymentProviderAccessErrorCode =
  | "PAYMENT_PROVIDER_UNKNOWN"
  | "PUBLIC_BANK_SPEC_NOT_READY";

export class PaymentProviderAccessError extends Error {
  constructor(readonly code: PaymentProviderAccessErrorCode) {
    super(
      code === "PUBLIC_BANK_SPEC_NOT_READY"
        ? "The requested bank-file provider is not release ready."
        : "The requested bank-file provider is unknown.",
    );
    this.name = "PaymentProviderAccessError";
  }
}

// Keep this list explicit. A provider must not become available merely because
// a bank display code exists in bank-directory.ts.
const registeredAdapters: readonly PaymentBankAdapter[] = [];

export function getPaymentBankAdapter(providerKey: string) {
  return (
    registeredAdapters.find((adapter) => adapter.providerKey === providerKey) ??
    null
  );
}

export function getPaymentProviderReadiness(
  providerKey: string,
): PaymentProviderReadiness | null {
  if (!paymentProviderKeys.includes(providerKey as PaymentProviderKey)) {
    return null;
  }
  return paymentProviderReadiness[providerKey as PaymentProviderKey];
}

/**
 * All artifact-generation entry points must use this fail-closed accessor.
 * It deliberately exposes no configuration values or beneficiary details.
 */
export function requireReleaseReadyPaymentBankAdapter(providerKey: string) {
  const readiness = getPaymentProviderReadiness(providerKey);
  if (!readiness) {
    throw new PaymentProviderAccessError("PAYMENT_PROVIDER_UNKNOWN");
  }
  if (!readiness.releaseReady) {
    throw new PaymentProviderAccessError(
      readiness.reason ?? "PAYMENT_PROVIDER_UNKNOWN",
    );
  }

  // The current readiness map has no release-ready provider. This lookup is
  // retained for the bank-specification-gated implementation phase.
  const adapter = getPaymentBankAdapter(providerKey);
  if (!adapter) {
    throw new PaymentProviderAccessError("PAYMENT_PROVIDER_UNKNOWN");
  }
  return adapter;
}

export function listPaymentBankAdapters() {
  return registeredAdapters.map((adapter) => ({
    contentType: adapter.contentType,
    fileExtension: adapter.fileExtension,
    formatVersion: adapter.formatVersion,
    providerKey: adapter.providerKey,
  }));
}
