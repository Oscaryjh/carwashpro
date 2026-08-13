import { randomInt } from "node:crypto";
import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";
import { safeEqual } from "./crypto";

export type EmployeeOtpPurpose = "LOGIN" | "REGISTER_DEVICE";

export type StartEmployeeVerificationInput = Readonly<{
  challengeId: string;
  phoneNumber: string;
  purpose: EmployeeOtpPurpose;
  expiresAt: Date;
  locale: string;
}>;

export type CheckEmployeeVerificationInput = Readonly<{
  challengeId: string;
  phoneNumber: string;
  providerReference: string;
  code: string;
}>;

export type EmployeeVerificationStartResult = Readonly<{
  status: "ACCEPTED";
  providerReference: string;
}>;

export type EmployeeVerificationCheckResult = Readonly<{
  status: "APPROVED" | "REJECTED" | "EXPIRED" | "LOCKED";
}>;

export interface EmployeeOtpProvider {
  readonly name: "mock" | "twilio_verify";
  readonly channel: "local" | "sms";
  sendVerification(
    input: StartEmployeeVerificationInput,
  ): Promise<EmployeeVerificationStartResult>;
  checkVerification(
    input: CheckEmployeeVerificationInput,
  ): Promise<EmployeeVerificationCheckResult>;
}

type StoredMockVerification = Readonly<{
  phoneNumber: string;
  code: string;
  expiresAt: Date;
  approved: boolean;
}>;

const mockVerificationStore = new Map<string, StoredMockVerification>();

export class MockEmployeeOtpProvider implements EmployeeOtpProvider {
  readonly name = "mock" as const;
  readonly channel = "local" as const;

  constructor(private readonly config: EmployeeAuthConfig) {
    if (
      config.environment === "production" ||
      config.otp.provider !== "mock"
    ) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "Employee OTP mock provider is disabled.",
      );
    }
  }

  async sendVerification(input: StartEmployeeVerificationInput) {
    const providerReference = `mock:${input.challengeId}`;
    mockVerificationStore.set(providerReference, {
      phoneNumber: input.phoneNumber,
      code: this.config.otp.mockCode ?? createMockCode(),
      expiresAt: input.expiresAt,
      approved: false,
    });
    return { status: "ACCEPTED" as const, providerReference };
  }

  /** Compatibility helper for older test fixtures; never used by real mode. */
  async sendOtp(
    input: StartEmployeeVerificationInput & { otp: string },
  ) {
    const providerReference = `mock:${input.challengeId}`;
    mockVerificationStore.set(providerReference, {
      phoneNumber: input.phoneNumber,
      code: input.otp,
      expiresAt: input.expiresAt,
      approved: false,
    });
  }

  async checkVerification(input: CheckEmployeeVerificationInput) {
    const stored = mockVerificationStore.get(input.providerReference);
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      mockVerificationStore.delete(input.providerReference);
      return { status: "EXPIRED" as const };
    }
    if (stored.approved || !safeEqual(stored.phoneNumber, input.phoneNumber)) {
      return { status: "REJECTED" as const };
    }
    if (!safeEqual(stored.code, input.code)) {
      return { status: "REJECTED" as const };
    }
    mockVerificationStore.set(input.providerReference, {
      ...stored,
      approved: true,
    });
    return { status: "APPROVED" as const };
  }
}

export class TwilioVerifySmsProvider implements EmployeeOtpProvider {
  readonly name = "twilio_verify" as const;
  readonly channel = "sms" as const;

  constructor(
    private readonly config: EmployeeAuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    if (config.otp.provider !== "twilio_verify") {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "Twilio Verify provider is not enabled.",
      );
    }
  }

  async sendVerification(input: StartEmployeeVerificationInput) {
    const body = new URLSearchParams({
      To: input.phoneNumber,
      Channel: "sms",
      Locale: input.locale.split("-")[0] ?? "en",
    });
    const response = await this.callTwilio("Verifications", body);
    const status = readString(response, "status");
    const sid = readString(response, "sid");

    if (status !== "pending" || !/^VE[0-9a-fA-F]{32}$/.test(sid)) {
      throw new EmployeeOtpProviderError(
        "PROVIDER_INVALID_RESPONSE",
        "Twilio Verify returned an unexpected verification response.",
      );
    }

    return {
      status: "ACCEPTED" as const,
      providerReference: sid,
    };
  }

  async checkVerification(input: CheckEmployeeVerificationInput) {
    try {
      const response = await this.callTwilio(
        "VerificationCheck",
        new URLSearchParams({
          VerificationSid: input.providerReference,
          Code: input.code,
        }),
      );
      const status = readString(response, "status");
      if (status === "approved") return { status: "APPROVED" as const };
      if (status === "expired" || status === "deleted") {
        return { status: "EXPIRED" as const };
      }
      if (status === "max_attempts_reached") {
        return { status: "LOCKED" as const };
      }
      return { status: "REJECTED" as const };
    } catch (error) {
      if (
        error instanceof EmployeeOtpProviderError &&
        (error.providerCode === 20404 || error.providerCode === 60431)
      ) {
        return { status: "EXPIRED" as const };
      }
      throw error;
    }
  }

  private async callTwilio(path: string, body: URLSearchParams) {
    const twilio = this.config.otp.twilio;
    if (!twilio.verifyServiceSid || !twilio.accountSid) {
      throw new EmployeeAuthError("CONFIGURATION_ERROR");
    }
    const username = twilio.apiKeySid ?? twilio.accountSid;
    const password = twilio.apiKeySecret ?? twilio.authToken;
    if (!password) throw new EmployeeAuthError("CONFIGURATION_ERROR");

    let response: Response;
    try {
      response = await this.request(
        `https://verify.twilio.com/v2/Services/${encodeURIComponent(twilio.verifyServiceSid)}/${path}`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(this.config.otp.providerTimeoutMs),
        },
      );
    } catch (error) {
      throw new EmployeeOtpProviderError(
        "PROVIDER_UNAVAILABLE",
        "Twilio Verify request failed.",
        { cause: error },
      );
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new EmployeeOtpProviderError(
        response.status === 429
          ? "PROVIDER_RATE_LIMITED"
          : response.status >= 500
            ? "PROVIDER_UNAVAILABLE"
            : "PROVIDER_REJECTED",
        "Twilio Verify request was rejected.",
        {
          httpStatus: response.status,
          providerCode: readNumber(payload, "code"),
        },
      );
    }
    return payload;
  }
}

export class EmployeeOtpProviderError extends Error {
  readonly code:
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_REJECTED"
    | "PROVIDER_INVALID_RESPONSE";
  readonly httpStatus: number | null;
  readonly providerCode: number | null;

  constructor(
    code: EmployeeOtpProviderError["code"],
    message: string,
    options: { cause?: unknown; httpStatus?: number; providerCode?: number | null } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmployeeOtpProviderError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.providerCode = options.providerCode ?? null;
  }
}

export function createEmployeeOtpProvider(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
): EmployeeOtpProvider {
  return config.otp.provider === "mock"
    ? new MockEmployeeOtpProvider(config)
    : new TwilioVerifySmsProvider(config);
}

/** Development/test-only inspection for stable browser regression. */
export function readMockEmployeeOtp(
  challengeId: string,
  accessKey: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (config.environment === "production" || config.otp.provider !== "mock") {
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
  const stored = mockVerificationStore.get(`mock:${challengeId}`);
  if (!stored || stored.expiresAt.getTime() <= Date.now()) return null;
  return stored.code;
}

export function clearMockEmployeeOtp(
  challengeId: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (config.environment !== "production") {
    mockVerificationStore.delete(`mock:${challengeId}`);
  }
}

export class CapturingEmployeeOtpProvider implements EmployeeOtpProvider {
  readonly name = "mock" as const;
  readonly channel = "local" as const;
  readonly sent: Array<StartEmployeeVerificationInput & { otp: string }> = [];
  readonly checked: CheckEmployeeVerificationInput[] = [];
  sendResult: EmployeeVerificationStartResult = {
    status: "ACCEPTED",
    providerReference: "capture:pending",
  };
  checkResult: EmployeeVerificationCheckResult = { status: "APPROVED" };

  async sendVerification(input: StartEmployeeVerificationInput) {
    const otp = "000000";
    const providerReference = `mock:${input.challengeId}`;
    this.sent.push({ ...input, expiresAt: new Date(input.expiresAt), otp });
    mockVerificationStore.set(providerReference, {
      phoneNumber: input.phoneNumber,
      code: otp,
      expiresAt: input.expiresAt,
      approved: false,
    });
    this.sendResult = { status: "ACCEPTED", providerReference };
    return this.sendResult;
  }

  async checkVerification(input: CheckEmployeeVerificationInput) {
    this.checked.push({ ...input });
    return this.checkResult;
  }
}

function createMockCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    throw new EmployeeOtpProviderError(
      "PROVIDER_INVALID_RESPONSE",
      "Twilio Verify returned invalid JSON.",
    );
  }
}

function readString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}

function readNumber(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "number" ? value[key] : null;
}
