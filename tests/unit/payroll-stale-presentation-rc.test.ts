import assert from "node:assert/strict";
import test from "node:test";
import {
  payrollReadinessPresentation,
  payrollStalePresentation,
} from "../../src/lib/payroll/stale-presentation";

const stale = ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"].map((scheme) => ({
  code: "STALE_STATUTORY_PROFILE",
  severity: "BLOCKING",
  message: `${scheme} profile changed after this Draft was calculated. Recalculate payroll.`,
}));

test("only canonical stale codes enable a Draft refresh", () => {
  assert.equal(payrollStalePresentation([], "DRAFT", true).canUpdate, false);
  assert.equal(payrollStalePresentation(stale, "DRAFT", true).canUpdate, true);
  assert.equal(
    payrollStalePresentation([
      { code: "OTHER", severity: "REVIEW", message: stale[0]!.message },
    ], "DRAFT", true).canUpdate,
    false,
  );
});

test("stale presentation preserves authorization and finalized-state boundaries", () => {
  assert.equal(payrollStalePresentation(stale, "DRAFT", false).canUpdate, false);
  assert.equal(payrollStalePresentation(stale, "REVIEW", true).canUpdate, false);
  assert.equal(payrollStalePresentation(stale, "FINALIZED", true).canUpdate, false);
  assert.deepEqual(
    payrollStalePresentation(stale, "DRAFT", true).snapshots,
    ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"].map(
      (scheme) => `${scheme} snapshot needs refresh`,
    ),
  );
});

test("bank and member-number gaps remain review presentation, never calculation", () => {
  const profileIssue = {
    code: "STATUTORY_PROFILE_INCOMPLETE",
    severity: "REVIEW",
    message: "Statutory or tax profile is incomplete.",
  };
  const facts = {
    statutoryProfileRevision: 1,
    taxProfileRevision: 1,
    epfEnabled: true,
    epfMemberNumber: null,
    socsoEnabled: true,
    socsoMemberNumber: null,
    taxIdentificationNumber: "SYNTHETIC",
  };
  const result = payrollReadinessPresentation([profileIssue], facts);

  assert.deepEqual(result.submission, [
    "EPF member number is missing.",
    "SOCSO member number is missing.",
  ]);
  assert.equal(result.submissionIsReviewOnly, true);
  assert.deepEqual(result.setup, []);

  const bank = {
    code: "MISSING_BANK_ACCOUNT",
    severity: "REVIEW",
    message: "No active primary bank account is configured.",
  };
  assert.equal(payrollReadinessPresentation([bank], facts).paymentIsReviewOnly, true);
});
