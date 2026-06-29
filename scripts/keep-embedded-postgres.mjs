import EmbeddedPostgres from "embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir: ".local-postgres/data",
  user: "postgres",
  password: "postgres",
  port: Number(process.env.LOCAL_POSTGRES_PORT ?? "5432"),
  persistent: true,
});

await pg.start();
console.log("Embedded Postgres is running.");

setInterval(() => {}, 60 * 60 * 1000);
