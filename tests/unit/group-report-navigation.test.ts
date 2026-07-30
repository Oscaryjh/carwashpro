import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupTrendPointReportHref } from "../../src/lib/business-groups/group-report-navigation";

test("builds an explicit all-store report link for a covered daily zero", () => {
  const href = buildGroupTrendPointReportHref("group-1", {
    fromDateValue: "2026-07-02",
    hasCoverage: true,
    toDateValue: "2026-07-02",
  });

  assert.ok(href);
  const url = new URL(href, "http://localhost");
  assert.equal(url.pathname, "/groups/group-1/reports");
  assert.deepEqual(
    Object.fromEntries(url.searchParams),
    {
      range: "custom",
      from: "2026-07-02",
      to: "2026-07-02",
      store: "all",
      paymentMethod: "all",
      status: "all",
      page: "1",
    },
  );
});

test("uses each monthly point's exact complete or partial business-date range", () => {
  const completeHref = buildGroupTrendPointReportHref("group-1", {
    fromDateValue: "2025-12-01",
    hasCoverage: true,
    toDateValue: "2025-12-31",
  });
  const partialHref = buildGroupTrendPointReportHref("group-1", {
    fromDateValue: "2026-03-01",
    hasCoverage: true,
    toDateValue: "2026-03-15",
  });

  assert.ok(completeHref);
  assert.ok(partialHref);
  const complete = new URL(completeHref, "http://localhost");
  const partial = new URL(partialHref, "http://localhost");
  assert.equal(complete.searchParams.get("from"), "2025-12-01");
  assert.equal(complete.searchParams.get("to"), "2025-12-31");
  assert.equal(partial.searchParams.get("from"), "2026-03-01");
  assert.equal(partial.searchParams.get("to"), "2026-03-15");
});

test("does not create a report destination for a no-scope point", () => {
  assert.equal(
    buildGroupTrendPointReportHref("group-1", {
      fromDateValue: "2026-01-01",
      hasCoverage: false,
      toDateValue: "2026-01-31",
    }),
    null,
  );
});
