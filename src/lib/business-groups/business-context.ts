import type {
  BusinessGroupUserRole,
  BusinessIndustry,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AppSession, CreateSessionInput } from "@/lib/auth/session";
import { createSession } from "@/lib/auth/session";
import { getStaffHomePath } from "@/lib/auth/staff-permissions";
import { writeBusinessGroupAuditLog } from "@/lib/business-groups/audit";
import type { EffectiveBusinessRole } from "@/lib/business-groups/business-access";
import { canGroupManager } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";

export type BusinessContextErrorCode =
  | "INVALID_CONTEXT_TOKEN"
  | "BUSINESS_CONTEXT_CHANGED"
  | "BUSINESS_ACCESS_DENIED"
  | "BUSINESS_INACTIVE"
  | "GROUP_MEMBERSHIP_INACTIVE"
  | "GROUP_ROLE_INACTIVE"
  | "MANAGER_SCOPE_DENIED"
  | "NO_AVAILABLE_BUSINESS";

export type BusinessContextActionState = {
  status: "idle" | "error";
  code?: BusinessContextErrorCode;
  message?: string;
};

export type AvailableBusinessContext = {
  id: string;
  name: string;
  industryType: BusinessIndustry;
  logoUrl: string | null;
  isCurrent: boolean;
  isHome: boolean;
};

export type AvailableBusinessContexts = {
  currentBusinessId: string | null;
  homeBusinessId: string | null;
  canSwitch: boolean;
  group: {
    id: string;
    name: string;
    role: BusinessGroupUserRole;
  } | null;
  businesses: AvailableBusinessContext[];
};

export type AuthorizedBusinessContext = {
  userId: string;
  homeBusinessId: string | null;
  businessId: string;
  branchId: string | null;
  industryType: BusinessIndustry;
  actorRole: "BUSINESS_OWNER" | "STAFF" | BusinessGroupUserRole;
  effectiveBusinessRole: Exclude<EffectiveBusinessRole, "PLATFORM_ADMIN">;
  permissions: string[];
  source: "DIRECT_BUSINESS" | "GROUP_ACCESS";
  groupId: string | null;
};

type ContextDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "business" | "businessGroupMember" | "businessGroupUser"
>;

type ContextTransaction = ContextDatabase &
  Pick<Prisma.TransactionClient, "businessGroupAuditLog" | "$queryRaw">;

type ContextRootDatabase = ContextDatabase & {
  $transaction<T>(
    operation: (transaction: ContextTransaction) => Promise<T>,
  ): Promise<T>;
};

type CommitSwitchDependencies = {
  database?: ContextRootDatabase;
  writeSession?: (session: CreateSessionInput) => Promise<void>;
};

export type CommitBusinessContextSwitchResult =
  | {
      ok: true;
      changed: boolean;
      destination: string;
      session: CreateSessionInput;
    }
  | {
      ok: false;
      code: BusinessContextErrorCode;
      message: string;
    };

export async function getAvailableBusinessContexts(
  userId: string,
  currentBusinessId: string | null,
  database: ContextDatabase = prisma,
): Promise<AvailableBusinessContexts> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      businessId: true,
      role: true,
      status: true,
      loginEnabled: true,
      business: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          industryType: true,
          status: true,
        },
      },
    },
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.loginEnabled ||
    user.role === "PLATFORM_ADMIN"
  ) {
    return emptyContexts(currentBusinessId, user?.businessId ?? null);
  }

  const grants = await database.businessGroupUser.findMany({
    where: {
      userId,
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      accessScope: true,
      group: {
        select: {
          id: true,
          name: true,
          members: {
            where: {
              status: "ACTIVE",
              business: { status: "active" },
            },
            orderBy: [
              { business: { name: "asc" } },
              { businessId: "asc" },
            ],
            select: {
              business: {
                select: {
                  id: true,
                  name: true,
                  logoUrl: true,
                  industryType: true,
                },
              },
            },
          },
        },
      },
      businessAccesses: {
        where: { business: { status: "active" } },
        select: { businessId: true },
      },
    },
  });

  if (!grants.length) {
    return {
      currentBusinessId,
      homeBusinessId: user.businessId,
      canSwitch: false,
      group: null,
      businesses:
        user.business?.status === "active"
          ? [toContextOption(user.business, currentBusinessId, user.businessId)]
          : [],
    };
  }

  const contexts = new Map<string, AvailableBusinessContext>();
  if (user.business?.status === "active") {
    contexts.set(
      user.business.id,
      toContextOption(user.business, currentBusinessId, user.businessId),
    );
  }

  for (const grant of grants) {
    const scopedIds = new Set(
      grant.businessAccesses.map((access) => access.businessId),
    );
    for (const member of grant.group.members) {
      if (
        grant.role === "GROUP_MANAGER" &&
        (grant.accessScope !== "SELECTED_BUSINESSES" ||
          !scopedIds.has(member.business.id))
      ) {
        continue;
      }

      contexts.set(
        member.business.id,
        toContextOption(member.business, currentBusinessId, user.businessId),
      );
    }
  }

  const businesses = [...contexts.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const primaryGrant =
    grants.find((grant) =>
      grant.group.members.some(
        (member) => member.business.id === currentBusinessId,
      ),
    ) ?? grants[0];

  return {
    currentBusinessId,
    homeBusinessId: user.businessId,
    canSwitch: businesses.length > 1,
    group: primaryGrant
      ? {
          id: primaryGrant.group.id,
          name: primaryGrant.group.name,
          role: primaryGrant.role,
        }
      : null,
    businesses,
  };
}

export async function authorizeBusinessContextTarget(
  userId: string,
  targetBusinessId: string,
  database: ContextDatabase = prisma,
): Promise<
  | { ok: true; context: AuthorizedBusinessContext }
  | { ok: false; code: BusinessContextErrorCode; message: string }
> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      businessId: true,
      branchId: true,
      role: true,
      status: true,
      loginEnabled: true,
      permissions: true,
      business: {
        select: { id: true, status: true, industryType: true },
      },
      branch: {
        select: { id: true, businessId: true, status: true },
      },
    },
  });

  if (
    !user ||
    user.status !== "active" ||
    !user.loginEnabled ||
    user.role === "PLATFORM_ADMIN"
  ) {
    return contextError(
      "BUSINESS_ACCESS_DENIED",
      "You do not have access to this business.",
    );
  }

  const business = await database.business.findUnique({
    where: { id: targetBusinessId },
    select: { id: true, status: true, industryType: true },
  });
  if (!business || business.status !== "active") {
    return contextError(
      "BUSINESS_INACTIVE",
      "The selected business is not available.",
    );
  }

  if (
    user.businessId === business.id &&
    user.business?.status === "active"
  ) {
    return {
      ok: true,
      context: {
        userId: user.id,
        homeBusinessId: user.businessId,
        businessId: business.id,
        branchId:
          user.branch?.status === "ACTIVE" &&
          user.branch.businessId === business.id
            ? user.branch.id
            : null,
        industryType: business.industryType,
        actorRole: user.role,
        effectiveBusinessRole:
          user.role === "BUSINESS_OWNER" ? "BUSINESS_OWNER" : "STAFF",
        permissions: user.permissions,
        source: "DIRECT_BUSINESS",
        groupId: null,
      },
    };
  }

  const membership = await database.businessGroupMember.findFirst({
    where: {
      businessId: business.id,
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    select: { groupId: true },
  });
  if (!membership) {
    return contextError(
      "GROUP_MEMBERSHIP_INACTIVE",
      "You do not have access to this business.",
    );
  }

  const grant = await database.businessGroupUser.findFirst({
    where: {
      groupId: membership.groupId,
      userId: user.id,
      status: "ACTIVE",
      group: { status: "ACTIVE" },
    },
    select: {
      id: true,
      groupId: true,
      role: true,
      accessScope: true,
      businessAccesses: {
        where: { businessId: business.id },
        select: { businessId: true },
      },
    },
  });
  if (!grant) {
    return contextError(
      "GROUP_ROLE_INACTIVE",
      "You do not have access to this business.",
    );
  }

  if (
    grant.role === "GROUP_MANAGER" &&
    (grant.accessScope !== "SELECTED_BUSINESSES" ||
      grant.businessAccesses.length !== 1)
  ) {
    return contextError(
      "MANAGER_SCOPE_DENIED",
      "You do not have access to this business.",
    );
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      homeBusinessId: user.businessId,
      businessId: business.id,
      branchId: null,
      industryType: business.industryType,
      actorRole: grant.role,
      effectiveBusinessRole:
        grant.role === "GROUP_OWNER"
          ? "BUSINESS_OWNER"
          : "GROUP_MANAGER_READ_ONLY",
      permissions: [],
      source: "GROUP_ACCESS",
      groupId: grant.groupId,
    },
  };
}

export async function getRecoveryBusinessContext(
  session: AppSession,
  database: ContextDatabase = prisma,
) {
  const contexts = await getAvailableBusinessContexts(
    session.userId,
    session.activeBusinessId,
    database,
  );
  const orderedIds = [
    contexts.homeBusinessId,
    ...contexts.businesses.map((business) => business.id),
  ].filter((id): id is string => Boolean(id));

  for (const businessId of [...new Set(orderedIds)]) {
    const result = await authorizeBusinessContextTarget(
      session.userId,
      businessId,
      database,
    );
    if (result.ok) return result;
  }

  return contextError(
    "NO_AVAILABLE_BUSINESS",
    "No active business is available for this account.",
  );
}

export async function commitBusinessContextSwitch(
  input: {
    session: AppSession;
    targetBusinessId: string;
    returnTo?: string | null;
    source: "STORE_SWITCHER" | "RECOVERY";
  },
  dependencies: CommitSwitchDependencies = {},
): Promise<CommitBusinessContextSwitchResult> {
  const database = dependencies.database ?? (prisma as ContextRootDatabase);
  const writeSession = dependencies.writeSession ?? createSession;
  const initialAuthorization = await authorizeBusinessContextTarget(
    input.session.userId,
    input.targetBusinessId,
    database,
  );
  if (!initialAuthorization.ok) return initialAuthorization;

  const destination = safeBusinessReturnTo(
    input.returnTo,
    initialAuthorization.context,
  );
  if (input.session.activeBusinessId === input.targetBusinessId) {
    return {
      ok: true,
      changed: false,
      destination,
      session: input.session,
    };
  }

  return database.$transaction(async (transaction) => {
    const authorization = await authorizeBusinessContextTarget(
      input.session.userId,
      input.targetBusinessId,
      transaction,
    );
    if (!authorization.ok) return authorization;

    const context = authorization.context;
    const nextSession = rotatedSession(input.session, context);
    const auditGroupId =
      context.groupId ??
      (await findAuditGroupId(
        input.session.userId,
        input.session.activeBusinessId,
        transaction,
      ));

    if (!auditGroupId && input.source !== "RECOVERY") {
      return contextError(
        "BUSINESS_ACCESS_DENIED",
        "The business context could not be changed.",
      );
    }

    const recoveryKey =
      input.source === "RECOVERY" && input.session.sessionId
        ? recoveryIdempotencyKey(
            input.session,
            input.targetBusinessId,
          )
        : null;
    const duplicateRecovery =
      input.source === "RECOVERY" &&
      recoveryKey &&
      auditGroupId
        ? await findCompletedRecovery(
            input.session.userId,
            recoveryKey,
            auditGroupId,
            transaction,
          )
        : null;

    if (auditGroupId && !duplicateRecovery) {
      await writeBusinessGroupAuditLog(
        {
          groupId: auditGroupId,
          businessId: context.businessId,
          actor: input.session,
          action: "BUSINESS_CONTEXT_SWITCHED",
          entityType: "BusinessContext",
          entityId: input.session.userId,
          summary: "Business context switched.",
          before: {
            activeBusinessId: input.session.activeBusinessId,
            contextVersion: input.session.contextVersion,
          },
          after: {
            activeBusinessId: context.businessId,
            contextVersion: nextSession.contextVersion,
          },
          metadata: {
            actorRole: context.actorRole,
            source: input.source,
            ...(input.source === "RECOVERY" && recoveryKey
              ? { recoveryKey }
              : {}),
          },
        },
        transaction,
      );
    } else {
      console.warn("[business-context] recovered without group audit", {
        userId: input.session.userId,
        source: input.source,
      });
    }

    // The cookie write stays inside the transaction callback. If it throws,
    // Prisma rolls back the audit instead of recording a switch that failed.
    await writeSession(nextSession);

    return {
      ok: true,
      changed: true,
      destination: safeBusinessReturnTo(input.returnTo, context),
      session: nextSession,
    };
  });
}

export function safeBusinessReturnTo(
  value: string | null | undefined,
  context: Pick<
    AuthorizedBusinessContext,
    "effectiveBusinessRole" | "industryType" | "permissions"
  >,
) {
  const fallback = safeBusinessHome(context);
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  let decoded = value;
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return fallback;
  }

  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return fallback;
  }

  let url: URL;
  try {
    url = new URL(decoded, "https://business-context.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://business-context.invalid") return fallback;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const commonReadPaths = new Set([
    "/dashboard",
    "/reports",
    "/crm",
    "/invoices",
    "/services",
    "/packages",
    "/products",
    "/team",
    "/team/employees",
    "/team/attendance-settings",
  ]);
  const ownerOnlyPaths = new Set([
    "/cashier",
    "/closing",
    "/loyalty",
    "/whatsapp/inbox",
    "/whatsapp/settings",
    "/business/settings",
  ]);
  const industryReadPaths =
    context.industryType === "AUTO_DETAILING"
      ? new Set(["/work-orders"])
      : new Set(["/appointments", "/salon/dashboard"]);
  const invoiceDetailPath = /^\/invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const industryOwnerPaths =
    context.industryType === "AUTO_DETAILING"
      ? new Set<string>()
      : new Set(["/cashier"]);

  if (
    commonReadPaths.has(path) ||
    industryReadPaths.has(path) ||
    invoiceDetailPath.test(path)
  ) {
    return path;
  }
  if (
    context.effectiveBusinessRole === "BUSINESS_OWNER" &&
    (ownerOnlyPaths.has(path) || industryOwnerPaths.has(path)) &&
    (path !== "/cashier" || industryOwnerPaths.has(path))
  ) {
    return path;
  }

  return fallback;
}

export function businessContextErrorMessage(code: BusinessContextErrorCode) {
  const messages: Record<BusinessContextErrorCode, string> = {
    INVALID_CONTEXT_TOKEN:
      "This page context is invalid. Refresh the page and try again.",
    BUSINESS_CONTEXT_CHANGED:
      "The active business changed in another tab. Refresh the page before submitting.",
    BUSINESS_ACCESS_DENIED: "You do not have access to this business.",
    BUSINESS_INACTIVE: "The selected business is not available.",
    GROUP_MEMBERSHIP_INACTIVE: "You do not have access to this business.",
    GROUP_ROLE_INACTIVE: "You do not have access to this business.",
    MANAGER_SCOPE_DENIED: "You do not have access to this business.",
    NO_AVAILABLE_BUSINESS:
      "No active business is available for this account.",
  };
  return messages[code];
}

function safeBusinessHome(
  context: Pick<
    AuthorizedBusinessContext,
    "effectiveBusinessRole" | "industryType" | "permissions"
  >,
) {
  if (context.effectiveBusinessRole === "STAFF") {
    const staffHome = getStaffHomePath(
      context.permissions,
      context.industryType,
    );
    return staffHome === "/login" ? "/no-business-access" : staffHome;
  }

  if (context.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY") {
    const managerDestinations = [
      ["VIEW_REPORTS", "/reports"],
      ["VIEW_APPOINTMENTS", "/appointments"],
      ["VIEW_WORK_ORDERS", "/work-orders"],
      ["VIEW_CRM", "/crm"],
      ["VIEW_INVOICES", "/invoices"],
      ["VIEW_CATALOG", "/services"],
      ["VIEW_INVENTORY", "/products"],
      ["VIEW_TEAM_DIRECTORY", "/team"],
    ] as const;
    return (
      managerDestinations.find(([capability]) =>
        canGroupManager(capability),
      )?.[1] ?? "/no-business-access"
    );
  }
  return context.industryType === "AUTO_DETAILING"
    ? "/work-orders"
    : "/cashier";
}

function rotatedSession(
  session: AppSession,
  context: AuthorizedBusinessContext,
): CreateSessionInput {
  return {
    userId: session.userId,
    sessionId: session.sessionId ?? randomUUID(),
    homeBusinessId: session.homeBusinessId,
    activeBusinessId: context.businessId,
    contextVersion: session.contextVersion + 1,
    branchId: context.branchId,
    industryType: context.industryType,
    name: session.name,
    email: session.email,
    role: session.role,
    permissions: session.permissions,
    status: session.status,
  };
}

async function findCompletedRecovery(
  userId: string,
  recoveryKey: string,
  groupId: string,
  transaction: ContextTransaction,
) {
  await transaction.$queryRaw`
    SELECT 1 AS locked
    FROM (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${"business-context-recovery:" + userId}, 0)
      )
    ) AS recovery_lock
  `;

  return transaction.businessGroupAuditLog.findFirst({
    where: {
      groupId,
      actorUserId: userId,
      action: "BUSINESS_CONTEXT_SWITCHED",
      metadata: {
        path: ["recoveryKey"],
        equals: recoveryKey,
      },
    },
    select: { id: true },
  });
}

function recoveryIdempotencyKey(
  session: Pick<
    AppSession,
    "sessionId" | "activeBusinessId" | "contextVersion"
  >,
  targetBusinessId: string,
) {
  return [
    session.sessionId,
    session.activeBusinessId ?? "none",
    session.contextVersion,
    targetBusinessId,
  ].join(":");
}

async function findAuditGroupId(
  userId: string,
  previousBusinessId: string | null,
  database: ContextDatabase,
) {
  if (!previousBusinessId) return null;
  const grant = await database.businessGroupUser.findFirst({
    where: {
      userId,
      group: {
        members: {
          some: {
            businessId: previousBusinessId,
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { grantedAt: "desc" }],
    select: { groupId: true },
  });
  return grant?.groupId ?? null;
}

function toContextOption(
  business: {
    id: string;
    name: string;
    logoUrl: string | null;
    industryType: BusinessIndustry;
  },
  currentBusinessId: string | null,
  homeBusinessId: string | null,
): AvailableBusinessContext {
  return {
    id: business.id,
    name: business.name,
    logoUrl: business.logoUrl,
    industryType: business.industryType,
    isCurrent: business.id === currentBusinessId,
    isHome: business.id === homeBusinessId,
  };
}

function emptyContexts(
  currentBusinessId: string | null,
  homeBusinessId: string | null,
): AvailableBusinessContexts {
  return {
    currentBusinessId,
    homeBusinessId,
    canSwitch: false,
    group: null,
    businesses: [],
  };
}

function contextError(
  code: BusinessContextErrorCode,
  message: string,
): {
  ok: false;
  code: BusinessContextErrorCode;
  message: string;
} {
  return { ok: false, code, message };
}
