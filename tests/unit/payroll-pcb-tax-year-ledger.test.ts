import assert from "node:assert/strict";
import test from "node:test";
import {
  PCB_YTD_BLOCKERS,
  buildPcbTaxYearYtd,
  type PcbTaxYearLedgerRecord,
} from "../../src/lib/payroll/pcb-tax-year-ledger";

function record(overrides: Partial<PcbTaxYearLedgerRecord> = {}): PcbTaxYearLedgerRecord {
  return {
    sourceId: "payroll-entry-1",
    sourceRevision: 1,
    sourceType: "CURRENT_EMPLOYER_FINALIZED_PAYROLL",
    sourceStatus: "FINALIZED",
    businessId: "business-1",
    membershipId: "member-1",
    taxYear: 2026,
    effectiveMonth: 1,
    normalRemunerationCents: 550_000,
    additionalRemunerationCents: 0,
    approvedSchemeContributionCents: 60_500,
    pcbCents: 11_000,
    allowableDeductionsCents: 0,
    zakatCents: 0,
    ...overrides,
  };
}

function build(records: readonly PcbTaxYearLedgerRecord[], overrides: Partial<Parameters<typeof buildPcbTaxYearYtd>[0]> = {}) {
  return buildPcbTaxYearYtd({ businessId: "business-1", membershipId: "member-1", taxYear: 2026, calculationMonth: 4, records, ...overrides });
}

test("YTD combines finalized current-employer payroll, multiple TP3 records and applied corrections", () => {
  const result = build([
    record(),
    record({ sourceId: "tp3-a", sourceType: "PREVIOUS_EMPLOYER_TP3", sourceStatus: "ACCEPTED", normalRemunerationCents: 300_000, approvedSchemeContributionCents: 33_000, pcbCents: 5_000 }),
    record({ sourceId: "tp3-b", sourceType: "PREVIOUS_EMPLOYER_TP3", sourceStatus: "ACCEPTED", normalRemunerationCents: 200_000, approvedSchemeContributionCents: 22_000, pcbCents: 3_000, effectiveMonth: 2 }),
    record({ sourceId: "correction-1", sourceType: "TAX_CORRECTION", sourceStatus: "APPLIED", normalRemunerationCents: 0, additionalRemunerationCents: 10_000, approvedSchemeContributionCents: 0, pcbCents: 100, effectiveMonth: 3 }),
  ]);
  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.state.grossRemunerationCents, 1_060_000);
    assert.equal(result.state.approvedSchemeContributionCents, 115_500);
    assert.equal(result.state.pcbCents, 19_100);
    assert.equal(result.state.sourceCount, 4);
    assert.match(result.state.digest, /^[a-f0-9]{64}$/);
  }
});

test("YTD is deterministic regardless of record query order", () => {
  const a = record();
  const b = record({ sourceId: "payroll-entry-2", effectiveMonth: 2 });
  const first = build([a, b]);
  const second = build([b, a]);
  assert.equal(first.status, "READY");
  assert.equal(second.status, "READY");
  if (first.status === "READY" && second.status === "READY") assert.equal(first.state.digest, second.state.digest);
});

test("draft and review payroll never enters canonical finalized YTD", () => {
  const draft = build([record({ sourceStatus: "DRAFT" })]);
  const review = build([record({ sourceStatus: "REVIEW" })]);
  assert.deepEqual(draft.blockers, [PCB_YTD_BLOCKERS.UNFINALIZED_SOURCE]);
  assert.deepEqual(review.blockers, [PCB_YTD_BLOCKERS.UNFINALIZED_SOURCE]);
});

test("current calculation month cannot circularly enter prior YTD", () => {
  const result = build([record({ effectiveMonth: 4 })]);
  assert.deepEqual(result.blockers, [PCB_YTD_BLOCKERS.CURRENT_MONTH_CIRCULARITY]);
});

test("duplicate source revision is rejected", () => {
  const duplicate = record();
  const result = build([duplicate, duplicate]);
  assert.deepEqual(result.blockers, [PCB_YTD_BLOCKERS.DUPLICATE_SOURCE]);
});

test("tenant, membership and tax-year mismatches fail closed", () => {
  const business = build([record({ businessId: "business-2" })]);
  const member = build([record({ membershipId: "member-2" })]);
  const year = build([record({ taxYear: 2025 })]);
  assert.equal(business.status, "BLOCKED");
  assert.equal(member.status, "BLOCKED");
  assert.equal(year.status, "BLOCKED");
  if (business.status === "BLOCKED") assert.ok(business.blockers.includes(PCB_YTD_BLOCKERS.SCOPE_MISMATCH));
  if (member.status === "BLOCKED") assert.ok(member.blockers.includes(PCB_YTD_BLOCKERS.SCOPE_MISMATCH));
  if (year.status === "BLOCKED") assert.ok(year.blockers.includes(PCB_YTD_BLOCKERS.SCOPE_MISMATCH));
});

test("January starts with an explicit empty prior-YTD state", () => {
  const result = build([], { calculationMonth: 1 });
  assert.equal(result.status, "READY");
  if (result.status === "READY") {
    assert.equal(result.state.throughMonth, 0);
    assert.equal(result.state.grossRemunerationCents, 0);
    assert.equal(result.state.sourceCount, 0);
  }
});
