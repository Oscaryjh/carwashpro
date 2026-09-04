export const STAFF_APP_DOMAINS = [
  "APPOINTMENTS",
  "ROSTER",
  "TIMESHEET",
  "LEAVE",
  "CLAIMS",
  "COMMISSION",
  "PAYSLIP",
] as const;

export type StaffAppDomain = (typeof STAFF_APP_DOMAINS)[number];

export const STAFF_APP_ICON_OPTIONS = [
  { value: "schedule-3d", label: "Schedule · 3D" },
  { value: "timesheets-3d", label: "Timesheets · 3D" },
  { value: "leave-3d", label: "Leave · 3D" },
  { value: "claims-3d", label: "Claims · 3D" },
  { value: "commission-3d", label: "Commission · 3D" },
  { value: "payslips-3d", label: "Payslips · 3D" },
  { value: "calendar", label: "Calendar" },
  { value: "clock", label: "Clock" },
  { value: "document", label: "Document" },
  { value: "leaf", label: "Leaf" },
  { value: "receipt", label: "Receipt" },
  { value: "money", label: "Money" },
  { value: "wallet", label: "Wallet" },
  { value: "briefcase", label: "Briefcase" },
  { value: "sparkle", label: "Sparkle" },
  { value: "person", label: "Person" },
] as const;

export type StaffAppIconName = (typeof STAFF_APP_ICON_OPTIONS)[number]["value"];

export const DEFAULT_STAFF_APP_ICONS: Readonly<Record<StaffAppDomain, StaffAppIconName>> = {
  APPOINTMENTS: "calendar",
  ROSTER: "schedule-3d",
  TIMESHEET: "timesheets-3d",
  LEAVE: "leave-3d",
  CLAIMS: "claims-3d",
  COMMISSION: "commission-3d",
  PAYSLIP: "payslips-3d",
};

export const STAFF_APP_DOMAIN_LABELS: Readonly<Record<StaffAppDomain, string>> = {
  APPOINTMENTS: "Appointments",
  ROSTER: "Schedule",
  TIMESHEET: "Timesheets",
  LEAVE: "Leave",
  CLAIMS: "Claims",
  COMMISSION: "Commission",
  PAYSLIP: "Payslips",
};

export type StaffAppAppearance = Readonly<{
  logoUrl: string | null;
  quickAccessIcons: Readonly<Record<StaffAppDomain, StaffAppIconName>>;
}>;

const iconNames = new Set<string>(STAFF_APP_ICON_OPTIONS.map((option) => option.value));

export function resolveStaffAppAppearance(
  stored: unknown,
  staffAppLogoUrl: string | null = null,
  businessLogoUrl: string | null = null,
): StaffAppAppearance {
  const quickAccessIcons = { ...DEFAULT_STAFF_APP_ICONS };
  const storedIcons = readStoredIcons(stored);

  for (const domain of STAFF_APP_DOMAINS) {
    const candidate = storedIcons?.[domain];
    if (typeof candidate === "string" && iconNames.has(candidate)) {
      quickAccessIcons[domain] = candidate as StaffAppIconName;
    }
  }

  return {
    logoUrl: businessLogoUrl ?? staffAppLogoUrl,
    quickAccessIcons,
  };
}

export function toStoredStaffAppAppearance(
  quickAccessIcons: Readonly<Record<StaffAppDomain, StaffAppIconName>>,
) {
  return {
    version: 1,
    quickAccessIcons: Object.fromEntries(
      STAFF_APP_DOMAINS.map((domain) => [domain, quickAccessIcons[domain]]),
    ),
  };
}

function readStoredIcons(stored: unknown): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const value = (stored as { quickAccessIcons?: unknown }).quickAccessIcons;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
