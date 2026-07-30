import { EmployeeAuthError } from "./errors";

export const EMPLOYEE_SESSION_COOKIE = "tetamu_employee_session";
export const EMPLOYEE_OTP_DIGITS = 6;

export type EmployeeOtpSendMode = "mock" | "provider";

export type EmployeeAuthConfig = Readonly<{
  authSecret: string;
  environment: "development" | "test" | "production";
  maxJsonBodyBytes: number;
  otp: Readonly<{
    digits: typeof EMPLOYEE_OTP_DIGITS;
    expiresInSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    phoneRequestsPerHour: number;
    ipRequestsPerHour: number;
    deviceRequestsPerHour: number;
    providerRequestsPerHour: number;
    sendMode: EmployeeOtpSendMode;
    locale: string;
    mockAccessKey: string | null;
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
  const authSecret = env.EMPLOYEE_AUTH_SECRET?.trim() ?? "";

  if (Buffer.byteLength(authSecret, "utf8") < 32) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "EMPLOYEE_AUTH_SECRET must be at least 32 bytes.",
    );
  }

  const sendMode = normalizeSendMode(
    env.EMPLOYEE_OTP_SEND_MODE,
    environment,
  );

  if (environment === "production" && sendMode === "mock") {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "OTP mock mode is not available in production.",
    );
  }

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
      expiresInSeconds: readInteger(
        env.EMPLOYEE_OTP_EXPIRES_SECONDS,
        5 * 60,
        60,
        15 * 60,
        "EMPLOYEE_OTP_EXPIRES_SECONDS",
      ),
      maxAttempts: readInteger(
        env.EMPLOYEE_OTP_MAX_ATTEMPTS,
        5,
        1,
        10,
        "EMPLOYEE_OTP_MAX_ATTEMPTS",
      ),
      resendCooldownSeconds: readInteger(
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
      sendMode,
      locale: readLocale(env.EMPLOYEE_OTP_LOCALE),
      mockAccessKey: env.EMPLOYEE_OTP_MOCK_ACCESS_KEY?.trim() || null,
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

function normalizeEnvironment(
  value: string | undefined,
): EmployeeAuthConfig["environment"] {
  if (value === "production" || value === "test") {
    return value;
  }

  return "development";
}

function normalizeSendMode(
  value: string | undefined,
  environment: EmployeeAuthConfig["environment"],
): EmployeeOtpSendMode {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return environment === "production" ? "provider" : "mock";
  }

  if (normalized === "mock" || normalized === "provider") {
    return normalized;
  }

  throw new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "EMPLOYEE_OTP_SEND_MODE must be either mock or provider.",
  );
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
