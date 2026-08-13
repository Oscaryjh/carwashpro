import type {
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { AuthRequestContext } from "./security";
import {
  authSecurityHashes,
  writeAuthSecurityEvent,
} from "./security";

export const SESSION_COOKIE = "car_wash_session";
export const SESSION_IDLE_SECONDS = 60 * 60 * 12;
export const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_TOUCH_INTERVAL_SECONDS = 60 * 5;
export const SESSION_CONTEXT_VERSION = 1;

export type AppSession = {
  userId: string;
  sessionId?: string | null;
  homeBusinessId: string | null;
  activeBusinessId: string | null;
  contextVersion: number;
  /** Compatibility alias. Never use this claim as database authority. */
  businessId: string | null;
  industryType?: string | null;
  branchId?: string | null;
  name: string;
  email: string;
  role: UserRole;
  permissions: string[];
  status: UserStatus;
};

export type CreateSessionInput = Omit<AppSession, "businessId"> & {
  businessId?: string | null;
};

type AppSessionDatabase = Pick<
  PrismaClient,
  "authSession" | "authSecurityEvent" | "business"
>;
type AppSessionTransaction = Pick<
  Prisma.TransactionClient,
  "authSession" | "authSecurityEvent" | "business"
>;

type SessionWriteOptions = Readonly<{
  database?: AppSessionDatabase | AppSessionTransaction;
  request?: AuthRequestContext;
  now?: Date;
}>;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(
  session: CreateSessionInput,
  options: SessionWriteOptions = {},
) {
  const stored = await persistSessionContext(session, options);
  const token = await createSessionToken(
    { ...session, sessionId: stored.id },
    { absoluteExpiresAt: stored.absoluteExpiresAt },
  );
  await setSessionCookie(
    token,
    Math.max(
      0,
      Math.ceil(
        (stored.absoluteExpiresAt.getTime() -
          (options.now ?? new Date()).getTime()) /
          1_000,
      ),
    ),
  );
}

export async function persistSessionContext(
  session: CreateSessionInput,
  options: SessionWriteOptions = {},
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const sessionId = session.sessionId;
  if (!sessionId) {
    throw new Error("Authenticated sessions require a sessionId.");
  }

  const hashes = authSecurityHashes({
    ipAddress: options.request?.ipAddress,
    userAgent: options.request?.userAgent,
  });
  const existing = await database.authSession.findUnique({
    where: { id: sessionId },
  });

  if (existing) {
    if (existing.userId !== session.userId || existing.revokedAt) {
      throw new Error("The authenticated session cannot be reused.");
    }
    return database.authSession.update({
      where: { id: sessionId },
      data: {
        activeBusinessId: session.activeBusinessId,
        branchId: session.branchId ?? null,
        contextVersion: session.contextVersion,
        lastActiveAt: now,
        idleExpiresAt: minDate(
          new Date(now.getTime() + SESSION_IDLE_SECONDS * 1_000),
          existing.absoluteExpiresAt,
        ),
      },
    });
  }

  const absoluteExpiresAt = new Date(
    now.getTime() + SESSION_ABSOLUTE_SECONDS * 1_000,
  );
  const created = await database.authSession.create({
    data: {
      id: sessionId,
      userId: session.userId,
      activeBusinessId: session.activeBusinessId,
      branchId: session.branchId ?? null,
      contextVersion: session.contextVersion,
      absoluteExpiresAt,
      idleExpiresAt: minDate(
        new Date(now.getTime() + SESSION_IDLE_SECONDS * 1_000),
        absoluteExpiresAt,
      ),
      lastActiveAt: now,
      ipAddressHash: hashes.ipAddressHash,
      userAgentHash: hashes.userAgentHash,
      createdAt: now,
    },
  });

  await writeAuthSecurityEvent(
    {
      eventType: "SESSION_CREATED",
      surface: "APP_SESSION",
      outcome: "SUCCESS",
      ...hashes,
      userId: session.userId,
      businessId: session.activeBusinessId,
      sessionId,
      createdAt: now,
    },
    database,
  );
  return created;
}

export async function createSessionToken(
  session: CreateSessionInput,
  options: { absoluteExpiresAt?: Date } = {},
) {
  const normalizedSession = normalizeSession({
    ...session,
    businessId: session.activeBusinessId,
  });
  const expiresAt =
    options.absoluteExpiresAt ??
    new Date(Date.now() + SESSION_ABSOLUTE_SECONDS * 1_000);
  let signer = new SignJWT(normalizedSession)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000));
  if (session.sessionId) {
    signer = signer.setJti(session.sessionId);
  }
  return signer.sign(getSecret());
}

export async function setSessionCookie(
  token: string,
  maxAge = SESSION_ABSOLUTE_SECONDS,
) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
}

export function sessionCookieOptions(
  maxAge = SESSION_ABSOLUTE_SECONDS,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload?.sessionId) return null;

  const now = new Date();
  const stored = await prisma.authSession.findUnique({
    where: { id: payload.sessionId },
    include: {
      user: {
        select: {
          id: true,
          businessId: true,
          branchId: true,
          name: true,
          email: true,
          role: true,
          permissions: true,
          status: true,
          loginEnabled: true,
        },
      },
    },
  });

  if (!stored || !isStoredSessionUsable(stored, payload, now)) {
    return null;
  }
  if (!stored.user.email) {
    return null;
  }

  if (
    now.getTime() - stored.lastActiveAt.getTime() >=
    SESSION_TOUCH_INTERVAL_SECONDS * 1_000
  ) {
    await prisma.authSession.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
        idleExpiresAt: { gt: now },
      },
      data: {
        lastActiveAt: now,
        idleExpiresAt: minDate(
          new Date(now.getTime() + SESSION_IDLE_SECONDS * 1_000),
          stored.absoluteExpiresAt,
        ),
      },
    });
  }

  const activeBusiness = stored.activeBusinessId
    ? await prisma.business.findUnique({
        where: { id: stored.activeBusinessId },
        select: { id: true, industryType: true, status: true },
      })
    : null;
  if (
    stored.activeBusinessId &&
    (!activeBusiness || activeBusiness.status !== "active")
  ) {
    return null;
  }

  return {
    ...payload,
    userId: stored.user.id,
    homeBusinessId: stored.user.businessId,
    activeBusinessId: stored.activeBusinessId,
    businessId: stored.activeBusinessId,
    branchId: stored.branchId,
    industryType: activeBusiness?.industryType ?? null,
    name: stored.user.name,
    email: stored.user.email,
    role: stored.user.role,
    permissions: stored.user.permissions,
    status: stored.user.status,
  } satisfies AppSession;
}

export async function destroySession(options: { reason?: string } = {}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  const now = new Date();

  if (payload?.sessionId) {
    const revoked = await prisma.authSession.updateMany({
      where: { id: payload.sessionId, userId: payload.userId, revokedAt: null },
      data: {
        revokedAt: now,
        revokeReason: (options.reason ?? "User logged out.").slice(0, 500),
      },
    });
    if (revoked.count === 1) {
      await writeAuthSecurityEvent({
        eventType: "SESSION_REVOKED",
        surface: "APP_SESSION",
        outcome: "SUCCESS",
        userId: payload.userId,
        businessId: payload.activeBusinessId,
        sessionId: payload.sessionId,
        reason: "LOGOUT",
        createdAt: now,
      });
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function revokeUserSessions(
  userId: string,
  reason: string,
  database: Pick<
    Prisma.TransactionClient,
    "authSession" | "sensitiveActionAuthorization"
  > | PrismaClient = prisma,
  now = new Date(),
) {
  const [sessions] = await Promise.all([
    database.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: reason.slice(0, 500) },
    }),
    database.sensitiveActionAuthorization.updateMany({
      where: { userId, consumedAt: null, revokedAt: null },
      data: {
        revokedAt: now,
        revokeReason: "USER_SESSIONS_REVOKED",
      },
    }),
  ]);
  return sessions;
}

export function isStoredSessionUsable(
  stored: {
    userId: string;
    activeBusinessId: string | null;
    branchId: string | null;
    contextVersion: number;
    absoluteExpiresAt: Date;
    idleExpiresAt: Date;
    revokedAt: Date | null;
    user: {
      id: string;
      status: UserStatus;
      loginEnabled: boolean;
      email: string | null;
    };
  },
  payload: AppSession,
  now: Date,
) {
  return (
    stored.userId === payload.userId &&
    stored.activeBusinessId === payload.activeBusinessId &&
    stored.branchId === (payload.branchId ?? null) &&
    stored.contextVersion === payload.contextVersion &&
    !stored.revokedAt &&
    stored.absoluteExpiresAt.getTime() > now.getTime() &&
    stored.idleExpiresAt.getTime() > now.getTime() &&
    stored.user.id === stored.userId &&
    stored.user.status === "active" &&
    stored.user.loginEnabled &&
    Boolean(stored.user.email)
  );
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function normalizeSession(payload: Record<string, unknown>): AppSession {
  const legacyBusinessId = nullableString(payload.businessId);
  const homeBusinessId = hasOwn(payload, "homeBusinessId")
    ? nullableString(payload.homeBusinessId)
    : legacyBusinessId;
  const activeBusinessId = hasOwn(payload, "activeBusinessId")
    ? nullableString(payload.activeBusinessId)
    : legacyBusinessId;
  const rawContextVersion = payload.contextVersion;
  const contextVersion =
    typeof rawContextVersion === "number" &&
    Number.isSafeInteger(rawContextVersion) &&
    rawContextVersion > 0
      ? rawContextVersion
      : SESSION_CONTEXT_VERSION;

  return {
    userId: requiredString(payload.userId, "userId"),
    sessionId: nullableString(payload.sessionId),
    homeBusinessId,
    activeBusinessId,
    contextVersion,
    businessId: activeBusinessId,
    industryType: nullableString(payload.industryType),
    branchId: nullableString(payload.branchId),
    name: requiredString(payload.name, "name"),
    email: requiredString(payload.email, "email"),
    role: requiredUserRole(payload.role),
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.filter(
          (permission): permission is string => typeof permission === "string",
        )
      : [],
    status: requiredUserStatus(payload.status),
  };
}

async function verifySessionToken(token: string) {
  try {
    const verified = await jwtVerify(token, getSecret());
    return normalizeSession(verified.payload);
  } catch {
    return null;
  }
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid session ${field}.`);
  }
  return value;
}

function requiredUserRole(value: unknown): UserRole {
  if (
    value !== "PLATFORM_ADMIN" &&
    value !== "BUSINESS_OWNER" &&
    value !== "STAFF"
  ) {
    throw new Error("Invalid session role.");
  }
  return value;
}

function requiredUserStatus(value: unknown): UserStatus {
  if (value !== "active" && value !== "inactive") {
    throw new Error("Invalid session status.");
  }
  return value;
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}
