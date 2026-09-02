import { emitOpsAlert } from "../src/lib/ops/alerting";

type ProbeName = "desktop" | "database" | "staff";
type ProbeState = {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  alertActive: boolean;
};

const environment = (process.env.APP_ENVIRONMENT ?? "").trim().toLowerCase();
if (environment !== "testing" && environment !== "local") {
  throw new Error("The operational health monitor is enabled only for Testing or Local.");
}

const intervalMs = readInteger("OPS_MONITOR_INTERVAL_MS", 120_000, 60_000, 300_000);
const failureThreshold = readInteger("OPS_HEALTH_FAILURE_THRESHOLD", 3, 2, 10);
const recoveryThreshold = readInteger("OPS_HEALTH_RECOVERY_THRESHOLD", 2, 1, 5);
const desktopUrl = requiredUrl("OPS_DESKTOP_HEALTH_URL");
const staffUrl = requiredUrl("OPS_STAFF_PROBE_URL");
const states = new Map<ProbeName, ProbeState>();
let stopping = false;

process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

await run();

async function run() {
  console.log(JSON.stringify({
    event: "HEALTH_MONITOR_STARTED",
    environment,
    severity: "INFO",
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-ops-monitor",
    timestamp: new Date().toISOString(),
    code: "HEALTH_MONITOR_STARTED",
    intervalSeconds: intervalMs / 1000,
  }));
  while (!stopping) {
    await runProbeCycle();
    if (!stopping) await sleep(intervalMs);
  }
}

export async function runProbeCycle(fetchImpl: typeof fetch = fetch) {
  let desktopHealthy = false;
  let databaseHealthy = false;
  try {
    const response = await fetchImpl(desktopUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await readJson(response);
    desktopHealthy = response.ok && payload?.ok === true;
    databaseHealthy = response.ok && payload?.database === "ready";
  } catch {
    desktopHealthy = false;
    databaseHealthy = false;
  }
  await recordProbe("desktop", desktopHealthy);
  await recordProbe("database", databaseHealthy);

  let staffHealthy = false;
  try {
    const response = await fetchImpl(staffUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    staffHealthy = response.status >= 200 && response.status < 400;
  } catch {
    staffHealthy = false;
  }
  await recordProbe("staff", staffHealthy);
}

async function recordProbe(name: ProbeName, healthy: boolean) {
  const state = states.get(name) ?? {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    alertActive: false,
  };
  if (healthy) {
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses += 1;
    if (state.alertActive && state.consecutiveSuccesses >= recoveryThreshold) {
      const event = name === "database" ? "DATABASE_RECOVERED" : "SERVICE_HEALTH_RECOVERED";
      await emitOpsAlert({
        event,
        severity: "INFO",
        service: serviceName(name),
        stage: "health-probe",
        code: event,
        message: `${name} health probe recovered.`,
        status: "RECOVERED",
        metadata: { probe: name, consecutiveSuccesses: state.consecutiveSuccesses },
      });
      state.alertActive = false;
    }
  } else {
    state.consecutiveSuccesses = 0;
    state.consecutiveFailures += 1;
    if (!state.alertActive && state.consecutiveFailures >= failureThreshold) {
      const event = name === "database" ? "DATABASE_UNAVAILABLE" : "SERVICE_HEALTH_FAILED";
      await emitOpsAlert({
        event,
        severity: "CRITICAL",
        service: serviceName(name),
        stage: "health-probe",
        code: event,
        message: `${name} health probe failed repeatedly.`,
        metadata: { probe: name, consecutiveFailures: state.consecutiveFailures },
      });
      state.alertActive = true;
    }
  }
  states.set(name, state);
}

function serviceName(name: ProbeName) {
  if (name === "staff") return "tetamu-staff-app";
  if (name === "database") return "testing-postgres";
  return "tetamu-pos-web";
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function requiredUrl(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (url.protocol !== "https:" && environment !== "local") {
    throw new Error(`${name} must use HTTPS in Testing.`);
  }
  return url.toString();
}

function readInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
