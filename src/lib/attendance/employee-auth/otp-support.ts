export type OtpSupportStatus =
  | "VERIFIED"
  | "SENT"
  | "DELIVERY_FAILED"
  | "EXPIRED"
  | "INVALIDATED"
  | "PENDING";

export type OtpSupportStatusSource = Readonly<{
  deliveryAcceptedAt: Date | null;
  expiresAt: Date;
  invalidatedAt: Date | null;
  verifiedAt: Date | null;
}>;

export function deriveOtpSupportStatus(
  challenge: OtpSupportStatusSource,
  now = new Date(),
): OtpSupportStatus {
  if (challenge.verifiedAt) return "VERIFIED";

  if (challenge.invalidatedAt) {
    return challenge.deliveryAcceptedAt ? "INVALIDATED" : "DELIVERY_FAILED";
  }

  if (challenge.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (challenge.deliveryAcceptedAt) return "SENT";
  return "PENDING";
}

export function otpSupportStatusLabel(status: OtpSupportStatus) {
  return {
    VERIFIED: "Verified",
    SENT: "Sent to carrier",
    DELIVERY_FAILED: "Delivery failed",
    EXPIRED: "Expired",
    INVALIDATED: "Replaced or cancelled",
    PENDING: "Preparing",
  }[status];
}

export function otpSupportStatusDescription(status: OtpSupportStatus) {
  return {
    VERIFIED: "The employee entered the correct code and completed verification.",
    SENT: "Twilio accepted the SMS request. This does not guarantee handset delivery.",
    DELIVERY_FAILED: "The provider did not accept this delivery attempt.",
    EXPIRED: "The code was not verified before its validity window ended.",
    INVALIDATED: "A newer request or another security event replaced this code.",
    PENDING: "The request was created but no provider acceptance is recorded yet.",
  }[status];
}

export function maskProviderReference(value: string | null) {
  if (!value) return "Not available";
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatSupportPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("60") && digits.length >= 11) {
    const local = digits.slice(2);
    return `+60 ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return value;
}
