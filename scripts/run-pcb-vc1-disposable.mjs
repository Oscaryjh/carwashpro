import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/run-pcb-vc1-disposable.mjs <command> [...args]",
  );
  process.exit(2);
}

const pg = createEmbeddedPostgres();
const databaseName =
  `tetamu_pcb_verification_vc1_disposable_${process.pid}_${Date.now()}`;
const databaseUrl =
  `postgresql://postgres:postgres@localhost:5432/${databaseName}?schema=public`;
let ownsPostgres = false;
let commandExitCode = 1;

try {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, databaseName);
  await waitForPostgres(pg, databaseName);
  await runPrismaMigrateDeploy(databaseUrl);
  commandExitCode = await runCommand(args[0], args.slice(1), databaseUrl);
} finally {
  await dropDisposableDatabase(databaseName);
  await stopOwnedPostgres(pg, ownsPostgres);
  console.log(`Disposable PCB VC1 database removed: ${databaseName}.`);
}

process.exit(commandExitCode);

function runPrismaMigrateDeploy(url) {
  const prismaCli = resolve(
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  return runChild(process.execPath, [prismaCli, "migrate", "deploy"], url, {
    quietLabel: "Fresh migrations applied",
  });
}

function runCommand(command, commandArgs, url) {
  return runChild(command, commandArgs, url);
}

function runChild(command, commandArgs, url, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const quiet = Boolean(options.quietLabel);
    const child = spawn(command, commandArgs, {
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
      env: {
        ...process.env,
        DATABASE_URL: url,
        TETAMU_ENVIRONMENT: "TESTING",
        TETAMU_PCB_VERIFICATION_CANDIDATE: "TETAMU_PCB_2026_VC1",
      },
    });
    let stdout = "";
    let stderr = "";
    if (quiet) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      const exitCode = code ?? 1;
      if (quiet && exitCode === 0) {
        console.log(`${options.quietLabel}: ${databaseName}.`);
      } else if (quiet) {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      }
      resolvePromise(exitCode);
    });
  });
}

async function dropDisposableDatabase(targetName) {
  if (!/^tetamu_pcb_verification_vc1_disposable_\d+_\d+$/.test(targetName)) {
    throw new Error(`Refusing to drop unexpected database name: ${targetName}`);
  }

  const client = pg.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [targetName],
    );
    await client.query(`DROP DATABASE ${client.escapeIdentifier(targetName)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
