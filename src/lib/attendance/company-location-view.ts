import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveCompanyLocationTarget } from "./company-location";
import type { CompanyLocationView } from "@/components/company-clock-in-location";

export async function loadCompanyLocationView(access: ResolvedBusinessAccess, hrEnabled: boolean, timezone: string): Promise<CompanyLocationView> {
  const target = await resolveCompanyLocationTarget(access);
  const canManage = hasBusinessCapability(access, "MODIFY_ATTENDANCE_SETTINGS");
  if (target.kind !== "single") return { kind: target.kind, canManage, configured: false, hrEnabled };
  const setting = target.branch.attendanceSetting;
  return { kind: "single", branch: { id: target.branch.id, name: target.branch.name }, canManage, hrEnabled, configured: Boolean(setting), values: {
    latitude: setting?.latitude.toString() ?? "", longitude: setting?.longitude.toString() ?? "",
    geofenceRadiusMeters: setting?.geofenceRadiusMeters ?? 100, minimumAccuracyMeters: setting?.minimumAccuracyMeters ?? 80,
    timezone: setting?.timezone ?? timezone, isEnabled: setting?.isEnabled ?? false,
    requireGeofence: setting?.requireGeofence ?? true, allowOutsideGeofenceRequest: setting?.allowOutsideGeofenceRequest ?? true,
    breakPolicy: setting?.breakPolicy ?? "MANUAL_PUNCH", targetBreakMinutes: setting?.targetBreakMinutes ?? 60,
    normalWorkMinutesPerDay: setting?.normalWorkMinutesPerDay ?? 480, shiftSpanMinutes: setting?.shiftSpanMinutes ?? 540,
  } };
}
