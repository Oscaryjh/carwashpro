import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditLogWhere } from "../../src/lib/audit/query";
import {
  isSensitiveAuditKey,
  sanitizeAuditValue,
} from "../../src/lib/audit/sanitize";

test("audit sanitizer removes credentials at every nesting level", () => {
  const value = sanitizeAuditValue({
    email: "owner@example.com",
    password: "plain-text",
    nested: {
      apiSecret: "connector-secret",
      sessionStatus: "connected",
      accessToken: "access-token",
    },
  });

  assert.deepEqual(value, {
    email: "owner@example.com",
    password: "[REDACTED]",
    nested: {
      apiSecret: "[REDACTED]",
      sessionStatus: "connected",
      accessToken: "[REDACTED]",
    },
  });
});

test("audit sanitizer handles dates, bigint, circular values and long strings", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const value = sanitizeAuditValue({
    at: new Date("2026-07-13T00:00:00.000Z"),
    count: 2n,
    circular,
    long: "a".repeat(2_100),
  }) as Record<string, unknown>;

  assert.equal(value.at, "2026-07-13T00:00:00.000Z");
  assert.equal(value.count, "2");
  assert.deepEqual(value.circular, { self: "[CIRCULAR]" });
  assert.match(String(value.long), /\.\.\.$/);
});

test("sensitive key matching is normalized but does not hide session health", () => {
  assert.equal(isSensitiveAuditKey("password_hash"), true);
  assert.equal(isSensitiveAuditKey("DATABASE_URL"), true);
  assert.equal(isSensitiveAuditKey("sessionStatus"), false);
});

test("audit query scope cannot be replaced by filters", () => {
  const where = buildAuditLogWhere("business-a", {
    actorUserId: "staff-a",
    action: "PAYMENT_RECORDED",
  });

  assert.deepEqual(where, {
    businessId: "business-a",
    actorUserId: "staff-a",
    action: "PAYMENT_RECORDED",
  });
});
