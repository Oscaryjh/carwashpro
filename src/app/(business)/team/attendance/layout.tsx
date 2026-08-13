import type { ReactNode } from "react";
import {
  HrPayrollWorkspaceNav,
  type HrPayrollWorkspaceItem,
} from "@/components/hr-payroll-workspace-nav";
import styles from "@/components/hr-payroll-workspace.module.css";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export default async function AttendanceLayout({ children }: { children: ReactNode }) {
  const { access } = await requireBusinessUser();
  const items: HrPayrollWorkspaceItem[] = [
    { href: "/team/attendance", label: "Overview", icon: "attendance", exact: true },
    { href: "/team/attendance/p2", label: "Expected work", icon: "evidence" },
    { href: "/team/attendance/timesheets", label: "Timesheets", icon: "timesheet" },
  ];

  if (hasBusinessCapability(access, "MODIFY_ATTENDANCE_EMPLOYEES")) {
    items.splice(2, 0, {
      href: "/team/attendance/resolutions",
      label: "Resolution queue",
      shortLabel: "Resolutions",
      icon: "resolution",
    });
  }
  if (hasBusinessCapability(access, "VIEW_ATTENDANCE_SETTINGS")) {
    items.push({ href: "/team/attendance-settings", label: "Settings", icon: "settings" });
  }

  return (
    <>
      <div className={styles.secondaryBar}>
        <HrPayrollWorkspaceNav items={items} label="Attendance sections" variant="secondary" />
      </div>
      {children}
    </>
  );
}
