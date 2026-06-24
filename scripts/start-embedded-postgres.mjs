import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const pg = new EmbeddedPostgres({
  databaseDir: ".local-postgres/data",
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

async function main() {
  if (!existsSync(".local-postgres/data/PG_VERSION")) {
    await pg.initialise();
  }
  await pg.start();

  try {
    await pg.createDatabase("car_wash_crm_pos");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }

  console.log("Embedded Postgres is running on localhost:5432");

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function shutdown() {
  await pg.stop();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pg.stop();
  } catch {
    // Ignore shutdown errors after startup failure.
  }
  process.exit(1);
});
