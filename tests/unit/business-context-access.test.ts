import assert from "node:assert/strict";
import test from "node:test";
import {
  businessCapabilities,
  canDirectStaff,
  canGroupManager,
  canGroupOwner,
  isReadCapability,
} from "../../src/lib/business-groups/capabilities";
import {
  normalizeSession,
  SESSION_CONTEXT_VERSION,
} from "../../src/lib/auth/session";
import {
  createBusinessContextToken,
  verifyBusinessContextToken,
} from "../../src/lib/auth/business-context-token";

test("group manager capability policy is centralized and read only", () => {
  for (const capability of businessCapabilities) {
    assert.equal(
      canGroupManager(capability),
      isReadCapability(capability),
      capability,
    );
    assert.equal(canGroupOwner(capability), true, capability);
  }
});

test("direct staff capabilities continue to follow existing permissions", () => {
  assert.equal(canDirectStaff(["CRM"], "VIEW_CRM"), true);
  assert.equal(canDirectStaff(["CRM"], "VIEW_REPORTS"), false);
  assert.equal(
    canDirectStaff(["SERVICES"], "VIEW_CATALOG"),
    true,
  );
  assert.equal(
    canDirectStaff(["TEAM"], "MODIFY_BUSINESS_SETTINGS"),
    false,
  );
});

test("legacy sessions safely map businessId to home and active business", () => {
  const session = normalizeSession({
    userId: "user-1",
    businessId: "business-1",
    branchId: null,
    industryType: "SALON_BEAUTY",
    name: "Legacy Owner",
    email: "legacy@example.test",
    role: "BUSINESS_OWNER",
    permissions: [],
    status: "active",
  });

  assert.equal(session.homeBusinessId, "business-1");
  assert.equal(session.activeBusinessId, "business-1");
  assert.equal(session.businessId, "business-1");
  assert.equal(session.contextVersion, SESSION_CONTEXT_VERSION);
});

test("new sessions keep home and active businesses distinct", () => {
  const session = normalizeSession({
    userId: "user-1",
    homeBusinessId: "business-home",
    activeBusinessId: "business-active",
    contextVersion: 4,
    businessId: "stale-legacy-value",
    branchId: null,
    industryType: "AUTO_DETAILING",
    name: "Group Owner",
    email: "group-owner@example.test",
    role: "BUSINESS_OWNER",
    permissions: [],
    status: "active",
  });

  assert.equal(session.homeBusinessId, "business-home");
  assert.equal(session.activeBusinessId, "business-active");
  assert.equal(session.businessId, "business-active");
  assert.equal(session.contextVersion, 4);
});

test("missing legacy identity fields fail closed instead of producing a partial session", () => {
  assert.throws(
    () =>
      normalizeSession({
        businessId: "business-1",
        role: "BUSINESS_OWNER",
        status: "active",
      }),
    /Invalid session userId/,
  );

  assert.throws(
    () =>
      normalizeSession({
        userId: "user-1",
        name: "Invalid Role",
        email: "invalid-role@example.test",
        role: "GROUP_OWNER",
        permissions: [],
        status: "active",
      }),
    /Invalid session role/,
  );
});

test("signed business context token detects another-tab context changes", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "unit-test-session-secret-that-is-long-enough";

  try {
    const token = await createBusinessContextToken({
      userId: "user-1",
      businessId: "business-a",
      contextVersion: 2,
    });

    assert.deepEqual(
      await verifyBusinessContextToken(token, {
        userId: "user-1",
        businessId: "business-a",
        contextVersion: 2,
      }),
      { valid: true },
    );
    assert.deepEqual(
      await verifyBusinessContextToken(token, {
        userId: "user-1",
        businessId: "business-b",
        contextVersion: 3,
      }),
      {
        valid: false,
        code: "BUSINESS_CONTEXT_CHANGED",
        message:
          "The active business changed in another tab. Refresh this page before submitting.",
      },
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
  }
});

test("tampered business context token returns a structured error", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "unit-test-session-secret-that-is-long-enough";

  try {
    const result = await verifyBusinessContextToken("not-a-token", {
      userId: "user-1",
      businessId: "business-a",
      contextVersion: 1,
    });

    assert.deepEqual(result, {
      valid: false,
      code: "INVALID_CONTEXT_TOKEN",
      message: "This page context is invalid. Refresh the page and try again.",
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
  }
});
