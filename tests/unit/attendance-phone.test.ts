import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAttendancePhone,
  maskAttendancePhone,
  normalizeAttendancePhone,
} from "../../src/lib/attendance/phone";

test("normalizes equivalent Malaysian mobile formats to canonical E.164", () => {
  for (const value of [
    "0123456789",
    "60123456789",
    "+60123456789",
    "(012) 345-6789",
    "+60 (12) 345-6789",
  ]) {
    assert.equal(normalizeAttendancePhone(value), "+60123456789");
  }
});

test("accepts valid international E.164 numbers with common formatting", () => {
  assert.equal(
    normalizeAttendancePhone("+44 (20) 7123-4567"),
    "+442071234567",
  );
  assert.equal(
    normalizeAttendancePhone("442071234567"),
    "+442071234567",
  );
  assert.equal(normalizeAttendancePhone("+12345678"), "+12345678");
  assert.equal(
    normalizeAttendancePhone("+123456789012345"),
    "+123456789012345",
  );
});

test("rejects empty, malformed, short, long, and invalid-prefix values", () => {
  for (const value of [
    "",
    "   ",
    "abc",
    "0123abc456",
    "1234567",
    "+1234567890123456",
    "+012345678",
    "00123456789",
    "60+123456789",
    "++60123456789",
  ]) {
    assert.equal(normalizeAttendancePhone(value), null, value);
  }
});

test("assert helper returns canonical values and rejects invalid input", () => {
  assert.equal(assertAttendancePhone("012-345 6789"), "+60123456789");
  assert.throws(
    () => assertAttendancePhone("not-a-phone"),
    /Enter a valid phone number/,
  );
});

test("masks canonical Malaysian and international numbers", () => {
  assert.equal(
    maskAttendancePhone("+60123456789"),
    "+60 12-*** 6789",
  );
  assert.equal(maskAttendancePhone("+442071234567"), "+442-***** 4567");
  assert.equal(maskAttendancePhone("not-a-phone"), null);
});
