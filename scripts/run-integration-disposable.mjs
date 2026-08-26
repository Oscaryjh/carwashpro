import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const pg = createEmbeddedPostgres();
const databaseName =
  `tetamu_pcb_verification_vc1_disposable_${process.pid}_${Date.now()}`;
const databaseUrl = `postgresql://postgres:postgres@localhost:5432/${databaseName}?schema=public`;
let ownsPostgres = false;

try {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, databaseName);
  await waitForPostgres(pg, databaseName);
  await runCommand("prisma", ["migrate", "deploy"], databaseUrl);
  const integrationFiles = (await readdir(resolve("tests", "integration"), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => `tests/integration/${entry.name}`)
    .sort();
  const isolatedFiles = new Set([
    "tests/integration/attendance-phase1c-route-flow.test.ts",
  ]);
  const sharedProcessFiles = integrationFiles.filter(
    (file) => !isolatedFiles.has(file),
  );

  await runCommand(
    "tsx",
    ["--test", "--test-concurrency=1", ...sharedProcessFiles],
    databaseUrl,
  );
  for (const file of isolatedFiles) {
    await runCommand(
      "tsx",
      ["--test", "--test-concurrency=1", file],
      databaseUrl,
    );
  }
} finally {
  await dropDisposableDatabase(databaseName);
  await stopOwnedPostgres(pg, ownsPostgres);
}

function runCommand(commandName, args, url) {
  const command = resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${commandName}.cmd` : commandName,
  );

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        DATABASE_URL: url,
        TETAMU_ENVIRONMENT: "TESTING",
        TETAMU_PCB_VERIFICATION_CANDIDATE: "TETAMU_PCB_2026_VC1",
      },
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${commandName} exited with code ${code}`));
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
