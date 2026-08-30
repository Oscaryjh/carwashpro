export type OpsAlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type OpsAlertEvent = Readonly<{
  event: string;
  environment: string;
  severity: OpsAlertSeverity;
  service: string;
  timestamp: string;
  stage: string;
  code: string;
  message: string;
  status: "ACTIVE" | "RECOVERED";
  fingerprint: string;
  deploymentId?: string;
  jobId?: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type OpsAlertDelivery = Readonly<{
  delivered: boolean;
  deduplicated: boolean;
  attempts: number;
  receiverId?: string;
  reason?: string;
}>;

type AlertState = {
  deliveries: Map<string, { count: number; firstAt: number; lastAt: number }>;
  httpErrors: number[];
};

type SendOptions = {
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  cooldownMs?: number;
  maxPerWindow?: number;
  windowMs?: number;
};

const ALERT_STATE = Symbol.for("tetamu.ops.alerting.state");
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_RATE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 3;
const HTTP_5XX_WINDOW_MS = 5 * 60 * 1000;
const HTTP_5XX_THRESHOLD = 5;

export function createOpsAlertEvent(input: {
  event: string;
  environment?: string;
  severity: OpsAlertSeverity;
  service: string;
  stage: string;
  code: string;
  message: string;
  status?: "ACTIVE" | "RECOVERED";
  deploymentId?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}): OpsAlertEvent {
  const environment = normalizeEnvironment(input.environment ?? process.env.APP_ENVIRONMENT);
  const event = stableIdentifier(input.event, "event");
  const service = safeText(input.service, 120);
  const stage = stableIdentifier(input.stage, "stage");
  const code = stableIdentifier(input.code, "code");
  const status = input.status ?? "ACTIVE";
  return {
    event,
    environment,
    severity: input.severity,
    service,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    stage,
    code,
    message: redactOpsText(input.message),
    status,
    fingerprint: `${environment}:${event}:${service}:${stage}:${code}:${status}`,
    ...(input.deploymentId
      ? { deploymentId: safeText(input.deploymentId, 120) }
      : {}),
    ...(input.jobId ? { jobId: safeText(input.jobId, 120) } : {}),
    metadata: redactOpsValue(input.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function sendOpsAlert(
  event: OpsAlertEvent,
  options: SendOptions = {},
): Promise<OpsAlertDelivery> {
  const webhookUrl = options.webhookUrl ?? process.env.OPS_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      delivered: false,
      deduplicated: false,
      attempts: 0,
      reason: "ALERT_DESTINATION_NOT_CONFIGURED",
    };
  }
  assertHttpsWebhook(webhookUrl, event.environment);
  const now = options.now ?? new Date();
  const state = getAlertState();
  const gate = deliveryGate(state, event.fingerprint, now.getTime(), options);
  if (!gate.allowed) {
    return {
      delivered: false,
      deduplicated: true,
      attempts: 0,
      reason: gate.reason,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  let lastReason = "ALERT_DELIVERY_FAILED";
  let attempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        recordDelivery(state, event.fingerprint, now.getTime(), options);
        return {
          delivered: true,
          deduplicated: false,
          attempts: attempt,
          ...(await receiverIdentity(response)),
        };
      }
      lastReason = `ALERT_HTTP_${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastReason = redactOpsText(error instanceof Error ? error.message : String(error));
    }
    if (attempt < 3) await sleepImpl(100 * 2 ** (attempt - 1));
  }
  console.error(
    JSON.stringify({
      event: "ALERT_DELIVERY_FAILED",
      environment: event.environment,
      severity: "ERROR",
      service: event.service,
      timestamp: new Date().toISOString(),
      code: lastReason,
      alertFingerprint: event.fingerprint,
    }),
  );
  return {
    delivered: false,
    deduplicated: false,
    attempts,
    reason: lastReason,
  };
}

export async function emitOpsAlert(
  input: Parameters<typeof createOpsAlertEvent>[0],
  options: SendOptions = {},
) {
  const event = createOpsAlertEvent(input);
  const delivery = await sendOpsAlert(event, options);
  const log = { ...event, delivery };
  const output = JSON.stringify(log);
  if (event.severity === "INFO" || event.status === "RECOVERED") console.log(output);
  else console.error(output);
  return { event, delivery };
}

export async function recordHttpServerError(input: {
  service: string;
  route: string;
  message: string;
  now?: Date;
}) {
  const state = getAlertState();
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - HTTP_5XX_WINDOW_MS;
  state.httpErrors = state.httpErrors.filter((timestamp) => timestamp >= cutoff);
  state.httpErrors.push(now.getTime());
  if (state.httpErrors.length < HTTP_5XX_THRESHOLD) {
    return { thresholdExceeded: false, count: state.httpErrors.length };
  }
  const result = await emitOpsAlert({
    event: "HTTP_5XX_THRESHOLD_EXCEEDED",
    severity: "ERROR",
    service: input.service,
    stage: "request-processing",
    code: "HTTP_5XX_THRESHOLD_EXCEEDED",
    message: input.message,
    metadata: {
      count: state.httpErrors.length,
      route: input.route,
      threshold: HTTP_5XX_THRESHOLD,
      windowSeconds: HTTP_5XX_WINDOW_MS / 1000,
    },
  });
  return { thresholdExceeded: true, count: state.httpErrors.length, ...result };
}

export async function emitSms123ProviderAlert(input: {
  failureType: "REJECTED" | "TIMEOUT" | "UNAVAILABLE" | "INVALID_RESPONSE";
  providerCode?: string | null;
  httpStatus?: number | null;
}) {
  const severity: OpsAlertSeverity =
    input.failureType === "REJECTED" ? "WARNING" : "ERROR";
  return emitOpsAlert({
    event: "SMS123_PROVIDER_ERROR",
    severity,
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-staff-app",
    stage: "otp-delivery",
    code: `SMS123_${input.failureType}`,
    message: `SMS123 ${input.failureType.toLowerCase()} the OTP delivery request.`,
    metadata: {
      httpStatus: input.httpStatus ?? null,
      providerCode: input.providerCode ?? null,
      deliveryState: "PROVIDER_REQUEST_FAILED",
    },
  });
}

export async function emitScheduledJobFailure(input: {
  job: string;
  attempt?: number;
  code: string;
  message: string;
  severity?: OpsAlertSeverity;
}) {
  return emitOpsAlert({
    event: "SCHEDULED_JOB_FAILED",
    severity: input.severity ?? "ERROR",
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-pos-worker",
    stage: "scheduled-job",
    code: input.code,
    message: input.message,
    jobId: input.job,
    metadata: { attempt: input.attempt ?? 1, job: input.job },
  });
}

export function redactOpsText(value: unknown) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b\d{6}\b/g, "[REDACTED_OTP]")
    .slice(0, 2_000);
}

export function resetOpsAlertStateForTests() {
  const holder = globalThis as typeof globalThis & { [ALERT_STATE]?: AlertState };
  delete holder[ALERT_STATE];
}

function redactOpsValue(value: unknown, key = ""): unknown {
  if (/(authorization|cookie|password|secret|token|api.?key|credential|otp|bank)/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((entry) => redactOpsValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactOpsValue(entry, entryKey),
      ]),
    );
  }
  return typeof value === "string" ? redactOpsText(value) : value;
}

function deliveryGate(
  state: AlertState,
  fingerprint: string,
  now: number,
  options: SendOptions,
) {
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxPerWindow = options.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const prior = state.deliveries.get(fingerprint);
  if (!prior) return { allowed: true as const };
  if (now - prior.lastAt < cooldownMs) {
    return { allowed: false as const, reason: "ALERT_DEDUPLICATED_COOLDOWN" };
  }
  if (now - prior.firstAt < windowMs && prior.count >= maxPerWindow) {
    return { allowed: false as const, reason: "ALERT_RATE_LIMITED" };
  }
  return { allowed: true as const };
}

function recordDelivery(
  state: AlertState,
  fingerprint: string,
  now: number,
  options: SendOptions,
) {
  const windowMs = options.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const prior = state.deliveries.get(fingerprint);
  state.deliveries.set(
    fingerprint,
    !prior || now - prior.firstAt >= windowMs
      ? { count: 1, firstAt: now, lastAt: now }
      : { count: prior.count + 1, firstAt: prior.firstAt, lastAt: now },
  );
}

function getAlertState() {
  const holder = globalThis as typeof globalThis & { [ALERT_STATE]?: AlertState };
  holder[ALERT_STATE] ??= { deliveries: new Map(), httpErrors: [] };
  return holder[ALERT_STATE];
}

function normalizeEnvironment(value: string | undefined) {
  const environment = String(value ?? "unknown").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(environment)) return "unknown";
  return environment;
}

function stableIdentifier(value: string, name: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{2,95}$/.test(normalized)) {
    throw new Error(`Ops alert ${name} must be a stable uppercase identifier.`);
  }
  return normalized;
}

function safeText(value: unknown, limit: number) {
  return redactOpsText(value).slice(0, limit);
}

function assertHttpsWebhook(webhookUrl: string, environment: string) {
  const parsed = new URL(webhookUrl);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(environment === "local" && local)) {
    throw new Error("OPS_ALERT_WEBHOOK_URL must use HTTPS outside Local.");
  }
}

async function receiverIdentity(response: Response) {
  const headerId = response.headers.get("x-request-id") ?? response.headers.get("x-message-id");
  if (headerId) return { receiverId: safeText(headerId, 160) };
  try {
    const payload = (await response.clone().json()) as Record<string, unknown>;
    const value = payload.messageId ?? payload.eventId ?? payload.id;
    return typeof value === "string" && value ? { receiverId: safeText(value, 160) } : {};
  } catch {
    return {};
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
