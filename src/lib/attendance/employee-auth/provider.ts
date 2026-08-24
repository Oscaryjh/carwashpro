import type { EmployeeAuthConfig } from "./config";
import { getEmployeeAuthConfig } from "./config";
import { safeEqual } from "./crypto";
import { EmployeeAuthError } from "./errors";

export type EmployeeOtpPurpose = "LOGIN" | "REGISTER_DEVICE";

export type SmsSendInput = Readonly<{
  recipient: string;
  message: string;
  referenceId: string;
  challengeId: string;
  purpose: EmployeeOtpPurpose;
  expiresAt: Date;
  locale: string;
}>;

export type SmsSendResult = Readonly<{
  status: "SENT";
  providerReferenceId: string;
  providerMessageCode: string | null;
}>;

export interface SmsProvider {
  readonly name: "mock" | "sms123";
  readonly channel: "local" | "sms";
  sendSms(input: SmsSendInput): Promise<SmsSendResult>;
}

/** Backward-compatible type name for existing service dependency injection. */
export type EmployeeOtpProvider = SmsProvider;

type StoredMockSms = Readonly<{
  code: string;
  expiresAt: Date;
}>;

const mockSmsStore = new Map<string, StoredMockSms>();

export class MockEmployeeOtpProvider implements SmsProvider {
  readonly name = "mock" as const;
  readonly channel = "local" as const;

  constructor(private readonly config: EmployeeAuthConfig) {
    if (config.environment === "production" || config.otp.provider !== "mock") {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "Employee OTP mock provider is disabled.",
      );
    }
  }

  async sendSms(input: SmsSendInput): Promise<SmsSendResult> {
    const code = extractOtp(input.message);
    mockSmsStore.set(input.referenceId, {
      code,
      expiresAt: new Date(input.expiresAt),
    });
    return {
      status: "SENT",
      providerReferenceId: input.referenceId,
      providerMessageCode: "MOCK_SENT",
    };
  }
}

export class Sms123Provider implements SmsProvider {
  readonly name = "sms123" as const;
  readonly channel = "sms" as const;

  constructor(
    private readonly config: EmployeeAuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    if (
      config.otp.provider !== "sms123" ||
      !config.otp.sms123.enabled ||
      !config.otp.sms123.apiKey
    ) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "SMS123 provider is not enabled.",
      );
    }
  }

  async sendSms(input: SmsSendInput): Promise<SmsSendResult> {
    const apiKey = this.config.otp.sms123.apiKey;
    if (!apiKey) throw new EmployeeAuthError("CONFIGURATION_ERROR");

    const url = new URL(`${this.config.otp.sms123.baseUrl}/send.php`);
    url.search = new URLSearchParams({
      apiKey,
      recipients: toSms123Recipient(input.recipient),
      messageContent: input.message,
      referenceID: input.referenceId,
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

    const payload = await readJson(response);
    const providerMessageCode = readString(payload, "msgCode") || null;
    if (!response.ok) {
      throw new EmployeeOtpProviderError(
        response.status === 429
          ? "PROVIDER_RATE_LIMITED"
          : response.status >= 500
            ? "PROVIDER_UNAVAILABLE"
            : "PROVIDER_REJECTED",
        "SMS123 request was rejected.",
        { httpStatus: response.status, providerMessageCode },
      );
    }

    const status = readString(payload, "status").toLowerCase();
    if (status !== "ok" || providerMessageCode !== "E00001") {
      throw new EmployeeOtpProviderError(
        "PROVIDER_REJECTED",
        "SMS123 did not accept the message.",
        { httpStatus: response.status, providerMessageCode },
      );
    }

    return {
      status: "SENT",
      providerReferenceId:
        readString(payload, "referenceID") || input.referenceId,
      providerMessageCode,
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
  readonly providerMessageCode: string | null;

  constructor(
    code: EmployeeOtpProviderError["code"],
    message: string,
    options: {
      cause?: unknown;
      httpStatus?: number;
      providerMessageCode?: string | null;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EmployeeOtpProviderError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.providerMessageCode = options.providerMessageCode ?? null;
  }
}

export function createEmployeeOtpProvider(
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
): SmsProvider {
  return config.otp.provider === "mock"
    ? new MockEmployeeOtpProvider(config)
    : new Sms123Provider(config);
}

export function createEmployeeOtpReferenceId(
  challengeId: string,
  sendAttempt = 1,
) {
  if (!Number.isSafeInteger(sendAttempt) || sendAttempt < 1) {
    throw new EmployeeAuthError("INVALID_REQUEST", "SMS send attempt is invalid.");
  }
  return `otp_${challengeId}_${sendAttempt}`;
}

export function buildEmployeeOtpMessage(
  otp: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (!/^\d{6}$/.test(otp)) {
    throw new EmployeeAuthError("INVALID_REQUEST", "OTP must contain six digits.");
  }
  const minutes = Math.max(1, Math.ceil(config.otp.expiresInSeconds / 60));
  return `${config.otp.sms123.messagePrefix} Tetamu: Your OTP is ${otp}. Valid for ${minutes} minutes. Do not share this code.`;
}

export function toSms123Recipient(phoneNumber: string) {
  const compact = phoneNumber.replace(/[\s()-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^60\d{8,13}$/.test(digits)) {
    throw new EmployeeOtpProviderError(
      "PROVIDER_REJECTED",
      "SMS123 recipient must be a Malaysian number with country code.",
    );
  }
  return digits;
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
  if (!config.otp.mockAccessKey || !safeEqual(accessKey, config.otp.mockAccessKey)) {
    throw new EmployeeAuthError(
      "UNAUTHENTICATED",
      "Employee OTP mock access key is invalid.",
    );
  }
  const stored = mockSmsStore.get(createEmployeeOtpReferenceId(challengeId));
  if (!stored || stored.expiresAt.getTime() <= Date.now()) return null;
  return stored.code;
}

export function clearMockEmployeeOtp(
  challengeId: string,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  if (config.environment !== "production") {
    mockSmsStore.delete(createEmployeeOtpReferenceId(challengeId));
  }
}

export class CapturingEmployeeOtpProvider implements SmsProvider {
  readonly name = "mock" as const;
  readonly channel = "local" as const;
  readonly sent: Array<SmsSendInput & { otp: string }> = [];
  sendResult: SmsSendResult = {
    status: "SENT",
    providerReferenceId: "capture:pending",
    providerMessageCode: "MOCK_SENT",
  };

  async sendSms(input: SmsSendInput) {
    const otp = extractOtp(input.message);
    this.sent.push({ ...input, expiresAt: new Date(input.expiresAt), otp });
    this.sendResult = {
      status: "SENT",
      providerReferenceId: input.referenceId,
      providerMessageCode: "MOCK_SENT",
    };
    return this.sendResult;
  }
}

function extractOtp(message: string) {
  const code = message.match(/\b\d{6}\b/)?.[0];
  if (!code) {
    throw new EmployeeOtpProviderError(
      "PROVIDER_REJECTED",
      "OTP message does not contain a six-digit code.",
    );
  }
  return code;
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
      "SMS123 returned invalid JSON.",
    );
  }
}

function readString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}
