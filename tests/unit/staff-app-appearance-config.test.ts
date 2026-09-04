import assert from "node:assert/strict";
import test from "node:test";
import { resolveStaffAppAppearance } from "../../src/lib/staff-pwa/appearance-config";

test("Staff App uses the company logo before a Staff App fallback logo", () => {
  const appearance = resolveStaffAppAppearance(
    null,
    "/uploads/staff-app-logos/fallback.png",
    "/uploads/business-logos/company.png",
  );

  assert.equal(appearance.logoUrl, "/uploads/business-logos/company.png");
});

test("Staff App keeps the optional fallback when no company logo exists", () => {
  const appearance = resolveStaffAppAppearance(
    null,
    "/uploads/staff-app-logos/fallback.png",
    null,
  );

  assert.equal(appearance.logoUrl, "/uploads/staff-app-logos/fallback.png");
});

test("Staff App uses its Tetamu fallback when neither logo exists", () => {
  const appearance = resolveStaffAppAppearance(null, null, null);

  assert.equal(appearance.logoUrl, null);
});
