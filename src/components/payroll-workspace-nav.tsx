import {
  HrPayrollWorkspaceNav,
  type HrPayrollWorkspaceItem,
} from "@/components/hr-payroll-workspace-nav";
import styles from "@/components/hr-payroll-workspace.module.css";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";

export async function PayrollWorkspaceNav() {
  const { access, moduleContext } = await requireBusinessUser();
  const items: HrPayrollWorkspaceItem[] = [
    {
      href: "/team/payroll/workspace",
      label: "Prepare payroll",
      shortLabel: "Prepare",
      icon: "overview",
      activePrefixes: ["/team/payroll/workspace"],
    },
    {
      href: "/team/payroll/runs",
      label: "Calculate and review payroll",
      shortLabel: "Calculate & review",
      icon: "runs",
      activePrefixes: ["/team/payroll/runs", "/team/payroll/payslips"],
    },
  ];

  if (moduleContext.enabledModules.has("COMMISSION") && hasBusinessCapability(access, "VIEW_COMMISSION")) {
    items.push({ href: "/team/commission", label: "Payroll inputs and commission", shortLabel: "Pay inputs", icon: "commission" });
  }
  if (hasBusinessCapability(access, "VIEW_PAYMENT_BATCH")) {
    items.push({ href: "/team/payroll/payments", label: "Pay employees", shortLabel: "Pay", icon: "payments" });
  }
  if (moduleContext.enabledModules.has("STATUTORY") && hasBusinessCapability(access, "VIEW_STATUTORY_SUBMISSION")) {
    items.push({ href: "/team/payroll/statutory", label: "Statutory", icon: "statutory" });
  }
  if (hasBusinessCapability(access, "MODIFY_PAYROLL")) {
    items.push({ href: "/team/payroll/settings", label: "Settings", icon: "settings" });
  }

  return (
    <div className={styles.secondaryBar}>
      <HrPayrollWorkspaceNav items={items} label="Payroll sections" variant="secondary" />
    </div>
  );
}
