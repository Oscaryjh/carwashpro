import type { ModuleKey } from "@/lib/modules/registry";

export type StaffNavigationItem = {
  href: string;
  label: string;
  icon: StaffNavigationIcon;
  activePrefixes?: readonly string[];
};

export type StaffNavigationIcon =
  | "home"
  | "attendance"
  | "leave"
  | "schedule"
  | "timesheet"
  | "claims"
  | "commission"
  | "payslip"
  | "profile"
  | "approvals"
  | "pay";

export type StaffNavigation = {
  primary: StaffNavigationItem[];
  more: StaffNavigationItem[];
};

export function buildStaffNavigation(
  enabledModules: readonly string[],
  options: { canApprove?: boolean } = {},
): StaffNavigation {
  const modules = new Set(enabledModules as readonly ModuleKey[]);
  const primary: StaffNavigationItem[] = [
    { href: "/staff", label: "Home", icon: "home", activePrefixes: ["/staff/leave", "/staff/claims"] },
  ];

  if (modules.has("HR")) {
    primary.push({
      href: "/staff/history",
      label: "Time",
      icon: "attendance",
      activePrefixes: ["/staff/history", "/staff/roster", "/staff/timesheet", "/staff/appointments"],
    });
  }
  if (modules.has("HR") && options.canApprove === true) {
    primary.push({
      href: "/staff/approvals",
      label: "Approvals",
      icon: "approvals",
      activePrefixes: ["/staff/approvals", "/staff/requests"],
    });
  }
  if (modules.has("PAYROLL") || modules.has("COMMISSION")) {
    primary.push({
      href: "/staff/pay",
      label: "Pay",
      icon: "pay",
      activePrefixes: ["/staff/pay", "/staff/payslips", "/staff/commission"],
    });
  }

  primary.push({ href: "/staff/profile", label: "Profile", icon: "profile" });
  return { primary, more: [] };
}

export function isStaffNavigationItemActive(currentPath: string, item: StaffNavigationItem) {
  if (currentPath === item.href) return true;
  if (item.href === "/staff/profile" && currentPath === "/staff/device") return true;
  const prefixes = item.activePrefixes ?? (item.href === "/staff" ? [] : [item.href]);
  return prefixes.some(prefix => currentPath === prefix || currentPath.startsWith(`${prefix}/`));
}
