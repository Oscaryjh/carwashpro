export function assertMigrationHistory(expected, rows) {
  if (rows.length !== expected.length) {
    throw new Error(`migration count mismatch: expected ${expected.length}, got ${rows.length}`);
  }
  const expectedByName = new Map(expected.map((entry) => [entry.name, entry.checksum]));
  if (expectedByName.size !== expected.length) {
    throw new Error("duplicate migration in expected set");
  }
  const seen = new Set();
  for (const row of rows) {
    const name = row.migration_name;
    if (seen.has(name)) {
      throw new Error(`duplicate migration in database: ${name}`);
    }
    seen.add(name);
    if (!expectedByName.has(name)) {
      throw new Error(`unexpected migration in database: ${name}`);
    }
    if (!row.finished_at || row.rolled_back_at) {
      throw new Error(`unfinished or rolled-back migration: ${name}`);
    }
    if (row.checksum !== expectedByName.get(name)) {
      throw new Error(`migration checksum mismatch: ${name}`);
    }
  }
  for (const name of expectedByName.keys()) {
    if (!seen.has(name)) {
      throw new Error(`missing migration in database: ${name}`);
    }
  }
}
