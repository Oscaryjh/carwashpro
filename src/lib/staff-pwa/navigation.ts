import type { ModuleKey } from "@/lib/modules/registry";

export type StaffNavigationItem = {
  href: string;
  label: string;
  icon: StaffNavigationIcon;
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
  | "profile";

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
  const more: StaffNavigationItem[] = [];

  if (modules.has("HR")) {
    primary.push(
      { href: "/staff/history", label: "Attendance", icon: "attendance" },
      { href: "/staff/leave", label: "Leave", icon: "leave" },
    );
    more.push(
      { href: "/staff/roster", label: "My Schedule", icon: "schedule" },
      { href: "/staff/timesheet", label: "My Timesheets", icon: "timesheet" },
    );
  }
  if (modules.has("CLAIMS")) {
    more.push({ href: "/staff/claims", label: "My Claims", icon: "claims" });
  }
  if (modules.has("COMMISSION")) {
    more.push({ href: "/staff/commission", label: "My Commission", icon: "commission" });
  }
  if (modules.has("PAYROLL")) {
    more.push({ href: "/staff/payslips", label: "My Payslips", icon: "payslip" });
  }

  primary.push({ href: "/staff/profile", label: "Profile", icon: "profile" });
  return { primary, more };
}
