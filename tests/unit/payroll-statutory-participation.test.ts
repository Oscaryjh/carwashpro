import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStatutoryParticipationForPayrollPeriod,
  STATUTORY_PARTICIPATION_BLOCKERS,
  type StatutoryParticipationPeriod,
} from "../../src/lib/payroll/statutory-participation";

const businessId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";

function period(input: {
  id?: string;
  from: string;
  to?: string | null;
  revision?: number;
  status: "PARTICIPATING" | "NOT_PARTICIPATING";
}): StatutoryParticipationPeriod {
  return {
    id: input.id ?? `period-${input.revision ?? 1}`,
    businessId,
    membershipId,
    scheme: "EPF",
    revision: input.revision ?? 1,
    effectiveFromMonth: new Date(`${input.from}T00:00:00.000Z`),
    effectiveToMonth: input.to
      ? new Date(`${input.to}T00:00:00.000Z`)
      : null,
    status: input.status,
    sourceType: "OFFICIAL_RECORD",
    sourceReference: "HASiL Testing Questions 2026 Q4",
    reason: "Official Q4 participation transition",
    sourceDigest: "a".repeat(64),
    confirmedAt: new Date("2026-08-27T00:00:00.000Z"),
  };
}

function resolve(month: string, records: StatutoryParticipationPeriod[], legacyEnabled = false) {
  return resolveStatutoryParticipationForPayrollPeriod({
    businessId,
    membershipId,
    scheme: "EPF",
    statutoryPeriod: new Date(`${month}-01T00:00:00.000Z`),
    records,
    legacyEnabled,
  });
}

test("full-year EPF ON resolves from its governed period", () => {
  const result = resolve("2026-06", [period({ from: "2026-01-01", status: "PARTICIPATING" })]);
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.equal(result.participationStatus, "PARTICIPATING");
    assert.equal(result.source, "CANONICAL_PERIOD");
  }
});

test("full-year EPF OFF resolves from its governed period", () => {
  const result = resolve("2026-06", [period({ from: "2026-01-01", status: "NOT_PARTICIPATING" })]);
  assert.equal(result.status, "RESOLVED");
  if (result.status === "RESOLVED") {
    assert.equal(result.participationStatus, "NOT_PARTICIPATING");
  }
});

test("Q4 resolves OFF Aug-Oct and ON Nov-Dec without mutating a boolean", () => {
  const records = [
    period({ from: "2026-08-01", to: "2026-11-01", status: "NOT_PARTICIPATING", revision: 1 }),
    period({ from: "2026-11-01", status: "PARTICIPATING", revision: 2 }),
  ];
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const result = resolve(month, records, true);
    assert.equal(result.status, "RESOLVED");
    if (result.status === "RESOLVED") assert.equal(result.participationStatus, "NOT_PARTICIPATING");
  }
  for (const month of ["2026-11", "2026-12"]) {
    const result = resolve(month, records, false);
    assert.equal(result.status, "RESOLVED");
    if (result.status === "RESOLVED") assert.equal(result.participationStatus, "PARTICIPATING");
  }
});

test("a future EPF start never applies early", () => {
  const result = resolve("2026-10", [period({ from: "2026-11-01", status: "PARTICIPATING" })], true);
  assert.deepEqual(result, {
    status: "BLOCKED",
    blockerCode: STATUTORY_PARTICIPATION_BLOCKERS.MISSING,
    period: null,
  });
});

test("overlapping periods fail closed", () => {
  const result = resolve("2026-11", [
    period({ id: "one", from: "2026-08-01", status: "NOT_PARTICIPATING", revision: 1 }),
    period({ id: "two", from: "2026-11-01", status: "PARTICIPATING", revision: 2 }),
  ]);
  assert.deepEqual(result, {
    status: "BLOCKED",
    blockerCode: STATUTORY_PARTICIPATION_BLOCKERS.OVERLAP,
    period: null,
  });
});

test("a gap in an existing timeline fails closed", () => {
  const result = resolve("2026-10", [
    period({ from: "2026-08-01", to: "2026-10-01", status: "NOT_PARTICIPATING" }),
  ]);
  assert.equal(result.status, "BLOCKED");
  if (result.status === "BLOCKED") {
    assert.equal(result.blockerCode, STATUTORY_PARTICIPATION_BLOCKERS.MISSING);
  }
});

test("no timeline uses the legacy static bridge", () => {
  const on = resolve("2026-10", [], true);
  const off = resolve("2026-10", [], false);
  assert.equal(on.status === "RESOLVED" && on.participationStatus, "PARTICIPATING");
  assert.equal(off.status === "RESOLVED" && off.participationStatus, "NOT_PARTICIPATING");
  assert.equal(on.status === "RESOLVED" && on.source, "LEGACY_STATIC_BRIDGE");
});

test("known legacy ambiguity fails closed instead of fabricating dates", () => {
  const result = resolveStatutoryParticipationForPayrollPeriod({
    businessId,
    membershipId,
    scheme: "EPF",
    statutoryPeriod: new Date("2026-10-01T00:00:00.000Z"),
    records: [],
    legacyEnabled: true,
    legacyStateUnambiguous: false,
  });
  assert.equal(result.status, "BLOCKED");
  if (result.status === "BLOCKED") {
    assert.equal(result.blockerCode, STATUTORY_PARTICIPATION_BLOCKERS.AMBIGUOUS);
  }
});
