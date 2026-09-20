import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { createEmployeeOtpProvider } from "../../src/lib/attendance/employee-auth/provider";
import { stagingRuntimeFixture } from "../helpers/staging-runtime-fixture";

test("staging web and staff select attested intercept without any real transport", async () => {
  for (const scope of ["web", "staff"]) {
    const f = stagingRuntimeFixture(scope);
    // Second argument is an injected build proof for isolated unit tests only.
    const config = Reflect.apply(getEmployeeAuthConfig, null, [f.env, f.attestation]);
    assert.equal(config.environment, "production");
    assert.equal(config.session.secureCookie, true);
    const provider = createEmployeeOtpProvider(config);
    assert.equal(provider.name, "rc_staging_intercept");
    const input = { challengeId: "synthetic-challenge", phoneNumber: f.env.RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST, expiresAt: new Date(Date.now() + 60_000), purpose: "LOGIN" as const, locale: "en" };
    const originalFetch = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("OUTBOUND_DENIED"); };
    try {
      const delivery = await provider.sendVerification(input);
      const seconds = Math.floor(input.expiresAt.getTime() / 1000);
      const digest = createHmac("sha256", f.env.RC_STAGING_OTP_HMAC_SEED).update(`tetamu:rc-staging-otp:v1\0${input.challengeId}\0${input.phoneNumber}\0${seconds}`).digest();
      const code = (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
      assert.equal(delivery.providerReference.includes(code), false);
      assert.equal(delivery.providerReference.includes(input.phoneNumber), false);
      const check = { challengeId: input.challengeId, phoneNumber: input.phoneNumber, providerReference: delivery.providerReference, code };
      assert.equal((await provider.checkVerification(check)).status, "APPROVED");
      assert.equal((await provider.checkVerification({ ...check, challengeId: "different" })).status, "REJECTED");
      assert.equal((await provider.checkVerification({ ...check, providerReference: "invalid" })).status, "REJECTED");
      await assert.rejects(provider.sendVerification({ ...input, phoneNumber: "+60128889999" }), /SYNTHETIC/);
      const expired = await provider.sendVerification({ ...input, expiresAt: new Date(Date.now() - 1000) });
      assert.equal((await provider.checkVerification({ ...check, providerReference: expired.providerReference })).status, "EXPIRED");
      assert.equal(calls, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("staging OTP rejects production, other scopes, missing proof and changed identities", () => {
  for (const [key, value] of [["APP_DEPLOYMENT_PROFILE", "production"], ["RAILWAY_ENVIRONMENT_NAME", "production"], ["RAILWAY_ENVIRONMENT_ID", "other"], ["SMS123_API_KEY", "forbidden"], ["APP_RELEASE_TREE", "e".repeat(40)]]) {
    const f = stagingRuntimeFixture(); f.env[key] = value;
    assert.throws(() => Reflect.apply(getEmployeeAuthConfig, null, [f.env, f.attestation]));
  }
  const f = stagingRuntimeFixture("analytics");
  assert.throws(() => Reflect.apply(getEmployeeAuthConfig, null, [f.env, f.attestation]));
  const web = stagingRuntimeFixture();
  assert.throws(() => Reflect.apply(getEmployeeAuthConfig, null, [web.env, null]));
});

test("direct staging auth config cannot switch to a live provider or discard its profile", () => {
  for (const provider of ["sms123", "twilio_verify"]) {
    const f = stagingRuntimeFixture("staff");
    f.env.OTP_PROVIDER = provider; f.env.OTP_CHANNEL = "sms";
    f.env.SMS123_API_KEY = "synthetic-key-only-for-rejection-test";
    assert.throws(() => getEmployeeAuthConfig(f.env, f.attestation), /PRODUCTION_.*(OTP|CREDENTIAL)/);
  }
  const f = stagingRuntimeFixture(); delete f.env.APP_DEPLOYMENT_PROFILE;
  f.env.OTP_PROVIDER = "sms123"; f.env.OTP_CHANNEL = "sms"; f.env.SMS123_API_KEY = "synthetic-key-only-for-rejection-test";
  assert.throws(() => getEmployeeAuthConfig(f.env, f.attestation), /PROFILE/);
});
