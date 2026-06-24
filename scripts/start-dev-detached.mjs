import { openSync } from "node:fs";
import { delimiter } from "node:path";
import { spawn } from "node:child_process";

const out = openSync(".next-dev-out.log", "a");
const err = openSync(".next-dev-err.log", "a");
const binPath = `${process.cwd()}\\node_modules\\.bin`;

const child = spawn("node", ["scripts/with-embedded-postgres.mjs", "next", "dev"], {
  cwd: process.cwd(),
  detached: true,
  stdio: ["ignore", out, err],
  shell: false,
  env: {
    ...process.env,
    PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
  },
});

child.unref();
console.log(child.pid);
