import type { ModuleKey } from "@/lib/modules/registry";

export type StaffNavigationItem = {
  href: string;
  label: string;
  icon: StaffNavigationIcon;
  section?: "ACCOUNT";
};

export type StaffNavigationIcon =
  | "home"
  | "attendance"
  | "appointments"
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
    primary.push({ href: "/staff/history", label: "Attendance", icon: "attendance" });
  }
  if (modules.has("SALON")) {
    primary.push({ href: "/staff/appointments", label: "Appointments", icon: "appointments" });
  }
  if (modules.has("HR")) {
    primary.push({ href: "/staff/roster", label: "Schedule", icon: "schedule" });
  }

  more.push({ href: "/staff/profile", label: "Profile", icon: "profile", section: "ACCOUNT" });
  return { primary, more };
}
