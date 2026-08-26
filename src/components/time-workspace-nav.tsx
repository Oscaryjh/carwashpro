import {
  HrPayrollWorkspaceNav,
  type HrPayrollWorkspaceItem,
} from "@/components/hr-payroll-workspace-nav";
import styles from "@/components/hr-payroll-workspace.module.css";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export async function TimeWorkspaceNav() {
  const { access } = await requireBusinessUser();
  const items: HrPayrollWorkspaceItem[] = [
    { href: "/team/time", label: "Overview", icon: "overview", exact: true },
  ];

  if (hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES")) {
    items.push({ href: "/team/attendance", label: "Attendance", icon: "attendance", exact: true });
  }
  if (hasBusinessCapability(access, "VIEW_ROSTER")) {
    items.push({ href: "/team/roster", label: "Roster", icon: "roster" });
  }
  if (hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES")) {
    items.push({ href: "/team/attendance/timesheets", label: "Timesheets", icon: "timesheet" });
  }
  if (hasBusinessCapability(access, "VIEW_ROSTER")) {
    items.push({ href: "/team/holidays", label: "Holidays", icon: "holiday" });
  }
  if (hasBusinessCapability(access, "VIEW_ATTENDANCE_SETTINGS")) {
    items.push({ href: "/team/attendance-settings", label: "Settings", icon: "settings" });
  }

  return (
    <div className={styles.secondaryBar}>
      <HrPayrollWorkspaceNav items={items} label="Time sections" variant="secondary" />
    </div>
  );
}
