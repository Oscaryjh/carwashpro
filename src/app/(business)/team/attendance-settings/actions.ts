"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuditRequestContext } from "@/lib/audit";
import { upsertBranchAttendanceSetting } from "@/lib/attendance/branch-setting-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";

export type BranchAttendanceSettingActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export async function saveBranchAttendanceSettingAction(
  _previousState: BranchAttendanceSettingActionState,
  formData: FormData,
): Promise<BranchAttendanceSettingActionState> {
  try {
    const { access, user, businessId } = await requireBusinessUser(
      "MODIFY_ATTENDANCE_SETTINGS",
    );
    const scope = await resolveAttendanceScope(access);
    const branchId = String(formData.get("branchId") ?? "").trim();
    const request = await getAuditRequestContext();

    await upsertBranchAttendanceSetting({
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request,
      input: {
        businessId,
        branchId,
        latitude: formData.get("latitude"),
        longitude: formData.get("longitude"),
        geofenceRadiusMeters: formData.get("geofenceRadiusMeters"),
        minimumAccuracyMeters: formData.get("minimumAccuracyMeters"),
        requireGeofence: formData.get("requireGeofence") === "on",
        allowOutsideGeofenceRequest:
          formData.get("allowOutsideGeofenceRequest") === "on",
        requirePhoto: formData.get("requirePhoto") === "on",
        timezone: formData.get("timezone"),
        isEnabled: formData.get("isEnabled") === "on",
      },
    });

    revalidatePath("/team/attendance-settings");
    revalidatePath(`/team/attendance-settings/${branchId}`);
    redirect(
      `/team/attendance-settings/${branchId}?type=success&message=${encodeURIComponent(
        "Attendance settings saved successfully.",
      )}`,
    );
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return toActionError(error, "Unable to save attendance settings.");
  }
}

function toActionError(
  error: unknown,
  fallback: string,
): BranchAttendanceSettingActionState {
  if (error instanceof z.ZodError) {
    const flattened = error.flatten();
    return {
      status: "error",
      message: error.issues[0]?.message ?? fallback,
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      status: "error",
      message: "Attendance settings could not be saved safely.",
    };
  }

  return {
    status: "error",
    message: error instanceof Error ? error.message : fallback,
  };
}
