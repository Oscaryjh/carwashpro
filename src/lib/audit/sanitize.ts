export type AuditJsonValue =
  | boolean
  | number
  | string
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apisecret",
  "authorization",
  "cookie",
  "credentials",
  "creds",
  "databaseurl",
  "documentbase64",
  "mediabase64",
  "newpassword",
  "password",
  "passwordhash",
  "rawmessagejson",
  "refreshtoken",
  "sessioncookie",
  "sessiontoken",
]);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

export function sanitizeAuditValue(value: unknown): AuditJsonValue | undefined {
  return sanitize(value, 0, new WeakSet<object>());
}

export function isSensitiveAuditKey(key: string) {
  return SENSITIVE_KEYS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): AuditJsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= MAX_DEPTH) {
    return "[MAX_DEPTH]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).flatMap((item) => {
      const sanitized = sanitize(item, depth + 1, seen);
      return sanitized === undefined ? [] : [sanitized];
    });
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    const output: Record<string, AuditJsonValue> = {};

    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveAuditKey(key)) {
        output[key] = "[REDACTED]";
        continue;
      }

      const sanitized = sanitize(item, depth + 1, seen);

      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}
