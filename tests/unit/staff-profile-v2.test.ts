import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProfileActivity,
  formatProfileDate,
  humanizeProfileValue,
  safeDeviceBrowser,
  safeDevicePlatform,
} from "../../src/lib/staff-pwa/profile-v2";

test("Profile V2 date helpers omit invalid values and preserve authorization semantics", () => {
  assert.equal(formatProfileDate("not-a-date"), null);
  assert.equal(formatProfileActivity("not-a-date"), null);

  const now = new Date("2026-09-02T12:00:00+08:00");
  assert.match(formatProfileActivity("2026-09-02T09:15:00+08:00", now) ?? "", /^Today, /);
  assert.match(formatProfileActivity("2026-09-01T21:30:00+08:00", now) ?? "", /^Yesterday, /);
  assert.match(formatProfileActivity("2026-08-29T10:00:00+08:00", now) ?? "", /29 Aug 2026/);
});

test("Profile V2 presents only generic device platforms", () => {
  assert.equal(safeDevicePlatform("iPhone"), "iPhone");
  assert.equal(safeDevicePlatform("Android"), "Android");
  assert.equal(safeDevicePlatform("Win32"), "Windows");
  assert.equal(safeDevicePlatform("unknown-vendor-device-123"), null);
  assert.equal(safeDevicePlatform(null), null);
  assert.equal(safeDeviceBrowser("Safari"), "Safari");
  assert.equal(safeDeviceBrowser("untrusted-browser-label"), null);
});

test("Profile V2 humanizes canonical employment values", () => {
  assert.equal(humanizeProfileValue("FULL_TIME"), "Full time");
  assert.equal(humanizeProfileValue("PART_TIME"), "Part time");
});
