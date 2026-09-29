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
    mode?: "location" | "policy";
  };

export async function upsertBranchAttendanceSetting(
  args: UpsertBranchAttendanceSettingArgs,
  database: AttendanceServiceDatabase = prisma,
) {
  const input = bindTrustedBusinessId(args.input, args.businessId);
  const branchId = String(input.branchId ?? "");
  assertAllowedBranch(branchId, args.allowedBranchIds);
  if (!args.mode) validateBranchAttendanceSettingInput(input);

  return database.$transaction(async (transaction) => {
    const branch = await transaction.branch.findFirst({
      where: {
        id: branchId,
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

    if (args.mode === "policy" && !existing) {
      throw new Error("Configure the clock-in location in Business details first.");
    }
    const locationKeys = ["latitude", "longitude", "geofenceRadiusMeters", "minimumAccuracyMeters", "timezone"] as const;
    const policyKeys = ["isEnabled", "requireGeofence", "allowOutsideGeofenceRequest", "breakPolicy", "targetBreakMinutes", "normalWorkMinutesPerDay", "shiftSpanMinutes"] as const;
    const changes = args.mode
      ? Object.fromEntries((args.mode === "location" ? locationKeys : policyKeys).map((key) => [key, input[key]]))
      : input;
    if (args.mode === "location" && [changes.latitude, changes.longitude].some((value) => value === null || value === undefined || String(value).trim() === "")) {
      throw new Error("Enter both latitude and longitude.");
    }
    const setting = validateBranchAttendanceSettingInput({
      ...(args.mode && existing ? { ...existing, latitude: existing.latitude.toString(), longitude: existing.longitude.toString() } : {}),
      ...changes,
      businessId: args.businessId,
      branchId,
    });
    const update = args.mode
      ? Object.fromEntries((args.mode === "location" ? locationKeys : policyKeys).map((key) => [key, setting[key]]))
      : {
          latitude: setting.latitude, longitude: setting.longitude,
          geofenceRadiusMeters: setting.geofenceRadiusMeters, minimumAccuracyMeters: setting.minimumAccuracyMeters,
          requireGeofence: setting.requireGeofence, allowOutsideGeofenceRequest: setting.allowOutsideGeofenceRequest,
          requirePhoto: setting.requirePhoto, breakPolicy: setting.breakPolicy, targetBreakMinutes: setting.targetBreakMinutes,
          normalWorkMinutesPerDay: setting.normalWorkMinutesPerDay, shiftSpanMinutes: setting.shiftSpanMinutes,
          timezone: setting.timezone, isEnabled: setting.isEnabled,
        };

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
        update,
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
  } as Record<string, unknown> & { businessId: string };
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
