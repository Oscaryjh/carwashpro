# TETAMU — Real OT UAT Attendance-to-Queue Diagnostic

## 1. Executive Summary

本次仅对 Railway **Testing** 数据库与当前代码进行只读追踪。真实手机打卡资料完整：Clock In、Clock Out、Roster Expected Day、分店、月份与时区均正确，没有 Leave、Attendance exception、Timesheet lock 或 Manager scope blocker。

第一个断点是：

```text
Completed EmployeeAttendance
→ legacy AttendanceFinalResult: PASS
→ AttendanceP2FinalResult: MISSING
→ Potential OT candidate: cannot be listed
→ Manager OT queue: empty
```

Clock Out 路径在完成 Attendance 后调用的是 legacy `materializeAttendanceResolutionFoundationInTransaction`，会生成 legacy `AttendanceFinalResult`，但不会调用 `materializeAttendanceP2Day`。OT listing 与 Staff Manager queue 只读取 `AttendanceP2FinalResult`。因此这是一项 **Attendance final-result pipeline contract gap**，不是 OT 算法、Manager 权限、Branch、月份、时区或 Timesheet 问题。

只读纯函数诊断证明：如果同一批真实事实已经存在于 `AttendanceP2FinalResult`，canonical `deriveOvertimeCandidate` 会产生 `NORMAL / 15 minutes / no blocked reason`。

## 2. Real UAT Evidence

| 项目 | 结果 |
|---|---|
| Environment | Railway `testing`，environment ID `ac9ef980-6805-4bf2-99f2-72dc7579d99d` |
| Database | Testing Postgres `railway`（只读查询） |
| Employee | Real Device Payroll UAT Staff (`UAT-PAYROLL-001`) |
| Phone | `+60128793848` |
| Business | Royal Salon |
| Branch | salon online |
| Roster | 27 Aug 2026, 16:50–17:20 MYT, break 0 |
| Real Clock In | 27 Aug 2026 16:44:41.076 MYT |
| Real Clock Out | 27 Aug 2026 17:30:13.867 MYT |
| Attendance worked minutes | 45 |
| Expected Potential OT | 15 minutes |

Production 未查询、未修改、未部署。

## 3. Employee Membership

确认真实 Attendance 使用的是 Royal Salon membership，而不是隔离 Payroll UAT Business 的其他 membership。

| 字段 | 值 |
|---|---|
| Membership ID | `72f21dad-66d0-45fc-a326-2a8c5f55ffdb` |
| Employee Account ID | `7260972a-e431-4ea1-bc69-b604a997ef0a` |
| Employee Code | `UAT-PAYROLL-001` |
| Business ID | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` |
| Branch ID | `41575966-238f-46ab-a114-22bbee4949c5` |
| Membership | ACTIVE |
| Attendance enabled | YES |
| Active primary branch assignment | YES |

结论：**PASS**。

## 4. Attendance Record

| 字段 | 值 |
|---|---|
| Attendance ID | `7d046190-da51-4148-8f37-9cfb3869f6f6` |
| businessId | `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` |
| branchId | `41575966-238f-46ab-a114-22bbee4949c5` |
| membershipId | `72f21dad-66d0-45fc-a326-2a8c5f55ffdb` |
| workDate | `2026-08-27` |
| clockInAt | `2026-08-27T08:44:41.076Z` = 16:44:41.076 MYT |
| clockOutAt | `2026-08-27T09:30:13.867Z` = 17:30:13.867 MYT |
| totalBreakMinutes | 0 |
| totalWorkedMinutes | 45 |
| status | COMPLETED |
| source | 两个 punch 均为 `STAFF_PWA` |
| revision | `EmployeeAttendance` 本身没有 revision 字段；legacy final result version = 1 |

Punch evidence：

- Clock In Punch ID: `88b5bbba-8658-4908-9c7d-a12967d08a4f`
- Clock Out Punch ID: `5b6c8d89-5db9-43de-8c77-710ff02bc876`
- 两者均绑定同一 Attendance ID、同一 Testing business/branch/membership。

结论：真实时间与 Staff App 显示一致，**PASS**。

## 5. Expected Day

| 字段 | 值 |
|---|---|
| Expected Day ID | `0e4c8353-fc3d-4c75-be05-68f3d9e3a72b` |
| kind | WORKDAY |
| status | CURRENT |
| source | ROSTER |
| Expected Day revision | 1 |
| Roster publication ID | `ebce5625-415c-4a08-8ebd-ce8afefe902b` |
| Roster publication revision | 3 |
| Published assignment ID | `ce4d426d-3b11-45bb-9a59-73b1598c433a` |
| shift start | `2026-08-27T08:50:00.000Z` = 16:50 MYT |
| shift end | `2026-08-27T09:20:00.000Z` = 17:20 MYT |
| break | 0 minutes |
| timezone | `Asia/Kuala_Lumpur` |
| evidence reference | `roster:ebce5625-415c-4a08-8ebd-ce8afefe902b:ce4d426d-3b11-45bb-9a59-73b1598c433a:r3` |

没有 stale/retrospective Expected Day。结论：**PASS**。

## 6. P2 Final Result

`AttendanceP2FinalResult`：**MISSING**。

| 字段 | 值 |
|---|---|
| finalResultId | N/A |
| outcome/status | N/A |
| workedMinutes | N/A（raw Attendance = 45） |
| expectedDayId | N/A（current Expected Day exists） |
| sourceDigest | N/A |
| revision/version | N/A |
| P2 blockers | NONE detected by read-only detector |
| P2 resolution state | No P2 exception/resolution exists |

同时存在的 **legacy** finalization evidence：

| 字段 | 值 |
|---|---|
| Legacy AttendanceResolutionCase ID | `f2d7c12b-48b1-4259-8d7c-2e8cb2791c2e` |
| status | RESOLVED |
| openedReason | LEGACY_COMPLETED |
| Legacy AttendanceFinalResult ID | `1bfa5083-1cca-4179-abf9-60cfc3ce0dea` |
| version | 1 |
| disposition | INCLUDED |
| source | RAW_SESSION |
| workedMinutes | 45 |

这份 legacy result 不是 OT service 查询的 `AttendanceP2FinalResult`，所以不能进入 OT candidate list。

## 7. Attendance Exceptions

| 检查 | 结果 | Blocking |
|---|---|---|
| Legacy AttendanceException | NONE | NO |
| Attendance adjustment | NONE | NO |
| Legacy resolution case | RESOLVED / `LEGACY_COMPLETED` | NO |
| P2 exception | NONE | NO |
| P2 resolution | NONE | NO |
| AttendanceCorrectionRequest | NONE | NO |
| Missing punch | NO；Clock In / Clock Out 均存在 | NO |
| Branch mismatch | NO | NO |
| Expected Day mismatch | NO | NO |

Read-only 调用 `detectAttendanceExceptions` 的结果：

```text
exceptions: []
warnings: []
suggestedOutcome: PRESENT
```

因此 P2 不是被异常阻挡；它是根本没有被 Clock Out flow 调用。

## 8. Leave Conflict

针对 membership `72f21dad-66d0-45fc-a326-2a8c5f55ffdb` 与 27 Aug 2026：

```text
Approved Leave: NO
Pending Leave: NO
LeaveRequestDay rows: 0
```

结论：**NO LEAVE CONFLICT**。

## 9. OT Derivation

因为持久化的 P2 Final Result 不存在，canonical persisted derivation 无法直接进行。为诊断算法而进行的只读、非持久化纯函数推演使用了同一份真实 Attendance 与 Expected Day facts：

| 字段 | 值 |
|---|---|
| expected start | 16:50:00 MYT |
| expected end | 17:20:00 MYT |
| actual start | 16:44:41.076 MYT |
| actual end | 17:30:13.867 MYT |
| total worked | 45 minutes |
| before-shift minutes | 5（floor） |
| after-shift minutes | 10（floor） |
| OT context | NORMAL |
| blocked reason | NONE |
| potential OT | **15 minutes** |
| expected effective review status | PENDING_REVIEW（no review exists） |

结论：OT derivation algorithm 对这笔 evidence 的结果正确；**不是 `OT_DERIVATION_BUG`**。

## 10. OT Candidate Listing

对 Testing DB read-only 调用 `listAttendanceOvertimeCandidates`：

```text
business: Royal Salon
branch scope: salon online
period: 2026-08-01 .. 2026-09-01
membership: UAT-PAYROLL-001 membership
candidate returned: NO
candidate count: 0
```

原因：`src/lib/attendance/overtime-service.ts:118` 的第一项 source query 只读取 `attendanceP2FinalResult`。该表没有这笔 employee/day，因此 service 在 derive/filter 前已经没有 input。

这不是 query/filter 丢掉一个已存在的 P2 result；是 upstream P2 source row 缺失。因此不分类为 `OT_CANDIDATE_QUERY_BUG`。

## 11. Manager Queue Projection

对 EMP-005 当前有效 session read-only 调用 `getStaffOvertimeQueue({ month: "2026-08" })`：

```text
access resolution: PASS
month: 2026-08
candidate items: 0
pending: 0
```

逐层结果：

| Filter / projection stage | 结果 |
|---|---|
| Business access | PASS |
| HR module / attendance capability | PASS |
| Allowed branch | PASS: salon online |
| Month filter | PASS: August 2026 |
| P2 final-result source query | **MISSING — first failing stage** |
| Candidate derivation | NOT REACHED |
| Self-review exclusion | Would PASS; Manager user differs from Employee |
| Final-result fact reload | NOT REACHED |
| Pending status projection | NOT REACHED |

因此 Manager queue `0 waiting` 是目前 persisted data contract 下的正确 projection；queue 本身没有把一项已存在的 candidate 过滤掉。

## 12. Manager Scope

| 检查 | 结果 |
|---|---|
| Manager membership | `3ed1909b-f624-49cb-9457-efecec9e776a` |
| Manager user | `5840c06f-fd53-4d8f-8983-e70d0011f876` |
| Same business | PASS |
| Same branch | PASS |
| Active branch scope | PASS: `41575966-238f-46ab-a114-22bbee4949c5` |
| `ATTENDANCE_EMPLOYEE_MANAGE` raw permission | PASS |
| `MODIFY_ATTENDANCE_EMPLOYEES` capability | PASS |
| Self-approval conflict | NO |
| Active Staff App session | PASS |

`src/lib/business-groups/capabilities.ts:280` 将 `MODIFY_ATTENDANCE_EMPLOYEES` capability 映射至 raw permission `ATTENDANCE_EMPLOYEE_MANAGE`；`resolveStaffOvertimeAccess` 已返回非空 access。Manager scope 不是 blocker。

## 13. Month / Timezone

| Evidence | UTC storage | MYT projection |
|---|---|---|
| workDate | `2026-08-27T00:00:00.000Z` (date semantic) | 27 Aug 2026 |
| Clock In | `2026-08-27T08:44:41.076Z` | 27 Aug 16:44:41.076 |
| Expected start | `2026-08-27T08:50:00.000Z` | 27 Aug 16:50 |
| Expected end | `2026-08-27T09:20:00.000Z` | 27 Aug 17:20 |
| Clock Out | `2026-08-27T09:30:13.867Z` | 27 Aug 17:30:13.867 |

Expected Day timezone snapshot 是 `Asia/Kuala_Lumpur`。Manager queue 的 `2026-08` range 是 `[2026-08-01, 2026-09-01)` UTC date bounds，与 canonical `workDate` 对齐。

结论：

```text
Clock events: PASS
Work date: PASS
Expected Day: PASS
OT diagnostic input: PASS
Manager queue month: PASS
UTC date drift: NONE
```

## 14. Timesheet State

Royal Salon August 2026：

```text
AttendanceMonthlyTimesheet exists: NO
state: N/A (effective draft/unlocked state)
locked: NO
revision: N/A
PayrollAttendanceInputSnapshot for employee/month: NONE
```

Timesheet lock 或 Payroll snapshot 没有阻挡这笔 OT。结论：**NO TIMESHEET STATE BLOCKER**。

## 15. End-to-End Data Chain

| Link | ID / result | State |
|---|---|---|
| Roster publication revision | `ebce5625-415c-4a08-8ebd-ce8afefe902b`, r3 | PASS |
| Published roster assignment | `ce4d426d-3b11-45bb-9a59-73b1598c433a` | PASS |
| Expected Day | `0e4c8353-fc3d-4c75-be05-68f3d9e3a72b` | PASS |
| EmployeeAttendance | `7d046190-da51-4148-8f37-9cfb3869f6f6` | PASS / COMPLETED |
| Legacy AttendanceFinalResult | `1bfa5083-1cca-4179-abf9-60cfc3ce0dea` | PASS, but not consumed by OT service |
| AttendanceP2FinalResult | none | **MISSING — first broken link** |
| Potential OT candidate | read-only hypothetical = 15 min | BLOCKED by missing P2 source |
| AttendanceOvertimeReview | none | Expected; no candidate was persisted/reviewed |
| Manager queue item | none | NOT FOUND because candidate source is missing |

## 16. Root Cause

### Proven call-path mismatch

1. `src/lib/attendance/punch-service.ts:312-314` detects a completed Attendance and calls `materializeAttendanceResolutionFoundationInTransaction`.
2. That path creates/resolves the legacy `AttendanceResolutionCase` and legacy `AttendanceFinalResult`.
3. Clock Out does **not** call `materializeAttendanceP2Day` / `materializeAttendanceP2DayInTransaction`.
4. Direct call-site search shows P2 materialization is exposed through the Desktop Attendance P2 actions (`src/app/(business)/team/attendance/p2/actions.ts:41,52`) and monthly timesheet coverage preparation (`src/lib/attendance/timesheet-service.ts:471`), not the real-device Clock Out completion path.
5. `listAttendanceOvertimeCandidates` begins from `attendanceP2FinalResult.findMany` (`src/lib/attendance/overtime-service.ts:107-118`).
6. `getStaffOvertimeQueue` consumes that candidate list (`src/lib/staff-pwa/overtime-approvals.ts:110-125`).

因此，系统目前有两个 final-result contracts：

```text
Clock Out → legacy AttendanceFinalResult
OT Queue  → AttendanceP2FinalResult
```

它们之间缺少 automatic/idempotent bridge。没有 worker/job processing error，也没有 hidden validation error；P2 materialization 根本未被调用。

Root Cause Classification：

```text
ATTENDANCE_FINAL_RESULT_NOT_CREATED
OTHER: LEGACY/P2 FINAL-RESULT PIPELINE CONTRACT GAP
```

排除：

```text
ATTENDANCE_FINAL_RESULT_BLOCKED
EXPECTED_DAY_LINK_MISMATCH
ROSTER_REVISION_MISMATCH
ATTENDANCE_EXCEPTION_BLOCKER
OT_DERIVATION_BUG
OT_CANDIDATE_QUERY_BUG
MANAGER_QUEUE_FILTER_BUG
BRANCH_SCOPE_BUG
MONTH/TIMEZONE_FILTER_BUG
TIMESHEET_STATE_BLOCKER
```

## 17. Recommended Fix Scope

后续修复应保持小范围并使用 canonical P2 service：

1. 在 real-device Clock Out 成功完成 Attendance 后，增加可靠且 idempotent 的 P2 day materialization trigger；不要另写一套 OT 计算。
2. 明确 transaction/post-commit 语义，确保 raw Attendance、CURRENT Expected Day 与 approved Leave evidence 均已可见。
3. 保留现有 digest/version idempotency，避免重试 Clock Out 时重复 Final Result。
4. 增加 integration regression：真实 Clock In/Out → `AttendanceP2FinalResult(PRESENT)` → 15-minute candidate → EMP-005 Manager queue item。
5. 覆盖有 P2 exception 时“不创建 final candidate”、Timesheet locked 时 decision block、branch scope 与 self-review exclusions。
6. 修复完成后使用 canonical replay/materialization flow 处理这笔 Testing evidence；不要直接插入 P2 Final Result 或 OT Review。

本轮未执行上述修复，也未重放或修改真实 UAT evidence。

## 18. Final Verdict

```text
Final Verdict: DIAGNOSED
First Broken Link: Completed Attendance → AttendanceP2FinalResult
Root Cause: Clock Out finalizes only the legacy Attendance result; OT consumes only P2 final results.
Potential OT if P2 is produced: 15 minutes
Manager Scope: PASS
Timesheet Locked: NO
Timezone Alignment: PASS
Real Device OT UAT: STILL PENDING
Code Changed: NO
Business Data Changed: NO
Deployment: NO
Production Touched: NO
```
