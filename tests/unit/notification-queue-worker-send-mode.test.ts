import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWhatsAppSendMode,
  sendWhatsAppQueueItem,
  WhatsAppSendModeConfigError,
  type QueueSendTransport,
} from "../../src/lib/notification-queue/worker-send";

const sampleQueueItem = {
  businessId: "business-qa",
  message: "QA TEST message",
  phone: "601123456789",
  queueId: "queue-123",
};

test("mock mode produces a deterministic simulated provider id without HTTP calls", async () => {
  let connectorCalls = 0;
  const transport: QueueSendTransport = async () => {
    connectorCalls += 1;
    throw new Error("transport should not be called in mock mode");
  };

  const result = await sendWhatsAppQueueItem(sampleQueueItem, {
    env: {
      WHATSAPP_CONNECTOR_URL: "https://real-looking-connector.example.test",
      WHATSAPP_SEND_MODE: "mock",
    },
    transport,
  });

  assert.equal(connectorCalls, 0);
  assert.equal(result.connectorCallsEnabled, false);
  assert.equal(result.messageId, "mock:queue-123");
  assert.equal(result.mode, "mock");
  assert.equal(result.simulated, true);
});

test("mock mode also blocks connector calls for closing report queue items", async () => {
  let connectorCalls = 0;
  const transport: QueueSendTransport = async () => {
    connectorCalls += 1;
    throw new Error("closing report should not call connector in mock mode");
  };

  const result = await sendWhatsAppQueueItem(
    {
      ...sampleQueueItem,
      message: "QA TEST closing snapshot text",
      queueId: "closing-report-queue-456",
    },
    {
      env: {
        WHATSAPP_CONNECTOR_URL: "https://real-looking-connector.example.test",
        WHATSAPP_SEND_MODE: "mock",
      },
      transport,
    },
  );

  assert.equal(connectorCalls, 0);
  assert.equal(result.messageId, "mock:closing-report-queue-456");
  assert.equal(result.simulated, true);
});

test("live mode is the only mode that calls the injected connector transport", async () => {
  const calls: Array<{ init: RequestInit; url: string }> = [];
  const transport: QueueSendTransport = async (url, init) => {
    calls.push({ init, url });
    return new Response(
      JSON.stringify({
        data: {
          messageId: "live-message-123",
          to: "601123456789",
        },
        ok: true,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  };

  const result = await sendWhatsAppQueueItem(sampleQueueItem, {
    env: {
      WHATSAPP_CONNECTOR_API_SECRET: "secret-for-test",
      WHATSAPP_CONNECTOR_URL: "https://connector.example.test/",
      WHATSAPP_SEND_MODE: "live",
    },
    transport,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://connector.example.test/send");
  const requestBody = JSON.parse(String(calls[0]?.init.body));
  assert.equal(requestBody.requestId, sampleQueueItem.queueId);
  assert.equal(
    new Headers(calls[0]?.init.headers).get("x-connector-request-id"),
    sampleQueueItem.queueId,
  );
  assert.equal(result.connectorCallsEnabled, true);
  assert.equal(result.messageId, "live-message-123");
  assert.equal(result.mode, "live");
  assert.equal(result.simulated, false);
});

test("missing send mode fails closed before any send attempt", async () => {
  let connectorCalls = 0;
  const transport: QueueSendTransport = async () => {
    connectorCalls += 1;
    return new Response("{}", { status: 200 });
  };

  await assert.rejects(
    () =>
      sendWhatsAppQueueItem(sampleQueueItem, {
        env: {
          WHATSAPP_CONNECTOR_URL: "https://connector.example.test",
        },
        transport,
      }),
    WhatsAppSendModeConfigError,
  );
  assert.equal(connectorCalls, 0);
});

test("invalid send mode fails closed before any send attempt", async () => {
  let connectorCalls = 0;
  const transport: QueueSendTransport = async () => {
    connectorCalls += 1;
    return new Response("{}", { status: 200 });
  };

  assert.throws(
    () =>
      resolveWhatsAppSendMode({
        WHATSAPP_SEND_MODE: "enabled",
      }),
    WhatsAppSendModeConfigError,
  );
  assert.throws(
    () =>
      resolveWhatsAppSendMode({
        WHATSAPP_SEND_MODE: "LIVE",
      }),
    WhatsAppSendModeConfigError,
  );
  await assert.rejects(
    () =>
      sendWhatsAppQueueItem(sampleQueueItem, {
        env: {
          WHATSAPP_CONNECTOR_URL: "https://connector.example.test",
          WHATSAPP_SEND_MODE: "enabled",
        },
        transport,
      }),
    WhatsAppSendModeConfigError,
  );
  assert.equal(connectorCalls, 0);
});

test("production mock mode is forbidden before a queue item can be simulated", () => {
  assert.throws(
    () => resolveWhatsAppSendMode({ NODE_ENV: "production", WHATSAPP_SEND_MODE: "mock" }),
    /forbidden in production/i,
  );
  assert.equal(
    resolveWhatsAppSendMode({ NODE_ENV: "production", WHATSAPP_SEND_MODE: "live" }),
    "live",
  );
  assert.equal(
    resolveWhatsAppSendMode({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "testing", WHATSAPP_SEND_MODE: "mock" }),
    "mock",
  );
});
