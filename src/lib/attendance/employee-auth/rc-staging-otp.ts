import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { validateProductionRuntime, type SourceAttestation } from "@/lib/release/production-contract.mjs";
import { readSourceAttestation } from "@/lib/release/source-attestation.mjs";
import type { EmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";
import type { EmployeeOtpProvider, StartEmployeeVerificationInput, CheckEmployeeVerificationInput } from "./provider";

export type RcStagingOtpConfiguration = Readonly<{ hmacSeed: string; syntheticPhoneAllowlist: readonly string[] }>;

export function readRcStagingOtpConfiguration(env: NodeJS.ProcessEnv, attestation: SourceAttestation | null = readSourceAttestation()): RcStagingOtpConfiguration {
  if (env.APP_DEPLOYMENT_PROFILE !== "rc-staging" || !["web", "staff"].includes(env.APP_SERVICE_SCOPE ?? "")) {
    throw new EmployeeAuthError("CONFIGURATION_ERROR", "RC_STAGING_OTP_PROFILE_REQUIRED");
  }
  // Not just a provider switch: bypassing the CLI still requires the entire
  // production-grade identity, protected inventory, secrets and source proof.
  validateProductionRuntime(env, env.APP_SERVICE_SCOPE!, attestation);
  return { hmacSeed: env.RC_STAGING_OTP_HMAC_SEED!, syntheticPhoneAllowlist: env.RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST!.split(",").map((value) => value.trim()) };
}

// No public inspection endpoint. Authorized test harnesses may derive a code
// in memory; the existing service enforces persistence, single-use and limits.
export function deriveRcStagingOtp(input: Pick<StartEmployeeVerificationInput, "challengeId" | "phoneNumber" | "expiresAt">, seed: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.challengeId) || !normalizeAttendancePhone(input.phoneNumber) || !Number.isSafeInteger(input.expiresAt.getTime()) || seed.length < 32) {
    throw new EmployeeAuthError("INVALID_REQUEST", "RC_STAGING_CHALLENGE_INVALID");
  }
  const digest = createHmac("sha256", seed).update(`tetamu:rc-staging-otp:v1\0${input.challengeId}\0${normalizeAttendancePhone(input.phoneNumber)}\0${Math.floor(input.expiresAt.getTime() / 1000)}`).digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

export class RcStagingEmployeeOtpProvider implements EmployeeOtpProvider {
  readonly name = "rc_staging_intercept" as const;
  readonly channel = "intercept" as const;
  readonly verificationMode = "provider" as const;
  private readonly staging: RcStagingOtpConfiguration;
  constructor(config: EmployeeAuthConfig) {
    if (config.environment !== "production" || config.otp.provider !== this.name || !config.otp.rcStaging) {
      throw new EmployeeAuthError("CONFIGURATION_ERROR", "RC_STAGING_OTP_CONFIGURATION_REQUIRED");
    }
    this.staging = config.otp.rcStaging;
  }
  private phone(value: string) {
    const phone = normalizeAttendancePhone(value);
    if (!phone || !this.staging.syntheticPhoneAllowlist.includes(phone)) throw new EmployeeAuthError("INVALID_REQUEST", "RC_STAGING_SYNTHETIC_PHONE_REQUIRED");
    return phone;
  }
  async sendVerification(input: StartEmployeeVerificationInput) {
    const phoneNumber = this.phone(input.phoneNumber);
    deriveRcStagingOtp({ ...input, phoneNumber }, this.staging.hmacSeed);
    return { status: "ACCEPTED" as const, providerReference: `rc-staging:v1:${input.challengeId}:${Math.floor(input.expiresAt.getTime() / 1000)}` };
  }
  async checkVerification(input: CheckEmployeeVerificationInput) {
    const phoneNumber = this.phone(input.phoneNumber);
    const parts = input.providerReference.split(":");
    const seconds = Number(parts[3]);
    if (parts.length !== 4 || parts[0] !== "rc-staging" || parts[1] !== "v1" || parts[2] !== input.challengeId || !Number.isSafeInteger(seconds) || seconds <= 0) return { status: "REJECTED" as const };
    const expiresAt = new Date(seconds * 1000);
    if (expiresAt.getTime() <= Date.now()) return { status: "EXPIRED" as const };
    const expected = deriveRcStagingOtp({ ...input, phoneNumber, expiresAt }, this.staging.hmacSeed);
    const valid = /^\d{6}$/.test(input.code) && timingSafeEqual(Buffer.from(expected), Buffer.from(input.code));
    return { status: valid ? "APPROVED" as const : "REJECTED" as const };
  }
}
