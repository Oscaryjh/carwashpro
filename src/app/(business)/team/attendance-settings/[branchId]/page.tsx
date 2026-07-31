import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceSettingsForm } from "@/components/attendance-settings-form";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { saveBranchAttendanceSettingAction } from "../actions";
import styles from "../attendance-settings.module.css";

type AttendanceSettingsDetailPageProps = {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ message?: string; type?: string }>;
};

export default async function AttendanceSettingsDetailPage({
  params,
  searchParams,
}: AttendanceSettingsDetailPageProps) {
  const { branchId } = await params;
  const query = await searchParams;
  const { access, businessId } = await requireBusinessUser(
    "MODIFY_ATTENDANCE_SETTINGS",
  );
  const scope = await resolveAttendanceScope(access);

  if (!scope.allowedBranchIds.includes(branchId)) {
    notFound();
  }

  const [business, branch] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    }),
    prisma.branch.findFirst({
      where: {
        id: branchId,
        businessId,
        status: "ACTIVE",
      },
      include: { attendanceSetting: true },
    }),
  ]);

  if (!branch) {
    notFound();
  }

  const setting = branch.attendanceSetting;

  return (
    <section className={`content ${styles.page}`}>
      <div className="page-header">
        <div>
          <h1>{branch.name}</h1>
          <p>Attendance geofence and device-location acceptance settings.</p>
        </div>
        <Link className="secondary-light-button" href="/team/attendance-settings">
          Back to Attendance Settings
        </Link>
      </div>

      {query.message ? (
        <div className={query.type === "error" ? "error" : "success"}>
          {query.message}
        </div>
      ) : null}

      <AttendanceSettingsForm
        action={saveBranchAttendanceSettingAction}
        branch={{ id: branch.id, name: branch.name }}
        initialValues={{
          latitude: setting?.latitude.toString() ?? "",
          longitude: setting?.longitude.toString() ?? "",
          geofenceRadiusMeters: setting?.geofenceRadiusMeters ?? 100,
          minimumAccuracyMeters: setting?.minimumAccuracyMeters ?? 80,
          requireGeofence: setting?.requireGeofence ?? true,
          allowOutsideGeofenceRequest:
            setting?.allowOutsideGeofenceRequest ?? true,
          breakPolicy: setting?.breakPolicy ?? "MANUAL_PUNCH",
          targetBreakMinutes: setting?.targetBreakMinutes ?? 60,
          normalWorkMinutesPerDay: setting?.normalWorkMinutesPerDay ?? 480,
          shiftSpanMinutes: setting?.shiftSpanMinutes ?? 540,
          timezone: setting?.timezone ?? business?.timezone ?? "Asia/Kuching",
          isEnabled: setting?.isEnabled ?? false,
        }}
      />
    </section>
  );
}
