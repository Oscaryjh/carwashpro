import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("Approval Center V2 has Pending and manager-owned History without a duplicate model", async () => {
  const [page, history, schema] = await Promise.all([
    read("src/app/staff/approvals/page.tsx"),
    read("src/lib/staff-pwa/approval-history.ts"),
    read("prisma/schema.prisma"),
  ]);
  assert.match(page, />Pending /);
  assert.match(page, />My History</);
  assert.match(page, /HISTORY_PAGE_SIZE|pagination\.totalPages|Page \{page\} of/);
  assert.match(history, /const HISTORY_PAGE_SIZE = 20/);
  assert.match(history, /const HISTORY_MONTHS = 12/);
  assert.match(history, /actorUserId: input\.access\.actor\.userId/);
  assert.match(history, /actorId: input\.access\.actor\.userId/);
  assert.doesNotMatch(schema, /model ApprovalHistory/);
});

test("history projects immutable canonical reviewer evidence for every approval domain", async () => {
  const history = await read("src/lib/staff-pwa/approval-history.ts");
  assert.match(history, /hrApprovalDecision\.findMany/);
  assert.match(history, /attendanceResolutionEvent\.findMany/);
  assert.match(history, /entityType: "AttendanceException"/);
  assert.match(history, /reviewNoteFromAudit\(audit\.after\)/);
  assert.match(history, /attendanceOvertimeReviewEvent\.findMany/);
  assert.match(history, /branchId: \{ in: \[\.\.\.input\.access\.allowedBranchIds\] \}/);
});

test("history defaults to current month, supports twelve months and employee filtering", async () => {
  const [page, history] = await Promise.all([read("src/app/staff/approvals/page.tsx"), read("src/lib/staff-pwa/approval-history.ts")]);
  assert.match(history, /normalizeHistoryMonth\(input\.month, now\)/);
  assert.match(history, /contains: input\.employee, mode: "insensitive"/);
  assert.match(page, /name="month"/);
  assert.match(page, /name="employee"/);
  assert.match(page, /Only decisions made by you are shown/);
});

test("Requests keeps a permanent capability-gated Manager approval entry at zero pending", async () => {
  const [requests, model] = await Promise.all([
    read("src/app/staff/requests/page.tsx"),
    read("src/lib/staff-pwa/requests-hub.ts"),
  ]);
  assert.match(requests, /loadRequestsApprovalEntry/);
  assert.match(model, /hasKnownCapability/);
  assert.match(model, /resolveStaffTeamApprovalAccess/);
  assert.match(model, /resolveStaffOvertimeAccess/);
  assert.match(requests, /title="Approvals"/);
  assert.match(model, /pending > 0/);
  assert.match(model, /`\$\{pending\} waiting for you`/);
  assert.match(model, /"All clear"/);
  assert.doesNotMatch(requests, /Team approvals/);
  assert.doesNotMatch(requests, /You’re all caught up · View approval history/);
});

test("approval decisions use a required rejection bottom sheet and direct approve action", async () => {
  const [form, css] = await Promise.all([read("src/components/staff-pwa/mobile-approval-form.tsx"), read("src/app/staff/staff-consolidation.css")]);
  assert.match(form, /staff-approval-sheet-backdrop/);
  assert.match(form, /aria-modal="true"/);
  assert.match(form, /minLength=\{3\}/);
  assert.match(form, /decision="APPROVED"/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height:44px/);
});

test("OT adjustment is human-friendly while the backend still receives canonical minutes", async () => {
  const [detail, action] = await Promise.all([read("src/app/staff/requests/overtime/[finalResultId]/page.tsx"), read("src/app/staff/requests/overtime/actions.ts")]);
  assert.match(detail, /name="approvedHours"/);
  assert.match(detail, /name="approvedMinuteRemainder"/);
  assert.doesNotMatch(detail, /Review revision/);
  assert.doesNotMatch(detail, /revision \$\{detail\.timesheetRevision\}/);
  assert.match(action, /Number\(rawHours \|\| 0\) \* 60 \+ Number\(rawMinuteRemainder \|\| 0\)/);
});
