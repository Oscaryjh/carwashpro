export function selectIntegrationFiles(available, requested) {
  if (requested.length === 0) return available;
  const known = new Set(available);
  const selected = [];
  for (const file of requested) {
    if (!known.has(file)) {
      throw new Error(`unknown integration test: ${file}`);
    }
    if (!selected.includes(file)) selected.push(file);
  }
  return selected;
}

export function selectIsolatedIntegrationFiles(selected, isolated) {
  const selectedSet = new Set(selected);
  return isolated.filter((file) => selectedSet.has(file));
}
