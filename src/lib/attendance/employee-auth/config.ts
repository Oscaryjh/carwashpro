import { EmployeeAuthError } from "./errors";

export const EMPLOYEE_SESSION_COOKIE = "tetamu_employee_session";
export const EMPLOYEE_OTP_DIGITS = 6;

export type EmployeeOtpProviderName = "mock" | "twilio_verify";
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
    twilio: Readonly<{
      accountSid: string | null;
      verifyServiceSid: string | null;
      apiKeySid: string | null;
      apiKeySecret: string | null;
      authToken: string | null;
    }>;
  }>;
  session: Readonly<{
    cookieName: typeof EMPLOYEE_SESSION_COOKIE;
    expiresInSeconds: number;
    selectionExpiresInSeconds: number;
    activityTouchIntervalSeconds: number;
    secureCookie: boolean;
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
    env.OTP_PROVIDER ?? env.EMPLOYEE_OTP_SEND_MODE,
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
  const twilio = readTwilioConfig(env, provider);

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
        env.EMPLOYEE_OTP_EXPIRES_SECONDS,
        developmentFastPath ? 24 * 60 * 60 : 5 * 60,
        60,
        developmentFastPath ? 24 * 60 * 60 : 15 * 60,
        "EMPLOYEE_OTP_EXPIRES_SECONDS",
      ),
      maxAttempts: readInteger(
        env.EMPLOYEE_OTP_MAX_ATTEMPTS,
        5,
        1,
        10,
        "EMPLOYEE_OTP_MAX_ATTEMPTS",
      ),
      resendCooldownSeconds:
        developmentFastPath && !env.EMPLOYEE_OTP_RESEND_SECONDS
          ? 0
          : readInteger(
              env.EMPLOYEE_OTP_RESEND_SECONDS,
              60,
              10,
              10 * 60,
              "EMPLOYEE_OTP_RESEND_SECONDS",
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
      twilio,
    },
    session: {
      cookieName: EMPLOYEE_SESSION_COOKIE,
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
      ? "twilio_verify"
      : "mock";
  }

  if (normalized === "mock") {
    return "mock";
  }

  if (normalized === "twilio_verify" || normalized === "provider") {
    return "twilio_verify";
  }

  throw new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "OTP_PROVIDER must be either mock or twilio_verify.",
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
        : "OTP_CHANNEL must be sms when OTP_PROVIDER=twilio_verify.",
    );
  }

  return channel;
}

function readTwilioConfig(
  env: NodeJS.ProcessEnv,
  provider: EmployeeOtpProviderName,
) {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() || null;
  const verifyServiceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim() || null;
  const apiKeySid = env.TWILIO_API_KEY_SID?.trim() || null;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET?.trim() || null;
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() || null;

  if (provider === "twilio_verify") {
    if (!accountSid || !/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "TWILIO_ACCOUNT_SID is required for Twilio Verify.",
      );
    }
    if (!verifyServiceSid || !/^VA[0-9a-fA-F]{32}$/.test(verifyServiceSid)) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "TWILIO_VERIFY_SERVICE_SID is required for Twilio Verify.",
      );
    }
    const hasApiKey = Boolean(apiKeySid && apiKeySecret);
    const hasAuthToken = Boolean(authToken);
    if (!hasApiKey && !hasAuthToken) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "Twilio Verify credentials are not configured.",
      );
    }
    if ((apiKeySid && !apiKeySecret) || (!apiKeySid && apiKeySecret)) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be configured together.",
      );
    }
    if (apiKeySid && !/^SK[0-9a-fA-F]{32}$/.test(apiKeySid)) {
      throw new EmployeeAuthError(
        "CONFIGURATION_ERROR",
        "TWILIO_API_KEY_SID is invalid.",
      );
    }
  }

  return {
    accountSid,
    verifyServiceSid,
    apiKeySid,
    apiKeySecret,
    authToken,
  } as const;
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
