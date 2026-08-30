import type { Instrumentation } from "next";
import { recordHttpServerError } from "@/lib/ops/alerting";

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
