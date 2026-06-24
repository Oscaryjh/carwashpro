import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { delimiter } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/with-embedded-postgres.mjs <command> [...args]");
  process.exit(1);
}

const pg = new EmbeddedPostgres({
  databaseDir: ".local-postgres/data",
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

let child;
let ownsPostgres = false;

function canConnectToPostgres() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: 5432 });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  if (!(await canConnectToPostgres())) {
    if (!existsSync(".local-postgres/data/PG_VERSION")) {
      await pg.initialise();
    }
    await pg.start();
    ownsPostgres = true;
  }

  if (ownsPostgres) {
    try {
      await pg.createDatabase("car_wash_crm_pos");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("already exists")) {
        throw error;
      }
    }
  }

  const binPath = `${process.cwd()}\\node_modules\\.bin`;
  child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PATH: `${binPath}${delimiter}${process.env.PATH ?? ""}`,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public",
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
  if (!ownsPostgres) {
    return;
  }

  try {
    await Promise.race([
      pg.stop(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch {
    // Postgres may already be stopped when the child exits.
  }
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
