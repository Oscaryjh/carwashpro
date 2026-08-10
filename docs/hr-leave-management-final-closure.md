# TETAMU HR — Leave Management Final Closure

> **Environment boundary:** LOCAL / TESTING ONLY
>
> **Production:** PRODUCTION NOT ACCESSED · PRODUCTION NOT VALIDATED

## A. Objective

本阶段收口以下唯一业务链：

```text
Employee chooses Leave Type
→ frozen policy / eligibility / treatment / balance facts
→ Manager approves or rejects
→ Attendance consumes approved Leave day snapshots
→ Final Attendance
→ Locked Timesheet
→ Payroll P5
```

永久规则是员工选择 Leave Type；经理只能审批、拒绝或按正式流程取消，不能在审批时更换 Leave Type，也不能自由选择 Paid / Unpaid。没有 Leave Application 的缺勤不会被 Leave domain 自动转换为 Unpaid Leave。

## B. Existing Leave Audit

| 审计项 | 状态 | 收口结论 |
| --- | --- | --- |
| Leave Type / Policy | READY | Business-scoped type、active 状态、effective version、paid treatment、balance/document/negative-balance policy 已表达。 |
| System / statutory types | PARTIAL | domain 可表达；未验证的 Malaysia legal rule 必须保持 `LEAVE_LEGAL_RULE_NOT_READY`。 |
| Business custom types / Emergency Leave | READY | 作为明确 company benefit 建立；不会冒充 statutory minimum。 |
| Employee entitlement | READY | Employee + policy version + join fact + leave year 的 deterministic snapshot。 |
| Leave year | READY | 当前 canonical cycle 为 calendar year；entitlement 与 ledger 使用同一 year boundary。 |
| Balance / source of truth | READY | balance = immutable ledger events sum；UI 不是 source of truth。 |
| Carry forward | PARTIAL | ledger event 可表达显式 carry forward；自动上限、到期和消费顺序尚未定义，标记 `CARRY_FORWARD_POLICY_NOT_READY`。 |
| Accrual / proration | PARTIAL | frozen policy 可提供 tenure values；未引入未定义的月度 accrual 或法定 proration engine。 |
| Manual adjustment | READY | 独立 permission、signed units、reason、actor、timestamp 和 immutable ledger。 |
| Leave application | READY | employee/business/branch/type/date/unit/reason/status/revision/idempotency 与 frozen facts 完整。 |
| Full day / multi-day | READY | 每日 snapshot deterministic 展开。 |
| Half day | READY | `HALF_DAY_AM` / `HALF_DAY_PM` 以 0.5 unit 贯穿 balance/day snapshot。 |
| Hourly Leave | NOT APPLICABLE | `HOURLY_LEAVE — NOT SUPPORTED`，本阶段没有扩大 scope。 |
| Supporting document | PARTIAL | bounded reference、policy requirement、tenant-owned request 已支持；完整安全文档仓库不在本阶段。 |
| Approval / rejection | READY | frozen treatment approval、mandatory rejection reason、revision 与 transaction guard。 |
| Withdrawal / cancellation | READY | Staff 可撤回 pending；approved Leave 由授权经理带原因取消，不 hard delete。 |
| Paid / unpaid | READY | 来自 frozen Leave policy / eligibility / balance contract，不是 manager choice。 |
| Attendance linkage | READY | Attendance 读取 approved day snapshot；Leave + Punch 继续产生 conflict。 |
| Timesheet linkage | READY | Final Attendance 才进入 Timesheet；locked period 阻止静默 Leave 变更。 |
| Payroll linkage | READY | Payroll P5 只消费 Locked Timesheet，不直接读取或写入 Leave。 |
| Staff App | READY | own balance、apply、pending、withdraw、history、decision/cancellation result。 |
| Manager UI | READY | `/team/leave` inbox、filters、balance projection、approve/reject/cancel、policy/ledger controls。 |
| Employee Profile | READY | 使用同一 version/entitlement/ledger read model，不独立重算。 |
| Permissions | READY | Leave view/approve/policy/balance permissions 与 Attendance/Payroll 分离。 |
| Tenant / branch scope | READY | trusted business/branch scope、composite ownership constraints 与 DB guards。 |
| Audit / concurrency / idempotency | READY | application events、audit、optimistic revision、serializable transaction、advisory lock 与 unique source key。 |
| Notifications | NOT APPLICABLE | 保留现有通知边界；未开发新的 WhatsApp Leave campaign。 |
| Legacy Leave | LEGACY | 非 deterministic legacy policy/version 标记 `LEGACY_LEAVE_REVIEW_REQUIRED`；不自动改写历史。 |
| Calendar / advanced analytics | NOT APPLICABLE | 不是 closure blocker，留作未来产品阶段。 |

## C. Leave Types

`LeavePolicy` 区分 `BUSINESS_CUSTOM`、verified legal origin 与 legacy origin，并保存 code、name、active、pay treatment、count mode、balance tracked、document requirement、negative-balance policy 和 business scope。Custom paid Leave 明确是 Company Policy，不等同 statutory minimum。没有强制每个 business 拥有相同类型，也没有无限扩张 enum。

## D. Policy Versioning

`LeavePolicyVersion` 是 effective-dated、revisioned、不可变记录。新政策只能新增 revision；旧 application 保存 version ID 及 name/legal/pay/balance snapshots。后续政策变化不会重算历史 consumed units、Attendance treatment 或 Timesheet facts。已使用 policy/version 受 delete/immutability DB guard 保护。

## E. Entitlement

`EmployeeLeaveEntitlement` 冻结 business、employee membership、policy、policy version、leave-year range、units、来源与 digest。计算只使用 frozen company policy 中已提供的 tenure values；未验证的 Malaysia statutory entitlement、hospitalisation、maternity、paternity、PH replacement 等不会被 hardcode。未知法律规则 fail closed 为 `LEAVE_LEGAL_RULE_NOT_READY`。

## F. Balance Ledger

`LeaveBalanceLedgerEntry` 为 append-only source of truth，覆盖 entitlement、approved consumption、cancellation restore、manual adjustment，并预留 accrual/carry-forward/expiry 等事件类型。余额始终通过同一 employee/policy/year ledger 求和。人工调整需要专用 permission、signed units、reason、actor 和 audit，禁止直接覆盖 remaining balance。

## G. Application

`LeaveRequest` 保存 business、branch、membership、employee-selected policy、period、unit、reason、document reference、status、revision、client request ID、policy/treatment/balance/legal snapshots 与 digest。`LeaveRequestDay` 冻结 date、AM/PM/full unit、expected-attendance evidence、pay treatment 和 consumption。Staff 直接 submit，不另外引入 Draft；关键事实提交后不能原地编辑，需撤回/取消旧申请后重新提交。

## H. Employee Ownership

Employee API 从 trusted Staff session 取得 membership/business，不接受调用方指定其他 employee。查询、申请与 pending withdrawal 都严格 own-scoped；guessed request ID 仍需 business/membership 双重匹配。不同 Business membership 的历史和余额不会自动迁移。

## I. Approval

经理仅能对授权 business/branch employee 执行 `APPROVED` 或 `REJECTED`。拒绝必须有原因；employee self-approve、submitter-as-approver、unauthorized branch 与 stale revision 均 fail closed。审批在 serializable transaction 中锁定 employee/policy/year key，并重新验证 overlap 与精确 ledger balance。重复相同 decision 是 idempotent，不重复消费。

## J. Paid / Unpaid Treatment

系统在申请时冻结 `payTreatmentSnapshot`，来源是 employee 选择的 Leave Type 及其有效 policy/eligibility/balance/legal status。审批 mutation 没有 treatment/type override 字段。Attendance 和后续层只消费 snapshot。`UNAUTHORIZED_ABSENCE` 与 approved Unpaid Leave 是不同 domain outcome；No Punch 不会创建 Unpaid Leave。

## K. Cancellation

Pending application 可由 employee 带原因撤回。Approved Leave 只能由有权限经理带 mandatory reason 和 expected revision 正式取消；application、day snapshot 与 event history 全部保留。取消会移除派生的 current StaffTimeOff source，但不会删除 Leave history。Locked Timesheet 覆盖的日期由 DB trigger 阻止静默取消，必须先走 Attendance/Timesheet reopen workflow。

## L. Balance Restore

Approved consumption 使用 `leave-approval:<requestId>` stable source；取消回补使用 `leave-cancel-restore:<requestId>` stable source。unique source key 加 transaction/revision guard 保证 retry 只恢复一次，不会由 10 天错误变成 12 天。

## M. Overlap / Concurrency

同一 employee/date 的 pending/approved overlap 在 submit 与 approve 两阶段检测，并有 DB overlap trigger。Full Day 与 AM/PM 冲突规则明确；AM 与 PM 可共存，Full Day 与任一 partial unit 冲突。审批使用 serializable transaction、optimistic revision、advisory key lock 和最新 ledger sum，默认禁止 silent negative balance；只有 frozen policy 明确允许时才可例外。

## N. Partial Day

支持 `FULL_DAY`、`HALF_DAY_AM`、`HALF_DAY_PM`。Half day 仅允许单日并冻结为 0.5 consumption；day snapshot 将 unit 传给 Attendance/Timesheet contract。Hourly Leave 明确不支持。

## O. Public Holiday / Rest Day

`WEEKDAYS` policy 只使用 Attendance P2 的 current `AttendanceExpectedDay` evidence；`WORKDAY` 才计入，Rest Day、Public Holiday 与 Not Scheduled 不扣 balance。没有 evidence 时返回 `LEAVE_EXPECTED_ATTENDANCE_NOT_READY`，不会用 calendar subtraction 猜测。多日 application 的 daily breakdown 在提交时冻结。

## P. Attendance Integration

Attendance 读取 approved `LeaveRequestDay` 的 application ID、date/unit、policy version、approval revision 与 `payTreatmentSnapshot`，产生 `APPROVED_PAID_LEAVE` 或 `APPROVED_UNPAID_LEAVE`。它不会 live-read current Leave policy。Approved Leave 与 Punch 同时存在时保留 Attendance P2 conflict；没有 approved Leave 的 No Attendance 仍是 attendance blocker/outcome，不进入 Leave ledger。

## Q. Timesheet Integration

Leave 不直接写 Timesheet。正确边界是 Leave snapshot → Attendance final result → monthly Timesheet。Timesheet approval/lock 冻结 final result；locked period 的 Leave cancellation由数据库拒绝，必须 reopen 后产生新 Attendance/Timesheet revision，旧 revision 继续不可变。

## R. Payroll Boundary

Payroll P5 只消费 Locked Timesheet materialisation，不直接读取 Leave reason、policy 或 balance，也不会在 Unpaid Leave approval时立即插入 deduction。Finalized Payroll 不被历史 Leave correction改写；后续 correction 必须沿 Leave → Attendance revision → Timesheet revision → Payroll proposed delta/P4C 路径处理。

## S. Employee Self-Service

`/staff/leave` 显示 canonical entitlement、used、pending、available 与 own application history。员工选择 ready Leave type、date/period、Full/AM/PM、reason 和必要 evidence；可撤回 pending，能看到 rejected reason 或 cancellation reason。真实 Local mock-OTP browser QA 已完成 login → apply → pending → manager decision → cancelled/history/restore，console error 与 hydration error 为 0。

## T. Manager Approval UX

`/team/leave` 提供 employee、branch、status、Leave type、date filters。每项显示 requested type、date/unit、reason、attachment indicator、frozen PAID/UNPAID、current balance、pending approval后的 projected balance和 Attendance impact。经理没有更改 Leave Type 或 pay treatment 的控制；可审批、带原因拒绝、带原因取消 approved Leave。policy revision 与 manual ledger adjustment 是分离并受独立权限保护的操作。

## U. Permissions

Leave capability 分为 `VIEW_LEAVE`、`APPROVE_LEAVE`、`EDIT_LEAVE_POLICY`、`ADJUST_LEAVE_BALANCE`；Staff own Leave 使用 employee session ownership。Leave 权限不由 `MODIFY_ATTENDANCE_EMPLOYEES` 或 Payroll 权限隐式取得。Group Manager 默认只有 view，不因 group role 自动获得跨 business approval/policy/adjust 权限。

## V. Tenant Isolation

所有 service write 绑定 trusted business/allowed branch scope。application、membership、branch、policy、version、entitlement、ledger 与 day snapshot 通过 composite tenant ownership / FK / trigger 校验，防止跨 business、branch 或 membership 引用。Employee API 自身 ownership 与 manager branch scope 均在 service 层重新验证。

## W. Audit / Historical Safety

Policy revision、entitlement、manual adjustment、submit、withdraw、approve、reject、cancel、consumption 与 restore 都保留 actor/time/reason/source key 或 application event，并写入现有 audit channel。Policy version 和 ledger DB trigger 阻止 update/delete；approved/rejected/cancelled history不 hard delete。Legacy data不作 speculative rewrite，缺少 deterministic provenance 的记录标记 `LEGACY_LEAVE_REVIEW_REQUIRED`。

## X. Tests / Build / Migration

全部命令仅针对 Local/Testing：

- Full unit regression after all current workspace changes: **736/736 PASS**。
- Full integration regression after all current workspace changes: **105/105 PASS**。
- Latest targeted Leave/unit permission/profile regression: **19/19 PASS**。
- Latest Leave integration: **5/5 PASS**，覆盖 consume/restore once、duplicate submit/cancel、immutable records、concurrent approval、overlap 与 frozen treatment。
- Latest Attendance P2 + Monthly Timesheet + Payroll P5 regression: **7/7 PASS**。
- Authenticated browser E2E: an employee with `attendanceEnabled=false` used the generic self-service mock OTP flow, submitted `HALF_DAY_AM`, saw Pending, Manager approved the frozen paid treatment, Manager cancelled with a reason, and Staff saw the restored balance: **PASS**；visible/hydration errors **0**。
- Browser DB/UI evidence: request `CANCELLED`, revision 2, events `SUBMITTED → APPROVED → CANCELLED`; the current lifecycle applied `-0.5 approval` and `+0.5 restore`, final balance 3.0。
- TypeScript: **PASS**。
- Lint: **PASS**；仅保留既有 WhatsApp `<img>` warning。
- Local production-mode Next build: **PASS**, 107 routes；仅有既有 WhatsApp warning 与 Attendance/global CSS autoprefixer warnings，Leave 页面无 build warning。
- Prisma validate: **PASS**。
- Prisma generate: **PASS**（关闭 Local dev process 释放 Windows Prisma engine lock 后重跑）。
- Prisma migration status: **147 migrations, database up to date**。
- Fresh Local full migration rebuild: **147/147 PASS**。
- Canonical guard 与 `git diff --check`: **PASS**。

第一次未显式设置 `DATABASE_URL` 的 targeted integration probe 被 Local-only safety gate拒绝；明确注入 localhost database 后重跑通过。这是预期的 Production 防护，不是产品测试失败。

## Y. Remaining Blockers

以下均被安全地阻断或延期，不污染 ready company-policy workflow：

- `LEAVE_LEGAL_RULE_NOT_READY`：Malaysia statutory Leave dataset/artifact 尚未完成独立验证；系统不 hardcode 法定天数。
- `LEGACY_LEAVE_REVIEW_REQUIRED`：缺少 frozen provenance 的 legacy policy/record 需人工 review。
- `CARRY_FORWARD_POLICY_NOT_READY`：自动 carry-forward cap、expiry 和 consumption order 尚未定义。
- 自动 monthly accrual、复杂 statutory proration、完整 attachment repository、Leave calendar/advanced analytics/notifications 属未来独立产品 scope。
- Termination 与 already-approved future Leave 的专用 HR review queue 尚未扩建；系统不会因此 silent delete history。
- Production 数据、variables、deployment 与 live integration 未验证且明确 out of scope。

这些 gap 不会 fallback 到猜测或 silent financial mutation；对应路径 fail closed。本轮没有进入或修改既有 Claims，也没有进入 Commission、PCB、Statutory Activation、Payroll Payment、Public Bank、POS Core 或新 Attendance phase。

## Z. Final Status

完成条件已满足：employee-selected type、frozen treatment、deterministic company entitlement、ledger source of truth、concurrency-safe/idempotent approval、overlap protection、exactly-once cancellation restore、Attendance/Timesheet/Payroll immutable boundary、Staff/Manager UI、permission/tenant/audit 与 Local test/build/migration gates均已验证。

```text
LEAVE MANAGEMENT — READY
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

本阶段在 Leave Management closure 停止；不会自动进入 Claims。
