import assert from "node:assert/strict";
import test from "node:test";
import {
  businessContextErrorMessage,
  safeBusinessReturnTo,
} from "../../src/lib/business-groups/business-context";

const groupOwnerContext = {
  effectiveBusinessRole: "BUSINESS_OWNER" as const,
  industryType: "SALON_BEAUTY" as const,
};
const groupManagerContext = {
  effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY" as const,
  industryType: "AUTO_DETAILING" as const,
};
const autoOwnerContext = {
  effectiveBusinessRole: "BUSINESS_OWNER" as const,
  industryType: "AUTO_DETAILING" as const,
};

test("business return paths are restricted to safe internal route roots", () => {
  assert.equal(
    safeBusinessReturnTo("/reports?range=month", groupManagerContext),
    "/reports",
  );
  assert.equal(
    safeBusinessReturnTo("/appointments/secret-id", groupManagerContext),
    "/reports",
  );
  assert.equal(
    safeBusinessReturnTo("/cashier", groupManagerContext),
    "/reports",
  );
  assert.equal(
    safeBusinessReturnTo("/cashier", groupOwnerContext),
    "/cashier",
  );
  assert.equal(
    safeBusinessReturnTo("/cashier", autoOwnerContext),
    "/work-orders",
  );
  assert.equal(
    safeBusinessReturnTo("/salon/dashboard", autoOwnerContext),
    "/work-orders",
  );
  assert.equal(
    safeBusinessReturnTo("/work-orders", groupOwnerContext),
    "/cashier",
  );
});

test("business return paths reject redirects and encoded bypasses", () => {
  for (const unsafe of [
    "https://example.test",
    "//example.test",
    "/%2f%2fexample.test",
    "/%252f%252fexample.test",
    "/\\example.test",
    "/admin/businesses",
    "/api/private",
    "/login",
    "/logout",
    "/business-context/recover",
  ]) {
    assert.equal(
      safeBusinessReturnTo(unsafe, groupOwnerContext),
      "/cashier",
      unsafe,
    );
  }
});

test("authorization errors use non-disclosing messages", () => {
  const deniedCodes = [
    "BUSINESS_ACCESS_DENIED",
    "GROUP_MEMBERSHIP_INACTIVE",
    "GROUP_ROLE_INACTIVE",
    "MANAGER_SCOPE_DENIED",
  ] as const;

  for (const code of deniedCodes) {
    assert.equal(
      businessContextErrorMessage(code),
      "You do not have access to this business.",
    );
  }
});
