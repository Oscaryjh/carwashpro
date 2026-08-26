# TETAMU HR & Payroll Fresh End-to-End Transaction UAT

**执行日期：** 26 Aug 2026
**环境：** Local development / disposable UAT data
**结论：** **Fresh E2E UAT → PASS ✅**
**发布结论：** 本报告只证明本轮 Fresh E2E 交易验收通过，**不代表 Production Ready**。

## 1. UAT 目标与停止边界

本轮以全新业务、员工、审批、考勤、Timesheet、Payroll 与 Payslip 数据执行真实交易链，验证：

1. Employee 在 canonical Staff App 发起请求。
2. Manager / Supervisor 在 canonical Staff App 审批其权限范围内的请求。
3. HR 在 Desktop 处理 Attendance correction、OT review、Timesheet 与 Payroll。
4. Timesheet 锁定后，后续源数据变化不会静默改写已锁定版本。
5. Payroll Finalize 后，金额、Timesheet revision 与 Payslip 均保持不可变。
6. Employee 只能查看自己的 Payslip。
7. Manager 不能审批自己、其他 branch 或其他 business 的资料。
8. 3000 的 legacy `/staff` 入口正确导向 3100，且保留 path/query。
9. 关键写入没有产生重复 Leave、Claim、OT、Payroll Entry、Payroll Component 或 Payslip。

本轮没有执行 Production、真实付款、法定提交、真实 OTP、真实设备发布或 release drill。

## 2. Local Application Boundary

| Surface | Canonical local URL | 本轮用途 | 证据资格 |
|---|---:|---|---|
| Desktop HR / Attendance / Payroll / Approvals | `https://localhost:3000` | HR、Owner、Attendance、Timesheet、Payroll、Payslip 发布 | **有效 Desktop 证据** |
| Canonical Staff App | `http://localhost:3100` | Employee 与 Manager / Supervisor 请求、审批、Pay、Payslip | **有效 Staff 证据** |
| Legacy Desktop Staff routes | `https://localhost:3000/staff/*` | 只做 redirect compatibility | **不能作为 Staff App UAT 证据** |
| Desktop local-UAT helper | `https://localhost:3000/api/local-uat/session` | Desktop persona/session helper | **仅限 Desktop；不能作为 Staff App 证据** |

本轮 Staff App 的 Employee 与 Manager 交易均通过 3100 canonical surface 完成。3000 `/staff` 仅验证 redirect，不作为功能验收替代品。

## 3. Fresh Fixture 与身份

| Record | ID / Value |
|---|---|
| Business | `de027150-942a-499c-a463-db2e114c5cc3` — TETAMU Fresh Payroll UAT 03e04c57 |
| Primary branch | `8cace4b9-f965-4308-beed-bf07a581bf87` |
| Other branch | `93fbe3f1-d9cf-4ccd-9414-668f1cdf9315` |
| Owner user | `ca88913c-2441-4bb8-b44b-6ac96f5c8d30` |
| HR user | `35ae74c8-297b-49ee-88f0-c8a63b749d55` |
| Manager user | `db2ca898-658c-4393-a395-78a6a9c68ab3` |
| Manager membership | `90f47dcf-7710-4748-9a09-41e699ebc609` |
| Employee account | `9b81fc54-7a45-46f7-94ee-7b7894f9ae9f` |
| Employee membership | `1ce22b1e-3f18-4534-9c4d-f2a1bf0a0b1b` |
| Employee code | `FRESH-03e04c57` |
| Other-branch employee membership | `8cb70908-745e-4788-9627-f075489749cb` |
| Leave policy / version | `d2f4cdc2-1000-436c-b126-3e07ee7bcb3c` / `aff89838-efed-4108-a08e-4d395a50c127` |
| Claim category / revision | `e03b07d5-d6ae-4e31-987a-35b270bc3adb` / `faee8ba9-25ad-4c48-9638-559f1398f048` |
| Payroll period | August 2026 |

## 4. End-to-End Transaction Lineage

### 4.1 Attendance correction and working time

| Event | Canonical actor/surface | Record | Result |
|---|---|---|---|
| 25 Aug missing clock-in request | Employee / 3100 | Exception `8281556e-c390-4dde-9c65-acf65ddc5365` | HR approved on 3000 |
| 25 Aug missing clock-out request | Employee / 3100 API | Exception `a22f3e67-fbc4-470e-a482-9ecc735fc2bc` | HR approved on 3000 |
| Corrected attendance session | HR canonical attendance | Session `098883f1-b71e-4512-8850-c3ed8eebd00b` | 09:00–20:00, 660 paid minutes |
| 26 Aug attendance | Employee / 3100 | Fresh live sessions | Excluded from locked payable day because no roster-backed expected work |

Attendance correction is HR-controlled in the current architecture. Manager does not approve these corrections through the Staff request inbox.

### 4.2 Leave

| Field | Evidence |
|---|---|
| Request | `36a2d7e4-d973-4c52-946a-e2e472ac71f8` |
| Submitted by | Fresh Employee on 3100 |
| Date | 27 Aug 2026 |
| Approval | Fresh Manager on 3100 |
| Balance | 12 days → 11 days |
| Self-approval negative test | Manager direct self-approval route returned Not Found; no action rendered |

### 4.3 Claim

| Field | Evidence |
|---|---|
| Claim | `7cfcb499-3187-4f68-9044-e260f154ac3a` |
| Description | `1001 Fresh E2E transport` |
| Amount | RM120.50 |
| Submitted by | Fresh Employee on 3100 |
| Approval | Fresh Manager on 3100 |
| Initial reimbursement state | `AWAITING_CHANNEL` |
| Payroll reimbursement | `19431ed0-75a4-40a8-be05-acbb90160e2f`, revision 1, `PAYROLL_LINKED` |
| Payroll claim snapshot | `2994d158-f7d8-4ecf-b152-7a8ff4aa7da6`, `READY`, RM120.50 |

Claim 被带入 Payroll 为 non-wage reimbursement；它增加 net payment，但不增加 gross salary。

### 4.4 Overtime and P2 payable time

当前受支持 canonical flow 是：Attendance 产生 overtime candidate，HR 在 Desktop review，而不是 Employee 另外提交一张 OT request。

| Record | Result |
|---|---|
| OT review `50d8d7fa-29b6-454c-ac81-55fa8a35ce9d` | 25 Aug, APPROVED, 120 minutes |
| P2 `855e1af1-5031-446f-826c-ad8a70f125d3` | 25 Aug, PRESENT, 660 minutes |
| P2 `ad5a7cb0-2821-4737-8bf6-21d373827e42` | 26 Aug, EXCLUDED, 0 minutes |
| P2 `ad187724-2f63-4997-8109-4d52e38123fd` | 27 Aug, APPROVED_PAID_LEAVE |
| Early-departure exception `058f7b2d-ae74-4735-986e-da175eea164d` | RESOLVED, 697 roster minutes reviewed |

### 4.5 Timesheet freeze

| Field | Evidence |
|---|---|
| Timesheet | `4efe5836-ded3-4c94-986e-49c6598709ea` |
| Locked revision | 2 |
| Revision record | `36f36b82-b1ea-4ff3-a1fc-5b86dc96eb9b` |
| Status | LOCKED |
| Finalization note | `Fresh E2E v2 locked with P2 coverage and approved overtime.` |
| Locked at | 26 Aug 2026, 7:10 am |

锁定后又在 3100 写入新的 live attendance session。系统检测 live results 与 locked revision 不同，但 locked revision 的记录、revision number 与 Payroll snapshot 没有被改写；需要通过 canonical reopen/revision 才能影响后续 Payroll。

## 5. Payroll Calculation → Finalize → Payslip

### 5.1 Payroll Draft and entry lineage

| Record | ID |
|---|---|
| Payroll Run | `3d2ea9e2-bc54-4eb8-8665-4557ca251971` |
| Fresh Employee entry | `8a261853-eba9-4b06-91b8-aebe258029bc` |
| Manager entry | `9b3f4e51-35b2-486d-9444-0ac2812fc903` |
| Other employee entry | `bcc3bedb-1210-4b0e-b8cf-9e81b6ec5110` |

Fresh Employee calculation evidence:

- Basic pay: RM3,000.00
- Normal payable work: 9 hours
- Approved OT: 2 hours
- Paid leave: 1 day
- OT amount: RM43.27
- Gross salary: RM3,043.27
- Claim reimbursement: RM120.50, excluded from gross salary
- Net payment: RM3,163.77
- Frozen Attendance source: Timesheet revision 2

Run totals:

- Gross salary: RM9,043.27
- Deductions: RM0.00
- Net payment including reimbursement: RM9,163.77

### 5.2 Finalization and immutability

HR submitted the Draft; Owner finalized the run on 26 Aug 2026 at 7:24 am. The run became finalized and locked.

After finalization, Employee created another live attendance session on 3100. Reloading the finalized Payroll Run still showed:

- Gross RM9,043.27
- Net RM9,163.77
- Fresh Employee net RM3,163.77
- Timesheet revision 2
- Reopen unavailable after documents were published

This proves later attendance changes did not mutate the finalized Payroll snapshot.

### 5.3 Payslip publication and authorization

| Evidence | Result |
|---|---|
| Publish operation | `3 payslip(s) published from the frozen payroll snapshot` |
| Published count | 3 / 3 |
| Employee publication | `f84aed8c-55fa-4199-b47c-3f7a54d781e2` |
| Manager publication | `13887323-a432-4489-bfc6-ea2915c512f9` |
| Employee 3100 Pay/Payslip | August 2026 document visible and published 26 Aug 2026 |
| Employee own document request | HTTP 200 |
| Employee request for manager document | HTTP 404 |

Employee can retrieve only their own Payslip; another employee’s publication is not exposed.

## 6. Authorization and Tenant Isolation

### 6.1 No self-approval

Manager attempting to open their own approval target received Not Found and no approval action was rendered. **PASS**.

### 6.2 Cross-branch

A fresh claim was submitted by the other-branch employee through canonical 3100:

- Claim `ddc82f27-dfee-4a1c-89e1-5aaed18b3f72`
- Submit HTTP 201
- Fresh Manager inbox did not contain the claim
- Direct detail returned the framework Not Found body; no `Review Claim` action or claim purpose was rendered

**PASS.** Note: the local Next development RSC transport returned HTTP 200 with a Not Found body on one direct navigation path. This is a dev-mode transport nuance, not a data disclosure; no protected target data or action was rendered.

### 6.3 Cross-business

An existing claim from another business was queried read-only. Fresh Manager direct detail rendered Not Found and did not expose `Review Claim` or target data. **PASS**.

## 7. Legacy Redirect Regression

Request:

```text
https://localhost:3000/staff/requests?foo=bar&next=%2Fstaff%2Fpay
```

Response:

```text
HTTP 307
Location: http://localhost:3100/staff/requests?foo=bar&next=%2Fstaff%2Fpay
```

Path and query were preserved and no redirect loop occurred. The redirected 3000 route was not used as Staff App evidence.

## 8. Duplicate Protection Audit

| Audit item | Count / Result |
|---|---|
| Fresh Leave Request | 1 |
| Fresh Claim | 1 |
| OT Review | 1 |
| Timesheet | 1 |
| Timesheet revisions | 2 legitimate controlled revisions |
| Payroll entries | 3 |
| Fresh Employee payroll entry | 1 |
| Duplicate payroll-entry memberships | 0 |
| Payroll components | 4 |
| Duplicate payroll-component line keys | 0 |
| Claim snapshot | 1 |
| Payslips | 3 |
| Duplicate payslip entries | 0 |
| Duplicate payslip memberships | 0 |
| Approval decisions | 2 |
| Duplicate approval decisions | 0 |

## 9. Bugs Found and Fixed

### Fix 1 — Timesheet P2 materialization and transaction visibility

**File:** `src/lib/attendance/timesheet-service.ts`

Problem:

- Attendance P2 did not consistently materialize from roster-backed current expected-day records and approved leave-day records.
- Materialization and readiness validation shared one transaction; a readiness blocker could roll back the materialized evidence.
- Session-only days without roster evidence could be treated as payable days.

Fix:

- Materialize P2 from roster-backed current `AttendanceExpectedDay` and approved `LeaveRequestDay`.
- Commit materialization before running blocker/readiness validation.
- Exclude session-only days that do not have roster-backed expected-work evidence.

Regression coverage was added to `tests/integration/attendance-monthly-timesheet.test.ts`; targeted suite passed 5/5.

### Fix 2 — Attendance resolution option mismatch

**File:** `src/app/(business)/team/attendance/resolutions/page.tsx`

Problem:

- The UI displayed resolution options that were invalid for specific exception types, causing avoidable server validation errors.

Fix:

- Render only type-specific resolution options accepted by the server.
- Verified through the browser resolution flow.

## 10. Automated Regression Results

| Workspace / Check | Result |
|---|---|
| Main unit tests | **1130/1130 PASS** |
| Staff App unit tests | **1160/1160 PASS** |
| Main integration | **185/185 PASS** (184 shared + 1 isolated route-flow) |
| Staff App integration | **184/184 PASS** (183 shared + 1 isolated route-flow) |
| Main TypeScript | PASS |
| Staff App TypeScript | PASS |
| Main ESLint | PASS, 0 errors, 7 pre-existing warnings |
| Staff App ESLint | PASS, 0 errors, 7 pre-existing warnings |
| Main `git diff --check` | PASS |
| Staff App `git diff --check` | PASS |

No package-manager install command was used during this UAT. Integration tests ran through the disposable integration runner.

## 11. Acceptance Checklist

| Requirement | Verdict |
|---|---|
| Fresh business and identities | PASS |
| Employee canonical 3100 request flow | PASS |
| Manager canonical 3100 approval flow | PASS |
| HR canonical 3000 attendance resolution | PASS |
| Attendance correction continuity | PASS |
| Leave balance continuity | PASS |
| Claim → reimbursement → Payroll snapshot continuity | PASS |
| OT approval → Payroll component continuity | PASS |
| Timesheet P2 readiness | PASS |
| Timesheet lock and post-lock protection | PASS |
| Payroll Draft calculation | PASS |
| Payroll Finalize immutability | PASS |
| Payslip publication on 3100 | PASS |
| Employee own-document authorization | PASS |
| Manager no-self / cross-branch / cross-business protection | PASS |
| Legacy 3000 Staff redirect | PASS |
| Duplicate protection | PASS |

## 12. Final Verdict

**Fresh E2E UAT → PASS ✅**

The tested local architecture successfully completed this lineage:

```text
3100 Employee request
→ 3100 Manager approval where supported
→ 3000 HR canonical attendance / OT / Timesheet controls
→ Locked Timesheet Revision 2
→ Payroll Draft
→ Claim reimbursement snapshot
→ Payroll Finalize
→ Frozen payroll entries
→ Payslip publish
→ 3100 Employee Pay / Payslip
```

The locked Timesheet and finalized Payroll snapshots remained unchanged after later live attendance writes. Authorization and tenant-isolation checks did not expose another employee, branch, or business record. No duplicate financial or approval records were found.

### Remaining gates outside this UAT

- Production environment and deployment verification
- Real device Staff App UAT
- Real OTP/SMS delivery and carrier behavior
- Real payment execution
- Statutory submission / external authority integration
- Production monitoring, backup/restore and release rollback drill

These gates were intentionally not executed and prevent this report from being interpreted as a Production Ready approval.
