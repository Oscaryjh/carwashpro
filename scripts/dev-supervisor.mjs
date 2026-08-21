import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import nextEnv from "@next/env";
import {
  DATABASE_NAME,
  DATABASE_URL,
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const nextDevCliArguments = process.argv.slice(2);
const configuredPort = readCliOption("--port", "-p") ?? "3000";
const pg = createEmbeddedPostgres();
const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const localHttpsKey = join(
  process.cwd(),
  ".local-https",
  "tetamu-local-key.pem",
);
const localHttpsCertificate = join(
  process.cwd(),
  ".local-https",
  "tetamu-local.pem",
);
const localHttpsCa = join(process.cwd(), ".local-https", "tetamu-local-ca.crt");
const whatsappWorkerRunner = join(process.cwd(), "scripts", "run-whatsapp-worker.mjs");
const notificationWorkerScript = join(
  process.cwd(),
  "scripts",
  "notification-queue-worker.ts",
);
const analyticsWorkerScript = join(
  process.cwd(),
  "scripts",
  "analytics-refresh-worker.ts",
);
const whatsappConnectorDir = join(process.cwd(), "whatsapp-connector");
const whatsappConnectorPackage = join(whatsappConnectorDir, "package.json");
const whatsappConnectorEnv = join(whatsappConnectorDir, ".env");
const binPath = join(process.cwd(), "node_modules", ".bin");
const restartDelayMs = 1500;
const minimumHealthyWorkerUptimeMs = 10_000;
const localDevSessionSecret =
  "tetamu-local-development-session-secret-v1";
const localDevEmployeeAuthSecret =
  "tetamu-local-development-employee-auth-secret-v1";
const notificationWorkerQueuedAfter = new Date().toISOString();

let nextChild;
let whatsappWorkerChild;
let notificationWorkerChild;
let analyticsWorkerChild;
let whatsappConnectorChild;
let ownsPostgres = false;
let shuttingDown = false;
let cacheResetRequested = false;

async function main() {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, DATABASE_NAME);
  await waitForPostgres(pg, DATABASE_NAME);

  console.log("WashFlow dev supervisor started.");
  console.log(
    `Local URL: ${hasLocalHttpsCertificate() ? "https" : "http"}://localhost:${configuredPort}`,
  );
  console.log("WhatsApp Connector: http://127.0.0.1:8787");
  console.log("Press Ctrl+C to stop.");

  if (process.env.AUTH_INFO_PATH?.trim() || existsSync(whatsappConnectorEnv)) {
    startWhatsAppConnector();
  } else {
    console.warn(
      "WhatsApp Connector disabled for local development because AUTH_INFO_PATH and whatsapp-connector/.env are not configured.",
    );
  }
  startWhatsAppWorker();
  const whatsappSendMode = process.env.WHATSAPP_SEND_MODE?.trim().toLowerCase();
  if (whatsappSendMode === "mock" || whatsappSendMode === "live") {
    startNotificationWorker();
  } else {
    console.warn(
      "Notification queue worker disabled for local development because WHATSAPP_SEND_MODE is not mock or live.",
    );
  }
  startAnalyticsWorker();
  startNext();
}

function startNext() {
  cacheResetRequested = false;
  nextChild = spawn(process.execPath, getNextDevArguments(), {
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

function getNextDevArguments() {
  const argumentsList = [nextBin, "dev"];

  if (hasLocalHttpsCertificate()) {
    argumentsList.push(
      "--experimental-https",
      "--experimental-https-key",
      localHttpsKey,
      "--experimental-https-cert",
      localHttpsCertificate,
      "--experimental-https-ca",
      localHttpsCa,
    );
  }

  argumentsList.push(...nextDevCliArguments);

  return argumentsList;
}

function readCliOption(longName, shortName) {
  for (let index = 0; index < nextDevCliArguments.length; index += 1) {
    const argument = nextDevCliArguments[index];
    if (argument === longName || argument === shortName) {
      return nextDevCliArguments[index + 1];
    }
    if (argument.startsWith(`${longName}=`)) {
      return argument.slice(longName.length + 1);
    }
  }

  return undefined;
}

function hasLocalHttpsCertificate() {
  return [localHttpsKey, localHttpsCertificate, localHttpsCa].every(existsSync);
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

  const startedAt = Date.now();
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
    if (Date.now() - startedAt < minimumHealthyWorkerUptimeMs) {
      console.warn(
        `Notification queue worker failed during startup (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Automatic restart disabled until the dev server is restarted.`,
      );
      notificationWorkerChild = undefined;
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

  const startedAt = Date.now();
  whatsappConnectorChild = spawn(
    process.execPath,
    ["--use-system-ca", "--import", "tsx", "src/server.ts"],
    {
      cwd: whatsappConnectorDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: {
        ...getChildEnv(),
        PORT: process.env.WHATSAPP_CONNECTOR_PORT ?? "8787",
      },
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
    if (Date.now() - startedAt < minimumHealthyWorkerUptimeMs) {
      console.warn(
        `WhatsApp Connector failed during startup (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Automatic restart disabled until the dev server is restarted.`,
      );
      whatsappConnectorChild = undefined;
      return;
    }

    console.warn(
      `WhatsApp Connector stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startWhatsAppConnector, restartDelayMs);
  });
}

function startAnalyticsWorker() {
  if (!existsSync(analyticsWorkerScript)) {
    console.warn(
      "Analytics refresh worker not started because its script is missing.",
    );
    return;
  }

  analyticsWorkerChild = spawn(
    process.execPath,
    [
      "--use-system-ca",
      "--import",
      "tsx",
      analyticsWorkerScript,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: getChildEnv(),
    },
  );

  analyticsWorkerChild.stdout?.on("data", (chunk) => {
    writePrefixed("[analytics] ", chunk, process.stdout);
  });

  analyticsWorkerChild.stderr?.on("data", (chunk) => {
    writePrefixed("[analytics] ", chunk, process.stderr);
  });

  analyticsWorkerChild.on("close", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.warn(
      `Analytics refresh worker stopped (code: ${code ?? "none"}, signal: ${signal ?? "none"}). Restarting...`,
    );
    setTimeout(startAnalyticsWorker, restartDelayMs);
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
  analyticsWorkerChild?.kill("SIGTERM");
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
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? localDevSessionSecret,
    EMPLOYEE_AUTH_SECRET:
      process.env.EMPLOYEE_AUTH_SECRET ?? localDevEmployeeAuthSecret,
    EMPLOYEE_OTP_SEND_MODE:
      process.env.EMPLOYEE_OTP_SEND_MODE ?? "mock",
    EMPLOYEE_OTP_MOCK_CODE:
      process.env.EMPLOYEE_OTP_MOCK_CODE ?? "000000",
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
