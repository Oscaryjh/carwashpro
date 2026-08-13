import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "buffer",
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const handoffDocuments = new Set([
  "AGENTS.md",
  "docs/database-migration-handoff.md",
  "docs/environment-variable-contract.md",
  "docs/known-limitations-and-deferred-scope.md",
  "docs/production-owner-handoff-checklist.md",
  "docs/production-smoke-checklist.md",
  "docs/release-handoff-audit-phase1.md",
  "docs/testing-release-smoke-checklist.md",
]);

const paths = result.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((path) => !handoffDocuments.has(path.replaceAll("\\", "/")))
  .sort((left, right) => left.localeCompare(right, "en"));

const digest = createHash("sha256");
for (const path of paths) {
  const normalizedPath = path.replaceAll("\\", "/");
  digest.update(Buffer.from(normalizedPath, "utf8"));
  digest.update(Buffer.from([0]));
  digest.update(readFileSync(path));
  digest.update(Buffer.from([0]));
}

process.stdout.write(`${digest.digest("hex")}\n`);
