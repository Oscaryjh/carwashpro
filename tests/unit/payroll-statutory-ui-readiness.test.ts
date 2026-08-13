import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  statutoryHumanSignOffReadiness,
  statutoryReviewerMfaLabel,
} from "../../src/lib/payroll/statutory-review-ui-readiness";

test("ready MFA infrastructure remains distinct from reviewer enrollment", () => {
  assert.equal(statutoryReviewerMfaLabel("NOT_ENROLLED"), "NOT ENROLLED");
  assert.equal(statutoryReviewerMfaLabel("PENDING"), "ENROLLMENT PENDING");
  assert.equal(statutoryReviewerMfaLabel("ENROLLED"), "ENROLLED");
  assert.equal(statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: "READY",
    reviewerMfaStatus: "NOT_ENROLLED",
    reviewerCanSign: true,
    humanReviewStatus: "PENDING",
    signOffExecuted: false,
  }), "BLOCKED_REVIEWER_MFA_ENROLLMENT");
});

test("enrolled reviewer is blocked only by remaining Human Review conditions", () => {
  assert.equal(statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: "READY",
    reviewerMfaStatus: "ENROLLED",
    reviewerCanSign: true,
    humanReviewStatus: "PENDING",
    signOffExecuted: false,
  }), "BLOCKED_HUMAN_REVIEW_PENDING");
  assert.equal(statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: "READY",
    reviewerMfaStatus: "ENROLLED",
    reviewerCanSign: true,
    humanReviewStatus: "COMPLETED",
    signOffExecuted: false,
  }), "READY");
});

test("unavailable MFA infrastructure is the real step-up blocker", () => {
  assert.equal(statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: "BLOCKED",
    reviewerMfaStatus: "ENROLLED",
    reviewerCanSign: true,
    humanReviewStatus: "COMPLETED",
    signOffExecuted: false,
  }), "BLOCKED_STEP_UP_INFRASTRUCTURE");
});

test("statutory list uses canonical infrastructure and reviewer-specific sources", async () => {
  const page = await readFile("src/app/admin/statutory/rulesets/page.tsx", "utf8");
  assert.match(page, /requireUser\(\)/);
  assert.match(page, /assertRole\(user, \["PLATFORM_ADMIN"\]\)/);
  assert.match(page, /statutoryStepUpReadiness\(canonical\)/);
  assert.match(page, /getMfaSecurityState/);
  assert.match(page, /MFA Step-up Infrastructure/);
  assert.match(page, /Reviewer MFA Enrollment/);
  assert.match(page, /Human Sign-off Readiness/);
  assert.doesNotMatch(page, /<td>BLOCKED<\/td>/);
});
