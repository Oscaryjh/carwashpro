import type {
  AttendanceAction,
  EmployeeAuthFlow,
  StaffApiErrorBody,
} from "./types";

const DEVICE_STORAGE_KEY = "tetamu.staff.device";
const AUTH_FLOW_STORAGE_KEY = "tetamu.staff.auth-flow";
const TENANT_STORAGE_PREFIX = "tetamu.staff.tenant.";

export class StaffApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "StaffApiError";
    this.code = code;
    this.status = status;
  }
}
type StaffApiFetchOptions = Readonly<{
  networkErrorMessage?: string;
}>;

export async function staffApiFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: StaffApiFetchOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(init?.body && !(typeof FormData !== "undefined" && init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new StaffApiError(
      "NETWORK_ERROR",
      options.networkErrorMessage ??
        "The Staff App cannot reach the server. Check your connection and try again.",
      0,
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | T
    | StaffApiErrorBody
    | null;
  const objectPayload =
    payload !== null && typeof payload === "object"
      ? payload
      : null;
  if (
    !response.ok ||
    !objectPayload ||
    ("ok" in objectPayload && objectPayload.ok === false)
  ) {
    const error =
      objectPayload && "error" in objectPayload
        ? (objectPayload as StaffApiErrorBody).error
        : {
            code: "REQUEST_FAILED",
            message: "Unable to complete the request.",
          };
    throw new StaffApiError(error.code, error.message, response.status);
  }

  return objectPayload as T;
}

export function getOrCreateDeviceIdentifier() {
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing && existing.length >= 16 && existing.length <= 256) {
    return existing;
  }

  const identifier = `${createBrowserUuid()}:${createBrowserUuid()}`;
  window.localStorage.setItem(DEVICE_STORAGE_KEY, identifier);
  return identifier;
}

export function getDeviceMetadata() {
  const userAgent = navigator.userAgent;
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    "Unknown platform";
  const browser = detectBrowser(userAgent);

  return {
    displayName: `${platform} · ${browser}`.slice(0, 100),
    platform: platform.slice(0, 100),
    browser: browser.slice(0, 100),
  };
}

export function readEmployeeAuthFlow(): EmployeeAuthFlow | null {
  const value = window.sessionStorage.getItem(AUTH_FLOW_STORAGE_KEY);
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as EmployeeAuthFlow;
    return parsed.challengeId &&
      parsed.deviceIdentifier &&
      Number.isFinite(parsed.expiresAt)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveEmployeeAuthFlow(flow: EmployeeAuthFlow) {
  window.sessionStorage.setItem(AUTH_FLOW_STORAGE_KEY, JSON.stringify(flow));
}

export function clearEmployeeAuthFlow() {
  window.sessionStorage.removeItem(AUTH_FLOW_STORAGE_KEY);
}

export function clearStaffTenantClientState() {
  clearEmployeeAuthFlow();
  removeStorageKeysWithPrefix(window.sessionStorage, TENANT_STORAGE_PREFIX);
  removeStorageKeysWithPrefix(window.localStorage, TENANT_STORAGE_PREFIX);
}

function removeStorageKeysWithPrefix(storage: Storage, prefix: string) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function maskPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) {
    return "••••";
  }
  return `•••• ${digits.slice(-4)}`;
}

export function formatPhoneForConfirmation(value: string) {
  const digits = value.replace(/\D/g, "");
  const malaysiaNumber = digits.startsWith("60")
    ? digits.slice(2)
    : digits.startsWith("0")
      ? digits.slice(1)
      : "";

  if (malaysiaNumber.length === 10) {
    return `+60 ${malaysiaNumber.slice(0, 2)} ${malaysiaNumber.slice(2, 6)} ${malaysiaNumber.slice(6)}`;
  }
  if (malaysiaNumber.length === 9) {
    return `+60 ${malaysiaNumber.slice(0, 2)} ${malaysiaNumber.slice(2, 5)} ${malaysiaNumber.slice(5)}`;
  }

  return value.trim();
}

export function createAttendanceIdempotencyKey(action: AttendanceAction) {
  return `staff-pwa:${action.toLowerCase()}:${createBrowserUuid()}`;
}

export function attendanceActionLabel(action: AttendanceAction) {
  switch (action) {
    case "CLOCK_IN":
      return "Clock In";
    case "BREAK_START":
      return "Start Break";
    case "BREAK_END":
      return "End Break";
    case "CLOCK_OUT":
      return "Clock Out";
  }
}

export function attendanceConfirmation(action: AttendanceAction) {
  switch (action) {
    case "CLOCK_IN":
      return "Confirm starting work at the current branch?";
    case "CLOCK_OUT":
      return "Confirm ending today’s work?";
    case "BREAK_START":
      return "Start your break now?";
    case "BREAK_END":
      return "End your break and return to work?";
  }
}

export function wasBreakEndedRecently(input: {
  lastBreakEndedAt: string | null;
  serverTime: string;
  thresholdSeconds?: number;
}) {
  if (!input.lastBreakEndedAt) return false;
  const endedAt = Date.parse(input.lastBreakEndedAt);
  const serverTime = Date.parse(input.serverTime);
  const thresholdSeconds = input.thresholdSeconds ?? 60;
  if (
    !Number.isFinite(endedAt) ||
    !Number.isFinite(serverTime) ||
    !Number.isFinite(thresholdSeconds) ||
    thresholdSeconds < 0
  ) {
    return false;
  }
  const elapsedMilliseconds = serverTime - endedAt;
  return (
    elapsedMilliseconds >= 0 &&
    elapsedMilliseconds <= thresholdSeconds * 1_000
  );
}

export function isEmployeeSessionError(code: string) {
  return [
    "UNAUTHENTICATED",
    "SESSION_EXPIRED",
    "SESSION_REVOKED",
    "DEVICE_REVOKED",
    "EMPLOYEE_INACTIVE",
    "ATTENDANCE_DISABLED",
  ].includes(code);
}

export function gpsStatusLabel(status: string | null) {
  switch (status) {
    case "INSIDE":
      return "Inside Work Location";
    case "OUTSIDE":
      return "Outside Work Location";
    case "GPS_INACCURATE":
      return "GPS Inaccurate";
    case "GPS_UNAVAILABLE":
      return "GPS Unavailable";
    case "GEOFENCE_DISABLED":
      return "Geofence Disabled";
    default:
      return "Not checked";
  }
}

export function formatMinutesAsHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.max(0, minutes % 60);
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

export function createBrowserUuid(
  cryptoApi: Pick<Crypto, "getRandomValues"> &
    Partial<Pick<Crypto, "randomUUID">> = crypto,
) {
  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  );

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function detectBrowser(userAgent: string) {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/CriOS\//.test(userAgent)) return "Chrome iOS";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/FxiOS\//.test(userAgent)) return "Firefox iOS";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Browser";
}

declare global {
  interface Navigator {
    userAgentData?: {
      platform?: string;
    };
  }
}
