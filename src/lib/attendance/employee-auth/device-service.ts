import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AuditRequestContext,
  WriteAuditLogInput,
} from "@/lib/audit";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { EmployeeAuthError } from "./errors";

export type VerifiedEmployeeDeviceInput = Readonly<{
  employeeAccountId: string;
  deviceIdentifierHash: string;
  displayName?: string | null;
  platform?: string | null;
  browser?: string | null;
  now: Date;
  purpose: "LOGIN" | "REGISTER_DEVICE";
}>;

export type RevokedEmployeeSessionScope = Readonly<{
  businessId: string;
  membershipId: string;
  revokedSessionCount: number;
}>;

export type BoundEmployeeDevice = Readonly<{
  deviceId: string;
  registered: boolean;
  replacedDeviceIds: readonly string[];
  revokedSessionScopes: readonly RevokedEmployeeSessionScope[];
  canView: boolean;
  canPunch: boolean;
}>;

export async function bindVerifiedEmployeeDevice(
  input: VerifiedEmployeeDeviceInput,
  transaction: Prisma.TransactionClient,
): Promise<BoundEmployeeDevice> {
  const existing = await transaction.employeeDevice.findUnique({
    where: {
      employeeAccountId_deviceIdentifierHash: {
        employeeAccountId: input.employeeAccountId,
        deviceIdentifierHash: input.deviceIdentifierHash,
      },
    },
    select: {
      id: true,
      status: true,
      canView: true,
      canPunch: true,
    },
  });

  if (existing?.status === "REVOKED") {
    throw new EmployeeAuthError(
      "DEVICE_REVOKED",
      "A revoked device cannot be registered by employee login.",
    );
  }

  if (existing?.status === "ACTIVE" && !existing.canView) {
    throw new EmployeeAuthError(
      "DEVICE_NOT_ALLOWED",
      "This device is not allowed to view employee attendance.",
    );
  }

  if (
    existing?.status === "REPLACED" &&
    input.purpose !== "REGISTER_DEVICE"
  ) {
    throw new EmployeeAuthError(
      "DEVICE_NOT_ALLOWED",
      "Replacing a device requires a device registration challenge.",
    );
  }

  const activeDevices = await transaction.employeeDevice.findMany({
    where: {
      employeeAccountId: input.employeeAccountId,
      status: "ACTIVE",
      ...(existing ? { id: { not: existing.id } } : {}),
    },
    select: { id: true },
  });
  const replacedDeviceIds = activeDevices.map((device) => device.id);
  let revokedSessionScopes: RevokedEmployeeSessionScope[] = [];

  if (
    replacedDeviceIds.length > 0 &&
    existing?.status !== "ACTIVE" &&
    input.purpose !== "REGISTER_DEVICE"
  ) {
    throw new EmployeeAuthError(
      "DEVICE_NOT_ALLOWED",
      "Replacing a device requires a device registration challenge.",
    );
  }

  if (replacedDeviceIds.length > 0) {
    const activeSessions = await transaction.$queryRaw<
      Array<{
        id: string;
        businessId: string;
        membershipId: string;
      }>
    >(
      Prisma.sql`
        SELECT
          id::text AS id,
          business_id::text AS "businessId",
          membership_id::text AS "membershipId"
        FROM employee_sessions
        WHERE employee_account_id = ${input.employeeAccountId}::uuid
          AND employee_device_id IN (
            ${Prisma.join(
              replacedDeviceIds.map((id) => Prisma.sql`${id}::uuid`),
            )}
          )
          AND revoked_at IS NULL
        FOR UPDATE
      `,
    );
    const sessionScopeCounts = new Map<string, RevokedEmployeeSessionScope>();

    for (const session of activeSessions) {
      const key = `${session.businessId}:${session.membershipId}`;
      const current = sessionScopeCounts.get(key);
      sessionScopeCounts.set(key, {
        businessId: session.businessId,
        membershipId: session.membershipId,
        revokedSessionCount: (current?.revokedSessionCount ?? 0) + 1,
      });
    }

    revokedSessionScopes = [...sessionScopeCounts.values()];

    await transaction.employeeDevice.updateMany({
      where: {
        id: { in: replacedDeviceIds },
        employeeAccountId: input.employeeAccountId,
        status: "ACTIVE",
      },
      data: {
        status: "REPLACED",
        revokedAt: input.now,
        revokeReason: "Replaced by a newly verified device.",
        canPunch: false,
        canView: false,
      },
    });

    await transaction.employeeSession.updateMany({
      where: {
        employeeAccountId: input.employeeAccountId,
        employeeDeviceId: { in: replacedDeviceIds },
        revokedAt: null,
      },
      data: {
        revokedAt: input.now,
        revokeReason: "Device replaced.",
      },
    });
  }

  if (existing) {
    const device = await transaction.employeeDevice.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName ?? undefined,
        platform: input.platform ?? undefined,
        browser: input.browser ?? undefined,
        lastActiveAt: input.now,
        status: "ACTIVE",
        revokedAt: null,
        revokeReason: null,
        canView: true,
        ...(existing.status === "REPLACED" ? { canPunch: true } : {}),
      },
      select: {
        id: true,
        canView: true,
        canPunch: true,
      },
    });

    return {
      deviceId: device.id,
      registered: existing.status !== "ACTIVE",
      replacedDeviceIds,
      revokedSessionScopes,
      canView: device.canView,
      canPunch: device.canPunch,
    };
  }

  const device = await transaction.employeeDevice.create({
    data: {
      employeeAccountId: input.employeeAccountId,
      deviceIdentifierHash: input.deviceIdentifierHash,
      displayName: input.displayName ?? null,
      platform: input.platform ?? null,
      browser: input.browser ?? null,
      firstVerifiedAt: input.now,
      lastActiveAt: input.now,
      status: "ACTIVE",
      canView: true,
      canPunch: true,
    },
    select: {
      id: true,
      canView: true,
      canPunch: true,
    },
  });

  return {
    deviceId: device.id,
    registered: true,
    replacedDeviceIds,
    revokedSessionScopes,
    canView: device.canView,
    canPunch: device.canPunch,
  };
}

type DeviceServiceActor = NonNullable<WriteAuditLogInput["actor"]>;

export type RevokeEmployeeDeviceInput = Readonly<{
  businessId: string;
  allowedBranchIds: readonly string[];
  wholeBusinessScope?: boolean;
  membershipId: string;
  deviceId: string;
  reason: string;
  actor: DeviceServiceActor;
  request?: AuditRequestContext;
  now?: Date;
}>;

export async function revokeEmployeeDevice(
  input: RevokeEmployeeDeviceInput,
  database: PrismaClient = prisma,
) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();

  if (!reason) {
    throw new EmployeeAuthError(
      "INVALID_REQUEST",
      "A device revoke reason is required.",
    );
  }

  return database.$transaction(async (transaction) => {
    const membership = await transaction.employeeBusinessMembership.findFirst({
      where: {
        id: input.membershipId,
        businessId: input.businessId,
        ...(!input.wholeBusinessScope
          ? {
              branchAssignments: {
                some: {
                  businessId: input.businessId,
                  branchId: { in: [...input.allowedBranchIds] },
                  status: "ACTIVE",
                  effectiveFrom: { lte: now },
                  OR: [
                    { effectiveUntil: null },
                    { effectiveUntil: { gte: now } },
                  ],
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        employeeAccountId: true,
        fullName: true,
      },
    });

    if (!membership) {
      throw new EmployeeAuthError(
        "MEMBERSHIP_NOT_AVAILABLE",
        "Employee device is outside the authorized scope.",
      );
    }

    await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id::text AS id
        FROM employee_accounts
        WHERE id = ${membership.employeeAccountId}::uuid
        FOR UPDATE
      `,
    );

    const otherBusinessMembership =
      await transaction.employeeBusinessMembership.findFirst({
        where: {
          employeeAccountId: membership.employeeAccountId,
          businessId: { not: input.businessId },
        },
        select: { id: true },
      });

    if (otherBusinessMembership) {
      throw new EmployeeAuthError(
        "MEMBERSHIP_NOT_AVAILABLE",
        "A shared employee device cannot be revoked by one business.",
      );
    }

    const device = await transaction.employeeDevice.findFirst({
      where: {
        id: input.deviceId,
        employeeAccountId: membership.employeeAccountId,
      },
      select: {
        id: true,
        status: true,
        canView: true,
        canPunch: true,
      },
    });

    if (!device) {
      throw new EmployeeAuthError(
        "MEMBERSHIP_NOT_AVAILABLE",
        "Employee device is outside the authorized scope.",
      );
    }

    const activeSessions = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id::text AS id
        FROM employee_sessions
        WHERE employee_account_id = ${membership.employeeAccountId}::uuid
          AND employee_device_id = ${device.id}::uuid
          AND revoked_at IS NULL
        FOR UPDATE
      `,
    );
    const revokedSessionCount = activeSessions.length;

    if (device.status !== "REVOKED") {
      await transaction.employeeDevice.update({
        where: { id: device.id },
        data: {
          status: "REVOKED",
          canView: false,
          canPunch: false,
          revokedAt: now,
          revokeReason: reason.slice(0, 500),
        },
      });
    }

    await transaction.employeeSession.updateMany({
      where: {
        employeeAccountId: membership.employeeAccountId,
        employeeDeviceId: device.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: "Device revoked by administrator.",
      },
    });

    if (revokedSessionCount > 0) {
      await writeAuditLog(
        {
          businessId: input.businessId,
          actor: input.actor,
          action: "EMPLOYEE_SESSION_REVOKED",
          entityType: "EmployeeDevice",
          entityId: device.id,
          summary: "Employee sessions revoked after administrator device revoke",
          metadata: {
            membershipId: membership.id,
            revokedSessionCount,
            reasonCode: "ADMIN_DEVICE_REVOKED",
          },
          request: input.request,
        },
        transaction,
      );
    }

    await writeAuditLog(
      {
        businessId: input.businessId,
        actor: input.actor,
        action: "EMPLOYEE_DEVICE_REVOKED",
        entityType: "EmployeeDevice",
        entityId: device.id,
        summary: `Revoked attendance device for ${membership.fullName}`,
        before: {
          status: device.status,
          canView: device.canView,
          canPunch: device.canPunch,
        },
        after: {
          status: "REVOKED",
          canView: false,
          canPunch: false,
        },
        metadata: {
          membershipId: membership.id,
          revokedSessionCount,
          reason: reason.slice(0, 500),
        },
        request: input.request,
      },
      transaction,
    );

    return {
      deviceId: device.id,
      revokedSessionCount,
    };
  });
}
