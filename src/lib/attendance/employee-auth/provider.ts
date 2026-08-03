import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";
import { safeEqual } from "./crypto";

export type EmployeeOtpPurpose = "LOGIN" | "REGISTER_DEVICE";

export type SendEmployeeOtpInput = {
  challengeId: string;
  phoneNumber: string;
  otp: string;
  purpose: EmployeeOtpPurpose;
  expiresAt: Date;
  locale: string;
};

export interface EmployeeOtpProvider {
  sendOtp(input: SendEmployeeOtpInput): Promise<void>;
}

type StoredMockOtp = Readonly<{
  otp: string;
  expiresAt: Date;
}>;

const mockOtpStore = new Map<string, StoredMockOtp>();

export class MockEmployeeOtpProvider implements EmployeeOtpProvider {
  constructor(private readonly config: EmployeeAuthConfig) {
    if (
      (config.environment === "production" &&
        !config.otp.testingDeployment) ||
      config.otp.sendMode !== "mock"
    ) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "Employee OTP mock provider is disabled.",
      );
    }
  }

  async sendOtp(input: SendEmployeeOtpInput) {
    mockOtpStore.set(input.challengeId, {
      otp: input.otp,
      expiresAt: input.expiresAt,
    });
  }
}

export function createEmployeeOtpProvider(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
): EmployeeOtpProvider {
  if (config.otp.sendMode === "mock") {
    return new MockEmployeeOtpProvider(config);
  }

  throw new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "No employee OTP provider is configured.",
  );
}

/**
 * Development-only retrieval for the in-memory mock provider.
 *
 * This helper is deliberately inaccessible in production and requires a
 * separate access key. API routes must never include its value in a response.
 */
export function readMockEmployeeOtp(
  challengeId: string,
  accessKey: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (
    config.environment === "production" ||
    config.otp.sendMode !== "mock"
  ) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "Employee OTP mock inspection is disabled.",
    );
  }

  if (
    !config.otp.mockAccessKey ||
    !safeEqual(accessKey, config.otp.mockAccessKey)
  ) {
    throw new EmployeeAuthError(
      "UNAUTHENTICATED",
      "Employee OTP mock access key is invalid.",
    );
  }

  const stored = mockOtpStore.get(challengeId);

  if (!stored || stored.expiresAt.getTime() <= Date.now()) {
    mockOtpStore.delete(challengeId);
    return null;
  }

  return stored.otp;
}

export function clearMockEmployeeOtp(
  challengeId: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (config.environment === "production") {
    return;
  }

  mockOtpStore.delete(challengeId);
}

export class CapturingEmployeeOtpProvider implements EmployeeOtpProvider {
  readonly sent: SendEmployeeOtpInput[] = [];

  async sendOtp(input: SendEmployeeOtpInput) {
    this.sent.push({
      ...input,
      expiresAt: new Date(input.expiresAt),
    });
  }
}
