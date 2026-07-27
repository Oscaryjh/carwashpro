import type { UserRole, UserStatus } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "car_wash_session";
export const SESSION_IDLE_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_CONTEXT_VERSION = 1;

export type AppSession = {
  userId: string;
  sessionId?: string | null;
  homeBusinessId: string | null;
  activeBusinessId: string | null;
  contextVersion: number;
  /**
   * Compatibility alias for code that has not moved to BusinessContext yet.
   * It always mirrors activeBusinessId and must not be treated as authority.
   */
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

function getSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }

  return new TextEncoder().encode(secret);
}

export async function createSession(session: CreateSessionInput) {
  const token = await createSessionToken(session);
  await setSessionCookie(token);
}

export async function createSessionToken(session: CreateSessionInput) {
  const normalizedSession = normalizeSession({
    ...session,
    businessId: session.activeBusinessId,
  });
  return new SignJWT(normalizedSession)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_SECONDS}s`)
    .sign(getSecret());
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_IDLE_SECONDS,
  };
}

export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const verified = await jwtVerify(token, getSecret());
    return normalizeSession(verified.payload);
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function requireUser() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
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
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.loginEnabled ||
    !user.email
  ) {
    redirect("/login");
  }

  return {
    ...session,
    userId: user.id,
    homeBusinessId: user.businessId,
    businessId: session.activeBusinessId,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    status: user.status,
  } satisfies AppSession;
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
