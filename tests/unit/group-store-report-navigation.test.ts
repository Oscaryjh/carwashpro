import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupStorePerformanceReportHref } from "../../src/lib/business-groups/group-report-navigation";

test("keeps normalized relative ranges and removes stale custom dates", () => {
  for (const range of ["today", "7days", "month"] as const) {
    const href = buildGroupStorePerformanceReportHref(
      "group-1",
      "11111111-1111-4111-8111-111111111111",
      {
        range,
        customFrom: "2026-01-01",
        customTo: "2026-01-31",
      },
    );

    assert.ok(href);
    const url = new URL(href, "http://localhost");
    assert.equal(url.pathname, "/groups/group-1/reports");
    assert.equal(url.searchParams.get("range"), range);
    assert.equal(
      url.searchParams.get("store"),
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(url.searchParams.get("paymentMethod"), "all");
    assert.equal(url.searchParams.get("status"), "all");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.has("from"), false);
    assert.equal(url.searchParams.has("to"), false);
  }
});

test("keeps a validated custom range and resets store report filters", () => {
  const href = buildGroupStorePerformanceReportHref(
    "group-1",
    "22222222-2222-4222-8222-222222222222",
    {
      range: "custom",
      customFrom: "2026-07-01",
      customTo: "2026-07-31",
    },
  );

  assert.ok(href);
  const url = new URL(href, "http://localhost");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    range: "custom",
    store: "22222222-2222-4222-8222-222222222222",
    paymentMethod: "all",
    status: "all",
    page: "1",
    from: "2026-07-01",
    to: "2026-07-31",
  });
});

test("fails closed when a custom store report range is incomplete", () => {
  assert.equal(
    buildGroupStorePerformanceReportHref(
      "group-1",
      "22222222-2222-4222-8222-222222222222",
      {
        range: "custom",
        customFrom: "2026-07-01",
        customTo: null,
      },
    ),
    null,
  );
});
