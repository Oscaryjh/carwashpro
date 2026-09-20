import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// Disposable loopback ONLY. Never inherit any external service credentials.
process.umask(0o077);
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(root, ".rc-browser-"));
const secret = () => randomBytes(32).toString("hex");
async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); });
  });
}
const dbPort = await freePort(), appPort = await freePort();
const dbPassword = secret(), password = secret();
const dbName = "rc_pcb_verification_vc1_disposable_synthetic";
const dbUrl = `postgresql://rc_local:${dbPassword}@127.0.0.1:${dbPort}/${dbName}?schema=public`;
const base = `http://127.0.0.1:${appPort}`;
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: directory,
  NODE_ENV: "test", DATABASE_URL: dbUrl, RC_DISPOSABLE_TEST: "1",
  TETAMU_PAYROLL_ENVIRONMENT: "LOCAL", TETAMU_MFA_ENABLED: "true",
  SESSION_SECRET: secret(), EMPLOYEE_AUTH_SECRET: secret(),
  MFA_ENCRYPTION_KEYS: JSON.stringify({ rc: randomBytes(32).toString("base64") }), MFA_ACTIVE_KEY_VERSION: "rc",
  HR_CORE_ACCEPTANCE_PASSWORD: password, HR_EIGHT_ROLE_UAT_PASSWORD: password,
  HR_PAYROLL_UAT_ARTIFACT_DIRECTORY: directory,
  LOCAL_POS_CORE_UAT_PASSWORD: password, POS_CORE_UAT_FIXTURE: "LOCAL_ONLY_CONFIRMED",
  NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: `--import=${join(root, "scripts/rc-network-guard.mjs")}`,
};
const database = new EmbeddedPostgres({ databaseDir: join(directory, "data"), port: dbPort, user: "rc_local", password: dbPassword,
  persistent: false, authMethod: "scram-sha-256", postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError() {} });
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
let server, browser, page, context, personas, core;
const results = [];
function safe(value) {
  return String(value).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[redacted]")
    .replace(/\+?\d[\d ()-]{6,}\d/g, "[redacted]").replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, "[redacted]")
    .replace(/\b[a-z0-9]{24,}\b/gi, "[redacted]");
}
function report(result) {
  if (result.status === "FAIL" || result.status === "NEEDS_IMPROVEMENT") exit = 1;
  results.push(result); console.log(JSON.stringify(result));
}
async function run(args, stage) {
  let output = "";
  const exit = await new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
    child.on("error", () => res(1)); child.on("close", code => res(code ?? 1));
  });
  report({ stage, exit });
  if (exit) {
    report({ stage, codes: [...new Set(output.match(/\b(?:P\d{4}|[A-Z][A-Z_]{8,})\b/g) ?? [])].slice(0, 15), locations: [...new Set(output.match(/(?:scripts|src|tests)\/[\w/.-]+\.[jt]s:\d+/g) ?? [])].slice(0, 5) });
    throw new Error("LOCAL_SEED_FAILED");
  }
}
async function logout() {
  if (!context) return;
  if (page && !page.isClosed()) {
    const button = page.getByRole("button", { name: /^(Sign out|Log out|Logout)$/i }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click(); await page.waitForURL(url => /\/(login|verify)$/.test(url.pathname), { timeout: 15000 });
    }
  }
  await context.close(); context = undefined; page = undefined;
}
async function login(role, mobile = false) {
  await logout();
  context = await browser.newContext({ httpCredentials: { username: runtime.UAT_PREVIEW_ACCESS_USERNAME, password: runtime.UAT_PREVIEW_ACCESS_PASSWORD }, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === base ? route.continue() : route.abort();
  });
  page = await context.newPage();
  const email = role === "AUTO" ? "uat.auto.owner@tetamu.test" : role === "SALON" ? "uat.salon.owner@tetamu.test" : personas.find(p => p.persona === role)?.email;
  if (!email) throw new Error("LOCAL_PERSONA_MISSING");
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => url.pathname !== "/login", { timeout: 20000 });
  report({ stage: "LOGIN", role, mobile, path: safe(new URL(page.url()).pathname) });
}
let runtime;
let exit = 0, databaseStopped = false;
try {
  await database.initialise(); await database.start(); await database.createDatabase(dbName);
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], "EMPTY_REPLAY");
  await run(["--import", "tsx", "scripts/prepare-pos-core-uat-fixtures.ts", "seed"], "POS_SEED");
  await run(["--import", "tsx", "scripts/prepare-hr-payroll-core-acceptance.ts"], "HR_SEED");
  await run(["--import", "tsx", "scripts/prepare-hr-payroll-eight-role-uat.ts"], "EIGHT_ROLE_SEED");
  core = JSON.parse(await readFile(join(directory, "hr-payroll-core-acceptance.json"), "utf8"));
  personas = JSON.parse(await readFile(join(directory, "hr-payroll-eight-role-uat.json"), "utf8")).personas;
  const staff = await prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: personas.find(p => p.persona === "STAFF").membershipId }, include: { employeeAccount: true } });
  runtime = { ...env, NODE_ENV: "production", APP_ENVIRONMENT: "uat-preview", RAILWAY_ENVIRONMENT_NAME: "uat-preview",
    RAILWAY_PROJECT_ID: "local-synthetic-project", UAT_PREVIEW_EXPECTED_PROJECT_ID: "local-synthetic-project",
    RAILWAY_ENVIRONMENT_ID: "local-synthetic-environment", UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "local-synthetic-environment",
    RAILWAY_SERVICE_ID: "local-synthetic-web", UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "local-synthetic-web",
    UAT_PREVIEW_ACCESS_ENABLED: "true", UAT_PREVIEW_ACCESS_USERNAME: "local-rc", UAT_PREVIEW_ACCESS_PASSWORD: secret(),
    UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true", UAT_PREVIEW_OTP_HMAC_SEED: secret(), UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST: staff.employeeAccount.phoneNumber,
    OTP_PROVIDER: "uat_preview_intercept", OTP_CHANNEL: "intercept", EMPLOYEE_OTP_SEND_MODE: "uat_preview_intercept",
    PRODUCTION_ELIGIBLE: "false", OFFICIAL_EXPORT_ELIGIBLE: "false", BANK_PAYMENT_EXECUTION_ENABLED: "false", GOVERNMENT_SUBMISSION_ENABLED: "false", PCB_PRODUCTION_ENABLED: "false",
  };
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], { cwd: root, env: runtime, stdio: "ignore" });
  let ready = false;
  for (let retry = 0; retry < 60; retry++) {
    try { const response = await fetch(`${base}/api/health`, { headers: { authorization: `Basic ${Buffer.from(`${runtime.UAT_PREVIEW_ACCESS_USERNAME}:${runtime.UAT_PREVIEW_ACCESS_PASSWORD}`).toString("base64")}` } }); if (response.status === 200) { ready = true; break; } } catch {}
    await new Promise(res => setTimeout(res, 500));
  }
  if (!ready) throw new Error("LOCAL_APP_HEALTH_FAILED");
  const { chromium } = await import(pathToFileURL(resolve(root, "../uat-runner/node_modules/playwright-core/index.mjs")).href);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report({ stage: "LOCAL_BROWSER_READY", health: "PASS", realCommunications: false });
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line);
    if (command.op === "stop") break;
    try {
      if (command.op === "login") await login(command.role, command.mobile);
      else if (command.op === "goto") {
        if (!/^\/[a-z0-9/?=&_.-]*$/i.test(command.path)) throw new Error("LOCAL_PATH_REQUIRED");
        const response = await page.goto(base + command.path);
        report({ stage: "NAVIGATE", label: command.label, status: response?.status(), path: safe(new URL(page.url()).pathname), headings: (await page.locator("h1,h2").allTextContents()).map(safe), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
      } else if (command.op === "controls") {
        const controls = await page.locator("button,label,input,select").evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, text: node.tagName === "INPUT" ? "" : (node.textContent ?? "").slice(0, 80), name: node.getAttribute("name"), type: node.getAttribute("type") })));
        report({ stage: "CONTROLS", controls: controls.map(c => ({ ...c, text: safe(c.text), name: safe(c.name) })) });
      } else if (command.op === "logout") { await logout(); report({ stage: "LOGOUT", status: "PASS" }); }
      else if (command.op === "health-negative") {
        await logout(); await database.stop(); databaseStopped = true;
          const response = await fetch(`${base}/api/health`, { headers: { authorization: `Basic ${Buffer.from(`${runtime.UAT_PREVIEW_ACCESS_USERNAME}:${runtime.UAT_PREVIEW_ACCESS_PASSWORD}`).toString("base64")}` } });
          const body = await response.text();
          if (response.status !== 503 || !body.includes('"database":"unavailable"') || body.includes(dbPassword) || body.includes(dbUrl)) throw new Error("HEALTH_FAIL_CLOSED_REQUIRED");
          report({ stage: "HEALTH_DB_DOWN", status: "PASS", httpStatus: 503, secretLeaked: false });
      }
      else if (command.op === "scenario") {
        const scenarios = await import(`${pathToFileURL(join(root, "scripts/rc-browser-scenarios.mjs")).href}?run=${Date.now()}`);
        await scenarios.runScenario(command.case, { login, logout, getPage: () => page, getContext: () => context, base, prisma, core, personas, runtime, report });
      }
      else throw new Error("LOCAL_COMMAND_UNKNOWN");
    } catch (error) { exit = 1; report({ stage: command.op, status: "FAIL", kind: error.name, code: /^[A-Z_]+$/.test(error.message) ? error.message : "BROWSER_ASSERTION_FAILED",
      locations: [...new Set(error.stack?.match(/(?:scripts|src)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]s:\d+:\d+/g) ?? [])].slice(0, 4),
      codes: [...new Set(error.message?.match(/\b(?:ERR_[A-Z_]+|MFA_[A-Z_]+|PCB_[A-Z_]+|STEP_UP_[A-Z_]+)\b/g) ?? [])] }); }
  }
} catch (error) { exit = 1; report({ stage: "HARNESS", status: "FAIL", kind: error.name, code: /^[A-Z_]+$/.test(error.message) ? error.message : "LOCAL_HARNESS_FAILED" }); }
finally {
  await logout().catch(() => { exit = 1; });
  await browser?.close();
  if (server && server.exitCode === null) { const closed = new Promise(res => server.once("close", res)); server.kill("SIGTERM"); await closed; }
  await prisma.$disconnect(); if (!databaseStopped) await database.stop();
  if (!directory.startsWith(join(root, ".rc-browser-"))) throw new Error("CLEANUP_SCOPE_DENIED");
  await rm(directory, { recursive: true, force: true });
  report({ stage: "LOCAL_RESOURCES_CLEANED", contextsClosed: true });
}
process.exit(exit);
