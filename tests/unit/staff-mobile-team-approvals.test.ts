import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  adapter: "src/lib/staff-pwa/team-approvals.ts",
  inbox: "src/app/staff/approvals/page.tsx",
  detail: "src/app/staff/approvals/[domain]/[requestId]/page.tsx",
  actions: "src/app/staff/approvals/actions.ts",
  home: "src/components/staff-pwa/staff-home-overview.tsx",
  css: "src/app/staff/staff.css",
};

test("mobile Approval Center is capability-based and projects every canonical review domain", async () => {
  const [adapter, home, inbox] = await Promise.all([readFile(files.adapter, "utf8"), readFile(files.home, "utf8"), readFile(files.inbox, "utf8")]);
  assert.match(adapter, /canDirectStaff\(user\.permissions, capability\)/);
  assert.match(adapter, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.match(adapter, /APPROVE_LEAVE/);
  assert.match(adapter, /REVIEW_CLAIM/);
  assert.match(adapter, /MobileApprovalDomain = "LEAVE" \| "CLAIMS"/);
  assert.doesNotMatch(home, /bottom navigation|More menu/i);
  assert.match(home, /Approval Center/);
  assert.match(inbox, /domain === "ATTENDANCE"/);
  assert.match(inbox, /domain === "OT"/);
  assert.match(inbox, /staff\/requests\/attendance-corrections/);
  assert.match(inbox, /title="Attendance"/);
  assert.match(inbox, /staff\/requests\/overtime/);
  assert.doesNotMatch(inbox, /Canonical queue/);
  assert.match(inbox, /Review pending work and your past decisions/);
});

test("mobile inbox reuses the canonical unified approval reader and oldest-first ordering", async () => {
  const [adapter, service] = await Promise.all([readFile(files.adapter, "utf8"), readFile("src/lib/approvals/service.ts", "utf8")]);
  assert.match(adapter, /getUnifiedApprovalInbox\(access\.unified/);
  assert.match(adapter, /getUnifiedApprovalCounts\(access\.unified/);
  assert.match(adapter, /domains: \["LEAVE", "CLAIMS"\]/);
  assert.match(adapter, /loadStaffAttendanceTaskProjection/);
  assert.match(service, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(service, /orderBy: \[\{ submittedAt: "asc" \}, \{ id: "asc" \}\]/);
});

test("mobile approval authorization is tenant, branch and self-approval safe", async () => {
  const adapter = await readFile(files.adapter, "utf8");
  assert.match(adapter, /businessId: auth\.businessId/);
  assert.match(adapter, /branchId: \{ in: \[\.\.\.access\.allowedBranchIds\] \}/);
  assert.match(adapter, /staffUser: \{ isNot: \{ id: access\.actor\.userId \} \}/);
  assert.match(adapter, /getHrApprovalStages/);
  assert.match(adapter, /reviewLeaveRequest\(/);
  assert.match(adapter, /reviewEmployeeClaim\(/);
});

test("mobile decisions preserve canonical stale guards and reimbursement boundary", async () => {
  const [adapter, leave, claim, detail] = await Promise.all([
    readFile(files.adapter, "utf8"),
    readFile("src/lib/leave/service.ts", "utf8"),
    readFile("src/lib/claim/service.ts", "utf8"),
    readFile(files.detail, "utf8"),
  ]);
  assert.match(adapter, /expectedRevision/);
  assert.match(leave, /leave\.status !== "PENDING" \|\| leave\.revision !== decision\.expectedRevision/);
  assert.match(claim, /claim\.revision !== submittedInput\.expectedRevision/);
  assert.match(detail, /does not mark the Claim paid or add it to Payroll/);
  assert.doesNotMatch(adapter, /markClaimReimbursementPaidOutsidePayroll|selectClaimReimbursementChannel/);
});

test("mobile approval documents use protected scoped routes", async () => {
  const [detail, leaveRoute, claimRoute] = await Promise.all([
    readFile(files.detail, "utf8"),
    readFile("src/app/api/staff-approvals/leave-documents/[documentId]/route.ts", "utf8"),
    readFile("src/app/api/staff-approvals/claim-attachments/[attachmentId]/route.ts", "utf8"),
  ]);
  assert.match(detail, /\/api\/staff-approvals\/leave-documents/);
  assert.match(detail, /\/api\/staff-approvals\/claim-attachments/);
  assert.match(leaveRoute, /resolveStaffTeamApprovalAccess/);
  assert.match(claimRoute, /allowedBranchIds/);
  assert.match(leaveRoute, /staffUser: \{ isNot: \{ id: access\.actor\.userId \} \}/);
  assert.match(claimRoute, /staffUser: \{ isNot: \{ id: access\.actor\.userId \} \}/);
  assert.match(leaveRoute, /private, no-store/);
  assert.match(claimRoute, /content-security-policy/);
});

test("mobile UI has compact filters, loading state and 44px touch targets", async () => {
  const [inbox, detail, form, home, css, loading] = await Promise.all([readFile(files.inbox, "utf8"), readFile(files.detail, "utf8"), readFile("src/components/staff-pwa/mobile-approval-form.tsx", "utf8"), readFile(files.home, "utf8"), readFile(files.css, "utf8"), readFile("src/app/staff/approvals/loading.tsx", "utf8")]);
  assert.match(inbox, /staff-approval-tabs/);
  assert.match(home, /canReviewLeave/);
  assert.match(home, /canReviewClaims/);
  assert.match(detail, /Current balance/);
  assert.match(form, /Reject request\?/);
  assert.match(form, /aria-modal="true"/);
  assert.match(form, /A reason is required/);
  assert.match(form, /decision="REJECTED"/);
  assert.match(form, /decision="APPROVED"/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(loading, /aria-busy="true"/);
});

test("mobile actions return safe approval errors instead of raw server messages", async () => {
  const actions = await readFile(files.actions, "utf8");
  assert.match(actions, /approvalErrorMessage\(error\)/);
  assert.match(actions, /This approval could not be saved\. Refresh the inbox and try again\./);
  assert.match(actions, /Required supporting documents must be verified before approval\./);
  assert.doesNotMatch(actions, /const message = error instanceof Error \? error\.message/);
});
