import { NextResponse } from "next/server";
import { resolvePosPilotSmokeConfig } from "@/lib/release/pos-pilot-smoke-authorization";

export const FROZEN_DOMAIN_DENIED = "FROZEN_DOMAIN_DENIED" as const;

export {
  assertPosPilotSmokeOperationScope,
  authorizePosPilotSmoke,
  authorizePosPilotSmokeOperation,
  buildPosPilotSmokeAuthorizationResult,
  issuePosPilotSmokeCapability,
  maintenanceSecretMatches,
  POS_PILOT_SMOKE_COOKIE,
  posPilotSmokeScopeMatches,
  verifyPosPilotSmokeCapability,
} from "@/lib/release/pos-pilot-smoke-authorization";
export { resolvePosPilotSmokeConfig };

export const POS_PILOT_WRITE_FROZEN = "POS_PILOT_WRITE_FROZEN" as const;

export const POS_PILOT_WRITE_FREEZE_MODES = [
  "full",
  "operator-smoke",
  "off",
] as const;

export type PosPilotWriteFreezeMode =
  (typeof POS_PILOT_WRITE_FREEZE_MODES)[number];

export type PosPilotWriteDecision =
  | "ALLOW"
  | "DENY"
  | "REQUIRE_SMOKE_CAPABILITY";

export const POS_PILOT_RELEASE_MODE = "core-pilot" as const;

export type FrozenDomainOperation =
  | "PAYROLL_MUTATION"
  | "PCB_CALCULATION"
  | "STATUTORY_ACTIVATION"
  | "OFFICIAL_STATUTORY_EXPORT"
  | "GOVERNMENT_SUBMISSION"
  | "PAYROLL_PAYMENT_BATCH"
  | "PAYROLL_BANK_EXECUTION"
  | "PAYROLL_SETTLEMENT"
  | "FROZEN_DOMAIN_JOB";

export type PosPilotOperation =
  | "POS_CHECKOUT"
  | "POS_CUSTOMER_PAYMENT"
  | "POS_PARTIAL_PAYMENT"
  | "POS_REFUND"
  | "POS_INVOICE_RECEIPT"
  | "POS_PACKAGE_REDEMPTION"
  | "POS_DAILY_CLOSING"
  | "POS_CUSTOMER_HISTORY";

export class FrozenDomainDeniedError extends Error {
  readonly code = FROZEN_DOMAIN_DENIED;

  constructor(readonly operation: FrozenDomainOperation) {
    super(FROZEN_DOMAIN_DENIED);
    this.name = "FrozenDomainDeniedError";
  }
}

export class PosPilotWriteFrozenError extends Error {
  readonly code = POS_PILOT_WRITE_FROZEN;

  constructor(readonly operation = "BUSINESS_MUTATION") {
    super(POS_PILOT_WRITE_FROZEN);
    this.name = "PosPilotWriteFrozenError";
  }
}

export function resolvePosPilotWriteFreezeMode(
  env: RuntimeEnv = process.env,
): PosPilotWriteFreezeMode {
  const value = env.POS_PILOT_WRITE_FREEZE_MODE;
  if (isWriteFreezeMode(value)) return value;

  const environment = resolveEnvironment(env);
  const corePilot = env.POS_PILOT_RELEASE_MODE === POS_PILOT_RELEASE_MODE;
  if (!value && environment !== "production" && !corePilot) return "off";

  throw new Error(
    "POS_PILOT_WRITE_FREEZE_MODE must be exactly full, operator-smoke, or off.",
  );
}

export function writeFrozenResponse() {
  return new NextResponse(POS_PILOT_WRITE_FROZEN, {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "60",
      "cache-control": "no-store",
    },
  });
}

export function evaluatePosPilotWriteRequest(input: {
  method: string;
  pathname: string;
  mode: PosPilotWriteFreezeMode;
  smokeCapabilityValid?: boolean;
}): PosPilotWriteDecision {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return "ALLOW";
  }
  if (input.mode === "off" || isWriteFreezeInfrastructurePath(input.pathname)) {
    return "ALLOW";
  }
  if (input.mode === "full") return "DENY";
  if (!isOperatorSmokePath(input.pathname)) return "DENY";
  return input.smokeCapabilityValid ? "ALLOW" : "REQUIRE_SMOKE_CAPABILITY";
}

export function maintenanceAuditEvent(input: {
  event: "MODE_OBSERVED" | "SMOKE_ACCEPTED" | "SMOKE_DENIED";
  mode: PosPilotWriteFreezeMode;
  actorId?: string;
  businessId?: string;
  branchId?: string;
  operation?: string;
  reason?: string;
  maintenanceToken?: string;
}) {
  return compactObject({
    event: `POS_PILOT_WRITE_FREEZE_${input.event}`,
    mode: input.mode,
    actorId: input.actorId,
    businessId: input.businessId,
    branchId: input.branchId,
    operation: input.operation,
    reason: input.reason,
  });
}

export function shouldSuppressPosPilotNotificationQueue(
  env: RuntimeEnv = process.env,
) {
  try {
    return resolvePosPilotWriteFreezeMode(env) !== "off";
  } catch {
    return true;
  }
}

export function assertFrozenDomainDenied(
  operation: FrozenDomainOperation,
  env: RuntimeEnv = process.env,
): void {
  const environment = resolveEnvironment(env);
  if (
    environment === "production" ||
    environment === "testing" ||
    env.POS_PILOT_RELEASE_MODE?.trim() === POS_PILOT_RELEASE_MODE
  ) {
    throw new FrozenDomainDeniedError(operation);
  }
}

export function isPosPilotOperationAllowed(
  operation: FrozenDomainOperation | PosPilotOperation,
) {
  return operation.startsWith("POS_");
}

export function frozenDomainResponse(operation: FrozenDomainOperation) {
  try {
    assertFrozenDomainDenied(operation);
    return null;
  } catch (error) {
    if (!(error instanceof FrozenDomainDeniedError)) throw error;
    return new Response(FROZEN_DOMAIN_DENIED, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export function classifyPosPilotRoute(
  pathname: string,
  searchParams?: Pick<URLSearchParams, "get">,
): "ALLOWED" | "FROZEN" {
  const isEmployeeProfile = /^\/team\/people\/[^/]+\/?$/.test(pathname);
  const section = searchParams?.get("section");
  const view = searchParams?.get("view");
  const employeePayrollSection = isEmployeeProfile && (
    section === "payroll" ||
    section === "statutory" ||
    (section === "compensation" && (view === "payroll" || view === "statutory"))
  );
  return pathname === "/team/payroll" ||
    pathname.startsWith("/team/payroll/") ||
    /^\/team\/people\/[^/]+\/payroll(?:\/|$)/.test(pathname) ||
    employeePayrollSection ||
    pathname === "/admin/statutory" ||
    pathname.startsWith("/admin/statutory/")
    ? "FROZEN"
    : "ALLOWED";
}

type RuntimeEnv = Record<string, string | undefined>;

function isWriteFreezeMode(value: string | undefined): value is PosPilotWriteFreezeMode {
  return POS_PILOT_WRITE_FREEZE_MODES.some((mode) => mode === value);
}

function isWriteFreezeInfrastructurePath(pathname: string) {
  return pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/security/mfa" ||
    pathname.startsWith("/security/mfa/") ||
    pathname === "/api/health" ||
    pathname === "/api/employee-auth/request-otp" ||
    pathname === "/api/employee-auth/verify-otp" ||
    pathname === "/api/employee-auth/logout" ||
    pathname === "/api/employee-auth/select-membership" ||
    pathname === "/api/employee-auth/switch-workplace" ||
    pathname.startsWith("/api/maintenance/pos-pilot-write-freeze/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";
}

function isOperatorSmokePath(pathname: string) {
  return pathname === "/cashier" ||
    pathname.startsWith("/cashier/") ||
    pathname === "/pos" ||
    pathname.startsWith("/pos/") ||
    pathname === "/appointments" ||
    pathname.startsWith("/appointments/") ||
    pathname === "/work-orders" ||
    pathname.startsWith("/work-orders/") ||
    pathname === "/invoices" ||
    pathname.startsWith("/invoices/") ||
    pathname === "/closing" ||
    pathname.startsWith("/closing/");
}

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

export function validatePosPilotRuntimeContract(env: RuntimeEnv = process.env) {
  assertConsistentRuntimeEnvironment(env);
  const environment = resolveEnvironment(env);

  if (environment === "production" || environment === "testing") {
    if (env.POS_PILOT_RELEASE_MODE?.trim() !== POS_PILOT_RELEASE_MODE) {
      throw new Error(
        `POS_PILOT_RELEASE_MODE=${POS_PILOT_RELEASE_MODE} is required in ${environment}.`,
      );
    }
    if (env.POS_PILOT_FROZEN_DOMAINS?.trim().toLowerCase() !== "true") {
      throw new Error(
        `POS_PILOT_FROZEN_DOMAINS=true is required in ${environment}.`,
      );
    }
  }

  const writeFreeze = resolvePosPilotWriteFreezeMode(env);
  if (environment === "production" && writeFreeze === "operator-smoke") {
    resolvePosPilotSmokeConfig(env);
  }

  return {
    frozenDomains: true as const,
    releaseMode: POS_PILOT_RELEASE_MODE,
    writeFreeze,
  };
}

function resolveEnvironment(env: RuntimeEnv) {
  const explicit = normalizeEnvironment(env.APP_ENVIRONMENT);
  const railway = normalizeEnvironment(env.RAILWAY_ENVIRONMENT_NAME);
  if (explicit === "production" || railway === "production") return "production";
  if (explicit === "testing" || railway === "testing") return "testing";
  return explicit || railway || normalizeEnvironment(env.NODE_ENV) || "development";
}

function assertConsistentRuntimeEnvironment(env: RuntimeEnv) {
  const explicit = normalizeEnvironment(env.APP_ENVIRONMENT);
  const railway = normalizeEnvironment(env.RAILWAY_ENVIRONMENT_NAME);
  if (explicit && railway && explicit !== railway) {
    throw new Error("Conflicting runtime environment identities are forbidden.");
  }
}

function normalizeEnvironment(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}
