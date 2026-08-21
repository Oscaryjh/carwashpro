export const STAFF_APP_DOMAINS = [
  "ROSTER",
  "TIMESHEET",
  "LEAVE",
  "CLAIMS",
  "COMMISSION",
  "PAYSLIP",
] as const;

export type StaffAppDomain = (typeof STAFF_APP_DOMAINS)[number];

export const STAFF_APP_ICON_OPTIONS = [
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
  ROSTER: "calendar",
  TIMESHEET: "document",
  LEAVE: "leaf",
  CLAIMS: "document",
  COMMISSION: "money",
  PAYSLIP: "receipt",
};

export const STAFF_APP_DOMAIN_LABELS: Readonly<Record<StaffAppDomain, string>> = {
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
  logoUrl: string | null = null,
): StaffAppAppearance {
  const quickAccessIcons = { ...DEFAULT_STAFF_APP_ICONS };
  const storedIcons = readStoredIcons(stored);

  for (const domain of STAFF_APP_DOMAINS) {
    const candidate = storedIcons?.[domain];
    if (typeof candidate === "string" && iconNames.has(candidate)) {
      quickAccessIcons[domain] = candidate as StaffAppIconName;
    }
  }

  return { logoUrl, quickAccessIcons };
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
