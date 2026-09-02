# TETAMU CLOCK OUT → ATTENDANCE P2 BRIDGE FIX

## 1. Executive Summary

Testing Staff App 的有效 `CLOCK_OUT` 现在会在旧 Attendance session 完成并持久化后，调用 canonical Attendance P2 materializer。现有的 legacy `AttendanceFinalResult` 保持不变；P2 只建立 canonical day result，现有 OT service 再从该结果推导 Potential OT。

本次修复已部署到 Railway **Testing / tetamu-staff-app**。对真实 Testing Attendance `7d046190-da51-4148-8f37-9cfb3869f6f6` 完成只读冲突预检后，仅执行一次 canonical replay。结果为一个 `PRESENT` P2 result、45 worked minutes，以及 Manager queue 中一笔 15-minute `PENDING_REVIEW` OT candidate。未审批 OT、未锁 Timesheet、未运行 Payroll、未触碰 Production。

## 2. Root Cause

Staff App punch flow 会完成 `EmployeeAttendance` 和 legacy `AttendanceFinalResult`，但 `CLOCK_OUT` 成功后没有进入 `materializeAttendanceP2DayInTransaction`。OT candidate service 只读取最新的 `AttendanceP2FinalResult`，因此已有完整真实 punches 仍无法出现在 Manager OT queue。

问题不是打卡、Roster 或 OT 公式错误，而是 legacy Clock Out contract 与 canonical P2 contract 之间缺少 materialization bridge。

## 3. Existing Clock Out Contract

- `performAttendancePunch` 继续负责 canonical punch state machine、idempotency、GPS/设备约束和 legacy finalization。
- `CLOCK_OUT` 成功后，`EmployeeAttendance.status = COMPLETED`。
- 真实 clock-in、clock-out、break 和 worked minutes 仍由原有 punch transaction 保存。
- 旧 `AttendanceFinalResult` 路径未删除、未替换、未重算。

## 4. New P2 Bridge

新增 `materializeAttendanceP2DayFromCompletedPunch`：

- 只接受 business、branch、membership 与 work date。
- 查找同 scope 下最新的 `CURRENT` Expected Day。
- 使用 Expected Day 的 business-scoped creator 作为受治理的 projection actor。
- 不复制 P2 公式，直接委派给现有 `materializeAttendanceP2DayInTransaction`。
- `performAttendancePunch` 只在 resulting status 为 `COMPLETED` 时调用它。

涉及文件：

- `src/lib/attendance/p2-service.ts`
- `src/lib/attendance/punch-service.ts`

## 5. Transaction Semantics

Punch transaction 先持久化有效 Clock Out、completed session 和 legacy final result。P2 bridge 随后在自己的 Serializable transaction 中执行。

这意味着：

- P2 成功不会改变已有 punch evidence。
- P2 失败不会回滚一个已经有效的 Clock Out。
- P2 失败会写结构化 server error，并尝试写入 `ATTENDANCE_P2_MATERIALIZATION_FAILED` audit event，其中只包含 business、membership、attendance session、work date 与安全的 error code。
- retry 可从相同 completed attendance evidence 再次 materialize。

## 6. Idempotency

- 首次成功 Clock Out 会触发 P2 materialization。
- 相同 Clock Out idempotency key 的 replay 会返回原 attendance result，并再次安全地尝试 P2 materialization。
- P2 result 由 business + membership + work date + version contract 管理；相同 source 不会创建重复的当前结果。
- 集成测试确认 replay 后 P2 result count 仍为 1。

结论：**PASS**。

## 7. Legacy Compatibility

Legacy `AttendanceFinalResult` 仍在原 transaction 中创建，原有 Attendance history、resolution foundation 和旧消费者保持兼容。此次没有删除 legacy model、没有切换旧查询、没有改变 payroll formula。

结论：**PRESERVED**。

## 8. P2 Result

真实 Testing replay 结果：

- Attendance ID: `7d046190-da51-4148-8f37-9cfb3869f6f6`
- P2 Final Result ID: `9320eecc-15d9-46fa-8efb-0c7ac8779bd7`
- Version: `1`
- Outcome: `PRESENT`
- Expected: 27 Aug 2026, 16:50–17:20 MYT
- Actual: 27 Aug 2026, 16:44:41–17:30:13 MYT
- Break: `0 min`
- Worked: `45 min`
- P2 exceptions: `0`

## 9. OT Projection

未直接创建 `AttendanceOvertimeReview`。现有 `listAttendanceOvertimeCandidates` 从 P2 result 与 Expected Day 推导：

- Employee: `UAT-PAYROLL-001`
- Work date: `27 Aug 2026`
- Context: `NORMAL`
- Potential OT: `15 min`
- Effective status: `PENDING_REVIEW`
- Persisted OT review rows: `0`

这保持了“candidate 先推导、Manager 再人工决定”的现有 contract。

## 10. Manager Queue

使用 EMP-005 的真实 Testing membership 与 Staff User 权限调用现有 `getStaffOvertimeQueue`：

- Manager employee code: `EMP-005`
- Role: `STAFF`
- Status: `active`
- Whole-business scope: `false`
- Allowed branch: `salon online` only
- August pending count: `1`
- Target queue item count: `1`
- Target: `UAT-PAYROLL-001 / 27 Aug 2026 / 15 min`

结论：**FOUND**。没有执行 approve、adjust 或 reject。

## 11. Exception / Leave Safety

集成测试覆盖 approved full-day Leave 与 Attendance 同日的冲突：

- Clock Out 仍保持 `COMPLETED`。
- P2 生成一个 open `LEAVE_ATTENDANCE_CONFLICT` exception。
- 不生成 clean P2 final result。
- 不生成 OT candidate。

真实 replay 前也确认目标日期没有 Leave day、P2 exception、correction 或 resolution。

结论：**PASS**。

## 12. Timesheet Safety

- 真实 replay 前确认 August monthly Timesheet 不存在，因此没有 locked revision、legacy entry 或 P2 day snapshot 冲突。
- 目标 membership 没有 August `PayrollAttendanceInputSnapshot`。
- 现有 OT decision service 的 locked Timesheet guard 未改变。
- 本次没有 materialize Timesheet、没有锁定 Timesheet、没有生成 Payroll snapshot。

结论：**PASS**。

## 13. Tests

新增 realistic integration coverage：

1. Roster 16:50–17:20 MYT、Clock In 16:44:41、Clock Out 17:30:13、break 0，得到 worked 45、Potential OT 15。
2. Clock Out replay 不重复创建 P2 result。
3. 缺 Clock Out 时不产生 clean P2 result。
4. Approved full-day Leave conflict 不产生 clean P2 result 或 OT candidate。
5. Manager queue 能看到相同 branch scope 下的 15-minute candidate。

测试文件：`tests/integration/attendance-phase1c-services.test.ts`。

## 14. Regression

执行结果：

- Target Attendance integration: `5/5 PASS`
- Relevant Attendance/OT integration: `9/9 PASS`
- Relevant unit: `19/19 PASS`
- Main unit suite: `PASS`
- TypeScript `npx tsc --noEmit`: `PASS`
- Target ESLint: `PASS`
- Full ESLint `npm run lint -- --quiet`: `PASS`
- Production build: `PASS`
- `git diff --check` for bridge files: `PASS`

既有 branch scope、self-approval、timezone、locked Timesheet 和 OT decision regression 均保持绿色。

## 15. Testing Deployment

- Environment: `testing`
- Service: `tetamu-staff-app`
- Deployment ID: `85a2a023-f8df-4378-b575-3061dc8bdd56`
- Status: `SUCCESS`
- Region: Railway Asia Southeast
- Health endpoint: HTTP `200`, database ready
- Production deployment: **not touched**

部署来自隔离 worktree，只包含本 bridge 及其所依赖的现有 Manager OT surface；没有把当前 dirty worktree 的其他开发内容带入部署。

## 16. Real Replay

Replay 前只读检查：

- Attendance exact ID exists and is `COMPLETED`: PASS
- Clock In / Clock Out IDs and timestamps unchanged: PASS
- Worked 45 / Break 0: PASS
- Current WORKDAY Expected Day exists: PASS
- Business-scoped projection actor exists: PASS
- Leave conflict: none
- P2 final: none
- P2 exception/correction/resolution: none
- OT review: none
- Timesheet or payroll snapshot conflict: none

通过后，仅调用 `materializeAttendanceP2DayFromCompletedPunch`。没有直接写 P2/OT table。

Replay result: **SUCCESS**。

## 17. Queue Verification

Post-replay read-only verification：

- P2 result count: `1`
- Latest outcome: `PRESENT`
- Candidate count for target membership/month: `1`
- Potential OT: `15 min`
- Manager queue target count: `1`
- Manager waiting count: `1`
- Review row: none（等待人工动作）

## 18. Human Next Step

在 EMP-005 的 Android Testing Staff App 执行：

`Requests → Overtime review → UAT-PAYROLL-001 → 27 Aug 2026 → Approve full OT`

然后 Employee 可在 `/staff/timesheet` 查看最终结果。本报告不宣称 Real Device OT UAT 已通过，因为最后的 Manager/Employee mobile actions 尚未由人完成。

## 19. Final Verdict

**READY FOR HUMAN MANAGER OT APPROVAL**

Production Touched: **NO**

