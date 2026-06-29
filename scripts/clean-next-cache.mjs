import { existsSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const nextDir = resolve(projectRoot, ".next");
const relativeNextDir = relative(projectRoot, nextDir);
const dryRun = process.argv.includes("--dry-run");

if (relativeNextDir.startsWith("..") || relativeNextDir === "") {
  throw new Error(`Refusing to clean unsafe path: ${nextDir}`);
}

if (!existsSync(nextDir)) {
  console.log(".next cache does not exist. Nothing to clean.");
  process.exit(0);
}

if (dryRun) {
  console.log(`Would clean: ${nextDir}`);
  process.exit(0);
}

rmSync(nextDir, { recursive: true, force: true });
console.log("Cleaned .next cache.");
