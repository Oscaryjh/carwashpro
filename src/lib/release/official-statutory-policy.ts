import { isTestingDeployment } from "@/lib/release/testing-boundary";

type Env = Readonly<Record<string, string | undefined>>;

export function officialStatutoryDenial(env: Env = process.env): string | null {
  if (isTestingDeployment(env)) return "Testing official statutory export and submission are blocked.";
  const app = env.APP_ENVIRONMENT?.trim().toLowerCase();
  const railway = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  const node = env.NODE_ENV?.trim().toLowerCase();
  if ([app, railway, node].some((value) => value === "production")) {
    return "Production official statutory export and submission are disabled.";
  }
  if (!railway && ((app === "development" && (!node || node === "development" || node === "test")) || (!app && node === "test"))) {
    return null;
  }
  return "Official statutory policy configuration is required before export or submission.";
}

export function assertOfficialStatutoryAllowed(env: Env = process.env) {
  const denial = officialStatutoryDenial(env);
  if (denial) throw new Error(denial);
}
