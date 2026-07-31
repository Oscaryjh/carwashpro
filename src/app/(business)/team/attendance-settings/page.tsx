import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import styles from "./attendance-settings.module.css";

export default async function AttendanceSettingsPage() {
  const { access, businessId } = await requireBusinessUser(
    "VIEW_ATTENDANCE_SETTINGS",
  );
  const scope = await resolveAttendanceScope(access);
  const canManage =
    access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY" ||
    access.permissions.includes("ATTENDANCE_SETTINGS_MANAGE");
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
          </p>
        </div>
        <div className={`hr-module-actions ${styles.headerActions}`}>
          <Link className="secondary-light-button" href="/team?section=people">
            People
          </Link>
          <Link className="secondary-light-button" href="/team/attendance">
            Attendance
          </Link>
        </div>
      </div>

      <div className={styles.notice}>
        <strong>Attendance API enforcement</strong>
        <span>
          Employee attendance APIs enforce these branch location rules. The
          Staff PWA and attendance administration use the same enforced rules.
        </span>
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
                        ? "Enabled"
                        : "Disabled"
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
                    <dd>{setting?.timezone ?? "Business default"}</dd>
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
                {canManage ? (
                  <Link
                    className="button-link"
                    href={`/team/attendance-settings/${branch.id}`}
                  >
                    {setting ? "Manage settings" : "Configure branch"}
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
