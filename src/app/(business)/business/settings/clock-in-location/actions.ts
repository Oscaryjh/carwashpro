"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveCompanyLocationTarget } from "@/lib/attendance/company-location";
import { upsertBranchAttendanceSetting } from "@/lib/attendance/branch-setting-service";
import { getAuditRequestContext } from "@/lib/audit";
import type { BranchAttendanceSettingActionState } from "@/app/(business)/team/attendance-settings/actions";

export async function saveCompanyClockInLocationAction(
  _previous: BranchAttendanceSettingActionState, formData: FormData,
): Promise<BranchAttendanceSettingActionState> {
  try {
    const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_SETTINGS");
    const target = await resolveCompanyLocationTarget(access);
    if (target.kind !== "single") return { status: "error", message: target.kind === "legacy" ? "Manage locations in HR Attendance Settings for this multi-location business." : "No authorized active location is available. Contact your administrator." };
    if (["businessId", "branchId"].some(key => formData.has(key) && formData.get(key) !== (key === "businessId" ? businessId : target.branch.id))) {
      return { status: "error", message: "The selected location is not available." };
    }
    await upsertBranchAttendanceSetting({
      businessId, allowedBranchIds: target.scope.allowedBranchIds, actor: user,
      request: await getAuditRequestContext(), mode: "location",
      input: { branchId: target.branch.id, ...Object.fromEntries(["latitude", "longitude", "geofenceRadiusMeters", "minimumAccuracyMeters", "timezone"].map(key => [key, formData.get(key)])) },
    });
    revalidatePath("/business/settings");
    revalidatePath("/business/settings/clock-in-location");
    revalidatePath("/team/attendance-settings", "layout");
    return { status: "success", message: "Clock-in location saved. Company details and attendance availability were not changed." };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof z.ZodError) return { status: "error", message: error.issues[0]?.message ?? "Check the location values." };
    console.error("[clock-in-location] Save failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { status: "error", message: "Clock-in location could not be saved. Check the values and try again. Company details were not changed." };
  }
}
