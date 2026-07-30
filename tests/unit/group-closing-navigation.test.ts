import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupClosingAuditPageHref,
  buildGroupClosingExportHref,
  buildGroupClosingRecordsPageHref,
} from "../../src/lib/business-groups/group-closing-navigation";

const groupId = "11111111-1111-4111-8111-111111111111";
const query = {
  range: "custom",
  from: "2026-07-01",
  to: "2026-07-07",
  store: "22222222-2222-4222-8222-222222222222",
  status: "missing",
  page: "2",
  auditPage: "3",
};

test("changes only the requested Closing page and keeps safe filters", () => {
  const audit = new URL(
    buildGroupClosingAuditPageHref(groupId, query, 4),
    "https://example.test",
  );
  assert.equal(audit.searchParams.get("auditPage"), "4");
  assert.equal(audit.searchParams.get("page"), "2");
  assert.equal(audit.searchParams.get("status"), "missing");

  const records = new URL(
    buildGroupClosingRecordsPageHref(groupId, query, 5),
    "https://example.test",
  );
  assert.equal(records.searchParams.get("page"), "5");
  assert.equal(records.searchParams.get("auditPage"), "3");
});

test("exports the full filtered audit without page parameters", () => {
  const href = new URL(
    buildGroupClosingExportHref(groupId, query, "xlsx"),
    "https://example.test",
  );
  assert.equal(href.searchParams.get("format"), "xlsx");
  assert.equal(href.searchParams.get("page"), null);
  assert.equal(href.searchParams.get("auditPage"), null);
  assert.equal(href.searchParams.get("range"), "custom");
  assert.equal(href.searchParams.get("status"), "missing");
});
