import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("Approval Center uses the shared V2 hierarchy, compact tabs, filters, grouped rows and pagination", async () => {
  const [page, css] = await Promise.all([
    read("src/app/staff/approvals/page.tsx"),
    read("src/components/staff-pwa/staff-approval-center-v2.module.css"),
  ]);

  assert.match(page, /StaffV2PageHeader title="Approvals"/);
  assert.match(page, /aria-current=\{view === "pending"/);
  assert.match(page, /Pending <b>\{total\}<\/b>/);
  assert.match(page, /My History/);
  assert.match(page, /className=\{styles\.filterStrip\}/);
  assert.match(page, /StaffV2RowGroup ariaLabel="Pending approvals"/);
  assert.match(page, /StaffV2ListRow/);
  assert.match(page, /name="month"/);
  assert.match(page, /name="employee"/);
  assert.match(page, /pagination\.totalPages/);
  assert.match(css, /\.viewTabs a[\s\S]*min-height: 44px/);
  assert.match(css, /\.filterStrip[\s\S]*overflow-x: auto/);
  assert.match(css, /@media \(max-width: 380px\)/);
});

test("pending details keep domain evidence and lifecycle boundaries without changing actions", async () => {
  const [detail, form] = await Promise.all([
    read("src/app/staff/approvals/[domain]/[requestId]/page.tsx"),
    read("src/components/staff-pwa/mobile-approval-form.tsx"),
  ]);

  assert.match(detail, /StaffV2PageHeader/);
  assert.match(detail, /StaffV2DetailSection title="Request"/);
  assert.match(detail, /StaffV2DetailSection title="Balance"/);
  assert.match(detail, /Leave approval and document verification are separate decisions/);
  assert.match(detail, /StaffV2DetailSection title="Claim items"/);
  assert.match(detail, /does not mark the claim paid or add it to Payroll/);
  assert.match(detail, /reviewMobileLeaveAction/);
  assert.match(detail, /reviewMobileClaimAction/);
  assert.match(form, /StaffV2StickyActionBar aboveNavigation/);
  assert.match(form, /decision="APPROVED"/);
  assert.match(form, /minLength=\{3\}/);
  assert.match(form, /StaffApprovalSheet/);
});

test("Attendance and OT preserve canonical manager routes while using compact V2 review surfaces", async () => {
  const [attendance, attendanceActions, overtime, overtimeForm] = await Promise.all([
    read("src/app/staff/requests/attendance-corrections/page.tsx"),
    read("src/app/staff/requests/attendance-corrections/actions.ts"),
    read("src/app/staff/requests/overtime/[finalResultId]/page.tsx"),
    read("src/components/staff-pwa/mobile-overtime-approval-form.tsx"),
  ]);

  assert.match(attendance, /getStaffAttendanceCorrectionQueue/);
  assert.match(attendance, /source\.sourceType === "P2_CORRECTION_REQUEST"/);
  assert.match(attendance, /source\.sourceType === "STANDALONE_EXCEPTION"/);
  assert.match(attendance, /reviewMobileAttendanceCorrectionAction/);
  assert.match(attendance, /Review details and decide/);
  assert.doesNotMatch(attendance, />P2</);
  assert.match(attendanceActions, /applyManagerAttendanceResolution|reviewStaffAttendanceCorrection/);
  assert.match(overtime, /getStaffOvertimeDetail/);
  assert.match(overtime, /durationLabel\(item\.potentialOtMinutes\)/);
  assert.match(overtimeForm, /title="Adjust overtime"/);
  assert.match(overtimeForm, /name="approvedHours"/);
  assert.match(overtimeForm, /name="approvedMinuteRemainder"/);
  assert.match(overtimeForm, /minLength=\{3\}/);
});

test("history remains a read-only projection with one status and no mutation form", async () => {
  const [list, detail] = await Promise.all([
    read("src/app/staff/approvals/page.tsx"),
    read("src/app/staff/approvals/history/[domain]/[sourceId]/page.tsx"),
  ]);

  assert.match(list, /StaffV2StatusBadge/);
  assert.match(list, /Only decisions made by you are shown/);
  assert.match(detail, /StaffV2DetailSection title="Decision"/);
  assert.match(detail, /StaffV2DetailSection title="Request"/);
  assert.match(detail, /StaffV2AttachmentRow/);
  assert.doesNotMatch(detail, /<form/);
  assert.doesNotMatch(detail, /reviewMobile/);
  assert.doesNotMatch(detail, /StaffV2StickyActionBar/);
});

test("loading, error and bottom sheets are mobile-safe and keyboard reachable", async () => {
  const [loading, error, sheet, css, primitives, navigation] = await Promise.all([
    read("src/app/staff/approvals/loading.tsx"),
    read("src/app/staff/approvals/error.tsx"),
    read("src/components/staff-pwa/staff-approval-sheet.tsx"),
    read("src/components/staff-pwa/staff-approval-center-v2.module.css"),
    read("src/components/staff-pwa/staff-v2-primitives.tsx"),
    read("src/lib/staff-pwa/navigation.ts"),
  ]);

  assert.match(loading, /aria-busy="true"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /retry/);
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /createPortal/);
  assert.match(sheet, /v2Styles\.portalScope/);
  assert.match(sheet, /event\.key !== "Tab"/);
  assert.match(sheet, /event\.key === "Escape"/);
  assert.match(sheet, /trigger\?\.focus/);
  assert.match(css, /max-height: min\(82dvh, 700px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /:focus-visible/);
  assert.match(primitives, /stickyActionBarAboveNavigation/);
  assert.match(navigation, /Home/);
  assert.match(navigation, /Time/);
  assert.match(navigation, /Requests/);
  assert.match(navigation, /Pay/);
  assert.match(navigation, /Profile/);
});
