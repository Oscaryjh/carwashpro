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
  "accountnumber",
  "accountnumberciphertext",
  "bankaccountnumber",
  "bankaccountnumberciphertext",
  "authorization",
  "cookie",
  "credentials",
  "creds",
  "ciphertext",
  "authenticationtag",
  "initializationvector",
  "encryptionkey",
  "encryptionkeys",
  "databaseurl",
  "devicefingerprint",
  "devicefingerprinthash",
  "deviceidentifier",
  "deviceidentifierhash",
  "documentbase64",
  "mediabase64",
  "objectkey",
  "storagekey",
  "storageobjectkey",
  "storagebucket",
  "storageendpoint",
  "s3bucket",
  "s3endpoint",
  "privateurl",
  "signedurl",
  "attachmenturl",
  "downloadurl",
  "originalfilename",
  "newpassword",
  "otp",
  "otpcode",
  "otphash",
  "password",
  "passwordhash",
  "phonenumber",
  "phonenumbernormalized",
  "rawmessagejson",
  "refreshtoken",
  "sessioncookie",
  "sessiontoken",
  "basesalary",
  "baserate",
  "baseratesnapshot",
  "salary",
  "monthlysalary",
  "dailyrate",
  "hourlyrate",
  "basicpay",
  "leavepay",
  "overtimepay",
  "publicholidaypay",
  "allowances",
  "otherdeductions",
  "grosspay",
  "netpay",
  "epfwagebase",
  "perkesowagebase",
  "epfemployee",
  "employerepf",
  "socsoemployee",
  "employersocso",
  "eisemployee",
  "employereis",
  "lindung24employee",
  "pcb",
  "identitynumber",
  "icnumber",
  "dateofbirth",
  "passportnumber",
  "taxidentificationnumber",
  "taxnumber",
  "tin",
  "epfnumber",
  "epfmembernumber",
  "employerepfnumber",
  "socsonumber",
  "socsomembernumber",
  "eisnumber",
  "employereisnumber",
  "pcbnumber",
  "statutoryidentitynumber",
  "documentnumber",

]);
const FREE_TEXT_KEYS = new Set([
  "notes",
  "overridereason",
  "reason",
  "rejectionreason",
  "reviewnote",
]);
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

export function sanitizeAuditValue(value: unknown): AuditJsonValue | undefined {
  return sanitize(value, 0, new WeakSet<object>());
}

export function isSensitiveAuditKey(key: string) {
  const normalized = normalizeKey(key);
  if (normalized.endsWith("masked")) {
    return false;
  }

  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("accountnumber") ||
    normalized.endsWith("identitynumber") ||
    normalized.endsWith("membernumber") ||
    normalized.endsWith("passportnumber") ||
    normalized.endsWith("taxidentificationnumber")
  );
}

export function sanitizeAuditReason(value: string) {
  return value
    .trim()
    .slice(0, 500)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\bRM\s*\d[\d,.]*/gi, "RM [REDACTED_AMOUNT]")
    .replace(/\b\d(?:[\s./-]?\d){5,}\b/g, "[REDACTED_NUMBER]")
    .replace(
      /\b(?=[A-Z0-9-]{8,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/gi,
      "[REDACTED_IDENTIFIER]",
    );
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

      if (
        typeof item === "string" &&
        FREE_TEXT_KEYS.has(normalizeKey(key))
      ) {
        output[key] = sanitizeAuditReason(item);
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

function normalizeKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
