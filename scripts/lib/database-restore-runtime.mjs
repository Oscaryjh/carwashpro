import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { redactOperationalText, runCommand } from "./database-backup-core.mjs";

export function buildDisposablePostgresPaths(workDir) {
  const root = String(workDir ?? "").trim();
  if (!root || !isAbsolute(root)) {
    throw new Error("Disposable PostgreSQL work directory must be absolute.");
  }
  const paths = {
    workDir: root,
    pgData: join(root, "postgres-data"),
    socketDir: join(root, "pg-socket"),
    startupLog: join(root, "postgres.log"),
  };
  for (const path of Object.values(paths)) {
    const child = relative(root, path);
    if (child.startsWith("..") || isAbsolute(child)) {
      throw new Error("Disposable PostgreSQL paths must remain inside the work directory.");
    }
  }
  return paths;
}

export async function prepareDisposablePostgres(paths) {
  await mkdir(paths.socketDir, { recursive: true, mode: 0o700 });
  await chmod(paths.socketDir, 0o700);
}

export function buildDisposablePostgresStartArgs({ paths, port }) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65_535) {
    throw new Error("Disposable PostgreSQL port is invalid.");
  }
  if (/\s/.test(paths.socketDir)) {
    throw new Error("Disposable PostgreSQL socket path must not contain whitespace.");
  }
  return [
    "-D",
    paths.pgData,
    "-l",
    paths.startupLog,
    "-o",
    `-p ${safePort} -h 127.0.0.1 -k ${paths.socketDir}`,
    "-w",
    "start",
  ];
}

export async function startDisposablePostgres({
  pgCtl,
  paths,
  port,
  runCommandImpl = runCommand,
  readFileImpl = readFile,
}) {
  await prepareDisposablePostgres(paths);
  try {
    await runCommandImpl(
      pgCtl,
      buildDisposablePostgresStartArgs({ paths, port }),
      { timeoutMs: 120_000, resolveOnExit: true },
    );
  } catch (error) {
    const startupLog = await readFileImpl(paths.startupLog, "utf8").catch(
      () => "PostgreSQL startup log was unavailable.",
    );
    throw new Error(
      `${error.message} PostgreSQL startup log: ${redactOperationalText(startupLog)}`,
    );
  }
}

export async function cleanupDisposablePostgres({
  pgCtl,
  paths,
  startAttempted,
  runCommandImpl = runCommand,
  rmImpl = rm,
}) {
  if (startAttempted) {
    await runCommandImpl(pgCtl, ["-D", paths.pgData, "-m", "fast", "stop"], {
      timeoutMs: 60_000,
    }).catch(() => {});
  }
  await rmImpl(paths.workDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  });
}
