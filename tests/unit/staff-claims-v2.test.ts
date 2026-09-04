import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const claims = readFileSync(new URL("../../src/components/staff-pwa/staff-claims.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/components/staff-pwa/staff-claims.module.css", import.meta.url), "utf8");
const sharedCss = readFileSync(new URL("../../src/components/staff-pwa/staff-v2.module.css", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../../src/components/staff-pwa/staff-v2-primitives.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/app/staff/claims/page.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../../src/lib/staff-pwa/home.ts", import.meta.url), "utf8");
const approvalCenter = readFileSync(new URL("../../src/app/staff/approvals/page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/lib/claim/service.ts", import.meta.url), "utf8");

test("Claims V2 keeps the canonical route and Home destination", () => {
  assert.match(page, /<StaffClaims\s*\/>/);
  assert.match(home, /href: "\/staff\/claims"/);
  assert.match(claims, /StaffV2PageHeader title="Claims"/);
});

test("Claims landing is row-first with one task entry and no giant hero", () => {
  assert.match(claims, /New claim/);
  assert.match(claims, /Recent claims/);
  assert.match(claims, /RECENT_CLAIM_LIMIT = 3/);
  assert.match(claims, /Show more recent claims/);
  assert.match(claims, /mode === "new"/);
  assert.doesNotMatch(claims, /className=\{styles\.hero\}|ClaimsGreenHeroV2|ClaimsMegaCard|ClaimHistoryCardV2/);
});

test("recent rows keep amount prominent and one canonical combined status", () => {
  assert.match(claims, /getEmployeeClaimStatus\(input\)/);
  assert.match(claims, /formatEmployeeClaimAmount\(claim\.submittedTotal, claim\.currency\)/);
  assert.match(claims, /className=\{styles\.claimRowCopy\}/);
  assert.doesNotMatch(claims, /PAYROLL_LINKED|AWAITING_CHANNEL|OUTSIDE_PAYROLL_PAID/);
});

test("claim detail separates approval, payment, facts, receipts and canonical decision", () => {
  assert.match(claims, /StaffV2DetailSection title="Approval"/);
  assert.match(claims, /StaffV2DetailSection title="Payment"/);
  assert.match(claims, /getEmployeeClaimApprovalStatus\(input\)/);
  assert.match(claims, /getEmployeeClaimPaymentStatus\(input\)/);
  assert.match(claims, /StaffV2DetailSection title="Claim details"/);
  assert.match(claims, /StaffV2DetailSection title="Receipt"/);
  assert.match(claims, /StaffV2DetailSection title="Decision"/);
  assert.match(claims, /claim\.reviewReason \?\? firstLine\?\.reviewReason/);
  assert.doesNotMatch(claims, /Next action|No action needed|Paid on|Will be paid in next payroll/);
});

test("receipt details are filename-specific, compact and accessible", () => {
  assert.match(claims, /StaffV2AttachmentRow/);
  assert.match(claims, /aria-label=\{`View receipt \$\{attachment\.sanitizedFileName\}`\}/);
  assert.match(primitives, /title=\{fileName\}/);
  assert.match(sharedCss, /text-overflow: ellipsis/);
  assert.doesNotMatch(claims, /OCR|receipt contents|camera|capture=/i);
});

test("new claim preserves a compact three-step task flow", () => {
  assert.match(claims, /Step \$\{step\} of 3/);
  assert.match(claims, />Details<\/li>/);
  assert.match(claims, />Receipt<\/li>/);
  assert.match(claims, />Review<\/li>/);
  assert.match(claims, /StaffV2FormSection title="Claim details"/);
  assert.match(claims, /StaffV2FormSection title="Receipt & reason"/);
  assert.match(claims, /StaffV2FormSection title="Review & submit"/);
  assert.equal(claims.match(/Submit claim/g)?.length, 1);
});

test("step one keeps only canonical claim facts and numeric-safe amount input", () => {
  assert.match(claims, />Category/);
  assert.match(claims, />Expense date/);
  assert.match(claims, />Amount \(RM\)/);
  assert.match(claims, />Distance travelled \(km\)/);
  assert.match(claims, /inputMode="decimal"/);
  assert.match(claims, /step="0\.01" type="number"/);
  assert.match(claims, />Merchant/);
  assert.doesNotMatch(claims, /claim draft model|ClaimDraft|localStorage|indexedDB/i);
});

test("step two wraps the canonical receipt picker with shared attachment UX", () => {
  assert.match(claims, /Upload receipt/);
  assert.match(claims, /Replace receipt/);
  assert.match(claims, /image\/jpeg,image\/png,image\/webp,application\/pdf/);
  assert.match(claims, /up to 10 MB\. Stored privately/);
  assert.match(claims, /receipt\.name/);
  assert.match(claims, /What was this expense for\?/);
});

test("review is read-only and the submit action is a safe fixed task footer", () => {
  const review = claims.indexOf('title="Review & submit"');
  const sticky = claims.indexOf("<StaffV2StickyActionBar>");
  assert.ok(review >= 0 && sticky > review);
  assert.match(claims, /After submission, approval and payment will be tracked separately/);
  assert.match(css, /padding-bottom: calc\(92px \+ var\(--staff-v2-safe-bottom\)\)/);
  assert.match(sharedCss, /position: fixed/);
  assert.match(sharedCss, /env\(safe-area-inset-right\)/);
  assert.match(sharedCss, /env\(safe-area-inset-left\)/);
});

test("task mode hides global navigation and landing restores it", () => {
  assert.match(claims, /setTaskNavigationHidden\(mode === "new"\)/);
  assert.match(claims, /return \(\) => setTaskNavigationHidden\(false\)/);
  assert.match(claims, /setMode\("landing"\)/);
});

test("loading, empty and error states are stable and employee-safe", () => {
  assert.match(claims, /ClaimsLoadingRows/);
  assert.match(claims, /No claims yet\./);
  assert.match(claims, /Claims couldn't load\./);
  assert.match(claims, />Try again<\/button>/);
  assert.match(claims, /role="alert"/);
  assert.doesNotMatch(claims, />Prisma<|>database<|>stack trace</);
  assert.match(service, /take: 100/);
  assert.doesNotMatch(claims, /All claims history/);
});

test("Claims V2 mobile CSS protects long text, touch targets and viewport width", () => {
  assert.match(css, /@media \(max-width: 369px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /100vw/);
});

test("Claim canonical API, approval, payment and attachments remain unchanged", () => {
  assert.match(service, /submitEmployeeClaim/);
  assert.match(service, /validateClaimAttachment/);
  assert.match(service, /reimbursement: true/);
  assert.match(service, /businessId: auth\.businessId, membershipId: auth\.membershipId/);
  assert.match(approvalCenter, /Claims|Claim/);
  assert.doesNotMatch(claims, /\/api\/staff\/claim-draft|\/api\/payroll/);
});
