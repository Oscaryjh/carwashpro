import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

export const CANONICAL_UAT_NAMESPACE = "TETAMU_CANONICAL_UAT_V1";
export const CANONICAL_UAT_BUSINESS_SLUG = "tetamu-canonical-uat";
export const CANONICAL_UAT_ISOLATION_BUSINESS_SLUG =
  "tetamu-uat-isolation-business";

export const CANONICAL_FIXTURE_KEYS = [
  "business.primary",
  "business.isolation",
  "branch.main",
  "branch.second",
  "branch.isolation",
  "user.owner",
  "account.manager",
  "account.staff",
  "membership.manager",
  "membership.staff",
  "user.manager",
  "user.staff",
  "assignment.manager.main",
  "assignment.staff.main",
  "assignment.staff.second",
  "customer.primary",
  "vehicle.primary",
  "service.primary",
  "product.primary",
  "stock.primary",
  "supplier.primary",
  "purchase-order.primary",
  "purchase-order-line.primary",
  "supplier-bill.primary",
  "supplier-bill-line.primary",
  "appointment.historical",
  "appointment.upcoming",
  "work-order.completed",
  "work-order-item.completed",
  "invoice.completed",
  "invoice-item.completed",
  "payment.completed",
  "refund.history",
  "expense-category.primary",
  "expense.primary",
  "roster-period.primary",
  "roster-assignment.primary",
  "roster-publication.primary",
  "roster-published-assignment.primary",
  "attendance.completed",
  "attendance.multi-session.1",
  "attendance.multi-session.2",
  "attendance.correction",
  "attendance.exception.pending",
  "attendance.expected-day.ot.staff",
  "attendance.final-result.ot.staff",
  "attendance.expected-day.ot.manager-self",
  "attendance.final-result.ot.manager-self",
  "leave-policy.primary",
  "leave-policy-version.primary",
  "leave-balance.staff",
  "leave-request.approved",
  "leave-request.pending",
  "leave-request.manager-self",
  "claim-category.primary",
  "claim-policy.primary",
  "claim.approved",
  "claim.pending",
  "claim.manager-self",
  "claim-line.approved",
  "claim-line.pending",
  "claim-line.manager-self",
  "commission-period.primary",
  "commission-statement.primary",
  "payroll-run.primary",
  "payroll-entry.staff",
  "payslip.staff",
] as const;

const EXPECTED_RAILWAY = {
  projectId: "ec8b25a7-4fb9-4959-8353-b4af000f4e80",
  environmentId: "ac9ef980-6805-4bf2-99f2-72dc7579d99d",
  serviceId: "e967b54d-dd06-4741-be99-e6e55e70af0e",
  serviceName: "tetamu-pos-web",
  databaseServiceId: "49c45405-1634-4292-9df3-bc27fe9a62a1",
  databaseServiceName: "Postgres-Canonical-Testing-SG",
} as const;

const REQUIRED_MIGRATION = "20260902120000_staff_otp_forward_hardening";
const SECRET_KEY_PATTERN =
  /(password|passphrase|secret|token|cookie|otp|database_url|api[_-]?key|private[_-]?key|credential|authorization)/i;
const SECRET_VALUE_PATTERN =
  /(postgres(?:ql)?:\/\/[^\s]+|bearer\s+[^\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/gi;
const PRODUCTION_PATTERN = /(^|[-_\s])prod(?:uction)?($|[-_\s])/i;

export type CanonicalPrepareMode = "DRY_RUN" | "APPLY";

export type CanonicalTestingEvidence = {
  environmentName: "testing";
  projectId: string;
  environmentId: string;
  serviceId: string;
  serviceName: string;
  databaseProvider: "postgresql";
  databaseHostClass: "railway-internal" | "railway-proxy" | "railway-ssh-tunnel";
};

export type CanonicalDatabaseEvidence = {
  databaseName: string;
  schemaName: string;
  migrationCount: number;
  latestMigration: string;
  requiredMigrationPresent: boolean;
  failedMigrationCount: number;
};

export class CanonicalTestingGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalTestingGuardError";
  }
}

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new CanonicalTestingGuardError(`Missing required Testing evidence: ${key}.`);
  }
  return value;
}

function assertNoProductionSignal(key: string, value: string) {
  if (PRODUCTION_PATTERN.test(value)) {
    throw new CanonicalTestingGuardError(
      `Production-like value detected in ${key}; canonical UAT tooling is Testing-only.`,
    );
  }
}

export function assertCanonicalTestingContext(
  env: NodeJS.ProcessEnv,
): CanonicalTestingEvidence {
  const environmentName = required(env, "RAILWAY_ENVIRONMENT_NAME").toLowerCase();
  const appEnvironment = required(env, "APP_ENVIRONMENT").toLowerCase();
  const projectId = required(env, "RAILWAY_PROJECT_ID");
  const environmentId = required(env, "RAILWAY_ENVIRONMENT_ID");
  const serviceId = required(env, "RAILWAY_SERVICE_ID");
  const serviceName = required(env, "RAILWAY_SERVICE_NAME");
  const databaseUrl = required(env, "DATABASE_URL");

  for (const [key, value] of Object.entries({
    RAILWAY_ENVIRONMENT_NAME: environmentName,
    APP_ENVIRONMENT: appEnvironment,
    RAILWAY_SERVICE_NAME: serviceName,
  })) {
    assertNoProductionSignal(key, value);
  }

  if (environmentName !== "testing" || appEnvironment !== "testing") {
    throw new CanonicalTestingGuardError(
      "Both RAILWAY_ENVIRONMENT_NAME and APP_ENVIRONMENT must equal testing.",
    );
  }
  if (projectId !== EXPECTED_RAILWAY.projectId) {
    throw new CanonicalTestingGuardError("Railway project identity does not match canonical Testing.");
  }
  if (environmentId !== EXPECTED_RAILWAY.environmentId) {
    throw new CanonicalTestingGuardError(
      "Railway environment identity does not match canonical Testing.",
    );
  }
  if (serviceId !== EXPECTED_RAILWAY.serviceId) {
    throw new CanonicalTestingGuardError("Railway service identity does not match canonical Testing.");
  }
  if (serviceName !== EXPECTED_RAILWAY.serviceName) {
    throw new CanonicalTestingGuardError("Railway service name does not match canonical Testing.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new CanonicalTestingGuardError("DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new CanonicalTestingGuardError("Canonical Testing requires PostgreSQL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  let databaseHostClass: CanonicalTestingEvidence["databaseHostClass"] | null = hostname.endsWith(
    ".railway.internal",
  )
    ? "railway-internal"
    : hostname.endsWith(".proxy.rlwy.net")
      ? "railway-proxy"
      : null;
  if (!databaseHostClass && (hostname === "127.0.0.1" || hostname === "localhost")) {
    const tunnelMode = required(env, "CANONICAL_UAT_TUNNEL_MODE");
    const databaseServiceId = required(env, "CANONICAL_UAT_DATABASE_SERVICE_ID");
    const databaseServiceName = required(env, "CANONICAL_UAT_DATABASE_SERVICE_NAME");
    if (
      tunnelMode !== "railway-ssh" ||
      databaseServiceId !== EXPECTED_RAILWAY.databaseServiceId ||
      databaseServiceName !== EXPECTED_RAILWAY.databaseServiceName
    ) {
      throw new CanonicalTestingGuardError(
        "Local database endpoints require the exact canonical Testing Railway SSH tunnel identity.",
      );
    }
    databaseHostClass = "railway-ssh-tunnel";
  }
  if (!databaseHostClass) {
    throw new CanonicalTestingGuardError(
      "DATABASE_URL is not a Railway internal or Railway TCP proxy endpoint.",
    );
  }

  return {
    environmentName: "testing",
    projectId,
    environmentId,
    serviceId,
    serviceName,
    databaseProvider: "postgresql",
    databaseHostClass,
  };
}

export async function assertCanonicalTestingDatabase(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<CanonicalDatabaseEvidence> {
  const identity = await prisma.$queryRaw<
    Array<{ database_name: string; schema_name: string }>
  >`SELECT current_database()::text AS database_name, current_schema()::text AS schema_name`;
  const migrations = await prisma.$queryRaw<
    Array<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
      logs: string | null;
    }>
  >`SELECT migration_name, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    ORDER BY started_at ASC`;

  const databaseName = identity[0]?.database_name ?? "";
  const schemaName = identity[0]?.schema_name ?? "";
  if (databaseName !== "railway" || schemaName !== "public") {
    throw new CanonicalTestingGuardError(
      "Database name/schema do not match the canonical Railway Testing shape.",
    );
  }
  const failed = migrations.filter(
    (row) => row.finished_at === null && row.rolled_back_at === null,
  );
  if (failed.length > 0) {
    throw new CanonicalTestingGuardError(
      "Database migration ledger contains unfinished migrations.",
    );
  }
  const requiredMigrationPresent = migrations.some(
    (row) => row.migration_name === REQUIRED_MIGRATION && row.finished_at !== null,
  );
  if (!requiredMigrationPresent) {
    throw new CanonicalTestingGuardError(
      "Required canonical Testing migration marker is absent.",
    );
  }

  return {
    databaseName,
    schemaName,
    migrationCount: migrations.length,
    latestMigration: migrations.at(-1)?.migration_name ?? "none",
    requiredMigrationPresent,
    failedMigrationCount: failed.length,
  };
}

export function parseCanonicalPrepareMode(args: readonly string[]): CanonicalPrepareMode {
  const forbidden = args.find((arg) =>
    /force|production|ignore|unsafe|skip|reset|delete|truncate|drop/i.test(arg),
  );
  if (forbidden) {
    throw new CanonicalTestingGuardError(`Forbidden argument: ${forbidden}.`);
  }
  const unknown = args.find((arg) => arg !== "--apply");
  if (unknown) {
    throw new CanonicalTestingGuardError(`Unknown argument: ${unknown}.`);
  }
  return args.includes("--apply") ? "APPLY" : "DRY_RUN";
}

export function stableFixtureId(key: string) {
  const hex = createHash("sha256")
    .update(`${CANONICAL_UAT_NAMESPACE}:${key}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function fixtureMarker(key: string) {
  return `[${CANONICAL_UAT_NAMESPACE}:${key}]`;
}

export function buildCanonicalFixturePlan(
  keys: readonly string[],
  existingFixtureIds: ReadonlySet<string>,
) {
  return keys.map((key) => ({
    key,
    id: stableFixtureId(key),
    status: existingFixtureIds.has(stableFixtureId(key))
      ? ("ALREADY EXISTS" as const)
      : ("WOULD CREATE" as const),
  }));
}

export async function executeCanonicalFixturePlan(
  mode: CanonicalPrepareMode,
  plan: ReadonlyArray<{ key: string; status: "WOULD CREATE" | "ALREADY EXISTS" }>,
  applyOne: (item: { key: string; id: string }) => Promise<void>,
) {
  if (mode !== "APPLY") return { applied: 0, mode } as const;
  let applied = 0;
  for (const item of plan) {
    if (item.status !== "WOULD CREATE") continue;
    await applyOne({ key: item.key, id: stableFixtureId(item.key) });
    applied += 1;
  }
  return { applied, mode } as const;
}

export function assertAllowedMutation(operation: string) {
  if (/\b(delete|deleteMany|truncate|drop|reset|executeRaw|queryRawUnsafe)\b/i.test(operation)) {
    throw new CanonicalTestingGuardError(
      `Destructive or arbitrary SQL operation is prohibited: ${operation}.`,
    );
  }
}

export function assertNoExternalSideEffect(operation: string) {
  if (/\b(send|sms|twilio|whatsapp|email|webhook|charge|refund|payment provider)\b/i.test(operation)) {
    throw new CanonicalTestingGuardError(
      `External side effect is prohibited in canonical UAT preparation: ${operation}.`,
    );
  }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(nested),
      ]),
    );
  }
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  }
  return value;
}

export function safeJson(value: unknown) {
  return JSON.stringify(redactSecrets(value), null, 2);
}
