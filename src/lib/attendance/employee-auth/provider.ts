import { randomInt } from "node:crypto";
import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import { EmployeeAuthError } from "./errors";
import {
  safeEqual,
  verifyEmployeeOtpHash,
} from "./crypto";

export type EmployeeOtpPurpose = "LOGIN" | "REGISTER_DEVICE";

export type StartEmployeeVerificationInput = Readonly<{
  challengeId: string;
  phoneNumber: string;
  purpose: EmployeeOtpPurpose;
  expiresAt: Date;
  locale: string;
  code?: string;
}>;

export type CheckEmployeeVerificationInput = Readonly<{
  challengeId: string;
  phoneNumber: string;
  providerReference: string;
  code: string;
  otpHash?: string | null;
}>;

export type EmployeeVerificationStartResult = Readonly<{
  status: "ACCEPTED";
  providerReference: string;
}>;

export type EmployeeVerificationCheckResult = Readonly<{
  status: "APPROVED" | "REJECTED" | "EXPIRED" | "LOCKED";
}>;

export interface EmployeeOtpProvider {
  readonly name: "mock" | "twilio_verify" | "sms123";
  readonly channel: "local" | "sms";
  readonly verificationMode: "provider" | "application";
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
  readonly verificationMode = "provider" as const;

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
    if (!stored && this.config.otp.mockCode) {
      const expectedReference = `mock:${input.challengeId}`;
      return {
        status:
          safeEqual(input.providerReference, expectedReference) &&
          safeEqual(input.code, this.config.otp.mockCode)
            ? ("APPROVED" as const)
            : ("REJECTED" as const),
      };
    }
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
  readonly verificationMode = "provider" as const;

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

const SMS123_SEND_URL = "https://www.sms123.net/api/send.php";
const SMS123_SUCCESS_CODES = new Set(["E00001", "BE00128"]);
const SMS123_FAILURE_REASONS: Readonly<Record<string, string>> = {
  E00242: "The mobile number was rejected by SMS123.",
  E00250: "The SMS123 account balance is insufficient.",
  E00359: "The SMS123 API key was rejected.",
  E00366: "The SMS content was rejected by SMS123.",
  BE00035: "The registered company name is missing.",
  BE00036: "The SMS template or company name is not whitelisted.",
  BE00096: "SMS123 rejected a duplicate request reference.",
};

export class Sms123OtpProvider implements EmployeeOtpProvider {
  readonly name = "sms123" as const;
  readonly channel = "sms" as const;
  readonly verificationMode = "application" as const;

  constructor(
    private readonly config: EmployeeAuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    if (config.otp.provider !== "sms123" || !config.otp.sms123.apiKey) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "SMS123 provider is not enabled.",
      );
    }
  }

  async sendVerification(input: StartEmployeeVerificationInput) {
    if (!input.code || !/^\d{6}$/.test(input.code)) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "SMS123 requires an application-generated verification code.",
      );
    }

    const apiKey = this.config.otp.sms123.apiKey;
    if (!apiKey) throw new EmployeeAuthError("CONFIGURATION_ERROR");

    const minutes = Math.max(
      1,
      Math.ceil(this.config.otp.expiresInSeconds / 60),
    );
    // SMS123's production gateway reads these credentials from the query
    // string. This mirrors the provider's documented GET integration and the
    // locally verified Staff App adapter.
    const url = new URL(SMS123_SEND_URL);
    url.search = new URLSearchParams({
      apiKey,
      recipients: normalizeSms123Recipient(input.phoneNumber),
      messageContent:
        `RM0 Tetamu: Your OTP is ${input.code}. ` +
        `Valid for ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
        "Do not share this code.",
      referenceID: input.challengeId,
    }).toString();

    let response: Response;
    try {
      response = await this.request(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(this.config.otp.providerTimeoutMs),
      });
    } catch (error) {
      throw new EmployeeOtpProviderError(
        "PROVIDER_UNAVAILABLE",
        "SMS123 request failed.",
        { cause: error },
      );
    }

    const payload = await readProviderJson(response, "SMS123");
    const status = readString(payload, "status");
    const providerCode = readString(payload, "msgCode");
    if (!response.ok || status !== "ok" || !SMS123_SUCCESS_CODES.has(providerCode)) {
      throw new EmployeeOtpProviderError(
        response.status === 429
          ? "PROVIDER_RATE_LIMITED"
          : response.status >= 500
            ? "PROVIDER_UNAVAILABLE"
            : "PROVIDER_REJECTED",
        "SMS123 rejected the verification message.",
        {
          httpStatus: response.status,
          providerCode: providerCode || null,
        },
      );
    }

    const reference = readSms123Reference(payload);
    if (!reference) {
      throw new EmployeeOtpProviderError(
        "PROVIDER_INVALID_RESPONSE",
        "SMS123 returned an unexpected response.",
      );
    }

    return {
      status: "ACCEPTED" as const,
      providerReference: `sms123:${reference}`,
    };
  }

  async checkVerification(input: CheckEmployeeVerificationInput) {
    if (
      !input.providerReference.startsWith("sms123:") ||
      !input.otpHash
    ) {
      return { status: "REJECTED" as const };
    }

    return {
      status: verifyEmployeeOtpHash(
        input.challengeId,
        input.code,
        input.otpHash,
        this.config.authSecret,
      )
        ? ("APPROVED" as const)
        : ("REJECTED" as const),
    };
  }
}

export class EmployeeOtpProviderError extends Error {
  readonly code:
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_REJECTED"
    | "PROVIDER_INVALID_RESPONSE";
  readonly httpStatus: number | null;
  readonly providerCode: number | string | null;

  constructor(
    code: EmployeeOtpProviderError["code"],
    message: string,
    options: {
      cause?: unknown;
      httpStatus?: number;
      providerCode?: number | string | null;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmployeeOtpProviderError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.providerCode = options.providerCode ?? null;
  }
}

export type EmployeeOtpProviderFailureDetail = Readonly<{
  failureCode: string;
  httpStatus: number | null;
  providerCode: number | string | null;
  reason: string;
}>;

export function describeEmployeeOtpProviderFailure(
  error: unknown,
): EmployeeOtpProviderFailureDetail {
  if (!(error instanceof EmployeeOtpProviderError)) {
    return {
      failureCode: "UNEXPECTED_PROVIDER_ERROR",
      httpStatus: null,
      providerCode: null,
      reason: "The SMS provider request failed unexpectedly.",
    };
  }

  const providerCode = error.providerCode;
  const mappedReason =
    typeof providerCode === "string"
      ? SMS123_FAILURE_REASONS[providerCode]
      : undefined;

  return {
    failureCode: error.code,
    httpStatus: error.httpStatus,
    providerCode,
    reason:
      mappedReason ??
      {
        PROVIDER_UNAVAILABLE: "The SMS provider could not be reached.",
        PROVIDER_RATE_LIMITED: "The SMS provider temporarily rate-limited this request.",
        PROVIDER_REJECTED: "The SMS provider rejected this request.",
        PROVIDER_INVALID_RESPONSE: "The SMS provider returned an invalid response.",
      }[error.code],
  };
}

export function createEmployeeOtpProvider(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
): EmployeeOtpProvider {
  if (config.otp.provider === "mock") {
    return new MockEmployeeOtpProvider(config);
  }
  if (config.otp.provider === "sms123") {
    return new Sms123OtpProvider(config);
  }
  return new TwilioVerifySmsProvider(config);
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
  readonly verificationMode = "provider" as const;
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
  return readProviderJson(response, "Twilio Verify");
}

async function readProviderJson(
  response: Response,
  providerName: string,
): Promise<Record<string, unknown>> {
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
      `${providerName} returned invalid JSON.`,
    );
  }
}

function normalizeSms123Recipient(phoneNumber: string) {
  const normalized = phoneNumber.replace(/^\+/, "");
  if (!/^60\d{8,11}$/.test(normalized)) {
    throw new EmployeeOtpProviderError(
      "PROVIDER_REJECTED",
      "SMS123 recipient must be a Malaysian number with country code.",
    );
  }
  return normalized;
}

function readSms123Reference(payload: Record<string, unknown>) {
  const topLevel = payload.referenceID;
  if (typeof topLevel === "string" && topLevel.trim()) return topLevel.trim();
  if (Array.isArray(topLevel)) {
    const first = topLevel.find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    if (first) return first.trim();
  }
  const data = payload.data;
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const reference = (entry as Record<string, unknown>).referenceID;
      if (typeof reference === "string" && reference.trim()) {
        return reference.trim();
      }
    }
  }
  return "";
}

function readString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}

function readNumber(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "number" ? value[key] : null;
}
