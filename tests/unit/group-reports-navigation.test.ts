import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAllStoresComparisonHref,
  buildGroupReportExportHref,
  buildGroupReportsPageHref,
} from "../../src/lib/business-groups/group-reports-navigation";

const query = {
  range: "custom",
  from: "2026-07-01",
  to: "2026-07-31",
  store: "all",
  paymentMethod: "CASH",
  status: "PARTIAL",
  page: "7",
  compareStore: ["store-a", "store-b"],
};

test("pagination preserves repeated compare stores and resets only the page", () => {
  const url = asUrl(buildGroupReportsPageHref("group id", query, 2));
  assert.equal(url.pathname, "/groups/group%20id/reports");
  assert.equal(url.searchParams.get("range"), "custom");
  assert.equal(url.searchParams.get("from"), "2026-07-01");
  assert.equal(url.searchParams.get("to"), "2026-07-31");
  assert.equal(url.searchParams.get("store"), "all");
  assert.equal(url.searchParams.get("paymentMethod"), "CASH");
  assert.equal(url.searchParams.get("status"), "PARTIAL");
  assert.equal(url.searchParams.get("page"), "2");
  assert.deepEqual(url.searchParams.getAll("compareStore"), [
    "store-a",
    "store-b",
  ]);
});

test("exports the report filters but not presentation-only comparison state", () => {
  const url = asUrl(buildGroupReportExportHref("group", query, "xlsx"));
  assert.equal(url.pathname, "/groups/group/reports/export");
  assert.equal(url.searchParams.get("range"), "custom");
  assert.equal(url.searchParams.get("from"), "2026-07-01");
  assert.equal(url.searchParams.get("to"), "2026-07-31");
  assert.equal(url.searchParams.get("paymentMethod"), "CASH");
  assert.equal(url.searchParams.get("status"), "PARTIAL");
  assert.equal(url.searchParams.get("format"), "xlsx");
  assert.equal(url.searchParams.has("page"), false);
  assert.equal(url.searchParams.has("compareStore"), false);
});

test("all-store comparison keeps normalized filters and removes the old selection", () => {
  const url = asUrl(
    buildAllStoresComparisonHref("group", {
      range: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
      storeId: "store-a",
      paymentMethod: "CASH",
      status: "PARTIAL",
      page: 7,
    }),
  );
  assert.equal(url.pathname, "/groups/group/reports");
  assert.equal(url.searchParams.get("range"), "custom");
  assert.equal(url.searchParams.get("from"), "2026-07-01");
  assert.equal(url.searchParams.get("to"), "2026-07-31");
  assert.equal(url.searchParams.get("store"), "all");
  assert.equal(url.searchParams.get("paymentMethod"), "CASH");
  assert.equal(url.searchParams.get("status"), "PARTIAL");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.has("compareStore"), false);
});

function asUrl(href: string) {
  return new URL(href, "http://localhost");
}
