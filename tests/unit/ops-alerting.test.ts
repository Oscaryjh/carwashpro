import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpsAlertEvent,
  emitScheduledJobFailure,
  emitSms123ProviderAlert,
  recordHttpServerError,
  redactOpsText,
  resetOpsAlertStateForTests,
  sendOpsAlert,
} from "../../src/lib/ops/alerting";

test.beforeEach(() => {
  resetOpsAlertStateForTests();
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  process.env.APP_ENVIRONMENT = "testing";
});

test("operational event schema is stable and secret metadata is redacted", () => {
  const event = createOpsAlertEvent({
    event: "DATABASE_UNAVAILABLE",
    environment: "testing",
    severity: "CRITICAL",
    service: "testing-postgres",
    stage: "health-probe",
    code: "DATABASE_UNAVAILABLE",
    message:
      "failed postgresql://user:password@example.test/db Authorization:BearerSecret OTP 123456",
    metadata: {
      SMS123_API_KEY: "key-value",
      Cookie: "session=value",
      bankAccount: "123456789",
      safe: "visible",
    },
    timestamp: new Date("2026-08-27T00:00:00Z"),
  });
  assert.equal(event.event, "DATABASE_UNAVAILABLE");
  assert.equal(event.timestamp, "2026-08-27T00:00:00.000Z");
  assert.match(event.message, /REDACTED_DATABASE_URL/);
  assert.match(event.message, /REDACTED_OTP/);
  assert.equal(event.metadata.SMS123_API_KEY, "[REDACTED]");
  assert.equal(event.metadata.Cookie, "[REDACTED]");
  assert.equal(event.metadata.bankAccount, "[REDACTED]");
  assert.equal(event.metadata.safe, "visible");
});

test("webhook delivery retries transient failures and records receiver identity", async () => {
  const event = fixtureEvent();
  let attempts = 0;
  const result = await sendOpsAlert(event, {
    webhookUrl: "https://alerts.example.test/hook",
    fetchImpl: async () => {
      attempts += 1;
      return new Response(null, {
        status: attempts < 3 ? 503 : 202,
        headers: attempts === 3 ? { "x-message-id": "receiver-42" } : {},
      });
    },
    sleepImpl: async () => undefined,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(result, {
    delivered: true,
    deduplicated: false,
    attempts: 3,
    receiverId: "receiver-42",
  });
});

test("same alert fingerprint is deduplicated during cooldown", async () => {
  const event = fixtureEvent();
  let calls = 0;
  const options = {
    webhookUrl: "https://alerts.example.test/hook",
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    },
    now: new Date("2026-08-27T00:00:00Z"),
  };
  assert.equal((await sendOpsAlert(event, options)).delivered, true);
  const second = await sendOpsAlert(event, options);
  assert.equal(calls, 1);
  assert.equal(second.deduplicated, true);
  assert.equal(second.reason, "ALERT_DEDUPLICATED_COOLDOWN");
});

test("five server errors in five minutes produce the threshold event", async () => {
  let result: Awaited<ReturnType<typeof recordHttpServerError>> | undefined;
  for (let index = 0; index < 5; index += 1) {
    result = await recordHttpServerError({
      service: "tetamu-pos-web",
      route: "/test",
      message: "controlled server error",
      now: new Date(`2026-08-27T00:0${index}:00Z`),
    });
  }
  assert.equal(result?.thresholdExceeded, true);
  assert.ok(result && "event" in result && "delivery" in result);
  assert.equal(result.event.event, "HTTP_5XX_THRESHOLD_EXCEEDED");
  assert.equal(result.delivery.reason, "ALERT_DESTINATION_NOT_CONFIGURED");
});

test("worker and SMS123 helpers classify failures without exposing delivery data", async () => {
  const worker = await emitScheduledJobFailure({
    job: "test-worker",
    attempt: 3,
    code: "TEST_WORKER_FAILED",
    message: "worker failed",
  });
  assert.equal(worker.event.event, "SCHEDULED_JOB_FAILED");
  assert.equal(worker.event.metadata.attempt, 3);

  const sms = await emitSms123ProviderAlert({
    failureType: "REJECTED",
    httpStatus: 400,
    providerCode: "E00366",
  });
  assert.equal(sms.event.event, "SMS123_PROVIDER_ERROR");
  assert.equal(sms.event.severity, "WARNING");
  assert.equal(sms.event.metadata.deliveryState, "PROVIDER_REQUEST_FAILED");
  assert.equal(JSON.stringify(sms.event).includes("phone"), false);
});

test("redaction covers credential header and OTP patterns", () => {
  const text = redactOpsText(
    "Authorization=BearerABC Cookie=session Password=pass api_key=key 654321",
  );
  assert.equal(text.includes("BearerABC"), false);
  assert.equal(text.includes("session"), false);
  assert.equal(text.includes("654321"), false);
});

function fixtureEvent() {
  return createOpsAlertEvent({
    event: "SERVICE_HEALTH_FAILED",
    environment: "testing",
    severity: "CRITICAL",
    service: "tetamu-pos-web",
    stage: "health-probe",
    code: "SERVICE_HEALTH_FAILED",
    message: "health probe failed",
    timestamp: new Date("2026-08-27T00:00:00Z"),
  });
}
