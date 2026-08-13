import type { ReactNode } from "react";
import {
  HrPayrollWorkspaceNav,
  type HrPayrollWorkspaceItem,
} from "@/components/hr-payroll-workspace-nav";
import styles from "@/components/hr-payroll-workspace.module.css";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export default async function TeamLayout({ children }: { children: ReactNode }) {
  const { access, moduleContext } = await requireBusinessUser();
  const enabled = moduleContext.enabledModules;
  const items: HrPayrollWorkspaceItem[] = [];

  if (hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY")) {
    items.push({
      href: "/team",
      label: "People",
      icon: "people",
      exact: true,
      activePrefixes: ["/team/employees", "/team/people", "/team/new"],
    });
  }
  if (hasAnyCapability(access, ["APPROVE_LEAVE", "REVIEW_CLAIM", "APPROVE_PAYROLL", "MODIFY_ATTENDANCE_EMPLOYEES"])) {
    items.push({ href: "/team/approvals", label: "Approvals", icon: "approvals" });
  }
  if (enabled.has("HR") && hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES")) {
    items.push({
      href: "/team/attendance",
      label: "Attendance",
      icon: "attendance",
      activePrefixes: ["/team/attendance-settings"],
    });
  }
  if (enabled.has("HR") && hasBusinessCapability(access, "VIEW_ROSTER")) {
    items.push({ href: "/team/roster", label: "Roster", icon: "roster" });
  }
  if (enabled.has("HR") && hasBusinessCapability(access, "VIEW_LEAVE")) {
    items.push({ href: "/team/leave", label: "Leave", icon: "leave" });
  }
  if (enabled.has("CLAIMS") && hasBusinessCapability(access, "VIEW_CLAIM")) {
    items.push({ href: "/team/claims", label: "Claims", icon: "claims" });
  }
  if (enabled.has("COMMISSION") && hasBusinessCapability(access, "VIEW_COMMISSION")) {
    items.push({ href: "/team/commission", label: "Commission", shortLabel: "Commission", icon: "commission" });
  }
  if (enabled.has("PAYROLL") && hasBusinessCapability(access, "VIEW_PAYROLL_RUN")) {
    items.push({ href: "/team/payroll", label: "Payroll", icon: "payroll" });
  }

  return (
    <div className={styles.workspace} data-hr-payroll-workspace="true">
      {items.length ? (
        <div className={styles.workspaceBar}>
          <div className={styles.workspaceIdentity}>
            <small>Workforce</small>
            <strong>HR &amp; Payroll</strong>
          </div>
          <HrPayrollWorkspaceNav items={items} label="HR and Payroll sections" />
        </div>
      ) : null}
      <div className={styles.contentArea}>{children}</div>
    </div>
  );
}

function hasAnyCapability(
  access: Parameters<typeof hasBusinessCapability>[0],
  capabilities: Parameters<typeof hasBusinessCapability>[1][],
) {
  return capabilities.some((capability) => hasBusinessCapability(access, capability));
}
