import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import {
  DATABASE_NAME,
  DATABASE_URL,
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/with-embedded-postgres.mjs <command> [...args]");
  process.exit(1);
}

const pg = createEmbeddedPostgres();

let child;
let ownsPostgres = false;

async function main() {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, DATABASE_NAME);
  await waitForPostgres(pg, DATABASE_NAME);

  const binPath = `${process.cwd()}\\node_modules\\.bin`;
  child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
      DATABASE_URL: process.env.DATABASE_URL ?? DATABASE_URL,
    },
  });

  child.on("close", async (code, signal) => {
    await shutdown();
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(code ?? 0);
  });
}

async function shutdown() {
  await stopOwnedPostgres(pg, ownsPostgres);
}

process.on("SIGINT", () => {
  child?.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child?.kill("SIGTERM");
});

main().catch(async (error) => {
  console.error(error);
  await shutdown();
  process.exit(1);
});
