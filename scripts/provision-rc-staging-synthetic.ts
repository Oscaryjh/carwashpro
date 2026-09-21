import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Keep domain diagnostics inside an isolated process. Only the structured,
// non-sensitive result protocol is released, never raw stdout/stderr.
const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/rc-staging-synthetic-worker.ts", ...process.argv.slice(2)], {
  cwd: resolve(import.meta.dirname, ".."),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV, APP_ENVIRONMENT: process.env.APP_ENVIRONMENT },
  stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024,
});
const line = child.stdout?.split("\n").reverse().find(line => line.startsWith("RC_STAGING_FIXTURE_RESULT "));
if (line) console.log(line);
else console.log('RC_STAGING_FIXTURE_RESULT {"status":"BLOCKED","code":"FIXTURE_WORKER_FAILED"}');
process.exitCode = child.status === 0 && line ? 0 : 2;
