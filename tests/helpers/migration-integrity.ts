import assert from "node:assert/strict";

type Entry = { name: string; hash: string };

/** Historical entries are pinned separately; new reviewed SQL is append-only. */
export function verifyMigrationIntegrity(historical: Entry[], additions: Entry[], actual: Entry[]) {
  assert.deepEqual(actual.slice(0, historical.length), historical, "Historical migration names, order or SHA changed");
  let previousTimestamp = historical.at(-1)?.name.slice(0, 14) ?? "";
  for (const entry of additions) {
    assert.match(entry.name, /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
    assert.match(entry.hash, /^[0-9a-f]{64}$/);
    const timestamp = entry.name.slice(0, 14);
    assert.ok(timestamp > previousTimestamp, "New migrations must follow the baseline and have unique increasing timestamps");
    const iso = `${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}T${timestamp.slice(8,10)}:${timestamp.slice(10,12)}:${timestamp.slice(12,14)}.000Z`;
    assert.equal(new Date(iso).toISOString(), iso, "Invalid migration timestamp");
    previousTimestamp = timestamp;
  }
  assert.deepEqual(actual, [...historical, ...additions], "SQL additions must match the reviewed checksum manifest exactly");
}
