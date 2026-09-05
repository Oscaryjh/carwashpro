import EmbeddedPostgres from "embedded-postgres";

// Explicit loopback database administration only; never reads DATABASE_URL or production env files.
const name = process.argv[2];
if (!/^tetamu_performance_disposable_[a-z0-9_]+$/.test(name ?? "")) throw new Error("Use an explicit isolated performance database name.");
const pg = new EmbeddedPostgres({ databaseDir: ".local-postgres/data", user: "postgres", password: "postgres", port: 5432, persistent: true });
const client = pg.getPgClient("postgres", "127.0.0.1");
try {
  await client.connect();
  const existing = await client.query("SELECT datname FROM pg_database WHERE datname = $1", [name]);
  if (existing.rows.length) throw new Error("Database already exists; refusing to reuse or overwrite it.");
  await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  process.stdout.write(`Created isolated local database: ${name}\n`);
} finally { await client.end(); }
