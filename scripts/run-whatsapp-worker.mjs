import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workerLoader = join(process.cwd(), "scripts", "whatsapp-worker-loader.mjs");
const workerScript = join(process.cwd(), "scripts", "whatsapp-worker.ts");
const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const workerTsconfig = join(process.cwd(), "tsconfig.worker.json");

if (!existsSync(workerScript)) {
  console.error(`Cannot find WhatsApp worker at ${workerScript}.`);
  process.exit(1);
}

const env = { ...process.env };

if (existsSync(workerTsconfig)) {
  env.TSX_TSCONFIG_PATH = workerTsconfig;
}

let workerArgs;

if (existsSync(tsxCli)) {
  workerArgs = [tsxCli, workerScript];
} else {
  if (!existsSync(workerLoader)) {
    console.error(
      `Cannot find tsx at ${tsxCli} or WhatsApp worker loader at ${workerLoader}.`,
    );
    process.exit(1);
  }

  workerArgs = [
    "--experimental-strip-types",
    "--loader",
    pathToFileURL(workerLoader).href,
    workerScript,
  ];
}

const child = spawn(process.execPath, workerArgs, {
  env,
  shell: false,
  stdio: "inherit",
});

function stopChild() {
  if (!child.killed) {
    child.kill();
  }
}

process.on("SIGINT", stopChild);
process.on("SIGTERM", stopChild);

child.on("error", (error) => {
  console.error("Failed to start WhatsApp worker:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
