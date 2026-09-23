import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const allowedDecisions = new Set([
  "APPLY",
  "MERGE_SEMANTICALLY",
  "SUPERSEDED",
  "REIMPLEMENT",
  "DEFERRED_POST_ALIGNMENT_FEATURE",
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const manifestPath = process.argv[2] ?? "canonical-candidate-sources.json";
let entries;
try {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  entries = parsed.entries;
} catch (error) {
  fail(`Cannot read source ledger: ${error instanceof Error ? error.message : String(error)}`);
}

if (process.exitCode) {
  // No usable manifest was loaded.
} else if (!Array.isArray(entries) || entries.length === 0) {
  fail("Source ledger must contain nonempty entries");
} else {
  const migrationOwners = new Map();
  const features = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = `source ${index + 1}`;
    if (!entry || typeof entry !== "object") {
      fail(`${label}: expected object`);
      continue;
    }
    if (typeof entry.feature !== "string" || !entry.feature.trim()) {
      fail(`${label}: missing feature`);
    } else if (features.has(entry.feature)) {
      fail(`${label}: duplicate feature ${entry.feature}`);
    } else {
      features.add(entry.feature);
    }
    if (!allowedDecisions.has(entry.decision)) {
      fail(`${label}: invalid decision`);
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      fail(`${label}: missing reason`);
    }
    if (!Array.isArray(entry.files) || entry.files.length === 0 ||
        entry.files.some((file) => typeof file !== "string" || !file.trim())) {
      fail(`${label}: files must be nonempty paths`);
    }
    if (!Array.isArray(entry.tests) || entry.tests.length === 0 ||
        entry.tests.some((name) => typeof name !== "string" || !name.trim())) {
      fail(`${label}: tests must be nonempty paths`);
    }
    if (typeof entry.sha !== "string" || !/^[0-9a-f]{40}$/.test(entry.sha)) {
      fail(`${label}: SHA must be full lowercase commit SHA`);
    } else {
      const result = spawnSync("git", ["cat-file", "-t", entry.sha], {
        encoding: "utf8",
      });
      if (result.status !== 0 || result.stdout.trim() !== "commit") {
        fail(`${label}: ${entry.sha} is not a commit`);
      }
    }
    if (!Array.isArray(entry.migrationNames)) {
      fail(`${label}: migrationNames must be an array`);
      continue;
    }
    if (entry.decision === "DEFERRED_POST_ALIGNMENT_FEATURE") {
      if (entry.migrationNames.length !== 0) {
        fail(`${label}: deferred source cannot claim a baseline migration`);
      }
      if (!Array.isArray(entry.deferredMigrationNames) || entry.deferredMigrationNames.length === 0) {
        fail(`${label}: deferred migration names required`);
      } else {
        for (const name of entry.deferredMigrationNames) {
          if (typeof name !== "string" || !/^\d{14}_[a-z0-9_]+$/.test(name)) {
            fail(`${label}: invalid deferred migration name ${String(name)}`);
          } else if (existsSync(`prisma/migrations/${name}`)) {
            fail(`${label}: deferred migration already exists in candidate: ${name}`);
          }
        }
      }
    }
    for (const name of entry.migrationNames) {
      if (typeof name !== "string" || !/^\d{14}_[a-z0-9_]+$/.test(name)) {
        fail(`${label}: invalid migration name ${String(name)}`);
        continue;
      }
      if (migrationOwners.has(name)) {
        fail(`duplicate migration ${name}: ${migrationOwners.get(name)} and ${entry.feature}`);
      } else {
        migrationOwners.set(name, entry.feature);
      }
    }
  }
  if (!process.exitCode) {
    process.stdout.write(`Verified ${entries.length} source${entries.length === 1 ? "" : "s"}, ${migrationOwners.size} migration claims\n`);
  }
}
