import { z } from "zod";

/** Server policy only. Environment overrides are for isolated tests, never request data. */
export function isWalletLocalTestEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.TETAMU_WALLET_LOCAL_TEST !== "true") return false;
  if (Object.entries(env).some(([key, value]) => key.startsWith("RAILWAY_") && !!value)) return false;
  for (const key of ["NODE_ENV", "APP_ENVIRONMENT", "TETAMU_ENVIRONMENT"]) {
    const value = env[key]?.trim().toLowerCase();
    if (value && !["development", "test", "testing"].includes(value)) return false;
  }
  if (env.VERCEL || env.NETLIFY || env.RENDER) return false;
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && /^\/tetamu_[a-z0-9_]+_disposable_[a-z0-9_]+$/.test(url.pathname);
  } catch { return false; }
}

export function assertWalletLocalTestEnabled(): void {
  if (!isWalletLocalTestEnabled()) throw new Error("Wallet payments and top-ups are restricted to controlled Local testing until financial release validation is complete.");
}

type Environment = Readonly<Record<string, string | undefined>>;
const uuid = z.string().uuid();

export function isWalletAccessAllowed({ businessId }: { businessId: string }, env: Environment = process.env): boolean {
  if (!uuid.safeParse(businessId).success) return false;
  if (isWalletLocalTestEnabled(env)) return true;
  // Match the existing Railway release contract, not NODE_ENV (a build mode).
  // Neither explicit variable may override a conflicting deployment identity.
  if (env.APP_ENVIRONMENT?.trim().toLowerCase() !== "testing" ||
      env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== "testing") return false;
  if (env.TETAMU_ENVIRONMENT !== undefined && env.TETAMU_ENVIRONMENT.trim().toLowerCase() !== "testing") return false;
  if (env.NODE_ENV !== undefined && !["production", "development", "test"].includes(env.NODE_ENV.trim().toLowerCase())) return false;
  if (env.VERCEL || env.NETLIFY || env.RENDER || env.TETAMU_WALLET_TESTING_PILOT !== "true") return false;
  const values = (env.TETAMU_WALLET_TESTING_BUSINESS_IDS ?? "").split(",").map(value => value.trim());
  if (values.some(value => !uuid.safeParse(value).success)) return false;
  return new Set(values.map(value => value.toLowerCase())).has(businessId.toLowerCase());
}

export class WalletUnavailableError extends Error {
  readonly code = "WALLET_UNAVAILABLE";
  constructor() { super("Member Wallet is not enabled for this business."); }
}

export function assertWalletAccessAllowed(input: { businessId: string }): void {
  if (!isWalletAccessAllowed(input)) throw new WalletUnavailableError();
}
