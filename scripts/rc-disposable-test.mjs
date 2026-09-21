import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

// No shell DATABASE_URL, provider credentials or Railway environment is inherited.
const root = resolve(import.meta.dirname, "..");
const tests = process.argv[2] === "--all" ? (await readdir(join(root, "tests/integration"))).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `tests/integration/${name}`) : process.argv.slice(2);
if (!tests.length || tests.some((file) => !/^tests\/integration\/[a-zA-Z0-9_-]+(?:\.integration)?\.test\.ts$/.test(file))) throw new Error("RC_TEST_ALLOWLIST_REQUIRED");
const wholeDatabaseTests = new Set([
  "tests/integration/rc-staging-fixture-resume.test.ts",
  "tests/integration/rc-staging-fixture.test.ts",
]);
const directory = await mkdtemp(join(root, ".rc-disposable-"));
const port = await new Promise((res, rej) => {
  const server = createServer();
  server.on("error", rej);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => res(address.port)); });
});
const password = randomBytes(32).toString("hex");
const localDatabaseName = "rc_pcb_verification_vc1_disposable_synthetic";
const database = new EmbeddedPostgres({ databaseDir: join(directory, "data"), port, user: "rc_local", password,
  persistent: false, authMethod: "scram-sha-256", postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError() {} });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: directory,
  DATABASE_URL: `postgresql://rc_local:${password}@127.0.0.1:${port}/${localDatabaseName}?schema=public`,
  NODE_ENV: "test", RC_DISPOSABLE_TEST: "1", TETAMU_PAYROLL_ENVIRONMENT: "LOCAL", TETAMU_MFA_ENABLED: "true", SESSION_SECRET: randomBytes(48).toString("hex"), NODE_OPTIONS: `--import=${join(root, "scripts/rc-network-guard.mjs")}` };
async function run(args, label) {
  let output = "";
  const exit = await new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => { output += d; }); child.stderr.on("data", (d) => { output += d; });
    child.on("error", () => res(1)); child.on("close", (code) => res(code ?? 1));
  });
  // Test diagnostics may include input objects. Never persist or echo those.
  const counts = output.split("\n").filter((line) => /^# (tests|pass|fail|skipped) \d+$/.test(line));
  const errorCodes = ["MODULE_NOT_ENABLED", "PCB_MANUAL_PERMISSION_DENIED", "PCB_INPUT_REVISION_CHANGED", "PCB_MANUAL_MFA_REQUIRED", "STEP_UP_REQUIRED", "STEP_UP_SESSION_MISMATCH", "STEP_UP_SCOPE_MISMATCH", "PrismaClientValidationError", "AssertionError", "TypeError", "ReferenceError", "P2002", "P2003", "P2021", "P2022", "origin", "NOT_CONFIGURED", "MFA_REQUIRED"].filter((code) => output.includes(code));
  console.log(JSON.stringify({ stage: label, exit, counts, errorCodes }));
  if (exit && label === "MIGRATION_REPLAY") console.log(JSON.stringify({ stage: "MIGRATION_DIAGNOSTIC",
    sqlState: output.match(/Database error code:\s*([A-Z0-9]{5})/)?.[1] ?? null,
    schemaErrors: [...output.matchAll(/(?:no language specified|syntax error at or near "[a-zA-Z_]+"|cannot change name of input parameter "[a-z_]+"|unsafe use of new value "[A-Z_]+"|type "[a-z_]+" does not exist|relation "[a-z_]+" does not exist|record variable cannot be part of multiple-item INTO list)/g)].map((m) => m[0]),
  }));
  for (const match of output.matchAll(/RC_READINESS (\{[^\n]+\})/g)) {
    const diagnostic = JSON.parse(match[1]);
    if (Number.isInteger(diagnostic.blockerCount) && Object.entries(diagnostic.codes ?? {}).every(([code, count]) => /^[A-Z_]+$/.test(code) && Number.isInteger(count))) {
      console.log(JSON.stringify({ stage: "READINESS_DIAGNOSTIC", blockerCount: diagnostic.blockerCount, codes: diagnostic.codes }));
    }
  }
  if (exit) {
    const failedBlocks = output.match(/^not ok \d+ - [\s\S]*?(?=^# Subtest:|^not ok |^ok \d+|^1\.\.|$(?![\s\S]))/gm) ?? [];
    console.log(JSON.stringify({ failedTests: failedBlocks.map((block) => ({
      title: block.split("\n")[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, "[redacted]").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[redacted]"),
      locations: [...new Set([...block.matchAll(/(?:src|tests)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]sx?:\d+(?::\d+)?/g)].map((m) => m[0]))].slice(0, 4),
      causes: ["PCB_MANUAL_CONFIRMATION_REQUIRED", "PCB_OFFICIAL_EXPORT_NOT_ENABLED", "PCB_PRODUCTION_ACTIVATION_NOT_ENABLED", "PAYROLL_READINESS_BLOCKED", "RC_EXTERNAL_NETWORK_DENIED", "MODULE_NOT_ENABLED", "AssertionError", "TypeError"].filter((code) => block.includes(code)),
      prismaCodes: [...new Set(block.match(/\bP\d{4}\b/g) ?? [])],
      transactionExpired: /Transaction already closed|expired transaction|transaction.*timed out/i.test(block),
      serializationConflict: /write conflict|deadlock|could not serialize/i.test(block),
      subprocessCodes: [...new Set(block.match(/RC_UPGRADE_SUBPROCESS_FAILED:[A-Za-z_]+:[A-Za-z0-9_, ]*/g) ?? [])],
    })) }));
  }
  if (exit) console.log(JSON.stringify({ diagnosticFlags: {
    moduleMissing: /Cannot find|MODULE_NOT_FOUND|ERR_MODULE/.test(output),
    transformError: /TransformError|transform failed|Transform failed/.test(output),
    timeout: /timed out|timeout/i.test(output),
    syntax: /SyntaxError/.test(output),
    constraint: /constraint/i.test(output),
    invalidAmount: /Amount|amount|money/.test(output),
  }, locations: [...output.matchAll(/(?:src|tests)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]sx?:\d+(?::\d+)?/g)].map((m) => m[0]).slice(0, 8) }));
  if (exit) {
    const known = [];
    for (const name of await readdir(join(root, "prisma/migrations"), { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const sql = await readFile(join(root, "prisma/migrations", name.name, "migration.sql"), "utf8");
      for (const match of sql.matchAll(/RAISE EXCEPTION '([^']+)'|CONSTRAINT "([^"]+)"/g)) {
        const literal = match[1] ?? match[2]; if (!literal.includes("%") && output.includes(literal)) known.push(literal);
      }
    }
    console.log(JSON.stringify({ knownDatabaseErrors: [...new Set(known)] }));
  }
  if (exit) throw new Error(`${label}_FAILED`);
}
let finalExitCode = 0;
try {
  await database.initialise(); await database.start(); await database.createDatabase(localDatabaseName);
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], "MIGRATION_REPLAY");
  const sharedTests = tests.length > 1 ? tests.filter((file) => !wholeDatabaseTests.has(file)) : tests;
  if (sharedTests.length) await run(["--import", "tsx", "--test", "--test-concurrency=1", ...sharedTests], "INTEGRATION");
  if (tests.length > 1) {
    for (const file of tests.filter((candidate) => wholeDatabaseTests.has(candidate))) {
      await runIsolatedWholeDatabaseTest(file);
    }
  }
} catch (error) {
  console.log(JSON.stringify({ result: "BLOCKED", code: error instanceof Error && /^(MIGRATION_REPLAY|INTEGRATION)_FAILED$/.test(error.message) ? error.message : "LOCAL_HARNESS_FAILED" }));
  finalExitCode = 1;
} finally {
  await database.stop();
  if (!directory.startsWith(join(root, ".rc-disposable-"))) throw new Error("CLEANUP_SCOPE_DENIED");
  await rm(directory, { recursive: true, force: true });
  console.log("RC_DISPOSABLE_CLEANED");
}
// embedded-postgres installs an async exit hook. Exit explicitly only AFTER
// owned-resource cleanup so its natural beforeExit hook cannot mask failure.
process.exit(finalExitCode);

async function runIsolatedWholeDatabaseTest(file) {
  const exit = await new Promise((resolveExit) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/rc-disposable-test.mjs"), file], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: "inherit",
    });
    child.on("error", () => resolveExit(1));
    child.on("close", (code) => resolveExit(code ?? 1));
  });
  if (exit !== 0) throw new Error("INTEGRATION_FAILED");
}
