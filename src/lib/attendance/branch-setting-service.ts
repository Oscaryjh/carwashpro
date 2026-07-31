import { validateBranchAttendanceSettingInput } from "@/lib/attendance/branch-setting";
import type {
  AttendanceServiceContext,
  AttendanceServiceDatabase,
} from "@/lib/attendance/employee-service";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type UpsertBranchAttendanceSettingArgs =
  AttendanceServiceContext & {
    input: unknown;
  };

export async function upsertBranchAttendanceSetting(
  args: UpsertBranchAttendanceSettingArgs,
  database: AttendanceServiceDatabase = prisma,
) {
  const setting = validateBranchAttendanceSettingInput(
    bindTrustedBusinessId(args.input, args.businessId),
  );
  assertAllowedBranch(setting.branchId, args.allowedBranchIds);

  return database.$transaction(async (transaction) => {
    const branch = await transaction.branch.findFirst({
      where: {
        id: setting.branchId,
        businessId: args.businessId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!branch) {
      throw new Error(
        "Attendance setting branch was not found in the selected business.",
      );
    }

    assertAllowedBranch(branch.id, args.allowedBranchIds);

    const existing =
      await transaction.branchAttendanceSetting.findUnique({
        where: {
          branchId: branch.id,
        },
      });

    if (existing && existing.businessId !== args.businessId) {
      throw new Error(
        "Attendance setting is outside the selected business.",
      );
    }

    const coordinatesChanged =
      !existing ||
      existing.latitude.toString() !== String(setting.latitude) ||
      existing.longitude.toString() !== String(setting.longitude);
    const previousAuditSnapshot = existing
      ? settingAuditSnapshot(existing)
      : null;

    const saved =
      await transaction.branchAttendanceSetting.upsert({
        where: {
          branchId: branch.id,
        },
        create: {
          businessId: args.businessId,
          branchId: branch.id,
          latitude: setting.latitude,
          longitude: setting.longitude,
          geofenceRadiusMeters: setting.geofenceRadiusMeters,
          minimumAccuracyMeters: setting.minimumAccuracyMeters,
          requireGeofence: setting.requireGeofence,
          allowOutsideGeofenceRequest:
            setting.allowOutsideGeofenceRequest,
          requirePhoto: setting.requirePhoto,
          breakPolicy: setting.breakPolicy,
          targetBreakMinutes: setting.targetBreakMinutes,
          normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay,
          shiftSpanMinutes: setting.shiftSpanMinutes,
          timezone: setting.timezone,
          isEnabled: setting.isEnabled,
        },
        update: {
          latitude: setting.latitude,
          longitude: setting.longitude,
          geofenceRadiusMeters: setting.geofenceRadiusMeters,
          minimumAccuracyMeters: setting.minimumAccuracyMeters,
          requireGeofence: setting.requireGeofence,
          allowOutsideGeofenceRequest:
            setting.allowOutsideGeofenceRequest,
          requirePhoto: setting.requirePhoto,
          breakPolicy: setting.breakPolicy,
          targetBreakMinutes: setting.targetBreakMinutes,
          normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay,
          shiftSpanMinutes: setting.shiftSpanMinutes,
          timezone: setting.timezone,
          isEnabled: setting.isEnabled,
        },
      });

    await writeAuditLog(
      {
        businessId: args.businessId,
        branchId: branch.id,
        actor: args.actor,
        request: args.request,
        action: existing
          ? "BRANCH_ATTENDANCE_SETTING_UPDATED"
          : "BRANCH_ATTENDANCE_SETTING_CREATED",
        entityType: "BranchAttendanceSetting",
        entityId: saved.id,
        summary: `Branch Attendance setting ${existing ? "updated" : "created"} for ${branch.name}.`,
        before: previousAuditSnapshot,
        after: settingAuditSnapshot(saved),
        metadata: {
          coordinatesChanged,
        },
      },
      transaction,
    );

    return saved;
  });
}

function bindTrustedBusinessId(input: unknown, businessId: string) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new Error("Branch Attendance setting input is invalid.");
  }

  return {
    ...(input as Record<string, unknown>),
    businessId,
  };
}

function assertAllowedBranch(
  branchId: string,
  allowedBranchIds: readonly string[],
) {
  if (!new Set(allowedBranchIds).has(branchId)) {
    throw new Error(
      "Attendance setting branch is outside the allowed branch scope.",
    );
  }
}

type StoredBranchAttendanceSetting = {
  geofenceRadiusMeters: number;
  minimumAccuracyMeters: number;
  requireGeofence: boolean;
  allowOutsideGeofenceRequest: boolean;
  requirePhoto: boolean;
  breakPolicy: "MANUAL_PUNCH" | "FLEXIBLE_CONFIRMATION" | "PAID_BREAK";
  targetBreakMinutes: number;
  normalWorkMinutesPerDay: number;
  shiftSpanMinutes: number;
  timezone: string;
  isEnabled: boolean;
};

function settingAuditSnapshot(
  setting: StoredBranchAttendanceSetting,
) {
  return {
    locationConfigured: true,
    geofenceRadiusMeters: setting.geofenceRadiusMeters,
    minimumAccuracyMeters: setting.minimumAccuracyMeters,
    requireGeofence: setting.requireGeofence,
    allowOutsideGeofenceRequest:
      setting.allowOutsideGeofenceRequest,
    requirePhoto: setting.requirePhoto,
    timezone: setting.timezone,
    breakPolicy: setting.breakPolicy,
    targetBreakMinutes: setting.targetBreakMinutes,
    normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay,
    shiftSpanMinutes: setting.shiftSpanMinutes,
    isEnabled: setting.isEnabled,
  };
}
