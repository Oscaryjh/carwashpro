import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveOtpSupportStatus,
  formatSupportPhone,
  maskProviderReference,
} from "../../src/lib/attendance/employee-auth/otp-support";

const pageSource = readFileSync(
  new URL("../../src/app/admin/otp-support/page.tsx", import.meta.url),
  "utf8",
);

const base = {
  deliveryAcceptedAt: null,
  expiresAt: new Date("2026-08-24T10:10:00.000Z"),
  invalidatedAt: null,
  verifiedAt: null,
};
const now = new Date("2026-08-24T10:00:00.000Z");

test("OTP support derives operational states without reading the OTP", () => {
  assert.equal(deriveOtpSupportStatus(base, now), "PENDING");
  assert.equal(
    deriveOtpSupportStatus({ ...base, deliveryAcceptedAt: now }, now),
    "SENT",
  );
  assert.equal(
    deriveOtpSupportStatus({ ...base, verifiedAt: now }, now),
    "VERIFIED",
  );
  assert.equal(
    deriveOtpSupportStatus({ ...base, invalidatedAt: now }, now),
    "DELIVERY_FAILED",
  );
  assert.equal(
    deriveOtpSupportStatus(
      { ...base, expiresAt: new Date("2026-08-24T09:59:00.000Z") },
      now,
    ),
    "EXPIRED",
  );
});

test("OTP support formats support identifiers safely", () => {
  assert.equal(formatSupportPhone("+601151300932"), "+60 11 5130 0932");
  assert.equal(maskProviderReference("VE1234567890ABCDEF"), "VE1234...CDEF");
});

test("admin OTP page is platform-only and never selects stored OTP material", () => {
  assert.match(pageSource, /assertRole\(user, \["PLATFORM_ADMIN"\]\)/);
  assert.doesNotMatch(pageSource, /otpHash/);
  assert.doesNotMatch(pageSource, /verification code value/i);
  assert.match(pageSource, /Login codes are never shown here/);
  assert.match(pageSource, /STAFF_OTP_SEND_FAILED/);
  assert.match(pageSource, /providerReason/);
  assert.match(pageSource, /Do not resend from Admin/);
});
