import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const nextDir = resolve(projectRoot, ".next");
const relativeNextDir = relative(projectRoot, nextDir);

if (relativeNextDir.startsWith("..") || relativeNextDir === "") {
  throw new Error(`Refusing to clean unsafe path: ${nextDir}`);
}

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log("Cleaned .next cache.");
}

const supervisor = join(projectRoot, "scripts", "dev-supervisor.mjs");
const child = spawn(process.execPath, [supervisor], {
  stdio: "inherit",
  shell: false,
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }

  process.exit(code ?? 0);
});
