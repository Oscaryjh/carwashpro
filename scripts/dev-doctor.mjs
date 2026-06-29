import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { DATABASE_PORT, DATABASE_URL } from "./embedded-postgres-utils.mjs";

const checks = [];

await addCheck("Node.js", async () => process.version);
await addCheck("package.json", async () => existsOrThrow("package.json"));
await addCheck("package-lock.json", async () => existsOrThrow("package-lock.json"));
await addCheck("node_modules", async () => existsOrThrow("node_modules"));
await addCheck("Next.js binary", async () =>
  existsOrThrow(join("node_modules", "next", "dist", "bin", "next")),
);
await addCheck("Prisma schema", async () => existsOrThrow(join("prisma", "schema.prisma")));
await addCheck("Embedded Postgres data", async () =>
  existsOrThrow(join(".local-postgres", "data", "PG_VERSION")),
);
await addCheck(`Postgres port ${DATABASE_PORT}`, async () => {
  const open = await canOpenTcpPort(DATABASE_PORT);
  if (!open) {
    throw new Error("not running");
  }
  return "open";
});
await addCheck("DATABASE_URL", async () => process.env.DATABASE_URL || DATABASE_URL);
await addCheck("Next dev port 3000", async () => {
  const open = await canOpenTcpPort(3000);
  return open ? "open" : "not running";
});

for (const check of checks) {
  const icon = check.ok ? "OK" : "FAIL";
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

const failed = checks.filter((check) => !check.ok);

if (failed.length) {
  console.log("");
  console.log("Suggested recovery:");
  console.log("1. npm.cmd run db:start");
  console.log("2. npm.cmd run dev:clean");
  process.exit(1);
}

console.log("");
console.log("Local environment looks ready.");

async function addCheck(name, fn) {
  try {
    checks.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message });
  }
}

function existsOrThrow(path) {
  if (!existsSync(path)) {
    throw new Error("missing");
  }

  return "found";
}

function canOpenTcpPort(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
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
