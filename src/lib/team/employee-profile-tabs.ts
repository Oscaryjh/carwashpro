import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import type { ModuleKey } from "@/lib/modules/registry";

/** Employee Profile areas compose canonical employee-scoped read models. */
export const employeeProfileTabs = [
  {
    key: "overview",
    label: "Overview",
    description: "Identity, employment and current attention",
    group: "Employee 360",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModules: ["CORE"],
  },
  {
    key: "work",
    label: "Work",
    description: "Workplaces, services and appointments",
    group: "Employee 360",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModules: ["CORE"],
  },
  {
    key: "time",
    label: "Time & Leave",
    description: "Attendance, schedule and leave",
    group: "Employee 360",
    capabilities: ["VIEW_ATTENDANCE_EMPLOYEES", "VIEW_LEAVE"],
    requiredModules: ["HR"],
  },
  {
    key: "compensation",
    label: "Compensation",
    description: "Pay, commission, claims and compliance",
    group: "Employee 360",
    capabilities: [
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "VIEW_PAYSLIP",
      "VIEW_BANK_ACCOUNT",
      "VIEW_STATUTORY_PROFILE",
      "VIEW_TAX_PROFILE",
      "VIEW_COMMISSION",
      "VIEW_CLAIM",
    ],
    requiredModules: ["PAYROLL", "STATUTORY", "COMMISSION", "CLAIMS"],
  },
  {
    key: "access",
    label: "Access",
    description: "Staff App, POS, permissions and devices",
    group: "Employee 360",
    capabilities: ["VIEW_TEAM_DIRECTORY"],
    requiredModules: ["CORE"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  description: string;
  group: "Employee 360";
  capabilities: readonly BusinessCapability[];
  requiredModules: readonly ModuleKey[];
}[];

export type EmployeeProfileSection =
  (typeof employeeProfileTabs)[number]["key"];

export type EmployeeProfileLegacySection =
  | "attendance"
  | "leave"
  | "claims"
  | "commission"
  | "payroll"
  | "statutory";

export type EmployeeProfileNavigationTab = Omit<
  (typeof employeeProfileTabs)[number],
  "key"
> & {
  key: EmployeeProfileSection | EmployeeProfileLegacySection;
};

export type EmployeeProfileSubview =
  | EmployeeProfileLegacySection
  | "summary"
  | "schedule";

const legacyArea: Record<EmployeeProfileLegacySection, EmployeeProfileSection> = {
  attendance: "time",
  leave: "time",
  claims: "compensation",
  commission: "compensation",
  payroll: "compensation",
  statutory: "compensation",
};

const legacyRequirements: Record<
  EmployeeProfileLegacySection,
  { capabilities: readonly BusinessCapability[]; requiredModules: readonly ModuleKey[] }
> = {
  attendance: {
    capabilities: ["VIEW_ATTENDANCE_EMPLOYEES"],
    requiredModules: ["HR"],
  },
  leave: { capabilities: ["VIEW_LEAVE"], requiredModules: ["HR"] },
  claims: { capabilities: ["VIEW_CLAIM"], requiredModules: ["CLAIMS"] },
  commission: {
    capabilities: ["VIEW_COMMISSION"],
    requiredModules: ["COMMISSION"],
  },
  payroll: {
    capabilities: ["VIEW_COMPENSATION", "VIEW_PAYROLL_RUN", "VIEW_PAYSLIP"],
    requiredModules: ["PAYROLL"],
  },
  statutory: {
    capabilities: ["VIEW_STATUTORY_PROFILE", "VIEW_TAX_PROFILE"],
    requiredModules: ["STATUTORY"],
  },
};

export function resolveEmployeeProfileLocation(
  section: string | undefined,
  view: string | undefined,
): { section: EmployeeProfileSection; view: EmployeeProfileSubview } {
  if (section && section in legacyArea) {
    const legacy = section as EmployeeProfileLegacySection;
    return { section: legacyArea[legacy], view: legacy };
  }
  if (isEmployeeProfileSection(section)) {
    return {
      section,
      view: isEmployeeProfileSubview(view) ? view : "summary",
    };
  }
  return { section: "overview", view: "summary" };
}

export function isEmployeeProfileSection(
  value: string | undefined,
): value is EmployeeProfileSection {
  return employeeProfileTabs.some((tab) => tab.key === value);
}

export function isEmployeeProfileSubview(
  value: string | undefined,
): value is EmployeeProfileSubview {
  return [
    "summary",
    "attendance",
    "schedule",
    "leave",
    "claims",
    "commission",
    "payroll",
    "statutory",
  ].includes(value ?? "");
}

export function canViewEmployeeProfileTab(
  access: ResolvedBusinessAccess,
  section: EmployeeProfileSection | EmployeeProfileLegacySection,
  enabledModules?: ReadonlySet<ModuleKey>,
) {
  if (section in legacyRequirements) {
    const requirement = legacyRequirements[section as EmployeeProfileLegacySection];
    return (
      (!enabledModules ||
        requirement.requiredModules.some((module) =>
          enabledModules.has(module),
        )) &&
      requirement.capabilities.some((capability) =>
        hasBusinessCapability(access, capability),
      )
    );
  }
  const tab = employeeProfileTabs.find((item) => item.key === section);
  return Boolean(
    tab &&
      (!enabledModules ||
        tab.requiredModules.some((module) => enabledModules.has(module))) &&
      tab.capabilities.some((capability) =>
        hasBusinessCapability(access, capability),
      ),
  );
}

export function getVisibleEmployeeProfileTabs(
  access: ResolvedBusinessAccess,
  enabledModules?: ReadonlySet<ModuleKey>,
): EmployeeProfileNavigationTab[] {
  return employeeProfileTabs.filter(
    (tab) =>
      (!enabledModules ||
        tab.requiredModules.some((module) => enabledModules.has(module))) &&
      tab.capabilities.some((capability) =>
        hasBusinessCapability(access, capability),
      ),
  ) as EmployeeProfileNavigationTab[];
}

export function modulesForEmployeeProfileSection(
  section: EmployeeProfileSection | EmployeeProfileLegacySection,
) {
  if (section in legacyRequirements) {
    return legacyRequirements[section as EmployeeProfileLegacySection]
      .requiredModules;
  }
  return (
    employeeProfileTabs.find((tab) => tab.key === section)?.requiredModules ??
    (["CORE"] as const)
  );
}
