import assert from "node:assert/strict";
import test from "node:test";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { Sms123OtpProvider, TwilioVerifySmsProvider } from "../../src/lib/attendance/employee-auth/provider";
import { resolveWhatsAppSendMode, sendWhatsAppQueueItem } from "../../src/lib/notification-queue/worker-send";
import { assertTestingExternalDeliveryBlocked, requireTestingOutboundProfile } from "../../src/lib/release/testing-boundary";
import { sendConnectorTextMessage } from "../../src/lib/whatsapp/connector-client";
import { GET as payrollExport } from "../../src/app/(business)/team/payroll/export/route";
import { GET as statutoryExport } from "../../src/app/(business)/team/payroll/statutory/export/route";
import { authorizeStatutoryExportAction, updateStatutorySubmissionStatusAction } from "../../src/app/(business)/team/payroll/statutory/actions";
import { buildOfficialSubmissionFile } from "../../src/lib/payroll/statutory-submission";
import { downloadOrCreateStatutoryArtifact } from "../../src/lib/payroll/statutory-artifact";
import { requireReleaseReadyPaymentBankAdapter } from "../../src/lib/payroll/payment/providers/registry";

const testing = {
  APP_ENVIRONMENT: "testing",
  RAILWAY_ENVIRONMENT_NAME: "testing",
  NODE_ENV: "production",
  TETAMU_TESTING_OUTBOUND_MODE: "intercept",
} as const;

test("Testing profile fails closed on missing or conflicting identity and send mode", () => {
  assert.throws(() => requireTestingOutboundProfile({ ...testing, TETAMU_TESTING_OUTBOUND_MODE: undefined }));
  assert.throws(() => requireTestingOutboundProfile({ ...testing, APP_ENVIRONMENT: "production" }));
  assert.throws(() => requireTestingOutboundProfile({ ...testing, RAILWAY_ENVIRONMENT_NAME: undefined }));
  assert.doesNotThrow(() => requireTestingOutboundProfile(testing));
});

test("Railway Testing OTP is mock-only despite NODE_ENV=production and rejects live credentials", () => {
  const base = { ...testing, EMPLOYEE_AUTH_SECRET: "t".repeat(40),
    EMPLOYEE_OTP_TESTING_ENABLED: "true", EMPLOYEE_OTP_TEST_PHONE_ALLOWLIST: "+60100000001",
    OTP_PROVIDER: "mock", OTP_CHANNEL: "local" };
  assert.equal(getEmployeeAuthConfig(base).otp.provider, "mock");
  assert.equal(getEmployeeAuthConfig(base).session.secureCookie, true);
  assert.throws(() => getEmployeeAuthConfig({ ...base, OTP_PROVIDER: "sms123", OTP_CHANNEL: "sms", SMS123_API_KEY: "k".repeat(20) }));
  assert.throws(() => getEmployeeAuthConfig({ ...base, EMPLOYEE_OTP_TESTING_ENABLED: undefined }));
  assert.throws(() => getEmployeeAuthConfig({ ...base, SMS123_API_KEY: "k".repeat(20) }));
});

test("Testing queue retry cannot use live transport, even with a configured connector", async () => {
  let providerCalls = 0;
  const input = { businessId: "b", queueId: "q", phone: "+60123456789", message: "test" };
  await assert.rejects(sendWhatsAppQueueItem(input, { env: { ...testing, WHATSAPP_SEND_MODE: "live",
    WHATSAPP_CONNECTOR_URL: "https://provider.example" }, transport: async () => {
      providerCalls++;
      return new Response("{}");
    } }));
  assert.equal(providerCalls, 0);
  assert.throws(() => resolveWhatsAppSendMode({ ...testing, WHATSAPP_SEND_MODE: undefined }));
  assert.equal(resolveWhatsAppSendMode({ ...testing, WHATSAPP_SEND_MODE: "mock" }), "mock");
});

test("final outbound guard blocks direct SMS, WhatsApp, email, bank and official submission", () => {
  for (const channel of ["sms", "whatsapp", "email", "payment-export", "bank-execution", "statutory-submission"] as const) {
    assert.throws(() => assertTestingExternalDeliveryBlocked(channel, testing), /Testing.*blocked/i);
  }
});

test("direct SMS and WhatsApp providers make zero network calls in Testing", async () => {
  const keys = ["APP_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "TETAMU_TESTING_OUTBOUND_MODE"] as const;
  const previous = keys.map((key) => process.env[key]);
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Response("{}"); };
  try {
    Object.assign(process.env, testing);
    const smsConfig = getEmployeeAuthConfig({ NODE_ENV: "test", EMPLOYEE_AUTH_SECRET: "t".repeat(40),
      OTP_PROVIDER: "sms123", OTP_CHANNEL: "sms", SMS123_API_KEY: "k".repeat(20) });
    const sms = new Sms123OtpProvider(smsConfig, transport);
    await assert.rejects(sms.sendVerification({ challengeId: "c", phoneNumber: "+60123456789", purpose: "LOGIN",
      expiresAt: new Date(Date.now() + 300_000), locale: "en-MY", code: "123456" }));
    const twilioConfig = getEmployeeAuthConfig({ NODE_ENV: "test", EMPLOYEE_AUTH_SECRET: "t".repeat(40),
      OTP_PROVIDER: "twilio_verify", OTP_CHANNEL: "sms", TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
      TWILIO_VERIFY_SERVICE_SID: `VA${"b".repeat(32)}`, TWILIO_AUTH_TOKEN: "t".repeat(32) });
    const twilio = new TwilioVerifySmsProvider(twilioConfig, transport);
    await assert.rejects(twilio.sendVerification({ challengeId: "c", phoneNumber: "+60123456789", purpose: "LOGIN",
      expiresAt: new Date(Date.now() + 300_000), locale: "en-MY" }));
    const oldFetch = globalThis.fetch;
    globalThis.fetch = transport;
    try {
      await assert.rejects(sendConnectorTextMessage({ businessId: "b", phone: "+60123456789", message: "test" }));
    } finally { globalThis.fetch = oldFetch; }
    assert.equal(calls, 0);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test("Testing official and payment export routes deny before auth, file generation or database writes", async () => {
  const keys = ["APP_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.APP_ENVIRONMENT = "testing";
    process.env.RAILWAY_ENVIRONMENT_NAME = "testing";
    assert.equal((await payrollExport(new Request("http://localhost:3000/team/payroll/export?kind=payroll&format=csv"))).status, 403);
    assert.equal((await statutoryExport(new Request("http://localhost:3000/team/payroll/statutory/export?provider=PCB"))).status, 403);
    assert.throws(() => buildOfficialSubmissionFile("PCB", {} as Parameters<typeof buildOfficialSubmissionFile>[1],
      {} as Parameters<typeof buildOfficialSubmissionFile>[2]), /Testing.*blocked/);
    await assert.rejects(downloadOrCreateStatutoryArtifact({} as Parameters<typeof downloadOrCreateStatutoryArtifact>[0]), /Testing.*blocked/);
    assert.throws(() => requireReleaseReadyPaymentBankAdapter("PUBLIC_BANK"), /Testing.*blocked/);
    await assert.rejects(authorizeStatutoryExportAction(new FormData()), /Testing.*blocked/);
    const submission = new FormData();
    submission.set("targetStatus", "SUBMITTED");
    await assert.rejects(updateStatutorySubmissionStatusAction(submission), /Testing.*blocked/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
