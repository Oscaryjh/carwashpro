export type RuntimeEnvironment =
  | "development"
  | "testing"
  | "uat-preview"
  | "production";

export type RuntimeEnvironmentMap = Readonly<
  Record<string, string | undefined>
>;

export function parseRuntimeEnvironment(
  env?: RuntimeEnvironmentMap,
): RuntimeEnvironment;

export function isProductionGradeEnvironment(
  environment: RuntimeEnvironment,
): boolean;

