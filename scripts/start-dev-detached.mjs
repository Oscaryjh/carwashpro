import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  console.error("Detached dev window is currently supported on Windows only.");
  process.exit(1);
}

const cwd = process.cwd();
const scriptPath = join(process.env.TEMP ?? cwd, "washflow-dev-window.cmd");
const nodePath = process.execPath;
const nodeDir = nodePath.slice(0, nodePath.lastIndexOf("\\"));

writeFileSync(
  scriptPath,
  [
    "@echo off",
    "title WashFlow Dev Server",
    `cd /d "${cwd}"`,
    `set "PATH=${cwd}\\node_modules\\.bin;${nodeDir};C:\\Windows\\System32;C:\\Windows"`,
    'set "NODE_OPTIONS=--use-system-ca"',
    'set "WS_NO_BUFFER_UTIL=1"',
    'set "WS_NO_UTF_8_VALIDATE=1"',
    "echo Starting WashFlow dev server...",
    `echo Project: ${cwd}`,
    "echo URL: http://localhost:3000",
    "echo.",
    `"${nodePath}" scripts\\dev-supervisor.mjs`,
    "echo.",
    "echo Dev server stopped. Close this window when finished.",
  ].join("\r\n"),
  "ascii",
);

const child = spawn("cmd.exe", ["/d", "/c", "start", "WashFlow Dev Server", "/min", "cmd.exe", "/k", scriptPath], {
  detached: true,
  stdio: "ignore",
  shell: false,
});

child.unref();
console.log("WashFlow dev server window started.");
console.log("Local URL: http://localhost:3000");
