import {
  DATABASE_NAME,
  createEmbeddedPostgres,
  ensureDatabaseExists,
  ensurePostgresReady,
  stopOwnedPostgres,
  waitForPostgres,
} from "./embedded-postgres-utils.mjs";

const pg = createEmbeddedPostgres();
let ownsPostgres = false;

async function main() {
  ownsPostgres = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, DATABASE_NAME);
  await waitForPostgres(pg, DATABASE_NAME);

  console.log("Embedded Postgres is running on localhost:5432");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function shutdown() {
  await stopOwnedPostgres(pg, ownsPostgres);
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await stopOwnedPostgres(pg, ownsPostgres);
  process.exit(1);
});
