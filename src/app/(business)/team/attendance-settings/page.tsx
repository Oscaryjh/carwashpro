import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { resolveCompanyLocationTarget } from "@/lib/attendance/company-location";
import styles from "./attendance-settings.module.css";

export default async function AttendanceSettingsPage() {
  const { access, businessId } = await requireBusinessUser(
    "VIEW_ATTENDANCE_SETTINGS",
  );
  const scope = await resolveAttendanceScope(access);
  const canManage = hasBusinessCapability(access, "MODIFY_ATTENDANCE_SETTINGS");
  const locationTarget = await resolveCompanyLocationTarget(access);
  const [business, branches] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    }),
    prisma.branch.findMany({
      where: {
        businessId,
        id: { in: [...scope.allowedBranchIds] },
        status: "ACTIVE",
      },
      include: { attendanceSetting: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      <div className="page-header hr-module-header">
        <div>
          <span className="hr-module-eyebrow">HR &amp; Payroll</span>
          <h1>Attendance Settings</h1>
          <p>
            Configure secure branch geofence rules for {business?.name ?? "this business"}.
            The same rules apply to Staff App clock-ins and Attendance APIs.
          </p>
        </div>
      </div>

      {branches.length ? (
        <div className={styles.branchGrid}>
          {branches.map((branch) => {
            const setting = branch.attendanceSetting;
            return (
              <article className={styles.branchCard} key={branch.id}>
                <div className={styles.branchHeading}>
                  <div>
                    <span>BRANCH</span>
                    <h2>{branch.name}</h2>
                  </div>
                  <span
                    className={
                      setting?.isEnabled ? styles.enabled : styles.disabled
                    }
                  >
                    {setting
                      ? setting.isEnabled
                        ? "Active"
                        : "Paused"
                      : "Not configured"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Geofence radius</dt>
                    <dd>{setting?.geofenceRadiusMeters ?? 100} m</dd>
                  </div>
                  <div>
                    <dt>Max GPS error</dt>
                    <dd>{setting?.minimumAccuracyMeters ?? 80} m</dd>
                  </div>
                  <div>
                    <dt>Timezone</dt>
                    <dd>{setting ? timeZoneLabel(setting.timezone) : "Business default"}</dd>
                  </div>
                  <div>
                    <dt>Outside request</dt>
                    <dd>
                      {(setting?.allowOutsideGeofenceRequest ?? true)
                        ? "Allowed"
                        : "Blocked"}
                    </dd>
                  </div>
                </dl>
                {locationTarget.kind === "single" && <div><h3>Clock-in location</h3><p>{setting ? "Location configured" : "Location not configured"}</p><p>Managed in Business details</p>{canManage && <Link href="/business/settings/clock-in-location">Manage location →</Link>}</div>}
                {canManage ? (
                  <Link
                    className="button-link"
                    href={`/team/attendance-settings/${branch.id}`}
                  >
                    {locationTarget.kind === "single" ? "Attendance rules" : "GPS & Attendance"}
                  </Link>
                ) : (
                  <p className={styles.readOnly}>
                    You have read-only access to these settings.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          No active branch is available in your authorized scope.
        </div>
      )}
    </section>
  );
}

function timeZoneLabel(timezone: string) {
  return timezone === "Asia/Kuching" || timezone === "Asia/Kuala_Lumpur"
    ? "Malaysia (UTC+8)"
    : timezone;
}
