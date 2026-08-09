import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  EMPLOYEE_OTP_DIGITS,
  getEmployeeAuthConfig,
} from "./config";
import { EmployeeAuthError } from "./errors";

type EmployeeIdentifierKind =
  | "device"
  | "device-fingerprint"
  | "ip"
  | "phone"
  | "user-agent";

export function createEmployeeOtp() {
  const maximum = 10 ** EMPLOYEE_OTP_DIGITS;
  return randomInt(0, maximum).toString().padStart(EMPLOYEE_OTP_DIGITS, "0");
}

export function createEmployeeSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashEmployeeSessionToken(
  token: string,
  secret = getEmployeeAuthConfig().authSecret,
) {
  return keyedHash("session-token", normalizeRequired(token, "session token"), secret);
}

export function hashEmployeeIdentifier(
  kind: EmployeeIdentifierKind,
  value: string,
  secret = getEmployeeAuthConfig().authSecret,
) {
  return keyedHash(
    `identifier:${kind}`,
    normalizeRequired(value, `${kind} identifier`),
    secret,
  );
}

export function hashEmployeeOtp(
  challengeId: string,
  otp: string,
  secret = getEmployeeAuthConfig().authSecret,
) {
  assertOtp(otp);
  return keyedHash(
    "otp",
    `${normalizeRequired(challengeId, "challenge id")}\0${otp}`,
    secret,
  );
}

export function verifyEmployeeOtpHash(
  challengeId: string,
  otp: string,
  expectedHash: string,
  secret = getEmployeeAuthConfig().authSecret,
) {
  if (!new RegExp(`^\\d{${EMPLOYEE_OTP_DIGITS}}$`).test(otp)) {
    return false;
  }

  const actualHash = hashEmployeeOtp(challengeId, otp, secret);
  return safeEqual(actualHash, expectedHash);
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function keyedHash(domain: string, value: string, secret: string) {
  return createHmac("sha256", secret)
    .update("tetamu:employee-auth:v1\0")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex");
}

function normalizeRequired(value: string, name: string) {
  const normalized = value.normalize("NFKC").trim();

  if (!normalized) {
    throw new EmployeeAuthError("INVALID_REQUEST", `${name} is required.`);
  }

  return normalized;
}

function assertOtp(value: string) {
  if (!new RegExp(`^\\d{${EMPLOYEE_OTP_DIGITS}}$`).test(value)) {
    throw new EmployeeAuthError("INVALID_REQUEST", "OTP must contain six digits.");
  }
}
