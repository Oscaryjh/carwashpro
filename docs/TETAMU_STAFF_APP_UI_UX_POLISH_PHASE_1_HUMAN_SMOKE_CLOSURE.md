# TETAMU STAFF APP — UI/UX POLISH PHASE 1 HUMAN SMOKE CLOSURE

## 1. Executive Summary

Human real-device UI smoke 尚未获得可记录的 Employee 与 Manager 真人设备证据。

```text
STAFF APP UI/UX POLISH PHASE 1
→ BLOCKED — AWAITING HUMAN DEVICE EVIDENCE
```

这不是产品 P0/P1 缺陷，也不推翻既有 functional UAT。工程验收仍为 `READY FOR HUMAN SMOKE`；最终 UI acceptance 只能在真实设备完成只读导航后关闭。

## 2. Environment

- Environment: `TESTING`
- Staff App: `https://tetamu-staff-app-testing.up.railway.app/staff/login`
- Health: HTTP 200
- Database: `ready`
- Login route: HTTP 200
- Production touched: `NO`
- Business data changed: `NO`
- Code changed: `NO`
- OTP sent: `NO`

## 3. Employee Home

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- Device type and OS/browser
- Current workplace and branch are obvious
- Today's shift and attendance state are obvious
- Clock In / Clock Out is visually dominant
- Secondary content does not compete with the primary action

No Clock In/Out action should be submitted for this smoke.

## 4. Employee Time

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- Roster versus actual Attendance is understandable
- Today, history, timesheet, overtime and correction are discoverable
- No confusing P2 / projection / revision / canonical terminology is visible

## 5. Employee Requests

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- Leave, Claims and Attendance Correction are easy to find
- Recent request status is understandable
- Employee `Submit OT` is not present

No request should be submitted.

## 6. Employee Pay

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- Period, Gross, Deductions, Net Pay and View/Open Payslip are visible
- Net Pay has the strongest summary emphasis

No payroll or payslip publication should be performed.

## 7. Employee Profile

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- Current workplace and branch are clear
- Switch workplace and Logout are discoverable
- Internal IDs and technical terminology are not exposed

Do not switch workplace during the smoke unless the user explicitly wants to verify the existing non-mutating selector behavior.

## 8. Manager Requests

Result: `NOT CHECKED ON HUMAN DEVICE`

Evidence still required:

- `Needs your approval` is obvious near the top
- Waiting count and approval domains are understandable
- Leave, Claims, Attendance Correction and Overtime review are discoverable

No approval, rejection or adjustment should be submitted.

## 9. Employee/Manager Separation

Result: `NOT CHECKED ON HUMAN DEVICE`

Required comparison:

- Employee does not see the Manager approval summary
- Manager sees it naturally without duplicate/confusing entry points

## 10. Bottom Navigation

Result: `NOT CHECKED ON HUMAN DEVICE`

Required confirmation:

```text
Home
Time
Requests
Pay
Profile
```

Also confirm active state, readable labels, comfortable touch targets, safe-area spacing, and no extra More tab.

## 11. Mobile Layout

Result: `NOT CHECKED ON HUMAN DEVICE`

Required confirmation:

- No horizontal page scroll
- No clipped cards, amounts or status pills
- No bottom-nav overlap
- No hidden primary actions
- Long names, branches and RM amounts wrap or truncate safely

## 12. Keyboard Safety

Result: `NOT CHECKED`

Open one existing Leave, Claims or Attendance Correction form without submitting. Confirm the page can scroll, key fields/actions remain reachable, and the bottom nav does not cover modal actions.

## 13. Issues Found

- P0 issues: `NONE RECORDED`
- P1 issues: `NONE RECORDED`
- P2 notes: `NONE RECORDED`
- Evidence gap: Employee and Manager human-device smoke results have not been supplied.

Minimum evidence to close this report:

```text
Employee device / OS / browser:
Employee Home: PASS/FAIL
Employee Time: PASS/FAIL
Employee Requests: PASS/FAIL
Employee Submit OT absent: YES/NO
Employee Pay: PASS/FAIL
Employee Profile: PASS/FAIL

Manager device / OS / browser:
Manager Requests: PASS/FAIL
Needs your approval: PASS/FAIL
Employee/Manager separation: PASS/FAIL

Bottom navigation: PASS/FAIL
Horizontal overflow: NONE/FOUND
Bottom-nav overlap: NONE/FOUND
Keyboard safety: PASS/FAIL/NOT CHECKED
Technical jargon: PASS/ISSUES
Observed issue / screenshot reference:
```

## 14. Final Verdict

```text
Final Verdict: BLOCKED
Reason: Human real-device Employee and Manager evidence is not yet available.
Staff App Functional UAT: REMAINS COMPLETE
Staff App UI/UX Acceptance: PARTIAL
Further Business Logic Development Required: NO
Further P2 Visual Polish Required: OPTIONAL, subject to human findings
Production Touched: NO
```

When the human results above are supplied, update only this evidence and the Phase 1 human-smoke subsection. Do not rerun full business UAT or modify functionality unless a real regression is reported.
