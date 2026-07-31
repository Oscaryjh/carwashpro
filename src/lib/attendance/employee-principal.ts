import type { Prisma } from "@prisma/client";
import { AttendanceApiError } from "@/lib/attendance/api-error";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";

export type EmployeeAttendancePrincipal = Awaited<
  ReturnType<typeof loadEmployeeAttendancePrincipal>
>;

export async function loadEmployeeAttendancePrincipal(input: {
  transaction: Prisma.TransactionClient;
  auth: EmployeeAuthContext;
  now: Date;
  branchId: string;
  deviceIdentifierHash?: string;
  requirePunch: boolean;
  requireBranchSetting: boolean;
}) {
  const session = await input.transaction.employeeSession.findUnique({
    where: {
      id: input.auth.sessionId,
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
      revokedAt: true,
      employeeAccount: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      membership: {
        select: {
          id: true,
          employeeAccountId: true,
          businessId: true,
          employeeCode: true,
          fullName: true,
          status: true,
          attendanceEnabled: true,
        },
      },
      business: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      employeeDevice: {
        select: {
          id: true,
          employeeAccountId: true,
          deviceIdentifierHash: true,
          status: true,
          canView: true,
          canPunch: true,
        },
      },
    },
  });

  if (
    !session ||
    session.id !== input.auth.sessionId ||
    session.employeeAccountId !== input.auth.employeeAccountId ||
    session.membershipId !== input.auth.membershipId ||
    session.businessId !== input.auth.businessId ||
    session.primaryBranchId !== input.auth.primaryBranchId ||
    (session.attendanceBranchId ?? session.primaryBranchId) !==
      (input.auth.attendanceBranchId ?? input.auth.primaryBranchId) ||
    session.employeeDeviceId !== input.auth.deviceId
  ) {
    throw new AttendanceApiError("UNAUTHENTICATED");
  }

  if (
    session.revokedAt ||
    session.expiresAt.getTime() <= input.now.getTime()
  ) {
    throw new AttendanceApiError("SESSION_EXPIRED");
  }

  if (
    session.employeeAccount.id !== session.employeeAccountId ||
    session.employeeAccount.status !== "ACTIVE" ||
    session.membership.id !== session.membershipId ||
    session.membership.employeeAccountId !== session.employeeAccountId ||
    session.membership.businessId !== session.businessId ||
    session.membership.status !== "ACTIVE" ||
    session.business.id !== session.businessId ||
    session.business.status !== "active"
  ) {
    throw new AttendanceApiError("EMPLOYEE_INACTIVE");
  }

  if (!session.membership.attendanceEnabled) {
    throw new AttendanceApiError("ATTENDANCE_DISABLED");
  }

  if (
    !session.employeeDevice ||
    session.employeeDevice.id !== session.employeeDeviceId ||
    session.employeeDevice.employeeAccountId !== session.employeeAccountId ||
    session.employeeDevice.status !== "ACTIVE" ||
    !session.employeeDevice.canView ||
    (input.requirePunch && !session.employeeDevice.canPunch) ||
    (input.deviceIdentifierHash !== undefined &&
      session.employeeDevice.deviceIdentifierHash !==
        input.deviceIdentifierHash)
  ) {
    throw new AttendanceApiError("DEVICE_NOT_AUTHORIZED");
  }

  const [assignment, branch] = await Promise.all([
    input.transaction.employeeBranchAssignment.findFirst({
      where: {
        membershipId: session.membershipId,
        businessId: session.businessId,
        branchId: input.branchId,
        status: "ACTIVE",
        canClockIn: true,
        effectiveFrom: {
          lte: input.now,
        },
        OR: [
          {
            effectiveUntil: null,
          },
          {
            effectiveUntil: {
              gte: input.now,
            },
          },
        ],
      },
      select: {
        id: true,
        branchId: true,
        isPrimary: true,
        canClockIn: true,
      },
    }),
    input.transaction.branch.findFirst({
      where: {
        id: input.branchId,
        businessId: session.businessId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        businessId: true,
        name: true,
        attendanceSetting: {
          select: {
            id: true,
            businessId: true,
            branchId: true,
            latitude: true,
            longitude: true,
            geofenceRadiusMeters: true,
            minimumAccuracyMeters: true,
            requireGeofence: true,
            allowOutsideGeofenceRequest: true,
            timezone: true,
            isEnabled: true,
          },
        },
      },
    }),
  ]);

  if (!assignment || !branch || branch.businessId !== session.businessId) {
    throw new AttendanceApiError("BRANCH_NOT_AUTHORIZED");
  }

  const setting = branch.attendanceSetting;
  if (
    input.requireBranchSetting &&
    (!setting ||
      setting.businessId !== session.businessId ||
      setting.branchId !== branch.id ||
      !setting.isEnabled)
  ) {
    throw new AttendanceApiError(
      "ATTENDANCE_DISABLED",
      "Attendance is not enabled for this branch.",
    );
  }

  return {
    session,
    employeeAccount: session.employeeAccount,
    membership: session.membership,
    business: session.business,
    device: session.employeeDevice,
    assignment,
    branch,
    setting,
  };
}
