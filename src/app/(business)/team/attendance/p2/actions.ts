"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { materializeAttendanceP2Day, recordExpectedAttendance } from "@/lib/attendance/p2-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { parseBranchLocalDateTime } from "@/lib/attendance/work-date";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export async function recordExpectedAttendanceAction(formData: FormData) {
  try {
    const context = await writeContext();
    const branchId = String(formData.get("branchId") ?? "");
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, businessId: context.businessId },
      select: { attendanceSetting: { select: { timezone: true } } },
    });
    const timezone = branch?.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
    const kind = String(formData.get("kind") ?? "");
    const workDate = parseDate(formData.get("workDate"));
    const start = String(formData.get("expectedStartLocal") ?? "");
    const end = String(formData.get("expectedEndLocal") ?? "");
    await recordExpectedAttendance({
      context,
      input: {
        branchId,
        membershipId: formData.get("membershipId"),
        workDate,
        kind,
        source: "MANUAL_EVIDENCE",
        expectedStartAt: kind === "WORKDAY" ? parseBranchLocalDateTime(`${dateText(workDate)}T${start}`, timezone) : null,
        expectedEndAt: kind === "WORKDAY" ? parseBranchLocalDateTime(`${dateText(workDate)}T${end}`, timezone) : null,
        graceMinutes: Number(formData.get("graceMinutes") ?? 0),
        timezoneSnapshot: timezone,
        evidenceReference: String(formData.get("evidenceReference") ?? "") || null,
      },
    });
    await materializeAttendanceP2Day({ context, membershipId: String(formData.get("membershipId")), workDate });
    done("Expected Attendance evidence recorded and day exceptions refreshed.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(error instanceof Error ? error.message : "Unable to record expected Attendance evidence.", "error");
  }
}

export async function detectAttendanceP2DayAction(formData: FormData) {
  try {
    const context = await writeContext();
    await materializeAttendanceP2Day({
      context,
      membershipId: String(formData.get("membershipId") ?? ""),
      workDate: parseDate(formData.get("workDate")),
    });
    done("Attendance day checked using current raw, expected and Leave evidence.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    done(error instanceof Error ? error.message : "Unable to check Attendance day.", "error");
  }
}

async function writeContext() {
  const { access, user, businessId } = await requireBusinessUser("MODIFY_ATTENDANCE_EMPLOYEES");
  const [scope, request] = await Promise.all([resolveAttendanceScope(access), getAuditRequestContext()]);
  return { businessId, allowedBranchIds: scope.allowedBranchIds, actor: user, request };
}
function parseDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Select a valid Attendance work date.");
  return new Date(`${text}T00:00:00.000Z`);
}
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function done(message: string, type: "success" | "error" = "success"): never {
  revalidatePath("/team/attendance/p2");
  revalidatePath("/team/attendance/resolutions");
  revalidatePath("/team/attendance/timesheets");
  redirect(`/team/attendance/p2?type=${type}&message=${encodeURIComponent(message)}`);
}
