export const DISABLED_LAUNCH_FEATURES = ["PCB_PRODUCTION_ACTIVATION", "PCB_OFFICIAL_EXPORT", "PCB_GOVERNMENT_SUBMISSION", "PAYROLL_BANK_EXECUTION", "PAYMENT_EXPORT"] as const;
export type DisabledLaunchFeature = (typeof DISABLED_LAUNCH_FEATURES)[number];
export const NOT_ENABLED_LABEL = "尚未启用 / Not enabled";

// Deliberately not configurable by environment, role or persisted provider state.
// POS customer payments are outside this narrowly enumerated Payroll boundary.
export function assertLaunchFeatureEnabled(feature: DisabledLaunchFeature): never {
  throw new Error(`${feature}_NOT_ENABLED`);
}
