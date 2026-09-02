import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export const DATABASE_DIR = ".local-postgres/data";
export const DATABASE_NAME =
  process.env.LOCAL_DATABASE_NAME ?? "tetamu_canonical_local_20260829";
export const DATABASE_PORT = Number(process.env.LOCAL_POSTGRES_PORT ?? "5432");
export const DATABASE_URL =
  `postgresql://postgres:postgres@localhost:${DATABASE_PORT}/${DATABASE_NAME}?schema=public`;
const REQUIRED_DATABASE_ENCODING = "UTF8";
const REQUIRED_DATABASE_COLLATE = "C";
const REQUIRED_DATABASE_CTYPE = "C";

export function createEmbeddedPostgres() {
  return new EmbeddedPostgres({
    databaseDir: DATABASE_DIR,
    user: "postgres",
    password: "postgres",
    port: DATABASE_PORT,
    persistent: true,
    initdbFlags: [
      `--encoding=${REQUIRED_DATABASE_ENCODING}`,
      `--locale=${REQUIRED_DATABASE_COLLATE}`,
    ],
  });
}

export async function ensurePostgresReady(pg) {
  if (await canQueryPostgres(pg, "postgres")) {
    return false;
  }

  if (await canOpenTcpPort()) {
    console.warn(
      `Postgres port ${DATABASE_PORT} is open but health check failed. Attempting to recover local embedded Postgres.`,
    );
    await stopProjectPostgresFromPidFile();
    await waitForTcpPortToClose();
  }

  if (await canOpenTcpPort()) {
    throw new Error(
      `Port ${DATABASE_PORT} is occupied, but the database is not healthy. Stop the process using port ${DATABASE_PORT} and try again.`,
    );
  }

  if (!existsSync(`${DATABASE_DIR}/PG_VERSION`)) {
    await pg.initialise();
  }

  await pg.start();
  await waitForPostgres(pg, "postgres");
  return true;
}

export async function ensureDatabaseExists(pg, databaseName = DATABASE_NAME) {
  const client = pg.getPgClient("postgres", "127.0.0.1");

  try {
    await client.connect();
    const existing = await client.query(
      `SELECT
        datname,
        pg_encoding_to_char(encoding) AS database_encoding,
        datcollate,
        datctype
      FROM pg_database
      WHERE datname = $1`,
      [databaseName],
    );

    if (existing.rowCount) {
      assertDatabaseEncoding(existing.rows[0], databaseName);
      return;
    }

    await client.query(
      `CREATE DATABASE ${client.escapeIdentifier(databaseName)} WITH TEMPLATE template0 ENCODING '${REQUIRED_DATABASE_ENCODING}' LC_COLLATE '${REQUIRED_DATABASE_COLLATE}' LC_CTYPE '${REQUIRED_DATABASE_CTYPE}'`,
    );
  } finally {
    await closeClient(client);
  }
}

function assertDatabaseEncoding(row, databaseName) {
  if (
    row.database_encoding === REQUIRED_DATABASE_ENCODING &&
    row.datcollate === REQUIRED_DATABASE_COLLATE &&
    row.datctype === REQUIRED_DATABASE_CTYPE
  ) {
    return;
  }

  throw new Error(
    `Database "${databaseName}" must be ${REQUIRED_DATABASE_ENCODING}/${REQUIRED_DATABASE_COLLATE}/${REQUIRED_DATABASE_CTYPE}, but found ${row.database_encoding}/${row.datcollate}/${row.datctype}. Recreate the local embedded Postgres data directory before starting WashFlow.`,
  );
}

export async function waitForPostgres(pg, databaseName = DATABASE_NAME) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (await canQueryPostgres(pg, databaseName)) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Postgres did not become ready for database "${databaseName}".`);
}

export async function stopOwnedPostgres(pg, ownsPostgres) {
  if (!ownsPostgres) {
    return;
  }

  try {
    await Promise.race([pg.stop(), delay(5_000)]);
  } catch {
    // Postgres may already be stopped when the child exits.
  }
}

async function canQueryPostgres(pg, databaseName) {
  const client = pg.getPgClient(databaseName, "127.0.0.1");

  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await closeClient(client);
  }
}

function canOpenTcpPort() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: DATABASE_PORT });
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

async function stopProjectPostgresFromPidFile() {
  const pidFile = `${DATABASE_DIR}/postmaster.pid`;

  if (!existsSync(pidFile)) {
    return false;
  }

  const [pidLine, dataDirLine] = (await readFile(pidFile, "utf8")).split(/\r?\n/);
  const pid = Number(pidLine);

  if (!Number.isInteger(pid) || pid <= 0 || !dataDirLine) {
    return false;
  }

  const expectedDataDir = normalizePath(resolve(DATABASE_DIR));
  const actualDataDir = normalizePath(resolve(dataDirLine.trim()));

  if (actualDataDir !== expectedDataDir) {
    return false;
  }

  await killProcessTree(pid);
  return true;
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    const command =
      process.platform === "win32"
        ? ["taskkill", ["/PID", String(pid), "/T", "/F"]]
        : ["kill", ["-TERM", String(pid)]];
    const child = spawn(command[0], command[1], {
      stdio: "ignore",
      shell: false,
    });
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

async function waitForTcpPortToClose() {
  const deadline = Date.now() + 8_000;

  while (Date.now() < deadline) {
    if (!(await canOpenTcpPort())) {
      return;
    }
    await delay(250);
  }
}

async function closeClient(client) {
  try {
    await client.end();
  } catch {
    // Ignore failed cleanup after connection errors.
  }
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").toLowerCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
