import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PASSWORD_LOGIN_SURFACE = "PASSWORD_LOGIN";
export const PASSWORD_LOGIN_WINDOW_MS = 15 * 60 * 1_000;
export const PASSWORD_LOGIN_IDENTIFIER_LIMIT = 5;
export const PASSWORD_LOGIN_IP_LIMIT = 25;
export const PASSWORD_LOGIN_COMBINATION_LIMIT = 5;
export const SENSITIVE_ACTION_STEP_UP_SURFACE = "SENSITIVE_ACTION_STEP_UP";
export const SENSITIVE_ACTION_STEP_UP_WINDOW_MS = 15 * 60 * 1_000;
export const SENSITIVE_ACTION_STEP_UP_SCOPE_LIMIT = 5;
export const SENSITIVE_ACTION_STEP_UP_USER_LIMIT = 10;
export const SENSITIVE_ACTION_STEP_UP_IP_LIMIT = 25;
export const MFA_SECURITY_SURFACE = "MFA_SECURITY";
export const MFA_VERIFY_WINDOW_MS = 15 * 60 * 1_000;
export const MFA_VERIFY_SESSION_LIMIT = 5;
export const MFA_VERIFY_CREDENTIAL_LIMIT = 5;
export const MFA_VERIFY_USER_LIMIT = 10;
export const MFA_VERIFY_IP_LIMIT = 25;

export type AuthRequestContext = Readonly<{
  ipAddress: string | null;
  userAgent: string | null;
}>;

type HeaderReader = Readonly<{
  get(name: string): string | null;
}>;

type AuthSecurityDatabase = Pick<PrismaClient, "authSecurityEvent">;
type AuthSecurityTransaction = Pick<
  Prisma.TransactionClient,
  "authSecurityEvent" | "$queryRaw"
>;

export type AuthSecurityEventInput = Readonly<{
  eventType: string;
  surface: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "RATE_LIMITED";
  identifierHash?: string | null;
  ipAddressHash?: string | null;
  userAgentHash?: string | null;
  userId?: string | null;
  businessId?: string | null;
  sessionId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  createdAt?: Date;
}>;

export function getAuthRequestContext(
  requestHeaders: HeaderReader,
  env: NodeJS.ProcessEnv = process.env,
): AuthRequestContext {
  const trustedProxyHops = readTrustedProxyHops(env.AUTH_TRUST_PROXY_HOPS);
  const userAgent = requestHeaders.get("user-agent")?.trim().slice(0, 512) || null;

  if (trustedProxyHops === 0) {
    return { ipAddress: null, userAgent };
  }

  const forwarded = (requestHeaders.get("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => normalizeIpAddress(value))
    .filter((value): value is string => value !== null);
  const forwardedIndex = forwarded.length - trustedProxyHops;
  const ipAddress =
    (forwardedIndex >= 0 ? forwarded[forwardedIndex] : null) ??
    normalizeIpAddress(requestHeaders.get("x-real-ip"));

  return { ipAddress, userAgent };
}

export function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new Error("AUTH_CROSS_SITE_REQUEST");
  }

  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestUrl = new URL(request.url);
  const suppliedOrigin = new URL(origin).origin;
  const host = request.headers.get("host")?.trim();
  const requestOrigin = host
    ? new URL(`${requestUrl.protocol}//${host}`).origin
    : requestUrl.origin;

  if (requestOrigin !== suppliedOrigin) {
    throw new Error("AUTH_CROSS_SITE_REQUEST");
  }
}

export function assertServerActionSameOrigin(requestHeaders: HeaderReader) {
  const fetchSite = requestHeaders.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new Error("AUTH_CROSS_SITE_REQUEST");
  }
  const origin = requestHeaders.get("origin");
  if (!origin) return;
  const host = requestHeaders.get("host")?.trim().toLowerCase();
  if (!host || new URL(origin).host.toLowerCase() !== host) {
    throw new Error("AUTH_CROSS_SITE_REQUEST");
  }
}

export function hashAuthSecurityValue(purpose: string, value: string | null) {
  if (!value) return null;
  return createHmac("sha256", getAuthSecuritySecret())
    .update(`${purpose}\0${value}`)
    .digest("hex");
}

export function authSecurityHashes(input: {
  identifier?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return {
    identifierHash: hashAuthSecurityValue(
      "identifier",
      input.identifier?.trim().toLowerCase() ?? null,
    ),
    ipAddressHash: hashAuthSecurityValue("ip", input.ipAddress ?? null),
    userAgentHash: hashAuthSecurityValue(
      "user-agent",
      input.userAgent ?? null,
    ),
  };
}

export async function writeAuthSecurityEvent(
  input: AuthSecurityEventInput,
  database: AuthSecurityDatabase = prisma,
) {
  return database.authSecurityEvent.create({
    data: {
      eventType: input.eventType,
      surface: input.surface,
      outcome: input.outcome,
      identifierHash: input.identifierHash ?? null,
      ipAddressHash: input.ipAddressHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      userId: input.userId ?? null,
      businessId: input.businessId ?? null,
      sessionId: input.sessionId ?? null,
      reason: input.reason?.slice(0, 200) ?? null,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export async function tryWriteAuthSecurityEvent(
  input: AuthSecurityEventInput,
  database: AuthSecurityDatabase = prisma,
) {
  try {
    await writeAuthSecurityEvent(input, database);
  } catch (error) {
    console.error("[auth-security] Unable to persist security event", {
      eventType: input.eventType,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function acquirePasswordLoginRateLimitLocks(
  hashes: Pick<
    ReturnType<typeof authSecurityHashes>,
    "identifierHash" | "ipAddressHash"
  >,
  transaction: AuthSecurityTransaction,
) {
  const keys = [
    hashes.identifierHash
      ? `password-login:identifier:${hashes.identifierHash}`
      : null,
    hashes.ipAddressHash ? `password-login:ip:${hashes.ipAddressHash}` : null,
    hashes.identifierHash && hashes.ipAddressHash
      ? `password-login:combination:${hashes.identifierHash}:${hashes.ipAddressHash}`
      : null,
  ]
    .filter((value): value is string => value !== null)
    .sort();

  if (keys.length === 0) {
    keys.push("password-login:unidentified");
  }

  for (const key of keys) {
    await transaction.$queryRaw<Array<{ acquired: string }>>(
      Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${key}, 0)
        )::text AS acquired
      `,
    );
  }
}

export async function checkPasswordLoginRateLimit(
  input: {
    identifierHash: string | null;
    ipAddressHash: string | null;
    now: Date;
  },
  database: AuthSecurityDatabase,
) {
  const since = new Date(input.now.getTime() - PASSWORD_LOGIN_WINDOW_MS);
  const baseWhere = {
    surface: PASSWORD_LOGIN_SURFACE,
    eventType: "LOGIN_FAILED",
    createdAt: { gte: since },
  } satisfies Prisma.AuthSecurityEventWhereInput;

  const [identifierFailures, ipFailures, combinationFailures] =
    await Promise.all([
      input.identifierHash
        ? database.authSecurityEvent.count({
            where: { ...baseWhere, identifierHash: input.identifierHash },
          })
        : Promise.resolve(0),
      input.ipAddressHash
        ? database.authSecurityEvent.count({
            where: { ...baseWhere, ipAddressHash: input.ipAddressHash },
          })
        : Promise.resolve(0),
      input.identifierHash && input.ipAddressHash
        ? database.authSecurityEvent.count({
            where: {
              ...baseWhere,
              identifierHash: input.identifierHash,
              ipAddressHash: input.ipAddressHash,
            },
          })
        : Promise.resolve(0),
    ]);

  const reasons = [
    identifierFailures >= PASSWORD_LOGIN_IDENTIFIER_LIMIT
      ? "IDENTIFIER"
      : null,
    ipFailures >= PASSWORD_LOGIN_IP_LIMIT ? "IP" : null,
    combinationFailures >= PASSWORD_LOGIN_COMBINATION_LIMIT
      ? "COMBINATION"
      : null,
  ].filter((value): value is string => value !== null);

  return {
    allowed: reasons.length === 0,
    reasons,
  } as const;
}

export function sensitiveActionRateLimitHashes(input: {
  userId: string;
  sessionId: string;
  actionKey: string;
  resourceType: string;
  resourceId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  return {
    identifierHash: hashAuthSecurityValue(
      "step-up-scope",
      `${input.userId}:${input.sessionId}:${input.actionKey}:${input.resourceType}:${input.resourceId}`,
    ),
    ipAddressHash: hashAuthSecurityValue("ip", input.ipAddress),
    userAgentHash: hashAuthSecurityValue("user-agent", input.userAgent),
  };
}

export async function acquireSensitiveActionRateLimitLocks(
  input: {
    userId: string;
    identifierHash: string;
    ipAddressHash: string | null;
  },
  transaction: AuthSecurityTransaction,
) {
  const keys = [
    `step-up:user:${input.userId}`,
    `step-up:scope:${input.identifierHash}`,
    input.ipAddressHash ? `step-up:ip:${input.ipAddressHash}` : null,
  ]
    .filter((value): value is string => value !== null)
    .sort();

  for (const key of keys) {
    await transaction.$queryRaw<Array<{ acquired: string }>>(
      Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${key}, 0)
        )::text AS acquired
      `,
    );
  }
}

export async function checkSensitiveActionRateLimit(
  input: {
    userId: string;
    identifierHash: string;
    ipAddressHash: string | null;
    now: Date;
  },
  database: AuthSecurityDatabase,
) {
  const since = new Date(
    input.now.getTime() - SENSITIVE_ACTION_STEP_UP_WINDOW_MS,
  );
  const baseWhere = {
    surface: SENSITIVE_ACTION_STEP_UP_SURFACE,
    eventType: "STEP_UP_FAILED",
    createdAt: { gte: since },
  } satisfies Prisma.AuthSecurityEventWhereInput;
  const [scopeFailures, userFailures, ipFailures] = await Promise.all([
    database.authSecurityEvent.count({
      where: { ...baseWhere, identifierHash: input.identifierHash },
    }),
    database.authSecurityEvent.count({
      where: { ...baseWhere, userId: input.userId },
    }),
    input.ipAddressHash
      ? database.authSecurityEvent.count({
          where: { ...baseWhere, ipAddressHash: input.ipAddressHash },
        })
      : Promise.resolve(0),
  ]);
  const reasons = [
    scopeFailures >= SENSITIVE_ACTION_STEP_UP_SCOPE_LIMIT ? "SCOPE" : null,
    userFailures >= SENSITIVE_ACTION_STEP_UP_USER_LIMIT ? "USER" : null,
    ipFailures >= SENSITIVE_ACTION_STEP_UP_IP_LIMIT ? "IP" : null,
  ].filter((value): value is string => value !== null);
  return { allowed: reasons.length === 0, reasons } as const;
}

export function mfaRateLimitHashes(input: {
  userId: string;
  sessionId: string;
  credentialId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  return {
    identifierHash: hashAuthSecurityValue(
      "mfa-credential",
      input.credentialId ?? `${input.userId}:${input.sessionId}`,
    ),
    ipAddressHash: hashAuthSecurityValue("ip", input.ipAddress),
    userAgentHash: hashAuthSecurityValue("user-agent", input.userAgent),
  };
}

export async function acquireMfaRateLimitLocks(
  input: {
    userId: string;
    sessionId: string;
    identifierHash: string;
    ipAddressHash: string | null;
  },
  transaction: AuthSecurityTransaction,
) {
  const keys = [
    `mfa:user:${input.userId}`,
    `mfa:session:${input.sessionId}`,
    `mfa:credential:${input.identifierHash}`,
    input.ipAddressHash ? `mfa:ip:${input.ipAddressHash}` : null,
  ]
    .filter((value): value is string => value !== null)
    .sort();
  for (const key of keys) {
    await transaction.$queryRaw(
      Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${key}, 0)
        )::text AS acquired
      `,
    );
  }
}

export async function checkMfaRateLimit(
  input: {
    userId: string;
    sessionId: string;
    identifierHash: string;
    ipAddressHash: string | null;
    now: Date;
  },
  database: AuthSecurityDatabase,
) {
  const since = new Date(input.now.getTime() - MFA_VERIFY_WINDOW_MS);
  const baseWhere = {
    surface: MFA_SECURITY_SURFACE,
    eventType: "MFA_VERIFICATION_FAILED",
    createdAt: { gte: since },
  } satisfies Prisma.AuthSecurityEventWhereInput;
  const [sessionFailures, credentialFailures, userFailures, ipFailures] =
    await Promise.all([
      database.authSecurityEvent.count({
        where: { ...baseWhere, sessionId: input.sessionId },
      }),
      database.authSecurityEvent.count({
        where: { ...baseWhere, identifierHash: input.identifierHash },
      }),
      database.authSecurityEvent.count({
        where: { ...baseWhere, userId: input.userId },
      }),
      input.ipAddressHash
        ? database.authSecurityEvent.count({
            where: { ...baseWhere, ipAddressHash: input.ipAddressHash },
          })
        : Promise.resolve(0),
    ]);
  const reasons = [
    sessionFailures >= MFA_VERIFY_SESSION_LIMIT ? "SESSION" : null,
    credentialFailures >= MFA_VERIFY_CREDENTIAL_LIMIT ? "CREDENTIAL" : null,
    userFailures >= MFA_VERIFY_USER_LIMIT ? "USER" : null,
    ipFailures >= MFA_VERIFY_IP_LIMIT ? "IP" : null,
  ].filter((value): value is string => value !== null);
  return { allowed: reasons.length === 0, reasons } as const;
}

function getAuthSecuritySecret() {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return secret;
}

function readTrustedProxyHops(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer from 0 to 5.");
  }
  return parsed;
}

function normalizeIpAddress(value: string | null) {
  if (!value) return null;
  let candidate = value.trim().toLowerCase();
  if (!candidate || candidate.length > 128) return null;

  if (candidate.startsWith("[")) {
    const closing = candidate.indexOf("]");
    candidate = closing > 0 ? candidate.slice(1, closing) : candidate;
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (candidate.startsWith("::ffff:")) {
    const mapped = candidate.slice("::ffff:".length);
    if (isIP(mapped) === 4) return mapped;
  }

  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;

  try {
    return new URL(`http://[${candidate}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}
