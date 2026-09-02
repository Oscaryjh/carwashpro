import {
  emitOpsAlert,
  emitScheduledJobFailure,
  emitSms123ProviderAlert,
  recordHttpServerError,
} from "../src/lib/ops/alerting";

const environment = (process.env.APP_ENVIRONMENT ?? "").trim().toLowerCase();
if ((environment !== "testing" && environment !== "local") || !process.argv.includes("--confirm-testing")) {
  throw new Error("Controlled alert tests require Testing/Local and --confirm-testing.");
}

const requested = process.argv.find((argument) => argument.startsWith("--event="))?.slice(8);
if (!requested) throw new Error("Use --event=TEST_ALERT|SERVICE|DATABASE|HTTP_5XX|WORKER|SMS123|RECOVERY.");

let result: unknown;
switch (requested) {
  case "TEST_ALERT":
    result = await emitOpsAlert({
      event: "TEST_ALERT",
      severity: "INFO",
      service: "tetamu-ops-alert-test",
      stage: "controlled-test",
      code: "TEST_ALERT",
      message: "Controlled Testing alert delivery verification.",
      metadata: { controlled: true },
    });
    break;
  case "SERVICE":
    result = await simulatedFailure("SERVICE_HEALTH_FAILED", "tetamu-pos-web", "CRITICAL");
    break;
  case "DATABASE":
    result = await simulatedFailure("DATABASE_UNAVAILABLE", "testing-postgres", "CRITICAL");
    break;
  case "HTTP_5XX":
    for (let index = 0; index < 5; index += 1) {
      result = await recordHttpServerError({
        service: "tetamu-pos-web",
        route: "/controlled-alert-test",
        message: "Controlled HTTP 5xx threshold test.",
      });
    }
    break;
  case "WORKER":
    result = await emitScheduledJobFailure({
      job: "controlled-worker-test",
      attempt: 3,
      code: "CONTROLLED_JOB_FAILURE",
      message: "Controlled Testing scheduled job failure.",
    });
    break;
  case "SMS123":
    result = await emitSms123ProviderAlert({
      failureType: "UNAVAILABLE",
      httpStatus: 503,
      providerCode: "CONTROLLED_TEST",
    });
    break;
  case "RECOVERY":
    result = await emitOpsAlert({
      event: "SERVICE_HEALTH_RECOVERED",
      severity: "INFO",
      service: "tetamu-pos-web",
      stage: "controlled-test",
      code: "SERVICE_HEALTH_RECOVERED",
      message: "Controlled Testing recovery verification.",
      status: "RECOVERED",
      metadata: { controlled: true },
    });
    break;
  default:
    throw new Error(`Unsupported controlled alert event: ${requested}`);
}

console.log(JSON.stringify({ event: "CONTROLLED_ALERT_TEST_COMPLETED", requested, result }));

function simulatedFailure(
  event: string,
  service: string,
  severity: "ERROR" | "CRITICAL",
) {
  return emitOpsAlert({
    event,
    severity,
    service,
    stage: "controlled-test",
    code: event,
    message: `Controlled Testing simulation for ${event}.`,
    metadata: { controlled: true, noBusinessDataChanged: true },
  });
}
