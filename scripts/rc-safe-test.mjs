import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
const stage = process.argv[2];
const unitFiles = (await readdir("tests/unit")).filter((f) => f.endsWith(".test.ts")).map((f) => `tests/unit/${f}`);
const commands = { unit: ["--import", "tsx", "--test", ...unitFiles], typescript: ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"], lint: ["node_modules/eslint/bin/eslint.js", "."], build: ["run", "build"] };
if (!commands[stage]) throw new Error("UNKNOWN_GATE");
let output = "";
const exit = await new Promise((resolve) => {
  const child = spawn(stage === "build" ? "npm" : process.execPath, commands[stage], { env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: stage === "build" ? "production" : "test", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
  child.on("error", () => resolve(1)); child.on("close", (code) => resolve(code ?? 1));
});
console.log(JSON.stringify({ stage, exit, counts: output.split("\n").filter((l) => /^# (tests|pass|fail|skipped) \d+$/.test(l)),
  failures: output.split("\n").filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[redacted]").replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, "[redacted]")),
  locations: stage === "unit" ? [] : [...new Set([...output.matchAll(/(?:src|tests|scripts)\/[a-zA-Z0-9_./()\[\]-]+\.[cm]?[jt]sx?(?:\(\d+,\d+\)|:\d+)?/g)].map((m) => m[0]))],
}));
process.exitCode = exit;
