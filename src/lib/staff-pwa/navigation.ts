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
  | "requests"
  | "pay";

export type StaffNavigation = {
  primary: StaffNavigationItem[];
  more: StaffNavigationItem[];
};

export function buildStaffNavigation(
  enabledModules: readonly string[],
): StaffNavigation {
  const modules = new Set(enabledModules as readonly ModuleKey[]);
  const primary: StaffNavigationItem[] = [
    { href: "/staff", label: "Home", icon: "home" },
  ];

  if (modules.has("HR")) {
    primary.push({
      href: "/staff/history",
      label: "Time",
      icon: "attendance",
      activePrefixes: ["/staff/history", "/staff/roster", "/staff/timesheet", "/staff/appointments"],
    });
  }
  if (modules.has("HR") || modules.has("CLAIMS")) {
    primary.push({
      href: "/staff/requests",
      label: "Requests",
      icon: "requests",
      activePrefixes: ["/staff/requests", "/staff/leave", "/staff/claims", "/staff/approvals"],
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
