import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getClaimOperationalStage,
  getEmployeeClaimStatus,
  getManagerClaimStatus,
} from "../../src/lib/claim/presentation";

test("claim presentation maps technical states to four operational stages", () => {
  assert.equal(getClaimOperationalStage({ claimStatus: "SUBMITTED" }), "NEEDS_REVIEW");
  assert.equal(getClaimOperationalStage({ claimStatus: "APPROVED", reimbursementStatus: "AWAITING_CHANNEL" }), "READY_TO_PAY");
  assert.equal(getClaimOperationalStage({ claimStatus: "APPROVED", reimbursementStatus: "PAYROLL_LINKED" }), "PROCESSING");
  assert.equal(getClaimOperationalStage({ claimStatus: "APPROVED", reimbursementStatus: "PAYROLL_SETTLED" }), "COMPLETED");
  assert.equal(getClaimOperationalStage({ claimStatus: "REJECTED" }), "COMPLETED");
});

test("claim presentation never exposes database enum labels to employees or HR", () => {
  assert.equal(getEmployeeClaimStatus({ claimStatus: "APPROVED", reimbursementStatus: "AWAITING_CHANNEL" }), "Approved — awaiting payment");
  assert.equal(getEmployeeClaimStatus({ claimStatus: "APPROVED", reimbursementStatus: "PAYROLL_LINKED" }), "Added to payroll");
  assert.equal(getManagerClaimStatus({ claimStatus: "APPROVED", reimbursementStatus: "OUTSIDE_PAYROLL_PENDING" }), "Payment pending");
  assert.equal(getManagerClaimStatus({ claimStatus: "APPROVED", reimbursementStatus: "PAYROLL_SETTLED" }), "Included in finalized payroll");
  assert.equal(getEmployeeClaimStatus({ claimStatus: "APPROVED", reimbursementStatus: "PAYROLL_SETTLED" }), "Included in finalized payroll");
});

test("Staff Claims keeps a three-step, one-line submission with policy-controlled mileage and evidence", async () => {
  const [component, service] = await Promise.all([
    readFile("src/components/staff-pwa/staff-claims.tsx", "utf8"),
    readFile("src/lib/claim/service.ts", "utf8"),
  ]);
  assert.match(component, /Step \{step\} of 3/);
  assert.match(component, />Expense<\/li>/);
  assert.match(component, />Details<\/li>/);
  assert.match(component, />Review<\/li>/);
  assert.match(component, /Estimated reimbursement/);
  assert.match(component, /selected\.mileageRatePerKm/);
  assert.match(component, /selected\?\.descriptionRequired/);
  assert.match(component, /selected\?\.receiptRequired/);
  assert.match(component, /lines: \[\{/);
  assert.doesNotMatch(component, /PAYROLL_LINKED|AWAITING_CHANNEL|BLOCKED_STATUTORY/);
  assert.match(service, /descriptionRequired: policy\.descriptionRequired/);
});
