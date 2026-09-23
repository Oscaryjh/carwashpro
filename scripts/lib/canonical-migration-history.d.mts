export type ExpectedMigration = Readonly<{
  name: string;
  checksum: string;
}>;

export type AppliedMigration = Readonly<{
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}>;

export function assertMigrationHistory(
  expected: readonly ExpectedMigration[],
  rows: readonly AppliedMigration[],
): void;
