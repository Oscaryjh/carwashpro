import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export const employeeProfileTabs = [
  {
    key: "overview",
    label: "Overview",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    phase: "Phase 2",
  },
  {
    key: "personal",
    label: "Personal",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    phase: "Phase 2B",
  },
  {
    key: "employment",
    label: "Employment",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    phase: "Phase 2",
  },
  {
    key: "attendance",
    label: "Attendance",
    capabilities: ["VIEW_ATTENDANCE_EMPLOYEES"],
    phase: "Phase 2",
  },
  {
    key: "leave",
    label: "Leave",
    capabilities: ["VIEW_ATTENDANCE_EMPLOYEES"],
    phase: "Phase 2B",
  },
  {
    key: "payroll",
    label: "Payroll",
    capabilities: [
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "VIEW_PAYSLIP",
      "VIEW_BANK_ACCOUNT",
      "VIEW_STATUTORY_PROFILE",
      "VIEW_TAX_PROFILE",
      "VIEW_PAYMENT_BATCH",
    ],
    phase: "Phase 3",
  },
  {
    key: "documents",
    label: "Documents",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    phase: "Future",
  },
  {
    key: "activity",
    label: "Activity",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    phase: "Future",
  },
] as const satisfies readonly {
  key: string;
  label: string;
  capabilities: readonly BusinessCapability[];
  phase: string;
}[];

export type EmployeeProfileSection =
  (typeof employeeProfileTabs)[number]["key"];

export function isEmployeeProfileSection(
  value: string | undefined,
): value is EmployeeProfileSection {
  return employeeProfileTabs.some((tab) => tab.key === value);
}

export function canViewEmployeeProfileTab(
  access: ResolvedBusinessAccess,
  section: EmployeeProfileSection,
) {
  const tab = employeeProfileTabs.find((item) => item.key === section);
  return Boolean(
    tab?.capabilities.some((capability) =>
      hasBusinessCapability(access, capability),
    ),
  );
}

export function getVisibleEmployeeProfileTabs(access: ResolvedBusinessAccess) {
  return employeeProfileTabs.filter((tab) =>
    tab.capabilities.some((capability) =>
      hasBusinessCapability(access, capability),
    ),
  );
}
