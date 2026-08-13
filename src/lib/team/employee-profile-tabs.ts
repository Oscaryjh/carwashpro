import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import type { ModuleKey } from "@/lib/modules/registry";

export const employeeProfileTabs = [
  {
    key: "overview",
    label: "Overview",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModule: "CORE",
    phase: "Phase 2",
  },
  {
    key: "personal",
    label: "Personal",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModule: "CORE",
    phase: "Phase 2B",
  },
  {
    key: "employment",
    label: "Employment",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModule: "HR",
    phase: "Phase 2",
  },
  {
    key: "attendance",
    label: "Attendance",
    capabilities: ["VIEW_ATTENDANCE_EMPLOYEES"],
    requiredModule: "HR",
    phase: "Phase 2C",
  },
  {
    key: "leave",
    label: "Leave",
    capabilities: ["VIEW_LEAVE"],
    requiredModule: "HR",
    phase: "Phase 2D",
  },
  {
    key: "claims",
    label: "Claims",
    capabilities: ["VIEW_CLAIM"],
    requiredModule: "CLAIMS",
    phase: "Claims closure",
  },
  {
    key: "payroll",
    label: "Payroll",
    capabilities: [
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "VIEW_PAYSLIP",
      "VIEW_BANK_ACCOUNT",
      "VIEW_PAYMENT_BATCH",
    ],
    requiredModule: "PAYROLL",
    phase: "Phase 3",
  },
  {
    key: "statutory",
    label: "Statutory",
    capabilities: ["VIEW_STATUTORY_PROFILE", "VIEW_TAX_PROFILE"],
    requiredModule: "STATUTORY",
    phase: "Statutory P2",
  },
  {
    key: "documents",
    label: "Documents",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModule: "CORE",
    phase: "Future",
  },
  {
    key: "activity",
    label: "Activity",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModule: "CORE",
    phase: "Future",
  },
] as const satisfies readonly {
  key: string;
  label: string;
  capabilities: readonly BusinessCapability[];
  requiredModule: ModuleKey;
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
  enabledModules?: ReadonlySet<ModuleKey>,
) {
  const tab = employeeProfileTabs.find((item) => item.key === section);
  return Boolean(
    tab &&
      tab.phase !== "Future" &&
      (!enabledModules || enabledModules.has(tab.requiredModule)) &&
      tab.capabilities.some((capability) =>
        hasBusinessCapability(access, capability),
      ),
  );
}

export function getVisibleEmployeeProfileTabs(
  access: ResolvedBusinessAccess,
  enabledModules?: ReadonlySet<ModuleKey>,
) {
  return employeeProfileTabs.filter(
    (tab) =>
      tab.phase !== "Future" &&
      (!enabledModules || enabledModules.has(tab.requiredModule)) &&
      tab.capabilities.some((capability) =>
        hasBusinessCapability(access, capability),
      ),
  );
}

export function moduleForEmployeeProfileSection(section: EmployeeProfileSection) {
  return employeeProfileTabs.find((tab) => tab.key === section)?.requiredModule ?? "CORE";
}
