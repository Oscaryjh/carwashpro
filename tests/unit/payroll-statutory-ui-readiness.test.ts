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

test("statutory list keeps MFA governance available but hides it behind the master switch", async () => {
  const page = await readFile("src/app/admin/statutory/rulesets/page.tsx", "utf8");
  assert.match(page, /requireUser\(\)/);
  assert.match(page, /assertRole\(user, \["PLATFORM_ADMIN"\]\)/);
  assert.match(page, /isMfaFeatureEnabled/);
  assert.match(page, /statutoryStepUpReadiness\(canonical\)/);
  assert.match(page, /getMfaSecurityState/);
  assert.match(page, /mfaFeatureEnabled \? <div><dt>Step-up service/);
  assert.match(page, /mfaFeatureEnabled \? <div><dt>Reviewer MFA/);
  assert.match(page, /mfaFeatureEnabled && reviewerMfaStatus/);
  assert.doesNotMatch(page, /<td>BLOCKED<\/td>/);
  assert.match(page, /Continue setup · \{remainingCount\} remaining/);
  assert.match(page, /Statutory payroll rules/);
  assert.match(page, /!engineeringReady && !pcbReviewAvailable \? "Review readiness" : isActive \? "View details" : canonical \? "Continue review" : "Start review"/);
  assert.doesNotMatch(page, />\s*Review evidence\s*</);
  assert.doesNotMatch(page, />\s*Open rule review\s*</);
});

test("classification review keeps official evidence and audit notes automatic", async () => {
  const [page, actions, styles] = await Promise.all([
    readFile("src/app/admin/statutory/rulesets/[ruleSetId]/page.tsx", "utf8"),
    readFile("src/app/admin/statutory/rulesets/actions.ts", "utf8"),
    readFile("src/app/admin/statutory/statutory-admin.module.css", "utf8"),
  ]);

  assert.doesNotMatch(page, /Why this decision\?/);
  assert.doesNotMatch(page, /Add supporting source/);
  assert.doesNotMatch(page, /Review summary/);
  assert.match(page, /id=\{`classification-\$\{item\.id\}`\}/);
  assert.match(page, /action=\{reviewStatutoryClassificationsAction\}/);
  assert.match(page, /name=\{`decision:\$\{item\.id\}`\}/);
  assert.match(page, /Only payroll containing this item will pause until the back payment is confirmed/);
  assert.match(page, /Save all changes/);
  assert.doesNotMatch(page, /Update treatment/);
  assert.doesNotMatch(page, /Save treatment/);
  assert.doesNotMatch(page, /Update review/);
  assert.doesNotMatch(page, /Save review/);
  assert.match(page, /friendlyActionNotice\(messages\.error\)/);
  assert.match(page, /friendlyResultNotice\(messages\.result\)/);
  assert.match(page, /HR review complete/);
  assert.match(page, /Complete the remaining PCB verification items before final approval/);
  assert.match(page, /Arrears needs clarification/);
  assert.match(page, /return isPcb \? "Review required" : "Needs clarification"/);
  assert.match(page, /Confirm what the back payment is for before using this item in payroll/);
  assert.match(page, /Other uncategorized pay item/);
  assert.match(page, /Payroll adjustment/);
  assert.match(page, /One-time payment/);
  assert.match(page, /Public holiday work pay/);
  assert.match(page, /Rest-day work pay/);
  assert.match(page, /Salary arrears \/ back pay/);
  assert.match(page, /Monthly pay/);
  assert.match(page, /One-off or non-monthly pay/);
  assert.match(page, /Not included in PCB/);
  assert.match(page, /Review required/);
  assert.match(page, /pcbClassificationExplanation/);
  assert.match(page, /<strong>System code:<\/strong>/);
  assert.match(actions, /evidenceReference: required\(formData, "defaultEvidenceReference"\)/);
  assert.match(actions, /reason: automaticReviewReason\(decision\)/);
  assert.match(actions, /export async function reviewStatutoryClassificationsAction/);
  assert.match(actions, /Payroll item treatments updated\./);
  assert.match(actions, /const changes = selections\.filter/);
  assert.match(actions, /recordStatutoryComponentReviewDecisions/);
  assert.match(actions, /decisions: changes\.map/);
  assert.doesNotMatch(actions, /expectedReviewRevision = saved\.reviewRevision/);
  assert.match(actions, /HR review completed after every statutory classification item received a recorded decision/);
  assert.match(actions, /HUMAN_REVIEW_COMPLETED#approval/);
  assert.match(actions, /CLASSIFICATION_REVIEW_RECORDED\$\{returnHash\}/);
  assert.match(actions, /function reviewReturnHash\(formData: FormData\)/);
  assert.match(styles, /grid-auto-rows: minmax\(42px, auto\)/);
  assert.match(styles, /grid-template-columns: 18px minmax\(0, 1fr\)/);
});

test("PCB evidence review explains payroll readiness without technical status codes", async () => {
  const [page, actions, governance, rulePage, styles] = await Promise.all([
    readFile("src/app/admin/statutory/review/[scheme]/page.tsx", "utf8"),
    readFile("src/app/admin/statutory/rulesets/actions.ts", "utf8"),
    readFile("src/lib/payroll/statutory-governance-service.ts", "utf8"),
    readFile("src/app/admin/statutory/rulesets/[ruleSetId]/page.tsx", "utf8"),
    readFile("src/app/admin/statutory/statutory-admin.module.css", "utf8"),
  ]);

  assert.match(page, /PCB payroll readiness/);
  assert.match(page, /PCB setup/);
  assert.match(page, /Setup progress/);
  assert.match(page, /Complete setup/);
  assert.match(page, /Start pay-item review/);
  assert.match(page, /Continue pay-item review/);
  assert.match(page, /Final approval stays locked until the official PCB verification is complete/);
  assert.match(page, /registerPcbReviewDraftAction/);
  assert.match(page, /id=\{isPcb \? "pcb-readiness" : undefined\}/);
  assert.match(page, /Supported requirements/);
  assert.match(page, /Official examples passed/);
  assert.match(page, /Remaining blockers/);
  assert.match(page, /What can be completed now/);
  assert.match(page, /#pay-item-treatment/);
  assert.match(page, /View pay items/);
  assert.match(page, /Start the review to record HR decisions for unclear items/);
  assert.match(page, /Only items marked “HR action” can be completed in Tetamu today/);
  assert.match(page, /System update needed/);
  assert.match(page, /External process/);
  assert.match(page, /Review pay items/);
  assert.match(page, /!rule\.sourceReference\.startsWith\("local:\/\/"\)/);
  assert.match(page, /friendlyPcbReadinessItem/);
  assert.match(page, /pcbReadinessCounts/);
  assert.match(page, /humanReviewComplete && limitation\.startsWith\("Several pay items"\)/);
  assert.match(page, /pcbReadinessItems\.length/);
  assert.match(page, /View technical verification record/);
  assert.match(actions, /registerPcbReviewDraft\(/);
  assert.match(actions, /Started PCB pay-item review from the retained official HASiL evidence/);
  assert.match(governance, /status: "ENGINEERING_VERIFIED"/);
  assert.match(governance, /readiness: "DATASET_VERIFIED"/);
  assert.match(governance, /signOffAllowed: false/);
  assert.match(governance, /activationAllowed: false/);
  assert.match(governance, /const canCompleteReview = pcbReviewDraft/);
  assert.doesNotMatch(rulePage, /humanReviewStatus === "IN_PROGRESS" && canReview && !pcbReviewDraft/);
  assert.match(rulePage, /Waiting for HASiL approval/);
  assert.match(rulePage, /Do not enter test details/);
  assert.match(rulePage, /I have official HASiL approval/);
  assert.match(rulePage, /Save official approval/);
  assert.match(rulePage, /recordPcbSoftwareVerificationAction/);
  assert.match(rulePage, /Your decisions are saved\. PCB still needs the remaining calculation and HASiL verification before final approval\./);
  assert.match(styles, /\.readinessSummaryGrid/);
  assert.match(styles, /\.readinessBlockerList/);
  assert.match(styles, /\.readinessOwnership/);
  assert.match(styles, /\.readinessOwnerBadge_hr/);
  assert.match(styles, /\.setupWorkflow/);
  assert.match(styles, /\.setupNextAction/);
  assert.match(styles, /\.verificationConfirmation/);
  assert.match(styles, /\.pcbVerificationDisclosure/);
  assert.match(styles, /grid-template-columns: 18px minmax\(0, 1fr\)/);
});
