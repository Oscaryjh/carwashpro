export function selectIntegrationFiles(
  available: readonly string[],
  requested: readonly string[],
): string[];

export function selectIsolatedIntegrationFiles(
  selected: readonly string[],
  isolated: readonly string[],
): string[];
