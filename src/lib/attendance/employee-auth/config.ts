import { EmployeeAuthError } from "./errors";

export const EMPLOYEE_SESSION_COOKIE = "tetamu_employee_session";
export const EMPLOYEE_OTP_DIGITS = 6;

export type EmployeeOtpProviderName = "mock" | "sms123";
export type EmployeeOtpChannel = "local" | "sms";
export type EmployeeOtpSendMode = "mock" | "provider";

export type EmployeeAuthConfig = Readonly<{
  authSecret: string;
  environment: "development" | "test" | "production";
  maxJsonBodyBytes: number;
  otp: Readonly<{
    digits: typeof EMPLOYEE_OTP_DIGITS;
    provider: EmployeeOtpProviderName;
    channel: EmployeeOtpChannel;
    expiresInSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    phoneRequestsPerHour: number;
    ipRequestsPerHour: number;
    deviceRequestsPerHour: number;
    providerRequestsPerHour: number;
    verifyPhoneAttemptsPerHour: number;
    verifyIpAttemptsPerHour: number;
    providerTimeoutMs: number;
    sendMode: EmployeeOtpSendMode;
    developmentFastPath: boolean;
    testingDeployment: boolean;
    locale: string;
    mockAccessKey: string | null;
    mockCode: string | null;
    sms123: Readonly<{
      apiKey: string | null;
      baseUrl: string;
      enabled: boolean;
      messagePrefix: string;
    }>;
  }>;
  session: Readonly<{
    cookieName: typeof EMPLOYEE_SESSION_COOKIE;
    expiresInSeconds: number;
    selectionExpiresInSeconds: number;
    activityTouchIntervalSeconds: number;
    secureCookie: boolean;
    allowConcurrentDevices: boolean;
  }>;
}>;

export function getEmployeeAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): EmployeeAuthConfig {
  const environment = normalizeEnvironment(env.NODE_ENV);
  const testingDeployment = readTestingDeployment(env);
  const authSecret = env.EMPLOYEE_AUTH_SECRET?.trim() ?? "";

  if (Buffer.byteLength(authSecret, "utf8") < 32) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_AUTH_SECRET must be at least 32 bytes.",
    );
  }

  const provider = normalizeProvider(
    env.SMS_PROVIDER ?? env.OTP_PROVIDER ?? env.EMPLOYEE_OTP_SEND_MODE,
    environment,
  );
  const channel = normalizeChannel(env.OTP_CHANNEL, provider);
  const sendMode: EmployeeOtpSendMode =
    provider === "mock" ? "mock" : "provider";
  const developmentFastPath =
    environment === "development" && sendMode === "mock";

  if (environment === "production" && provider === "mock") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "OTP mock mode is not available in production.",
    );
  }

  const mockCode = readMockCode(
    env.EMPLOYEE_OTP_MOCK_CODE,
    environment,
    sendMode,
  );
  assertOtpLength(env.OTP_LENGTH);
  const sms123 = readSms123Config(env, provider, environment);

  return {
    authSecret,
    environment,
    maxJsonBodyBytes: readInteger(
      env.EMPLOYEE_AUTH_MAX_JSON_BYTES,
      8_192,
      1_024,
      65_536,
      "EMPLOYEE_AUTH_MAX_JSON_BYTES",
    ),
    otp: {
      digits: EMPLOYEE_OTP_DIGITS,
      provider,
      channel,
      expiresInSeconds: readInteger(
        env.OTP_TTL_SECONDS ?? env.EMPLOYEE_OTP_EXPIRES_SECONDS,
        developmentFastPath ? 24 * 60 * 60 : 5 * 60,
        60,
        developmentFastPath ? 24 * 60 * 60 : 15 * 60,
        "OTP_TTL_SECONDS",
      ),
      maxAttempts: readInteger(
        env.OTP_MAX_VERIFY_ATTEMPTS ?? env.EMPLOYEE_OTP_MAX_ATTEMPTS,
        5,
        1,
        10,
        "OTP_MAX_VERIFY_ATTEMPTS",
      ),
      resendCooldownSeconds:
        developmentFastPath &&
        !env.OTP_RESEND_COOLDOWN_SECONDS &&
        !env.EMPLOYEE_OTP_RESEND_SECONDS
          ? 0
          : readInteger(
              env.OTP_RESEND_COOLDOWN_SECONDS ?? env.EMPLOYEE_OTP_RESEND_SECONDS,
              60,
              10,
              10 * 60,
              "OTP_RESEND_COOLDOWN_SECONDS",
            ),
      phoneRequestsPerHour: readInteger(
        env.EMPLOYEE_OTP_PHONE_HOURLY_LIMIT,
        5,
        1,
        50,
        "EMPLOYEE_OTP_PHONE_HOURLY_LIMIT",
      ),
      ipRequestsPerHour: readInteger(
        env.EMPLOYEE_OTP_IP_HOURLY_LIMIT,
        20,
        1,
        500,
        "EMPLOYEE_OTP_IP_HOURLY_LIMIT",
      ),
      deviceRequestsPerHour: readInteger(
        env.EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT,
        10,
        1,
        100,
        "EMPLOYEE_OTP_DEVICE_HOURLY_LIMIT",
      ),
      providerRequestsPerHour: readInteger(
        env.EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT,
        1_000,
        1,
        100_000,
        "EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT",
      ),
      verifyPhoneAttemptsPerHour: readInteger(
        env.STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT,
        10,
        1,
        100,
        "STAFF_OTP_VERIFY_PHONE_HOURLY_LIMIT",
      ),
      verifyIpAttemptsPerHour: readInteger(
        env.STAFF_OTP_VERIFY_IP_HOURLY_LIMIT,
        30,
        1,
        1_000,
        "STAFF_OTP_VERIFY_IP_HOURLY_LIMIT",
      ),
      providerTimeoutMs: readInteger(
        env.STAFF_OTP_PROVIDER_TIMEOUT_MS,
        10_000,
        1_000,
        30_000,
        "STAFF_OTP_PROVIDER_TIMEOUT_MS",
      ),
      sendMode,
      developmentFastPath,
      testingDeployment,
      locale: readLocale(env.EMPLOYEE_OTP_LOCALE),
      mockAccessKey: env.EMPLOYEE_OTP_MOCK_ACCESS_KEY?.trim() || null,
      mockCode,
      sms123,
    },
    session: {
      cookieName: EMPLOYEE_SESSION_COOKIE,
      allowConcurrentDevices: environment === "development",
      expiresInSeconds: readInteger(
        env.EMPLOYEE_SESSION_EXPIRES_SECONDS,
        7 * 24 * 60 * 60,
        5 * 60,
        30 * 24 * 60 * 60,
        "EMPLOYEE_SESSION_EXPIRES_SECONDS",
      ),
      selectionExpiresInSeconds: readInteger(
        env.EMPLOYEE_MEMBERSHIP_SELECTION_EXPIRES_SECONDS,
        5 * 60,
        60,
        15 * 60,
        "EMPLOYEE_MEMBERSHIP_SELECTION_EXPIRES_SECONDS",
      ),
      activityTouchIntervalSeconds: readInteger(
        env.EMPLOYEE_SESSION_TOUCH_INTERVAL_SECONDS,
        5 * 60,
        30,
        60 * 60,
        "EMPLOYEE_SESSION_TOUCH_INTERVAL_SECONDS",
      ),
      secureCookie: environment === "production",
    },
  };
}

function readMockCode(
  value: string | undefined,
  environment: EmployeeAuthConfig["environment"],
  sendMode: EmployeeOtpSendMode,
) {
  const code = value?.trim() ?? "";

  if (!code) {
    return environment === "development" && sendMode === "mock"
      ? "000000"
      : null;
  }

  if (
    environment === "production" ||
    sendMode !== "mock"
  ) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_OTP_MOCK_CODE is available only in non-production mock mode.",
    );
  }

  if (!/^\d{6}$/.test(code)) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_OTP_MOCK_CODE must contain exactly 6 digits.",
    );
  }

  return code;
}

function normalizeEnvironment(
  value: string | undefined,
): EmployeeAuthConfig["environment"] {
  if (value === "production" || value === "test") {
    return value;
  }

  return "development";
}

function normalizeProvider(
  value: string | undefined,
  environment: EmployeeAuthConfig["environment"],
): EmployeeOtpProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return environment === "production"
      ? "sms123"
      : "mock";
  }

  if (normalized === "mock") {
    return "mock";
  }

  if (normalized === "sms123" || normalized === "provider") {
    return "sms123";
  }

  throw new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "SMS_PROVIDER must be either mock or sms123.",
  );
}

function normalizeChannel(
  value: string | undefined,
  provider: EmployeeOtpProviderName,
): EmployeeOtpChannel {
  const normalized = value?.trim().toLowerCase();
  const fallback = provider === "mock" ? "local" : "sms";
  const channel = normalized || fallback;

  if (channel !== fallback) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      provider === "mock"
        ? "OTP_CHANNEL must be local when OTP_PROVIDER=mock."
        : "OTP_CHANNEL must be sms when SMS_PROVIDER=sms123.",
    );
  }

  return channel;
}

function readSms123Config(
  env: NodeJS.ProcessEnv,
  provider: EmployeeOtpProviderName,
  environment: EmployeeAuthConfig["environment"],
) {
  const apiKey = env.SMS123_API_KEY?.trim() || null;
  const enabledValue = env.SMS123_ENABLED?.trim().toLowerCase();
  if (enabledValue && enabledValue !== "true" && enabledValue !== "false") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "SMS123_ENABLED must be true or false when provided.",
    );
  }
  const enabled = enabledValue !== "false";
  const baseUrl = normalizeSms123BaseUrl(
    env.SMS123_API_BASE_URL?.trim() || "https://www.sms123.net/api",
    environment,
  );
  const messagePrefix = normalizeMessagePrefix(
    env.SMS123_MESSAGE_PREFIX?.trim() || "RM0",
  );

  if (provider === "sms123" && (!enabled || !apiKey)) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      enabled
        ? "SMS123_API_KEY is required when SMS_PROVIDER=sms123."
        : "SMS123 is disabled while SMS_PROVIDER=sms123.",
    );
  }

  return { apiKey, baseUrl, enabled, messagePrefix } as const;
}

function normalizeSms123BaseUrl(
  value: string,
  environment: EmployeeAuthConfig["environment"],
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "SMS123_API_BASE_URL must be a valid URL.",
    );
  }
  if (environment === "production" && url.protocol !== "https:") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "SMS123_API_BASE_URL must use HTTPS in production.",
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeMessagePrefix(value: string) {
  if (!/^[A-Za-z0-9]{1,12}$/.test(value)) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "SMS123_MESSAGE_PREFIX must contain 1 to 12 letters or digits.",
    );
  }
  return value;
}

function assertOtpLength(value: string | undefined) {
  if (value !== undefined && value.trim() !== String(EMPLOYEE_OTP_DIGITS)) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      `OTP_LENGTH must be ${EMPLOYEE_OTP_DIGITS}.`,
    );
  }
}

function readTestingDeployment(env: NodeJS.ProcessEnv) {
  const enabled = env.EMPLOYEE_OTP_TESTING_ENABLED?.trim().toLowerCase();
  if (!enabled) return false;
  if (enabled !== "true") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_OTP_TESTING_ENABLED must be true when provided.",
    );
  }
  if (env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "testing") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "Testing OTP is restricted to the Railway testing environment.",
    );
  }
  return true;
}

function readLocale(value: string | undefined) {
  const locale = value?.trim() || "en-MY";

  if (
    locale.length > 35 ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)
  ) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_OTP_LOCALE must be a valid locale identifier.",
    );
  }

  return locale;
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }

  return parsed;
}
