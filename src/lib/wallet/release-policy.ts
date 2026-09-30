/** P1F release interlock. Never accept environment overrides from a request. */
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
