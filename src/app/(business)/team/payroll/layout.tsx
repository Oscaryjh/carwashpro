import type { ReactNode } from "react";
import {
  HrPayrollWorkspaceNav,
  type HrPayrollWorkspaceItem,
} from "@/components/hr-payroll-workspace-nav";
import styles from "@/components/hr-payroll-workspace.module.css";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const { access, moduleContext } = await requireBusinessUser();
  const items: HrPayrollWorkspaceItem[] = [
    { href: "/team/payroll", label: "Overview", icon: "overview", exact: true },
    { href: "/team/payroll/workspace", label: "Workspace", icon: "payroll" },
    { href: "/team/payroll/runs", label: "Payroll runs", shortLabel: "Runs", icon: "runs" },
  ];

  if (hasBusinessCapability(access, "VIEW_PAYMENT_BATCH")) {
    items.push({ href: "/team/payroll/payments", label: "Payments", icon: "payments" });
  }
  if (
    moduleContext.enabledModules.has("STATUTORY") &&
    hasBusinessCapability(access, "VIEW_STATUTORY_SUBMISSION")
  ) {
    items.push({ href: "/team/payroll/statutory", label: "Statutory", icon: "statutory" });
  }
  if (hasBusinessCapability(access, "MODIFY_PAYROLL")) {
    items.push({ href: "/team/payroll/settings", label: "Settings", icon: "settings" });
  }

  return (
    <>
      <div className={styles.secondaryBar}>
        <HrPayrollWorkspaceNav items={items} label="Payroll sections" variant="secondary" />
      </div>
      {children}
    </>
  );
}
