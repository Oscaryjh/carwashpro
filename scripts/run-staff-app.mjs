import { spawn } from "node:child_process";
import { join } from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const mode = process.argv[2];

if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-staff-app.mjs <dev|start>");
  process.exit(1);
}

const port = process.env.STAFF_APP_PORT?.trim() || "3100";
const localDatabasePort = process.env.LOCAL_POSTGRES_PORT?.trim() || "5432";
const environment = {
  ...process.env,
  TETAMU_APP_SURFACE: "staff",
  STAFF_APP_PORT: port,
  ...(mode === "dev"
    ? {
        DATABASE_URL:
          process.env.DATABASE_URL ??
          `postgresql://postgres:postgres@localhost:${localDatabasePort}/car_wash_crm_pos?schema=public`,
        SESSION_SECRET:
          process.env.SESSION_SECRET ??
          "tetamu-local-development-session-secret-v1",
        EMPLOYEE_AUTH_SECRET:
          process.env.EMPLOYEE_AUTH_SECRET ??
          "tetamu-local-development-employee-auth-secret-v1",
        EMPLOYEE_OTP_SEND_MODE:
          process.env.EMPLOYEE_OTP_SEND_MODE ?? "mock",
        EMPLOYEE_OTP_MOCK_CODE:
          process.env.EMPLOYEE_OTP_MOCK_CODE ?? "000000",
      }
    : {}),
};

if (mode === "start") {
  await run(process.execPath, [
    join(process.cwd(), "scripts", "validate-release-environment.mjs"),
    "web",
  ]);
  await run(process.execPath, [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "migrate",
    "deploy",
  ]);
}

const nextCli = join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const command = [nextCli, mode, "--port", port];

await run(process.execPath, command);

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: "inherit",
      shell: false,
      env: environment,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Staff App process exited with code ${code ?? "unknown"}.`));
    });
  });
}
