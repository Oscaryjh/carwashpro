import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeAttendancePhone } from "@/lib/attendance/phone";
import { runtimeEnvironment, type RuntimeEnvironmentMap } from "@/lib/release/environment";
import type { EmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";
import type {
  CheckEmployeeVerificationInput,
  EmployeeOtpProvider,
  StartEmployeeVerificationInput,
} from "./provider";

export type UatPreviewOtpConfiguration = Readonly<{
  hmacSeed: string;
  syntheticPhoneAllowlist: readonly string[];
}>;

type DeriveUatPreviewOtpInput = Readonly<{
  challengeId: string;
  phoneNumber: string;
  expiresAt: Date;
}>;

const RESTRICTED_FALSE_FLAGS = [
  "PRODUCTION_ELIGIBLE",
  "OFFICIAL_EXPORT_ELIGIBLE",
  "BANK_PAYMENT_EXECUTION_ENABLED",
  "GOVERNMENT_SUBMISSION_ENABLED",
  "PCB_PRODUCTION_ENABLED",
] as const;

const REAL_SMS_CREDENTIALS = [
  "SMS123_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_VERIFY_SERVICE_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_AUTH_TOKEN",
] as const;

export function readUatPreviewOtpConfiguration(
  env: RuntimeEnvironmentMap,
): UatPreviewOtpConfiguration {
  if (
    env.NODE_ENV?.trim().toLowerCase() !== "production" ||
    runtimeEnvironment(env) !== "uat-preview"
  ) {
    configurationError("UAT_PREVIEW_OTP_ENVIRONMENT_MISMATCH");
  }

  requireIdentityMatch(
    env.RAILWAY_PROJECT_ID,
    env.UAT_PREVIEW_EXPECTED_PROJECT_ID,
    "UAT_PREVIEW_PROJECT_ID_MISMATCH",
  );
  requireIdentityMatch(
    env.RAILWAY_ENVIRONMENT_ID,
    env.UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID,
    "UAT_PREVIEW_ENVIRONMENT_ID_MISMATCH",
  );
  requireIdentityMatch(
    env.RAILWAY_SERVICE_ID,
    env.UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID,
    "UAT_PREVIEW_WEB_SERVICE_ID_MISMATCH",
  );

  if (env.UAT_PREVIEW_OTP_INTERCEPT_ENABLED?.trim().toLowerCase() !== "true") {
    configurationError("UAT_PREVIEW_OTP_INTERCEPT_REQUIRED");
  }
  if (env.UAT_PREVIEW_ACCESS_ENABLED?.trim().toLowerCase() !== "true") {
    configurationError("UAT_PREVIEW_ACCESS_REQUIRED");
  }
  if (
    (env.UAT_PREVIEW_ACCESS_USERNAME?.trim().length ?? 0) < 3 ||
    Buffer.byteLength(env.UAT_PREVIEW_ACCESS_PASSWORD?.trim() ?? "", "utf8") < 32
  ) {
    configurationError("UAT_PREVIEW_ACCESS_CREDENTIALS_REQUIRED");
  }

  for (const name of RESTRICTED_FALSE_FLAGS) {
    if (env[name]?.trim().toLowerCase() !== "false") {
      configurationError("UAT_PREVIEW_RESTRICTED_FEATURE_ENABLED");
    }
  }
  if (REAL_SMS_CREDENTIALS.some((name) => Boolean(env[name]?.trim()))) {
    configurationError("UAT_PREVIEW_REAL_SMS_CONFIGURATION_FORBIDDEN");
  }

  const hmacSeed = env.UAT_PREVIEW_OTP_HMAC_SEED?.trim() ?? "";
  if (Buffer.byteLength(hmacSeed, "utf8") < 32) {
    configurationError("UAT_PREVIEW_OTP_HMAC_SEED_REQUIRED");
  }

  const syntheticPhoneAllowlist = [
    ...new Set(
      (env.UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST ?? "")
        .split(",")
        .map((value) => normalizeAttendancePhone(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (syntheticPhoneAllowlist.length === 0) {
    configurationError("UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST_REQUIRED");
  }

  return { hmacSeed, syntheticPhoneAllowlist };
}

export function deriveUatPreviewOtp(
  input: DeriveUatPreviewOtpInput,
  hmacSeed: string,
) {
  const phoneNumber = normalizeAttendancePhone(input.phoneNumber);
  const challengeId = input.challengeId.trim();
  const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1_000);
  if (
    !phoneNumber ||
    !challengeId ||
    challengeId.includes(":") ||
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= 0 ||
    Buffer.byteLength(hmacSeed, "utf8") < 32
  ) {
    throw new EmployeeAuthError("INVALID_REQUEST");
  }

  const digest = createHmac("sha256", hmacSeed)
    .update("tetamu:uat-preview-otp:v1\0")
    .update(challengeId)
    .update("\0")
    .update(phoneNumber)
    .update("\0")
    .update(String(expiresAtSeconds))
    .digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

export class UatPreviewEmployeeOtpProvider implements EmployeeOtpProvider {
  readonly name = "uat_preview_intercept" as const;
  readonly channel = "intercept" as const;
  readonly verificationMode = "provider" as const;
  private readonly preview: UatPreviewOtpConfiguration;

  constructor(private readonly config: EmployeeAuthConfig) {
    if (
      config.environment !== "uat-preview" ||
      config.otp.provider !== "uat_preview_intercept" ||
      !config.otp.uatPreview
    ) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "UAT_PREVIEW_OTP_CONFIGURATION_REQUIRED",
      );
    }
    this.preview = config.otp.uatPreview;
  }

  async sendVerification(input: StartEmployeeVerificationInput) {
    const phoneNumber = this.requireSyntheticPhone(input.phoneNumber);
    const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1_000);
    deriveUatPreviewOtp(
      { ...input, phoneNumber },
      this.preview.hmacSeed,
    );
    return {
      status: "ACCEPTED" as const,
      providerReference:
        `uat-preview:v1:${input.challengeId}:${expiresAtSeconds}`,
    };
  }

  async checkVerification(input: CheckEmployeeVerificationInput) {
    const phoneNumber = this.requireSyntheticPhone(input.phoneNumber);
    const reference = parseProviderReference(input.providerReference);
    if (!reference || !constantTimeTextEqual(reference.challengeId, input.challengeId)) {
      return { status: "REJECTED" as const };
    }
    if (reference.expiresAt.getTime() <= Date.now()) {
      return { status: "EXPIRED" as const };
    }
    const expected = deriveUatPreviewOtp(
      {
        challengeId: input.challengeId,
        phoneNumber,
        expiresAt: reference.expiresAt,
      },
      this.preview.hmacSeed,
    );
    return {
      status: constantTimeTextEqual(expected, input.code)
        ? ("APPROVED" as const)
        : ("REJECTED" as const),
    };
  }

  private requireSyntheticPhone(value: string) {
    const phoneNumber = normalizeAttendancePhone(value);
    if (
      !phoneNumber ||
      !this.preview.syntheticPhoneAllowlist.includes(phoneNumber)
    ) {
      throw new EmployeeAuthError(
        "INVALID_REQUEST",
        "UAT_PREVIEW_SYNTHETIC_PHONE_REQUIRED",
      );
    }
    return phoneNumber;
  }
}

function requireIdentityMatch(
  actual: string | undefined,
  expected: string | undefined,
  code: string,
) {
  const normalizedActual = actual?.trim() ?? "";
  const normalizedExpected = expected?.trim() ?? "";
  if (
    !normalizedActual ||
    !normalizedExpected ||
    normalizedActual !== normalizedExpected
  ) {
    configurationError(code);
  }
}

function parseProviderReference(value: string) {
  const [namespace, version, challengeId, expiresAtText, ...rest] =
    value.split(":");
  const expiresAtSeconds = Number(expiresAtText);
  if (
    namespace !== "uat-preview" ||
    version !== "v1" ||
    !challengeId ||
    rest.length > 0 ||
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= 0
  ) {
    return null;
  }
  return {
    challengeId,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

function constantTimeTextEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  const maximumLength = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(maximumLength);
  const paddedRight = Buffer.alloc(maximumLength);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  return (
    timingSafeEqual(paddedLeft, paddedRight) &&
    leftBuffer.length === rightBuffer.length
  );
}

function configurationError(code: string): never {
  throw new EmployeeAuthError("CONFIGURATION_ERROR", code);
}
