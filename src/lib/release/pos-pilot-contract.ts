export const FROZEN_DOMAIN_DENIED = "FROZEN_DOMAIN_DENIED" as const;

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

export function classifyPosPilotRoute(pathname: string): "ALLOWED" | "FROZEN" {
  return pathname === "/team/payroll" ||
    pathname.startsWith("/team/payroll/") ||
    pathname === "/admin/statutory" ||
    pathname.startsWith("/admin/statutory/")
    ? "FROZEN"
    : "ALLOWED";
}

type RuntimeEnv = Record<string, string | undefined>;

export function validatePosPilotRuntimeContract(env: RuntimeEnv = process.env) {
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

  return {
    frozenDomains: true as const,
    releaseMode: POS_PILOT_RELEASE_MODE,
  };
}

function resolveEnvironment(env: RuntimeEnv) {
  return (
    env.APP_ENVIRONMENT ??
    env.RAILWAY_ENVIRONMENT_NAME ??
    env.NODE_ENV ??
    "development"
  )
    .trim()
    .toLowerCase();
}
