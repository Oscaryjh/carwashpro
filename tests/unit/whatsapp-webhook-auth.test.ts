import assert from "node:assert/strict";
import test from "node:test";
import { authorizeWhatsAppWebhook } from "../../src/lib/whatsapp/webhook-auth";

function headers(secret?: string) {
  return new Headers(secret ? { "x-whatsapp-webhook-secret": secret } : undefined);
}

test("WhatsApp webhook authentication fails closed when no secret is configured", () => {
  assert.deepEqual(authorizeWhatsAppWebhook(headers(), undefined), {
    ok: false,
    status: 503,
    error: "WhatsApp webhook authentication is not configured.",
  });
  assert.deepEqual(authorizeWhatsAppWebhook(headers(), "   "), {
    ok: false,
    status: 503,
    error: "WhatsApp webhook authentication is not configured.",
  });
});

test("WhatsApp webhook authentication rejects missing and incorrect credentials", () => {
  assert.deepEqual(authorizeWhatsAppWebhook(headers(), "expected-secret"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
  assert.deepEqual(authorizeWhatsAppWebhook(headers("wrong-secret"), "expected-secret"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
});

test("WhatsApp webhook authentication accepts the exact configured secret", () => {
  assert.deepEqual(authorizeWhatsAppWebhook(headers("expected-secret"), " expected-secret "), {
    ok: true,
  });
});
