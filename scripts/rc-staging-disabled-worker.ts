import { validateProductionRuntime } from "../src/lib/release/production-contract.mjs";
import { readSourceAttestation } from "../src/lib/release/source-attestation.mjs";

// Keep disabled connectors deployable without reading queues, restoring live
// sessions, contacting providers, or reporting simulated messages as delivered.
export async function runDisabledStagingWorker(scope: "notification" | "whatsapp") {
  if (process.env.APP_DEPLOYMENT_PROFILE !== "rc-staging" && !process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase().startsWith("production-rc-staging")) return false;
  validateProductionRuntime(process.env, scope, readSourceAttestation());
  console.log(JSON.stringify({ event: "RC_STAGING_COMMUNICATION_DISABLED", scope }));
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 1000);
    const stop = () => {
      clearInterval(keepAlive);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return true;
}
