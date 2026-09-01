import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatLeaveDateRange,
  formatLeaveUnits,
  leaveDecisionPresentation,
  leaveEvidencePresentation,
  leaveRowStatus,
  sortLeaveBalances,
} from "../../src/lib/staff-pwa/leave-v2";

const leave = readFileSync(new URL("../../src/components/staff-pwa/staff-leave.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/components/staff-pwa/staff-leave.module.css", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../../src/components/staff-pwa/staff-v2-primitives.tsx", import.meta.url), "utf8");
const sharedCss = readFileSync(new URL("../../src/components/staff-pwa/staff-v2.module.css", import.meta.url), "utf8");
const leavePage = readFileSync(new URL("../../src/app/staff/leave/page.tsx", import.meta.url), "utf8");
const newPage = readFileSync(new URL("../../src/app/staff/leave/new/page.tsx", import.meta.url), "utf8");
const requests = readFileSync(new URL("../../src/app/staff/requests/page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/lib/leave/service.ts", import.meta.url), "utf8");
const documents = readFileSync(new URL("../../src/lib/leave/document-service.ts", import.meta.url), "utf8");

const document = (reviewStatus = "NOT_REVIEWED") => ({ reviewStatus });
const request = (status: string, evidenceStatus = "NOT_REVIEWED", documentStatuses: string[] = [], required = false) => ({
  status,
  supportingEvidenceRequired: required,
  supportingEvidenceStatus: evidenceStatus,
  supportingDocuments: documentStatuses.map(document),
});

test("Leave V2 keeps the canonical routes and Requests Hub destination", () => {
  assert.match(leavePage, /<StaffLeave\s*\/>/);
  assert.match(newPage, /<StaffTaskNavigation\s*\/>/);
  assert.match(newPage, /<StaffLeave view="new-request"\s*\/>/);
  assert.match(requests, /href="\/staff\/leave"/);
});

test("Leave landing uses Staff V2 hierarchy without a balance-card wall", () => {
  assert.match(leave, /StaffV2PageHeader title="Leave"/);
  assert.match(leave, /New leave request/);
  assert.match(leave, /trackedPolicies\.slice\(0, 2\)/);
  assert.match(leave, /View all balances/);
  assert.match(leave, /Recent requests/);
  assert.match(leave, /RECENT_REQUEST_LIMIT = 3/);
  assert.doesNotMatch(leave, /className=\{styles\.hero\}|balanceCard|LEAVE BALANCE|Time off/);
});

test("Leave balance format and safe presentation ordering are deterministic", () => {
  assert.equal(formatLeaveUnits(1), "1 day");
  assert.equal(formatLeaveUnits(2), "2 days");
  assert.equal(formatLeaveUnits(0.5), "0.5 day");
  const sorted = sortLeaveBalances([
    { id: "expired", applicationReady: false, remainingDays: 20, carryForwardBuckets: [] },
    { id: "zero", applicationReady: true, remainingDays: 0, carryForwardBuckets: [] },
    { id: "usable", applicationReady: true, remainingDays: 8, carryForwardBuckets: [{ expiresAt: "2026-12-01" }] },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["usable", "zero", "expired"]);
  assert.match(leave, /Current entitlement|entitlement/);
  assert.match(leave, /Carry forward/);
  assert.match(leave, /Used/);
  assert.match(leave, /Pending/);
  assert.match(leave, /Adjustment/);
  assert.doesNotMatch(leave, /bucket ID|ledger event|rule-pack|policyRevision|readinessCode \?/);
});

test("Leave decision status maps to one employee-facing primary state", () => {
  assert.deepEqual(leaveDecisionPresentation("PENDING"), { label: "Waiting for manager", tone: "warning" });
  assert.deepEqual(leaveDecisionPresentation("APPROVED"), { label: "Approved", tone: "success" });
  assert.deepEqual(leaveDecisionPresentation("REJECTED"), { label: "Rejected", tone: "danger" });
  assert.deepEqual(leaveDecisionPresentation("CANCELLED"), { label: "Cancelled", tone: "neutral" });
  assert.deepEqual(leaveDecisionPresentation("WITHDRAWN"), { label: "Cancelled", tone: "neutral" });
});

test("Leave decision remains separate from supporting-evidence verification", () => {
  const cases = [
    [request("PENDING"), "Waiting for manager", null],
    [request("PENDING", "NOT_REVIEWED", ["NOT_REVIEWED"]), "Waiting for manager", "Awaiting review"],
    [request("APPROVED"), "Approved", null],
    [request("APPROVED", "NOT_REVIEWED", ["NOT_REVIEWED"]), "Approved", "Awaiting review"],
    [request("APPROVED", "VERIFIED", ["VERIFIED"]), "Approved", "Verified"],
    [request("APPROVED", "REVIEW_REQUIRED", ["REVIEW_REQUIRED"]), "Approved", "Needs follow-up"],
    [request("REJECTED", "NOT_REVIEWED", ["NOT_REVIEWED"]), "Rejected", "Awaiting review"],
    [request("CANCELLED", "VERIFIED", ["VERIFIED"]), "Cancelled", "Verified"],
  ] as const;
  for (const [input, decisionLabel, evidenceLabel] of cases) {
    assert.equal(leaveDecisionPresentation(input.status).label, decisionLabel);
    assert.equal(leaveEvidencePresentation(input)?.label ?? null, evidenceLabel);
  }
});

test("Evidence follow-up may elevate row actionability without overwriting the decision", () => {
  const approved = request("APPROVED", "REVIEW_REQUIRED", ["REVIEW_REQUIRED"]);
  const row = leaveRowStatus(approved);
  assert.equal(row.label, "Action needed");
  assert.equal(row.decision.label, "Approved");
  assert.equal(row.evidence?.label, "Needs follow-up");
  assert.match(leave, /evidenceReviewNote/);
  assert.match(leave, /Supporting document needs follow-up/);
  assert.doesNotMatch(leave, /Next action[\s\S]*No action needed/);
});

test("Leave detail is progressive, flat, and keeps contextual actions canonical", () => {
  assert.match(leave, /<details className=\{styles\.requestDetails\}/);
  assert.match(leave, /StaffV2DetailSection title="Request"/);
  assert.match(leave, /StaffV2DetailSection title="Decision"/);
  assert.match(leave, /StaffV2DetailSection title="Supporting documents"/);
  assert.match(leave, /StaffV2DetailSection title="Evidence status"/);
  assert.match(leave, /const pending = request\.status === "PENDING"/);
  assert.match(leave, /pending \? \(/);
  assert.match(leave, /Withdraw request/);
  assert.doesNotMatch(leave, /label="Decision date"|label="Decision actor"|label="Revision"/);
});

test("New Leave task keeps canonical fields and accessible half-day semantics", () => {
  assert.match(leave, /StaffV2FormSection flat title="Leave type"/);
  assert.match(leave, /StaffV2FormSection flat title="Dates"/);
  assert.match(leave, /StaffV2FormSection flat title="Duration"/);
  assert.match(leave, /StaffV2FormSection flat title="Reason"/);
  assert.match(leave, /StaffV2FormSection[\s\S]*title="Supporting documents"/);
  assert.match(leave, /role="radiogroup" aria-label="Leave duration"/);
  assert.match(leave, /Full day/);
  assert.match(leave, /Half day/);
  assert.match(leave, /role="radiogroup" aria-label="Half-day period"/);
  assert.match(leave, />AM</);
  assert.match(leave, />PM</);
  assert.match(leave, /Calculated duration/);
  assert.match(leave, /Confirmed after submission/);
  assert.doesNotMatch(leave, /remainingDays.*[-+*/].*requestedDays/);
});

test("Dates and duration presentation stay compact without becoming entitlement truth", () => {
  assert.equal(formatLeaveDateRange("2026-08-28", "2026-08-28"), "28 Aug");
  assert.equal(formatLeaveDateRange("2026-08-24", "2026-08-25"), "24 Aug–25 Aug");
  assert.match(leave, /Working days are calculated by your workplace schedule/);
  assert.match(leave, /countMode === "CALENDAR_DAYS"/);
  assert.match(service, /resolveLeaveEntitlementDays/);
  assert.match(service, /daySnapshots\.reduce/);
});

test("Attachment pattern preserves canonical 5-file and 10 MB limits", () => {
  assert.match(leave, /MAX_LEAVE_DOCUMENTS = 5/);
  assert.match(leave, /MAX_LEAVE_DOCUMENT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(leave, /StaffV2AttachmentRow/);
  assert.match(leave, /Selected/);
  assert.match(leave, /Awaiting review/);
  assert.match(leave, /Needs follow-up/);
  assert.match(leave, /Verified/);
  assert.match(leave, /document\.fileName/);
  assert.match(documents, /MAX_LEAVE_DOCUMENTS = 5/);
  assert.match(documents, /validateClaimAttachment/);
  assert.match(primitives, /title=\{fileName\}/);
  assert.match(sharedCss, /text-overflow: ellipsis/);
});

test("Loading, errors, empty state and partial page usability are employee-safe", () => {
  assert.match(leave, /Leave couldn't load/);
  assert.match(leave, /No leave requests yet/);
  assert.match(leave, /Your submitted requests will appear here/);
  assert.match(leave, /LeaveLoading/);
  assert.match(leave, /role="alert"/);
  assert.doesNotMatch(leave, />Prisma<|>database<|>stack trace</);
  assert.match(service, /take: 50/);
  assert.match(leave, /Show more recent requests/);
  assert.doesNotMatch(leave, /All Leave history|View all requests/);
});

test("Leave V2 mobile CSS keeps task actions and long content inside the viewport", () => {
  assert.match(css, /@media \(max-width: 369px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(sharedCss, /env\(safe-area-inset-bottom/);
  assert.match(sharedCss, /position: sticky/);
  assert.match(sharedCss, /min-height: 44px/);
  assert.match(sharedCss, /prefers-reduced-motion/);
});

test("Leave V2 adds shared detail, form, attachment and sticky-action primitives", () => {
  assert.match(primitives, /export function StaffV2DetailSection/);
  assert.match(primitives, /export function StaffV2FormSection/);
  assert.match(primitives, /export function StaffV2AttachmentRow/);
  assert.match(primitives, /export function StaffV2StickyActionBar/);
  assert.doesNotMatch(css, /LeaveMegaCard|LeaveBalanceCardWall|LeaveRequestCardV2|LeaveEvidenceMegaCard/);
});
