import type { Instrumentation } from "next";
import { recordHttpServerError } from "@/lib/ops/alerting";

// Runs before the Node server accepts requests, including direct `next start`.
// Keep filesystem/crypto imports out of the Edge instrumentation bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { releaseIdentity } = await import("@/lib/release/environment");
    releaseIdentity();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const message = error instanceof Error ? error.message : String(error);
  await recordHttpServerError({
    service: process.env.RAILWAY_SERVICE_NAME ?? "tetamu-pos-web",
    route: context.routePath,
    message,
  });
};
