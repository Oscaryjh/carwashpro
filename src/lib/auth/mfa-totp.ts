import * as OTPAuth from "otpauth";

export const TOTP_ISSUER = "Tetamu";
export const TOTP_ALGORITHM = "SHA1";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;

export function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function createTotpUri(input: { accountLabel: string; secret: string }) {
  return totp(input).toString();
}

export function verifyTotp(input: {
  code: string;
  secret: string;
  timestamp: number;
}) {
  if (!/^\d{6}$/.test(input.code)) return null;
  const verifier = totp({ accountLabel: "verification", secret: input.secret });
  const delta = verifier.validate({
    token: input.code,
    timestamp: input.timestamp,
    window: TOTP_WINDOW,
  });
  if (delta === null) return null;
  return BigInt(verifier.counter({ timestamp: input.timestamp }) + delta);
}

export function generateTotpCode(input: {
  secret: string;
  timestamp: number;
}) {
  return totp({ accountLabel: "verification", secret: input.secret }).generate({
    timestamp: input.timestamp,
  });
}

function totp(input: { accountLabel: string; secret: string }) {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: normalizeLabel(input.accountLabel),
    issuerInLabel: true,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(input.secret),
  });
}

function normalizeLabel(value: string) {
  const normalized = value.trim().replace(/[\r\n\0]/g, "").slice(0, 160);
  return normalized || "account";
}
