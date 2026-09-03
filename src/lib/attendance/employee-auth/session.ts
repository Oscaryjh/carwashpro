import type { Prisma, PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { EmployeeAuthConfig } from "./config";
import {
  EMPLOYEE_SESSION_COOKIE,
  getEmployeeAuthConfig,
} from "./config";
import { readEmployeeSessionToken } from "./cookie";
import {
  createEmployeeSessionToken,
  hashEmployeeIdentifier,
  hashEmployeeSessionToken,
} from "./crypto";
import { EmployeeAuthError } from "./errors";
import type { EmployeeAuthRequestContext } from "./http";
import {
  findEligibleEmployeeIdentityById,
  resolveEligibleEmployeeMembership,
} from "./membership";

export type EmployeeAuthContext = Readonly<{
  sessionId: string;
  employeeAccountId: string;
  membershipId: string;
  businessId: string;
  primaryBranchId: string;
  attendanceBranchId?: string;
  deviceId: string;
}>;

export type EmployeeAuthProfile = Readonly<{
  employee: Readonly<{
    fullName: string;
    avatarUrl: string | null;
    employeeCode: string;
    position: string | null;
    employmentType: string;
    employmentStatus: string;
    joinedAt: string;
  }>;
  workplace: Readonly<{
    businessName: string;
    primaryBranchName: string;
  }>;
  capabilities: Readonly<{
    canView: boolean;
    canPunch: boolean;
  }>;
  device: Readonly<{
    displayName: string | null;
    platform: string | null;
    browser: string | null;
    firstVerifiedAt: string;
    lastActiveAt: string;
    status: "ACTIVE" | "REVOKED" | "REPLACED";
  }>;
}>;

export type EmployeeWorkplaceChoice = Readonly<{
  membershipId: string;
  businessName: string;
  employeeCode: string;
  primaryBranchName: string;
  current: boolean;
}>;

export type CreateEmployeeSessionRecordInput = Readonly<{
  employeeAccountId: string;
  membershipId: string;
  businessId: string;
  primaryBranchId: string;
  attendanceBranchId?: string;
  deviceId: string;
  ipAddressHash?: string | null;
  userAgent?: string | null;
  now: Date;
}>;

const employeeAuthSessionSelect = {
  id: true,
  employeeAccountId: true,
  membershipId: true,
  businessId: true,
  primaryBranchId: true,
  attendanceBranchId: true,
  employeeDeviceId: true,
  expiresAt: true,
  lastActiveAt: true,
  revokedAt: true,
  employeeAccount: {
    select: {
      id: true,
      status: true,
    },
  },
  membership: {
    select: {
      id: true,
      employeeAccountId: true,
      businessId: true,
      status: true,
      attendanceEnabled: true,
      branchAssignments: {
        select: {
          branchId: true,
          businessId: true,
          isPrimary: true,
          canClockIn: true,
          effectiveFrom: true,
          effectiveUntil: true,
          status: true,
        },
      },
    },
  },
  business: {
    select: {
      id: true,
      status: true,
    },
  },
  primaryBranch: {
    select: {
      id: true,
      businessId: true,
      status: true,
      attendanceSetting: {
        select: {
          businessId: true,
          branchId: true,
          isEnabled: true,
        },
      },
    },
  },
  employeeDevice: {
    select: {
      id: true,
      employeeAccountId: true,
      status: true,
      canView: true,
      canPunch: true,
      lastActiveAt: true,
    },
  },
} satisfies Prisma.EmployeeSessionSelect;

type EmployeeAuthSessionRecord = Prisma.EmployeeSessionGetPayload<{
  select: typeof employeeAuthSessionSelect;
}>;

type AuthenticateEmployeeSessionOptions = {
  database?: PrismaClient;
  config?: EmployeeAuthConfig;
  now?: Date;
  requirePunch?: boolean;
  requireAttendance?: boolean;
};

export async function createEmployeeSessionRecord(
  input: CreateEmployeeSessionRecordInput,
  transaction: Prisma.TransactionClient,
  config: EmployeeAuthConfig = getEmployeeAuthConfig(),
) {
  const token = createEmployeeSessionToken();
  const refreshTokenHash = hashEmployeeSessionToken(
    token,
    config.authSecret,
  );
  const expiresAt = new Date(
    input.now.getTime() + config.session.expiresInSeconds * 1_000,
  );
  const record = await transaction.employeeSession.create({
    data: {
      createdAt: input.now,
      employeeAccountId: input.employeeAccountId,
      membershipId: input.membershipId,
      businessId: input.businessId,
      primaryBranchId: input.primaryBranchId,
      attendanceBranchId: input.attendanceBranchId ?? input.primaryBranchId,
      employeeDeviceId: input.deviceId,
      refreshTokenHash,
      expiresAt,
      lastActiveAt: input.now,
      ipAddressHash: input.ipAddressHash ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    },
    select: {
      id: true,
      employeeAccountId: true,
      membershipId: true,
      businessId: true,
      primaryBranchId: true,
      attendanceBranchId: true,
      employeeDeviceId: true,
      expiresAt: true,
    },
  });

  if (!record.employeeDeviceId) {
    throw new EmployeeAuthError(
      "CONFIGURATION_ERROR",
      "Employee session was created without a device.",
    );
  }

  return {
    token,
    expiresAt: record.expiresAt,
    context: {
      sessionId: record.id,
      employeeAccountId: record.employeeAccountId,
      membershipId: record.membershipId,
      businessId: record.businessId,
      primaryBranchId: record.primaryBranchId,
      attendanceBranchId:
        record.attendanceBranchId ?? record.primaryBranchId,
      deviceId: record.employeeDeviceId,
    } satisfies EmployeeAuthContext,
  };
}

export async function authenticateEmployeeSessionToken(
  token: string,
  options: AuthenticateEmployeeSessionOptions = {},
): Promise<EmployeeAuthContext> {
  const database = options.database ?? prisma;
  const config = options.config ?? getEmployeeAuthConfig();
  const now = options.now ?? new Date();
  const refreshTokenHash = hashEmployeeSessionToken(
    token,
    config.authSecret,
  );
  const session = await database.employeeSession.findUnique({
    where: { refreshTokenHash },
    select: employeeAuthSessionSelect,
  });

  if (!session) {
    throw new EmployeeAuthError("UNAUTHENTICATED");
  }

  const failure = validateEmployeeSession(
    session,
    now,
    options.requirePunch === true,
    options.requireAttendance !== false,
  );

  if (failure) {
    if (session.revokedAt === null) {
      await database.$transaction(async (transaction) => {
        const revoked = await transaction.employeeSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revokeReason: failure.publicMessage.slice(0, 500),
          },
        });

        if (revoked.count === 1) {
          await writeAuditLog(
            {
              businessId: session.businessId,
              branchId: session.primaryBranchId,
              action: "EMPLOYEE_SESSION_REVOKED",
              entityType: "EmployeeSession",
              entityId: session.id,
              summary: "Employee session revoked",
              metadata: {
                membershipId: session.membershipId,
                deviceId: session.employeeDeviceId,
                reasonCode: failure.code,
              },
            },
            transaction,
          );
        }
      });
    }

    throw failure;
  }

  if (!session.employeeDeviceId) {
    throw new EmployeeAuthError("UNAUTHENTICATED");
  }

  const touchBefore = new Date(
    now.getTime() -
      config.session.activityTouchIntervalSeconds * 1_000,
  );

  if (session.lastActiveAt.getTime() <= touchBefore.getTime()) {
    const refreshedExpiresAt = new Date(
      now.getTime() + config.session.expiresInSeconds * 1_000,
    );
    await database.$transaction([
      database.employeeSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: now },
          lastActiveAt: { lte: touchBefore },
        },
        data: {
          expiresAt: refreshedExpiresAt,
          lastActiveAt: now,
        },
      }),
      database.employeeDevice.updateMany({
        where: {
          id: session.employeeDeviceId,
          employeeAccountId: session.employeeAccountId,
          status: "ACTIVE",
          lastActiveAt: { lte: touchBefore },
        },
        data: { lastActiveAt: now },
      }),
    ]);
  }

  return {
    sessionId: session.id,
    employeeAccountId: session.employeeAccountId,
    membershipId: session.membershipId,
    businessId: session.businessId,
    primaryBranchId: session.primaryBranchId,
    attendanceBranchId:
      session.attendanceBranchId ?? session.primaryBranchId,
    deviceId: session.employeeDeviceId,
  };
}

export async function tryAuthenticateEmployeeSessionToken(
  token: string,
  options: AuthenticateEmployeeSessionOptions = {},
) {
  try {
    return await authenticateEmployeeSessionToken(token, options);
  } catch {
    return null;
  }
}

export async function getEmployeeAuthContext(
  request?: Request,
  options: AuthenticateEmployeeSessionOptions = {},
) {
  const token = request
    ? readEmployeeSessionToken(request)
    : (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value ?? null;

  if (!token) {
    return null;
  }

  return tryAuthenticateEmployeeSessionToken(token, options);
}

export async function requireEmployeeAuthContext(
  request?: Request,
  options: AuthenticateEmployeeSessionOptions = {},
) {
  const token = request
    ? readEmployeeSessionToken(request)
    : (await cookies()).get(EMPLOYEE_SESSION_COOKIE)?.value ?? null;

  if (!token) {
    throw new EmployeeAuthError("UNAUTHENTICATED");
  }

  return authenticateEmployeeSessionToken(token, options);
}

export async function getEmployeeSelfServiceAuthContext(
  request?: Request,
  options: Omit<AuthenticateEmployeeSessionOptions, "requireAttendance"> = {},
) {
  return getEmployeeAuthContext(request, {
    ...options,
    requireAttendance: false,
  });
}

export async function requireEmployeeSelfServiceAuthContext(
  request?: Request,
  options: Omit<AuthenticateEmployeeSessionOptions, "requireAttendance"> = {},
) {
  return requireEmployeeAuthContext(request, {
    ...options,
    requireAttendance: false,
  });
}

export async function requireEmployeePunchAuthContext(
  request?: Request,
  options: Omit<AuthenticateEmployeeSessionOptions, "requirePunch"> = {},
) {
  return requireEmployeeAuthContext(request, {
    ...options,
    requirePunch: true,
  });
}

export async function getEmployeeAuthProfile(
  context: EmployeeAuthContext,
  database: PrismaClient = prisma,
): Promise<EmployeeAuthProfile> {
  const [membership, device] = await Promise.all([
    database.employeeBusinessMembership.findFirst({
      where: {
        id: context.membershipId,
        employeeAccountId: context.employeeAccountId,
        businessId: context.businessId,
      },
      select: {
        fullName: true,
        avatarUrl: true,
        employeeCode: true,
        position: true,
        employmentType: true,
        status: true,
        joinedAt: true,
        business: {
          select: {
            name: true,
          },
        },
        branchAssignments: {
          where: {
            branchId: context.primaryBranchId,
            isPrimary: true,
            status: "ACTIVE",
          },
          take: 1,
          select: {
            branch: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    database.employeeDevice.findFirst({
      where: {
        id: context.deviceId,
        employeeAccountId: context.employeeAccountId,
        status: "ACTIVE",
      },
      select: {
        displayName: true,
        platform: true,
        browser: true,
        firstVerifiedAt: true,
        lastActiveAt: true,
        status: true,
        canView: true,
        canPunch: true,
      },
    }),
  ]);

  const primaryAssignment = membership?.branchAssignments[0];

  if (!membership || !primaryAssignment || !device?.canView) {
    throw new EmployeeAuthError("UNAUTHENTICATED");
  }

  return {
    employee: {
      fullName: membership.fullName,
      avatarUrl: membership.avatarUrl,
      employeeCode: membership.employeeCode,
      position: membership.position,
      employmentType: membership.employmentType,
      employmentStatus: membership.status,
      joinedAt: membership.joinedAt.toISOString(),
    },
    workplace: {
      businessName: membership.business.name,
      primaryBranchName: primaryAssignment.branch.name,
    },
    capabilities: {
      canView: device.canView,
      canPunch: device.canPunch,
    },
    device: {
      displayName: device.displayName,
      platform: device.platform,
      browser: device.browser,
      firstVerifiedAt: device.firstVerifiedAt.toISOString(),
      lastActiveAt: device.lastActiveAt.toISOString(),
      status: device.status,
    },
  };
}

export async function getEmployeeWorkplaces(
  context: Pick<
    EmployeeAuthContext,
    "employeeAccountId" | "membershipId"
  >,
  database: PrismaClient = prisma,
  now = new Date(),
): Promise<readonly EmployeeWorkplaceChoice[]> {
  const identity = await findEligibleEmployeeIdentityById(
    context.employeeAccountId,
    now,
    database,
    false,
  );

  if (!identity) {
    throw new EmployeeAuthError("EMPLOYEE_INACTIVE");
  }

  const workplaces = identity.memberships.map((membership) => ({
    membershipId: membership.membershipId,
    businessName: membership.businessName,
    employeeCode: membership.employeeCode,
    primaryBranchName: membership.primaryBranchName,
    current: membership.membershipId === context.membershipId,
  }));
  if (!workplaces.some((workplace) => workplace.current)) {
    throw new EmployeeAuthError("MEMBERSHIP_NOT_AVAILABLE");
  }
  return workplaces;
}

export async function switchEmployeeWorkplace(
  input: Readonly<{
    auth: EmployeeAuthContext;
    membershipId: string;
    request?: EmployeeAuthRequestContext;
  }>,
  options: Readonly<{
    database?: PrismaClient;
    config?: EmployeeAuthConfig;
    now?: Date;
  }> = {},
) {
  if (input.membershipId === input.auth.membershipId) {
    throw new EmployeeAuthError(
      "INVALID_REQUEST",
      "The selected workplace is already active.",
    );
  }

  const database = options.database ?? prisma;
  const config = options.config ?? getEmployeeAuthConfig();
  const now = options.now ?? new Date();
  const ipAddressHash = input.request?.ipAddress
    ? hashEmployeeIdentifier(
        "ip",
        input.request.ipAddress,
        config.authSecret,
      )
    : null;

  const executeSwitch = async (transaction: Prisma.TransactionClient) => {
    const currentSession = await transaction.employeeSession.findFirst({
      where: {
        id: input.auth.sessionId,
        employeeAccountId: input.auth.employeeAccountId,
        membershipId: input.auth.membershipId,
        businessId: input.auth.businessId,
        employeeDeviceId: input.auth.deviceId,
        revokedAt: null,
        expiresAt: { gt: now },
        employeeDevice: {
          employeeAccountId: input.auth.employeeAccountId,
          status: "ACTIVE",
          canView: true,
        },
      },
      select: { id: true },
    });

    if (!currentSession) {
      throw new EmployeeAuthError("SESSION_REVOKED");
    }

    const membership = await resolveEligibleEmployeeMembership(
      input.auth.employeeAccountId,
      input.membershipId,
      now,
      transaction,
      false,
    );

    if (!membership) {
      throw new EmployeeAuthError("MEMBERSHIP_NOT_AVAILABLE");
    }

    const revoked = await transaction.employeeSession.updateMany({
      where: {
        id: currentSession.id,
        employeeAccountId: input.auth.employeeAccountId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
        revokeReason: "Employee switched workplace.",
      },
    });

    if (revoked.count !== 1) {
      throw new EmployeeAuthError("SESSION_REVOKED");
    }

    const created = await createEmployeeSessionRecord(
      {
        employeeAccountId: membership.employeeAccountId,
        membershipId: membership.membershipId,
        businessId: membership.businessId,
        primaryBranchId: membership.primaryBranchId,
        attendanceBranchId: membership.primaryBranchId,
        deviceId: input.auth.deviceId,
        ipAddressHash,
        userAgent: input.request?.userAgent ?? null,
        now,
      },
      transaction,
      config,
    );

    await writeAuditLog(
      {
        businessId: input.auth.businessId,
        branchId: input.auth.primaryBranchId,
        action: "EMPLOYEE_WORKPLACE_SWITCHED_FROM",
        entityType: "EmployeeSession",
        entityId: currentSession.id,
        summary: "Employee switched away from this workplace",
        metadata: {
          membershipId: input.auth.membershipId,
          nextSessionId: created.context.sessionId,
        },
      },
      transaction,
    );
    await writeAuditLog(
      {
        businessId: membership.businessId,
        branchId: membership.primaryBranchId,
        action: "EMPLOYEE_WORKPLACE_SWITCHED_TO",
        entityType: "EmployeeSession",
        entityId: created.context.sessionId,
        summary: "Employee switched into this workplace",
        metadata: {
          membershipId: membership.membershipId,
          previousSessionId: currentSession.id,
        },
      },
      transaction,
    );

    return {
      ...created,
      workplace: {
        membershipId: membership.membershipId,
        businessName: membership.businessName,
        employeeCode: membership.employeeCode,
        primaryBranchName: membership.primaryBranchName,
      },
    };
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(executeSwitch, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (attempt < 2 && isSerializableTransactionConflict(error)) continue;
      throw error;
    }
  }

  throw new EmployeeAuthError(
    "CONFIGURATION_ERROR",
    "Unable to establish the selected workplace session.",
  );
}

function isSerializableTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "P2034";
}

export async function revokeEmployeeSessionToken(
  token: string | null,
  options: {
    database?: PrismaClient;
    config?: EmployeeAuthConfig;
    now?: Date;
    reason?: string;
  } = {},
) {
  if (!token) {
    return false;
  }

  const database = options.database ?? prisma;
  const config = options.config ?? getEmployeeAuthConfig();
  const now = options.now ?? new Date();
  const refreshTokenHash = hashEmployeeSessionToken(
    token,
    config.authSecret,
  );

  return database.$transaction(async (transaction) => {
    const session = await transaction.employeeSession.findUnique({
      where: { refreshTokenHash },
      select: {
        id: true,
        businessId: true,
        membershipId: true,
        employeeDeviceId: true,
        revokedAt: true,
      },
    });

    if (!session || session.revokedAt) {
      return false;
    }

    const updated = await transaction.employeeSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: (options.reason ?? "Employee logged out.").slice(0, 500),
      },
    });

    if (updated.count === 0) {
      return false;
    }

    await writeAuditLog(
      {
        businessId: session.businessId,
        action: "EMPLOYEE_SESSION_REVOKED",
        entityType: "EmployeeSession",
        entityId: session.id,
        summary: "Employee logged out",
        metadata: {
          membershipId: session.membershipId,
          deviceId: session.employeeDeviceId,
        },
      },
      transaction,
    );

    await writeAuditLog(
      {
        businessId: session.businessId,
        action: "EMPLOYEE_LOGOUT",
        entityType: "EmployeeSession",
        entityId: session.id,
        summary: "Employee logged out",
        metadata: {
          membershipId: session.membershipId,
          deviceId: session.employeeDeviceId,
        },
      },
      transaction,
    );

    return true;
  });
}

function validateEmployeeSession(
  session: EmployeeAuthSessionRecord,
  now: Date,
  requirePunch: boolean,
  requireAttendance: boolean,
): EmployeeAuthError | null {
  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    return new EmployeeAuthError("SESSION_REVOKED");
  }

  if (
    session.employeeAccount.id !== session.employeeAccountId ||
    session.employeeAccount.status !== "ACTIVE"
  ) {
    return new EmployeeAuthError("EMPLOYEE_INACTIVE");
  }

  if (
    session.membership.id !== session.membershipId ||
    session.membership.employeeAccountId !== session.employeeAccountId ||
    session.membership.businessId !== session.businessId ||
    session.membership.status !== "ACTIVE"
  ) {
    return new EmployeeAuthError("MEMBERSHIP_INACTIVE");
  }

  if (requireAttendance && !session.membership.attendanceEnabled) {
    return new EmployeeAuthError("ATTENDANCE_DISABLED");
  }

  if (
    session.business.id !== session.businessId ||
    session.business.status !== "active"
  ) {
    return new EmployeeAuthError("MEMBERSHIP_INACTIVE");
  }

  if (
    !session.employeeDevice ||
    session.employeeDevice.id !== session.employeeDeviceId ||
    session.employeeDevice.employeeAccountId !== session.employeeAccountId ||
    session.employeeDevice.status !== "ACTIVE"
  ) {
    return new EmployeeAuthError("DEVICE_REVOKED");
  }

  if (!session.employeeDevice.canView) {
    return new EmployeeAuthError("DEVICE_NOT_ALLOWED");
  }

  if (requirePunch && !session.employeeDevice.canPunch) {
    return new EmployeeAuthError("DEVICE_NOT_ALLOWED");
  }

  if (
    session.primaryBranch.id !== session.primaryBranchId ||
    session.primaryBranch.businessId !== session.businessId ||
    session.primaryBranch.status !== "ACTIVE" ||
    (requireAttendance &&
      (session.primaryBranch.attendanceSetting?.isEnabled !== true ||
        session.primaryBranch.attendanceSetting.businessId !== session.businessId ||
        session.primaryBranch.attendanceSetting.branchId !== session.primaryBranchId))
  ) {
    return new EmployeeAuthError("PRIMARY_BRANCH_UNAVAILABLE");
  }

  const validPrimaryAssignments =
    session.membership.branchAssignments.filter(
      (assignment) =>
        assignment.branchId === session.primaryBranchId &&
        assignment.businessId === session.businessId &&
        assignment.isPrimary &&
        (!requireAttendance || assignment.canClockIn) &&
        assignment.status === "ACTIVE" &&
        assignment.effectiveFrom.getTime() <= now.getTime() &&
        (assignment.effectiveUntil === null ||
          assignment.effectiveUntil.getTime() >= now.getTime()),
    );

  if (validPrimaryAssignments.length !== 1) {
    return new EmployeeAuthError("PRIMARY_BRANCH_UNAVAILABLE");
  }

  return null;
}
