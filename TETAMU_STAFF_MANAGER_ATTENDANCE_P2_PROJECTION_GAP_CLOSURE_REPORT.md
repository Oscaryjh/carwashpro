# TETAMU STAFF 3000 — MANAGER ATTENDANCE CORRECTION P2 PROJECTION GAP CLOSURE REPORT

范围：Staff 3000；LOCAL / Railway TESTING ONLY。完成日期：2026-09-01。

## 1. FINAL VERDICT

**READY.** `MANAGER_P2_PROJECTION_GAP` 已关闭：员工提交的 canonical P2 missing-punch correction 现在会进入既有 Manager Attendance queue 与 Approval Center Attendance count，并由既有 P2 resolution service 决策。没有建立第二套 workflow、route、table 或 migration。

## 2. GAP BEFORE

原 manager projection 只聚合 `AttendanceResolutionCase` 与 standalone `AttendanceException`。`AttendanceCorrectionRequest` 虽已通过 Timesheet/P2 canonical flow durable 存在，却不会显示在 `/staff/requests/attendance-corrections`，导致父级 Attendance count 和真实待审批工作不完整。

## 3. CANONICAL P2 OWNERSHIP

Canonical chain 为：`AttendanceP2Exception`（missing clock in/out）→ `submitAttendanceCorrectionRequest` 建立 `AttendanceCorrectionRequest(PENDING)` 并把 exception 推进为 `PENDING_MANAGER` → `resolveAttendanceP2Exception` 建立 immutable `AttendanceP2Resolution` → request 映射为 `APPROVED/REJECTED` → 无剩余 blocker 时建立 immutable `AttendanceP2FinalResult`。Staff adapter 只做授权、投影与 source dispatch；写入仍由 canonical P2 service 拥有。

## 4. EXISTING MANAGER PROJECTION

既有 `loadStaffAttendanceTaskProjection` 已扩展为三源聚合：

- `RESOLUTION_CASE`
- `STANDALONE_EXCEPTION`
- `P2_CORRECTION_REQUEST`

同一个 projection 同时服务 child queue 与 Approval Center summary；没有新 projection stack。

## 5. P2 ACTIONABILITY

仅以下联合证据可进入 Pending：request `PENDING`；owning exception `PENDING_MANAGER`；`currentResolutionId = null`；exception type 为 `MISSING_CLOCK_IN` 或 `MISSING_CLOCK_OUT`；request/exception/business/membership linkage 一致；branch 在授权范围；employee membership 不是 actor membership。`APPROVED`、`REJECTED`、`CANCELLED` 或 resolved/stale rows 均排除。

## 6. P2 MANAGER ITEM CONTRACT

内部 DTO 带 request ID、exception ID/revision、work date、missing type、recorded/requested times、reason、employee membership/name/code、branch/timezone。UI 只显示员工、日期、分店、缺失类型、请求时间和原因；不会显示 P2、模型名、revision、digest 或 materialization。

## 7. APPROVAL CENTER COUNT

Attendance parent count 等于三源 actionability total 的和，并应用相同 tenant、branch、自审和 capability scope。集成测试明确断言 parent Attendance count 与 child queue total 相等。

## 8. CHILD QUEUE COUNT

`/staff/requests/attendance-corrections` 使用同一 `loadStaffAttendanceTaskProjection`，显示 `totalActionable`，不再分别分页后相加。三源先取有界候选、全局排序、再统一分页。

## 9. DEDUPLICATION

P2 query 以 `request.exception_id` 做 `COUNT(DISTINCT ...)` 与 `DISTINCT ON (...)`。linked request + exception 只产生一个 manager item；同日但不相关的 ResolutionCase/standalone issue 仍保持独立。

## 10. ORDERING

三源共同按 oldest actionable first 排序。P2 使用 canonical `AttendanceCorrectionRequest.createdAt`；ResolutionCase 使用 queue 的 `updatedAt`；standalone exception 使用 `createdAt`；同时间用 typed source identity 稳定排序。

## 11. BUSINESS / BRANCH SCOPE

查询与 action 都要求 exact `businessId`，P2 exception 的 `branchId` 必须在 `allowedBranchIds`，request/exception/membership tenant linkage 必须一致。Branch-limited manager 看不到另一 branch；cross-business fail closed。

## 12. SELF-REVIEW

Read path 以 `excludedMembershipId` 排除 actor membership；write adapter 与 canonical P2 service 都再次验证 membership-level identity。集成测试覆盖 queue 隐藏与直接 action 两层自审阻断。

## 13. CAPABILITY

继续使用现有 capability resolver：HR module entitlement + `MODIFY_ATTENDANCE_EMPLOYEES`（由 direct permission `ATTENDANCE_EMPLOYEE_MANAGE` 映射）。不依赖角色名称。撤销 capability 后，直接 action fail closed。

## 14. APPROVE

Approve 仅在员工提供所缺时间时可用，并通过 `resolveAttendanceP2Exception(type = CORRECTED)` 提交 request 中已存的 requested time。Staff 不接受客户端任意 correction time，也不直接改 Timesheet/Payroll。

## 15. REJECT

Reject 通过同一 canonical service 使用既有 missing-punch terminal resolution `EXCLUDED`。P2 service 的既有映射会把非 `CORRECTED` 的 terminal request 标记为 `REJECTED`；不新增 decision enum。

## 16. REJECTION REASON CONTRACT

**READY；无需 `P2_REJECTION_REASON_CONTRACT_REVIEW_REQUIRED`。** Canonical P2 resolution 对所有决定要求 reason 3–500 characters；manager form 对 Reject 保留 required/minLength/maxLength，最终 reason 写入 immutable resolution，并投影至 My History。

## 17. STALE / DOUBLE DECISION

Action 保留 request `PENDING`、exception `PENDING_MANAGER`、`currentResolutionId = null` 与 exact revision guard。canonical serializable transaction 再检查 revision；第二次决定会失败。集成测试覆盖 stale/double-decision。

## 18. LOCKED TIMESHEET GUARD

审计发现原 P2 resolution service 缺少 approved/locked monthly Timesheet guard。本次在 canonical service transaction 内补上 fail-closed guard：当该 work month 的 Timesheet 为 `APPROVED` 或 `LOCKED`，拒绝 review，并返回 manager-safe reopen guidance。不会为 Staff UI 绕过 finalized evidence。

## 19. EMPLOYEE ARCHIVE REGRESSION

`GET /api/employee-attendance/corrections` 与 `/staff/history/corrections` 未修改。真实 PostgreSQL lifecycle 验证 manager approve 后，既有 archive 自然显示 `APPROVED`；reject 同理来自 canonical request/resolution evidence。

## 20. TIMESHEET REGRESSION

Manager decision 仍产生 canonical resolution/final result；Staff adapter 不写 Timesheet。P2 focused lifecycle、A3 Timesheet tests 与 lock guard 通过。一个既有 P6B cross-midnight fixture 仍因 branch-ready blocker 假设失效而 FAIL；该测试与本次 diff 无关，未通过削弱 blocker 规则来刷绿。

## 21. PAYROLL REGRESSION

Payroll P5 Attendance integration 与 P6A OT approval integration PASS。P2 UI action不直接改 Payroll input；Payroll 继续只消费 canonical locked/final evidence。

## 22. APPROVAL CENTER REGRESSION

Approval Center Pending、permanent Requests manager entry、统一 domain count、Leave/Claims/OT 现有架构均保留。P2 只归属 `ATTENDANCE`，没有 P2 tab/domain。

## 23. MY HISTORY / P2 HISTORY STATUS

**READY — narrow read-model enrichment completed.** Immutable `AttendanceP2Resolution.createdById/reason/createdAt` 与 linked request reviewed status 足以证明 manager-owned decision。现有 My History reader 以 actor、business、branch、month/source scope 批量读取；没有 ApprovalHistory table 或 derived write model。

## 24. MOBILE 360

真实本地浏览器 `360 × 800`（runtime inner width 361）PASS：无横向 overflow；card width 325.83px；最小 action height 43.997px（约 44px）；scroll end 时最后 action 位于 fixed nav 上方约 44.5px。

## 25. MOBILE 390

真实本地浏览器 `390 × 844`（runtime inner width 391）PASS：无横向 overflow；card width 355.83px；约 44px touch targets；scroll end 时最后 action 位于 nav 上方约 45.5px。

## 26. MOBILE 412

真实本地浏览器 `412 × 915` PASS：无横向 overflow；card width 377.5px；约 44px touch targets；scroll end 时最后 action 位于 nav 上方约 45.4px。

## 27. SECURITY

PASS：normal staff route access 由既有 manager access resolver fail closed；branch scope、tenant scope、membership self-review、capability revoke、stale revision、double decision 均由 server-side read + write checks 覆盖；UI visibility 不是 authorization。

## 28. FILES CHANGED

- `src/lib/attendance/resolution-read-service.ts`
- `src/lib/staff-pwa/team-approvals.ts`
- `src/lib/attendance/p2-service.ts`
- `src/lib/staff-pwa/approval-history.ts`
- `src/app/staff/requests/attendance-corrections/page.tsx`
- `src/app/staff/requests/attendance-corrections/actions.ts`
- `tests/integration/staff-manager-p2-projection.test.ts`
- `tests/integration/attendance-resolution-workflow.test.ts`（只把过期的固定 session expiry 更新至 2030，使当前日期可执行既有测试）
- `tests/unit/staff-attendance-approval-consistency.test.ts`
- `tests/unit/staff-mobile-attendance-corrections.test.ts`
- 本报告

## 29. TEST RESULTS

- Focused P2/Approval/employee archive unit：50/50 PASS。
- New + canonical PostgreSQL P2 lifecycle：6/6 PASS。
- Existing Attendance Resolution workflow（fixture expiry 修复后）：5/5 PASS。
- Relevant integration batch：31 PASS；1 个既有 P6B branch-ready fixture FAIL，未触及 production source，详见 section 20。
- TypeScript：PASS。
- ESLint：0 errors；3 个仓库既有 warnings。
- `git diff --check`：PASS。
- Production build：PASS。

## 30. FULL UNIT STATUS

**PASS — 1357/1357。** 无 skipped、cancelled 或 failed tests。

## 31. INTEGRATION STATUS

**P2 closure lifecycle PASS on fully migrated local PostgreSQL (212 migrations).** 覆盖 submit → manager projection/count → approve/reject → Pending removal → immutable resolution/final result → employee archive；另覆盖 cancelled、branch isolation、self-review、capability revoke、double decision、approved Timesheet guard。Relevant regression 为 31 PASS / 1 known unrelated P6B fixture FAIL；没有以 mock array 代替 lifecycle proof。

## 32. NO DUPLICATE WORKFLOW

Confirmed：没有新的 manager state machine、P2 decision service、approval table、status model 或 write path。三源 projection，既有 source-specific canonical decision services。

## 33. NO NEW ROUTE

Confirmed：manager surface 仍为 `/staff/requests/attendance-corrections`，入口仍为 `/staff/approvals`。没有 `/staff/requests/p2-corrections` 或其他 manager route。

## 34. NO NEW MIGRATION

Confirmed：Prisma schema 与 `prisma/migrations` 无变化。**NO NEW MIGRATION.**

## 35. TESTING DEPLOYMENT

Commit: `cc85e91d392d21a7b1d9c49e10ef5d0537357991`  
Deployment ID: `dac26bb2-8ec1-4b7c-8615-3012d0f34b84`  
Status: **SUCCESS**  
Image digest: `sha256:b73d53e9be0549d54b2ea1e7c168214df3a0982027703aac506cfad2670a0e07`

Target：Railway `Tetamu-POS / testing / tetamu-staff-app`，Singapore replica `asia-southeast1-eqsg3a`。没有在 Railway Testing 制造 pending P2 fixture，也没有发送 OTP。

Post-deploy smoke：`/api/health` HTTP 200、`ok=true`、`database=ready`、`environment=testing`，release deployment ID 与本次 deployment 一致；`/staff/approvals`、`/staff/requests/attendance-corrections`、`/staff/history/corrections`、`/staff/timesheet` 均 HTTP 200，并在无 session 时继续 fail closed。Health 中 `commitSha` 仍为 Railway 既有静态 release variable `c75b5d31...`，不是 CLI upload 自动注入值；本次 source commit 由 clean worktree、Git commit 和 Railway deployment message `Staff P2 attendance projection (cc85e91)` 三方记录。

## 36. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

Stop rule honored：本轮停在 `MANAGER_P2_PROJECTION_GAP` closure；没有开始 Approval Center visual normalization、Pay V2 或 Profile V2。
