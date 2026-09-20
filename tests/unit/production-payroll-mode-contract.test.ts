import assert from "node:assert/strict";
import test from "node:test";
import { assertNoDirectStatutoryEntryValues } from "../../src/lib/payroll/service";
import { isNonProductionDeferredPcbSnapshot } from "../../src/lib/payroll/readiness";
import { resolveApplicableStatutoryRule } from "../../src/lib/payroll/statutory-p2";

// Characterization, not a claim that the Phase2 requested mode is implemented.
// These are the financial invariants that a new controlled source must preserve.
test("an unactivated PCB rule cannot be consumed by current payroll materialization", () => {
  const candidate = {
    id: "synthetic-rule", scheme: "PCB" as const,
    status: "HUMAN_SIGNED_OFF" as const,
    readiness: "CALCULATION_VERIFIED" as const,
    version: "synthetic-candidate",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
  };
  assert.equal(resolveApplicableStatutoryRule([candidate], "PCB", new Date("2026-09-01T00:00:00Z")), null);
});

test("real unknown PCB cannot inherit the synthetic-only readiness exemption", () => {
  assert.equal(isNonProductionDeferredPcbSnapshot({
    scheme: "PCB", status: "BLOCKED", blockerCode: "PCB_PROFILE_INCOMPLETE",
    evidenceNature: "REAL", evidenceEnvironment: null, fixturePurpose: null,
    officialExportEligible: false,
  }), false);
});

test("writing a manually described amount through ordinary entry editing remains forbidden", () => {
  assert.throws(() => assertNoDirectStatutoryEntryValues({
    notes: "synthetic manual confirmation", pcb: 120,
  } as Parameters<typeof assertNoDirectStatutoryEntryValues>[0]), /Direct statutory amount overrides are disabled/);
});
