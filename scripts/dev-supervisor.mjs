import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  DATABASE_NAME,
  DATABASE_URL,
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const pg = createEmbeddedPostgres();
const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const whatsappWorkerRunner = join(process.cwd(), "scripts", "run-whatsapp-worker.mjs");
const notificationWorkerScript = join(
  process.cwd(),
  "scripts",
  "notification-queue-worker.ts",
);
const whatsappConnectorDir = join(process.cwd(), "whatsapp-connector");
const whatsappConnectorPackage = join(whatsappConnectorDir, "package.json");
const binPath = join(process.cwd(), "node_modules", ".bin");
const restartDelayMs = 1500;
const notificationWorkerQueuedAfter = new Date().toISOString();

let nextChild;
let whatsappWorkerChild;
let notificationWorkerChild;
let whatsappConnectorChild;
let ownsPostgres = false;
let shuttingDown = false;
let cacheResetRequested = false;

async function main() {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, DATABASE_NAME);
  await waitForPostgres(pg, DATABASE_NAME);

  console.log("WashFlow dev supervisor started.");
  console.log("Local URL: http://localhost:3000");
  console.log("WhatsApp Connector: http://127.0.0.1:8787");
  console.log("Press Ctrl+C to stop.");

  startWhatsAppConnector();
  startWhatsAppWorker();
  startNotificationWorker();
  startNext();
}

function startNext() {
  cacheResetRequested = false;
  nextChild = spawn(process.execPath, [nextBin, "dev"], {
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
    env: getChildEnv(),
  });

  nextChild.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    inspectNextOutput(chunk);
  });

  nextChild.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
    inspectNextOutput(chunk);
  });

  nextChild.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (cacheResetRequested) {
      cleanNextCache();
    }

    console.warn(
      `Next dev server stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startNext, restartDelayMs);
  });
}

function startWhatsAppWorker() {
  if (!existsSync(whatsappWorkerRunner)) {
    console.warn("WhatsApp worker not started because the runner script is missing.");
    return;
  }

  whatsappWorkerChild = spawn(process.execPath, [whatsappWorkerRunner], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: getChildEnv(),
  });

  whatsappWorkerChild.stdout?.on("data", (chunk) => {
    writePrefixed("[whatsapp] ", chunk, process.stdout);
  });

  whatsappWorkerChild.stderr?.on("data", (chunk) => {
    writePrefixed("[whatsapp] ", chunk, process.stderr);
  });

  whatsappWorkerChild.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.warn(
      `WhatsApp worker stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startWhatsAppWorker, restartDelayMs);
  });
}

function startNotificationWorker() {
  if (!existsSync(notificationWorkerScript)) {
    console.warn(
      "Notification queue worker not started because its script is missing.",
    );
    return;
  }

  notificationWorkerChild = spawn(
    process.execPath,
    [
      "--use-system-ca",
      "--import",
      "tsx",
      notificationWorkerScript,
      `--queued-after=${notificationWorkerQueuedAfter}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: getChildEnv(),
    },
  );

  notificationWorkerChild.stdout?.on("data", (chunk) => {
    writePrefixed("[notifications] ", chunk, process.stdout);
  });

  notificationWorkerChild.stderr?.on("data", (chunk) => {
    writePrefixed("[notifications] ", chunk, process.stderr);
  });

  notificationWorkerChild.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.warn(
      `Notification queue worker stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startNotificationWorker, restartDelayMs);
  });
}

function startWhatsAppConnector() {
  if (!existsSync(whatsappConnectorPackage)) {
    console.warn("WhatsApp Connector not started because its package.json is missing.");
    return;
  }

  whatsappConnectorChild = spawn(
    process.execPath,
    ["--use-system-ca", "--import", "tsx", "src/server.ts"],
    {
      cwd: whatsappConnectorDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: getChildEnv(),
    },
  );

  whatsappConnectorChild.stdout?.on("data", (chunk) => {
    writePrefixed("[connector] ", chunk, process.stdout);
  });

  whatsappConnectorChild.stderr?.on("data", (chunk) => {
    writePrefixed("[connector] ", chunk, process.stderr);
  });

  whatsappConnectorChild.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.warn(
      `WhatsApp Connector stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startWhatsAppConnector, restartDelayMs);
  });
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  nextChild?.kill("SIGTERM");
  whatsappWorkerChild?.kill("SIGTERM");
  notificationWorkerChild?.kill("SIGTERM");
  whatsappConnectorChild?.kill("SIGTERM");
  await stopOwnedPostgres(pg, ownsPostgres);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error(error);
  await stopOwnedPostgres(pg, ownsPostgres);
  process.exit(1);
});

function withNodeOption(existingOptions, option) {
  const options = existingOptions?.trim();

  if (!options) {
    return option;
  }

  if (options.split(/\s+/).includes(option)) {
    return options;
  }

  return `${options} ${option}`;
}

function getChildEnv() {
  return {
    ...process.env,
    PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
    DATABASE_URL: process.env.DATABASE_URL ?? DATABASE_URL,
    NODE_OPTIONS: withNodeOption(process.env.NODE_OPTIONS, "--use-system-ca"),
    WS_NO_BUFFER_UTIL: process.env.WS_NO_BUFFER_UTIL ?? "1",
    WS_NO_UTF_8_VALIDATE: process.env.WS_NO_UTF_8_VALIDATE ?? "1",
  };
}

function writePrefixed(prefix, chunk, stream) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line && index === lines.length - 1) {
      return;
    }
    stream.write(`${prefix}${line}\n`);
  });
}

function inspectNextOutput(chunk) {
  const output = chunk.toString();

  const looksLikeBrokenNextCache =
    /Cannot find module ['"]\.\/\d+\.js['"]/.test(output) ||
    /prerender-manifest\.json/.test(output) ||
    /__webpack_modules__\[.*\] is not a function/.test(output) ||
    (/\.next[\\/]/.test(output) && /ENOENT|Cannot find module/.test(output));

  if (!looksLikeBrokenNextCache || cacheResetRequested || shuttingDown) {
    return;
  }

  cacheResetRequested = true;
  console.warn("Detected a broken Next.js dev cache. Cleaning .next and restarting...");
  nextChild?.kill("SIGTERM");
}

function cleanNextCache() {
  const nextDir = join(process.cwd(), ".next");

  if (!existsSync(nextDir)) {
    return;
  }

  rmSync(nextDir, { recursive: true, force: true });
  console.log("Cleaned .next cache.");
}
