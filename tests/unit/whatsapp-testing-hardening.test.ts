import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyWhatsAppSendFailure,
  ConnectorSendError,
} from "../../src/lib/notification-queue/worker-send";
import {
  assertWhatsAppTemplateCanRender,
  WhatsAppTemplateValidationError,
} from "../../src/lib/whatsapp/templates";
import {
  planWhatsAppStatusTransition,
} from "../../src/lib/whatsapp/status-state";
import {
  parseWhatsAppWebhookEventHeaders,
  readWhatsAppWebhookJson,
  WhatsAppWebhookRequestError,
} from "../../src/lib/whatsapp/webhook-events";
import {
  normalizeValidWhatsAppPhone,
  normalizeWhatsAppQueueRecipient,
} from "../../src/lib/whatsappDeepLink";
import { ConnectorRequestReplayCache } from "../../whatsapp-connector/src/request-replay";
import {
  authorizeConnectorRequest,
  validateConnectorRequestIdentity,
} from "../../whatsapp-connector/src/security";
import {
  buildStableProviderMessageId,
} from "../../whatsapp-connector/src/identity";

test("WhatsApp status policy advances monotonically and ignores duplicates or downgrades", () => {
  const delivered = planWhatsAppStatusTransition({
    currentStatus: "SENT_TO_SERVER",
    nextStatus: "DELIVERED",
  });
  assert.equal(delivered.nextStatus, "DELIVERED");
  assert.equal(delivered.setDeliveredAt, true);

  const read = planWhatsAppStatusTransition({
    currentStatus: "DELIVERED",
    deliveredAt: new Date("2026-08-09T01:00:00.000Z"),
    nextStatus: "READ",
  });
  assert.equal(read.nextStatus, "READ");
  assert.equal(read.setDeliveredAt, false);
  assert.equal(read.setReadAt, true);

  assert.equal(
    planWhatsAppStatusTransition({
      currentStatus: "READ",
      deliveredAt: new Date(),
      nextStatus: "DELIVERED",
      readAt: new Date(),
    }).outcome,
    "IGNORED_DOWNGRADE",
  );
  assert.equal(
    planWhatsAppStatusTransition({
      currentStatus: "READ",
      deliveredAt: new Date(),
      nextStatus: "FAILED",
      readAt: new Date(),
    }).outcome,
    "IGNORED_DOWNGRADE",
  );
  assert.equal(
    planWhatsAppStatusTransition({
      currentStatus: "DELIVERED",
      deliveredAt: new Date(),
      nextStatus: "DELIVERED",
    }).outcome,
    "DUPLICATE",
  );
});

test("webhook event headers require a fresh stable identity", () => {
  const now = new Date("2026-08-09T02:00:00.000Z");
  const valid = new Headers({
    "x-whatsapp-event-id": "receipt:stable-event",
    "x-whatsapp-event-timestamp": now.toISOString(),
  });
  assert.equal(parseWhatsAppWebhookEventHeaders(valid, now).eventKey, "receipt:stable-event");

  assert.throws(
    () => parseWhatsAppWebhookEventHeaders(new Headers(), now),
    WhatsAppWebhookRequestError,
  );
  assert.throws(
    () =>
      parseWhatsAppWebhookEventHeaders(
        new Headers({
          "x-whatsapp-event-id": "receipt:stale",
          "x-whatsapp-event-timestamp": "2026-08-09T01:00:00.000Z",
        }),
        now,
      ),
    /freshness window/i,
  );
});

test("webhook body reader fingerprints raw bytes and enforces a bound", async () => {
  const first = await readWhatsAppWebhookJson(
    new Request("http://local.test/webhook", { method: "POST", body: '{"a":1}' }),
    32,
  );
  const second = await readWhatsAppWebhookJson(
    new Request("http://local.test/webhook", { method: "POST", body: '{"a":1}' }),
    32,
  );
  assert.equal(first.payloadFingerprint, second.payloadFingerprint);
  await assert.rejects(
    () =>
      readWhatsAppWebhookJson(
        new Request("http://local.test/webhook", { method: "POST", body: '{"tooLong":true}' }),
        4,
      ),
    (error: unknown) =>
      error instanceof WhatsAppWebhookRequestError && error.status === 413,
  );
});

test("connector authentication and request identity fail closed", () => {
  assert.deepEqual(authorizeConnectorRequest(undefined, undefined), {
    error: "Connector API authentication is not configured.",
    ok: false,
    status: 503,
  });
  assert.equal(authorizeConnectorRequest("wrong", "expected").ok, false);
  assert.deepEqual(authorizeConnectorRequest("expected", " expected "), { ok: true });

  assert.equal(validateConnectorRequestIdentity(undefined, undefined).ok, false);
  assert.equal(
    validateConnectorRequestIdentity("queue-request-123", "different-request").ok,
    false,
  );
  assert.equal(
    validateConnectorRequestIdentity("queue-request-123", "queue-request-123").ok,
    true,
  );
});

test("connector replay cache shares one in-flight/completed send and retries failures", async () => {
  const cache = new ConnectorRequestReplayCache(10_000, 10);
  let calls = 0;
  const operation = async () => {
    calls += 1;
    return { messageId: "provider-1" };
  };
  const [first, second] = await Promise.all([
    cache.execute("business-a:queue-1", operation),
    cache.execute("business-a:queue-1", operation),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);

  let failures = 0;
  await assert.rejects(() =>
    cache.execute("business-a:queue-2", async () => {
      failures += 1;
      throw new Error("temporary");
    }),
  );
  await cache.execute("business-a:queue-2", async () => {
    failures += 1;
    return true;
  });
  assert.equal(failures, 2);
});

test("connector derives a stable tenant-scoped provider identity", () => {
  const first = buildStableProviderMessageId("business-a", "queue-1");
  assert.equal(first, buildStableProviderMessageId("business-a", "queue-1"));
  assert.notEqual(first, buildStableProviderMessageId("business-b", "queue-1"));
  assert.match(first, /^[A-F0-9]{20}$/);
});

test("retry classification separates transient and final WhatsApp failures", () => {
  assert.deepEqual(
    classifyWhatsAppSendFailure(
      new ConnectorSendError(422, "WHATSAPP_INVALID_RECIPIENT", "Invalid recipient"),
    ),
    {
      category: "INVALID_RECIPIENT",
      retryable: false,
      safeMessage: "Invalid recipient",
    },
  );
  assert.equal(
    classifyWhatsAppSendFailure(
      new ConnectorSendError(409, "WHATSAPP_NOT_CONNECTED", "Offline"),
    ).retryable,
    true,
  );
  assert.equal(
    classifyWhatsAppSendFailure(
      new ConnectorSendError(401, "UNAUTHORIZED", "Unauthorized"),
    ).retryable,
    false,
  );
});

test("template validation refuses missing variables and phone normalization is bounded", () => {
  assert.doesNotThrow(() =>
    assertWhatsAppTemplateCanRender("Hi {{customerName}}", { customerName: "QA" }),
  );
  assert.throws(
    () => assertWhatsAppTemplateCanRender("Hi {{customerName}}", {}),
    WhatsAppTemplateValidationError,
  );
  assert.equal(normalizeValidWhatsAppPhone("+60 11-1221 2259"), "601112212259");
  assert.equal(normalizeValidWhatsAppPhone("123"), null);
  assert.equal(
    normalizeWhatsAppQueueRecipient("123456789012345@lid"),
    "123456789012345@lid",
  );
});

test("hardening migration is additive, indexed, scoped and preserves legacy rows", async () => {
  const migration = await readFile(
    "prisma/migrations/20260809220000_whatsapp_testing_hardening/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "whatsapp_send_attempts"/);
  assert.match(migration, /CREATE TABLE "whatsapp_webhook_events"/);
  assert.match(migration, /notification_queue_status_lease_expires_at_idx/);
  assert.match(migration, /whatsapp_webhook_events_business_provider_event_key/);
  assert.match(migration, /FOREIGN KEY \("queue_id", "business_id"\)/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE "whatsapp_messages"/i);
});

test("connector audit logging redacts recipients, payloads, secrets and raw errors", async () => {
  const [loggerSource, serverSource, webhookSource] = await Promise.all([
    readFile("whatsapp-connector/src/logger.ts", "utf8"),
    readFile("whatsapp-connector/src/server.ts", "utf8"),
    readFile("whatsapp-connector/src/webhook.ts", "utf8"),
  ]);
  for (const redactedKey of [
    "authInfoPath",
    "body",
    "error",
    "from",
    "mediaBase64",
    "phone",
    "remoteJid",
    "to",
    "update",
  ]) {
    assert.match(loggerSource, new RegExp(`"${redactedKey}"`));
  }
  assert.doesNotMatch(serverSource, /console\.error\("\[runtime:/);
  assert.doesNotMatch(webhookSource, /from: payload\.from|remoteJid: payload\.remoteJid/);
  assert.match(serverSource, /message: "WhatsApp connector send failed\."/);
});
