import type { ModuleKey } from "@/lib/modules/registry";

export type StaffNavigationItem = {
  href: string;
  label: string;
  icon: StaffNavigationIcon;
  section?: "SELF_SERVICE" | "ACCOUNT";
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
  | "more";

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
      { href: "/staff/roster", label: "Schedule", icon: "schedule" },
      { href: "/staff/leave", label: "Leave", icon: "leave" },
    );
    more.push(
      { href: "/staff/timesheet", label: "Timesheets", icon: "timesheet", section: "SELF_SERVICE" },
    );
  }
  if (modules.has("CLAIMS")) {
    more.push({ href: "/staff/claims", label: "Claims", icon: "claims", section: "SELF_SERVICE" });
  }
  if (modules.has("COMMISSION")) {
    more.push({ href: "/staff/commission", label: "Commission", icon: "commission", section: "SELF_SERVICE" });
  }
  if (modules.has("PAYROLL")) {
    more.push({ href: "/staff/payslips", label: "Payslips", icon: "payslip", section: "SELF_SERVICE" });
  }

  more.push({ href: "/staff/profile", label: "Profile", icon: "profile", section: "ACCOUNT" });
  return { primary, more };
}
