# TETAMU LEAVE — 当前流程与优化交接文档

> 整理日期：2026-08-24
> 文档性质：根据当前 Tetamu 代码库整理的真实现状，不是未来构想。
> 用途：可直接交给 ChatGPT 分析并优化 Leave 的员工申请、HR 审批、余额、Roster、Attendance、Timesheet 与 Payroll 衔接。

## 1. 一句话说明

Tetamu Leave 目前已经具备以下主链：

```text
员工 Staff App 提交 Leave
→ 系统按请假开始日找出有效 Leave Policy
→ 读取已确认的工作日 / Roster
→ 计算请假天数并冻结 Policy、Pay Treatment 与 statutory facts
→ HR / Manager 审批
→ 扣减 canonical Leave entitlement buckets
→ Approved Leave 进入 Roster 与 Attendance
→ 月度 Timesheet 锁定时冻结 Leave snapshot
→ Payroll 只读取锁定的 Timesheet
→ Paid Leave / Unpaid Leave 进入工资计算
```

Leave Engine 已经包含 policy versioning、entitlement、carry forward、ledger、文件证据、两级审批、取消恢复、Timesheet freeze 与 Payroll integration。优化重点应放在流程、文案、入口、异常处理与跨模块下一步，不应重写底层 Leave Engine。

---

## 2. 当前完整业务流程

### 2.1 员工查看 Leave balance

入口：

```text
Staff App → Leave
Route: /staff/leave
```

员工目前可以查看每一种适用 Leave Policy 的：

- Entitlement
- Carry forward
- Used
- Pending
- Manual adjustments
- Remaining
- Expiry notices
- Paid / Unpaid
- Balance tracked / not tracked

`Pending` 会单独显示，不会在申请阶段直接变成实际扣减。真正扣减发生在最终批准时；并发审批也会重新检查余额，避免两笔申请同时超额使用。

主要代码证据：

- `src/app/staff/leave/page.tsx`
- `src/components/staff-pwa/staff-leave.tsx`
- `src/app/api/employee-leave/route.ts`
- `src/lib/leave/service.ts`
- `src/lib/leave/ledger-projection.ts`

---

### 2.2 员工申请 Leave

员工目前可以填写：

- Leave type
- From date
- To date
- Full day / Half day AM / Half day PM
- Reason
- Supporting document

附件支持：

- PDF
- JPG / JPEG
- PNG
- WEBP
- 单个文件最多 10 MB
- 一次最多 5 个文件

Supporting document 类型包括：

- Medical certificate
- Hospitalisation support
- Maternity support
- Paternity support
- General supporting document
- Other

提交时系统会：

1. 使用 `clientRequestId` 防止重复申请。
2. 确认员工仍处于有效 employment period。
3. 按 Leave 开始日找出有效 `LeavePolicyVersion`。
4. 检查 policy 是否已达到可申请状态。
5. 按 policy 判断是否必须上传证明。
6. 使用已确认的工作日 / Roster 建立逐日 `LeaveRequestDay` snapshot。
7. 按 `WEEKDAYS` 或 `CALENDAR_DAYS` 计算实际请假单位。
8. 检查是否与现有 `PENDING` 或 `APPROVED` Leave 重叠。
9. 检查 entitlement period 与员工可用余额。
10. 冻结 policy version、policy name、pay treatment、legal status、statutory classification、evidence requirement 与每日 schedule facts。
11. 创建状态为 `PENDING` 的 Leave request、`SUBMITTED` event 和 audit record。

当前申请 reason 是服务层必填，长度为 3–500 个字符。因此后续若决定取消普通申请的 reason，不能只隐藏 UI，必须同步调整 input validation、audit 策略与测试。

主要代码证据：

- `src/lib/leave/policy.ts`
- `src/lib/leave/service.ts` → `submitEmployeeLeave`
- `src/app/api/employee-leave/route.ts`
- `src/components/staff-pwa/staff-leave.tsx`

---

### 2.3 Leave 天数如何计算

#### WEEKDAYS

系统不会猜测星期一至星期五就是工作日，而是读取员工当日已经确认的 expected work schedule。

```text
Expected workday = 计入 Leave
Rest day / non-working day = 不计入 Leave
Public holiday = 按已确认日历与 schedule 事实处理
```

如果员工的工作安排尚未发布或确认，系统会阻止申请，避免错误扣除 Leave：

```text
Your work schedule for [date] is not ready yet.
Ask your manager to publish or confirm the Roster before submitting Leave.
```

#### CALENDAR_DAYS

从开始日至结束日的每个 calendar day 都会计入。

#### Half day

支持：

- `HALF_DAY_AM`
- `HALF_DAY_PM`

Payroll 后续可以把半天 Leave 与当天实际工作部分同时处理，不会把整天都当成 Leave。

主要代码证据：

- `src/lib/leave/service.ts` → `buildLeaveDaySnapshots`
- `src/lib/leave/policy.ts`
- `prisma/schema.prisma` → `LeaveCountMode`, `LeaveUnit`

---

### 2.4 员工提交后的操作

员工可以在 Staff App 查看：

- Leave type
- Dates
- Requested days
- Leave unit
- Status
- Employee reason
- Review note
- Cancellation reason
- Supporting documents

当前规则：

- `PENDING`：员工可以撤回。
- 撤回时目前必须填写原因。
- `PENDING`：员工可以增加、替换或移除 Supporting document。
- 员工不能直接修改已提交申请的日期、类型或 pay treatment。
- 如需修改核心内容，当前正确流程是撤回后重新申请。

所有 Leave documents 都是 private resource，不使用公开文件 URL。

主要代码证据：

- `src/components/staff-pwa/staff-leave.tsx`
- `src/app/api/employee-leave/route.ts`
- `src/lib/leave/document-service.ts`
- `src/lib/leave/service.ts` → `cancelEmployeeLeave`

---

### 2.5 后台 Leave Requests Inbox

主要入口：

```text
HR & Payroll → Leave
Route: /team/leave
```

待处理 Leave 也会进入统一审批中心：

```text
HR & Payroll → Actions / Approvals
Route: /team/approvals
```

有审批权限的 Owner / Manager 也可以在 Staff App 的 mobile approvals 审批：

```text
/staff/approvals/LEAVE/{requestId}
```

Leave 主页面目前已经分成三层，不把所有状态混在同一列表：

1. `Pending approval`
2. `Approved`
3. `Rejected & cancelled`

筛选条件包括：

- Employee
- Branch
- Leave type
- Covers date

每笔请求可以查看：

- Employee / employee code
- Branch
- Leave type
- From / To
- Requested units
- Full day / Half day
- Paid / Unpaid
- Balance before and projected after decision
- Evidence requirement
- Attached document count
- Employee note
- Private supporting documents

列表采用 compact row；只有展开后才显示详细资料与审批 action，适合同时处理多笔 Leave request。

主要代码证据：

- `src/app/(business)/team/leave/page.tsx`
- `src/app/(business)/team/leave/actions.ts`
- `src/lib/approvals/service.ts`
- `src/lib/staff-pwa/team-approvals.ts`
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`

---

### 2.6 HR / Manager 审批

审批结果：

```text
APPROVED
REJECTED
```

当前规则：

- 员工不能审批自己的 Leave。
- 拒绝时 review note / reason 必填。
- 批准时不会让审批人改变 Leave type 或 pay treatment。
- Required supporting documents 必须存在。
- 所有 required active documents 必须已被审核为 `VERIFIED`。
- 审批使用 expected revision，避免旧页面覆盖较新的决定。
- 最终批准前会重新检查 policy、overlap、balance 与 entitlement buckets。

如果启用了两级审批：

```text
Manager Level 1 审批
→ 记录 manager review
→ Request 仍等待 Owner
→ Business Owner Level 2 最终审批
→ 才扣减余额并正式变成 APPROVED
```

最终批准时系统会：

1. 重新锁定并检查 request revision。
2. 确认没有另一笔已批准的重叠 Leave。
3. 处理到期 carry-forward。
4. 按消费顺序分配 entitlement buckets。
5. 创建 immutable consumption allocations。
6. 写入 Leave decision digest 与 approval event。
7. 如员工已连接 Staff App，创建 / 更新 `StaffTimeOff`。
8. 记录 audit event。

主要代码证据：

- `src/lib/leave/service.ts` → `reviewLeaveRequest`
- `src/lib/leave/bucket-engine.ts`
- `src/lib/leave/entitlement-engine.ts`
- `src/lib/approvals/service.ts`

---

### 2.7 Approved Leave 的取消

后台可以在 `Approved` 列表展开：

```text
Cancel approved leave
```

当前 manager cancellation 需要 reason。

取消时系统会：

1. 只接受当前状态为 `APPROVED` 的 Leave。
2. 锁定 request，避免重复取消。
3. 按原 consumption allocation 恢复 entitlement buckets。
4. 确保每一笔 allocation 只恢复一次。
5. 移除相应 `StaffTimeOff`。
6. 把 request 状态改为 `CANCELLED`。
7. 写入 `CANCELLED` event 与 audit record。

重要边界：

- 如果原本使用的 carry-forward bucket 已正式过期，系统不会把过期单位重新变成可用余额。
- 如果该月 Timesheet 已锁定，取消 Leave 不会偷偷改写旧的 locked revision。
- 要让后续 Payroll 使用取消后的新事实，必须通过 Attendance 的 `Reopen` 创建新 Timesheet revision，再刷新对应 Payroll Draft。

这是 snapshot immutability 的保护，不是单纯的 UI bug；但当前 UX 应更清楚地告诉 HR 下一步。

主要代码证据：

- `src/lib/leave/service.ts` → `cancelApprovedLeaveRequest`
- `src/lib/leave/bucket-engine.ts`
- `src/lib/attendance/timesheet-service.ts`

---

## 3. Leave 与 Roster、Attendance、Timesheet、Payroll 的真实衔接

### 3.1 Roster

Approved Leave 会显示在：

- Team Roster
- Staff App Schedule / Roster
- Month / staff / coverage / day views

Approved full-day Leave 会阻止同一天再被排成正常上班 exception，避免员工同时显示为整天请假和整天上班。

`PENDING` Leave 不会改变 Roster；只有最终 `APPROVED` 的 Leave 才成为正式工作安排事实。

主要代码证据：

- `src/app/(business)/team/roster/page.tsx`
- `src/app/staff/roster/page.tsx`
- `src/lib/roster/service.ts` → `assertNoApprovedFullDayLeave`

---

### 3.2 Attendance

Approved Leave 会被 Attendance 分类为：

```text
APPROVED_PAID_LEAVE
APPROVED_UNPAID_LEAVE
```

如果员工在 Leave 当天仍有 Attendance facts，系统会产生：

```text
LEAVE_ATTENDANCE_CONFLICT
```

这类冲突必须先在 Attendance / Timesheet review 中解决，不能由 Payroll 猜测哪一边正确。

主要代码证据：

- `src/lib/attendance/p2-service.ts`
- `src/lib/attendance/p2-detection.ts`
- `src/lib/attendance/cross-midnight-segmentation.ts`

---

### 3.3 Monthly Timesheet freeze

Leave 不会让 Payroll 每次直接读取 live Leave tables。

月度 Timesheet 锁定时，会冻结：

- Leave request id
- Request revision
- Decision digest
- Policy id / version / name
- Pay treatment
- Leave unit
- Legal status
- Jurisdiction
- Statutory rule version / status
- Statutory category
- Eligibility
- Statutory pay requirement
- Compliance status

只有当时匹配并且已批准的 Leave 会进入 locked Timesheet revision。

员工的 Leave reason 与 private supporting documents 不会被复制进 Payroll snapshot。

主要代码证据：

- `src/lib/attendance/timesheet-service.ts`
- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/attendance-integration.ts`

---

### 3.4 Payroll

Payroll 只使用 locked Timesheet 中冻结的 Leave facts。

#### Monthly-paid employee

- `APPROVED_PAID_LEAVE`：已包含在 monthly base salary，不会再重复增加一笔 paid leave earning。
- `APPROVED_UNPAID_LEAVE`：进入 `UNPAID_ABSENCE_DEDUCTION`。
- Deduction 基础为：monthly salary ÷ configured working days × absence fraction。

#### Daily-paid employee

- Approved paid leave 可以形成 `PAID_LEAVE_PAY`。
- 计算为 approved paid leave days × daily rate。

#### Hourly-paid employee

- 当前 paid leave pay 尚未闭环。
- 系统会以 `HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY` 阻止错误计算，而不是猜测 hourly paid leave 单位。

#### Half day

- Leave 部分按 paid / unpaid leave 处理。
- 当天实际工作的另一部分仍可以保留为 regular work。

Payroll 可能出现的 Leave blockers：

- `APPROVED_LEAVE_EVIDENCE_INCOMPLETE`
- `LEAVE_PAY_TREATMENT_MISMATCH`
- `LEAVE_STATUTORY_RULE_NOT_ACTIVE`
- `MATERNITY_ALLOWANCE_REVIEW_REQUIRED`
- `PAYROLL_ABSENCE_RATE_POLICY_NOT_READY`
- `HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY`

这些 blocker 保护的是该次 Payroll calculation 的可审计性。后续 UI 应把 technical code 转成具体原因与 `Fix` action。

主要代码证据：

- `src/lib/payroll/attendance-integration.ts`
- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/calculation.ts`
- `src/lib/payroll/component-service.ts`

---

## 4. Leave balance、entitlement 与 carry forward

当前 canonical balance 不是简单直接改一个数字，而是由 immutable ledger 与 buckets 投影出来。

### Entitlement

支持：

- Calendar year
- Service anniversary
- Custom year
- Default entitlement
- Tenure tiers
- Employment eligibility
- Join / termination proration
- Calendar-day ratio
- Completed-month proration
- Half-day / whole-day rounding rules

### Carry forward

支持：

- Carry-forward enabled / disabled
- Maximum carried units
- No expiry
- Days after rollover
- Months after rollover
- Fixed date in destination period
- Earliest expiry first
- Oldest entitlement first
- Rollover lifecycle
- Expiry events
- Lapse events

### Manual adjustment

HR 不会直接覆盖余额；系统追加一笔有权限、有 reason、有 audit 的 immutable adjustment ledger event。

### Ledger event types

```text
ENTITLEMENT
CARRY_FORWARD
CARRY_FORWARD_LAPSE
MANUAL_ADJUSTMENT
APPROVED_CONSUMPTION
CANCELLATION_RESTORE
EXPIRY
```

主要代码证据：

- `src/lib/leave/entitlement-engine.ts`
- `src/lib/leave/bucket-engine.ts`
- `src/lib/leave/ledger-projection.ts`
- `src/lib/leave/service.ts`
- `prisma/schema.prisma`

---

## 5. Leave Policy 与 statutory rule

### Company Leave Policy

Policy revision 包含：

- Policy name
- Effective date
- Paid / Unpaid
- Weekdays / Calendar days
- Balance tracked
- Default entitlement
- Tenure tiers
- Required document
- Negative balance rule
- Entitlement period
- Proration and rounding
- Carry-forward rules
- Statutory category

Policy 是 effective-dated 与 versioned 的。新 revision 不会倒改历史 Leave request 的 frozen snapshot。

Starter policies：

```text
Annual leave (company policy)
Medical leave (company policy)
Unpaid leave
```

Starter policies 明确属于 company policy，不声称自己已经满足任何 Malaysia statutory minimum。

### Statutory Leave Rules

系统已有 statutory rule workflow：

```text
Draft rule
→ Evidence
→ Human review
→ Sign-off
→ Activation
```

当前有 source-backed Sabah candidate，但它只适用于精确匹配的 Sabah jurisdiction，不能作为全国 fallback，也不会自动启用。任何 legal rule 都必须经过 human sign-off 与 activation。

Policy readiness：

- `COMPANY_POLICY_ONLY`：可以申请。
- `VERIFIED_LEGAL`：可以申请。
- `LEGAL_RULE_NOT_READY`：阻止并要求完成 legal rule。
- `LEGACY_REVIEW_REQUIRED`：阻止并要求审查旧 policy。
- 没有 effective version：`LEAVE_POLICY_NOT_READY`。

主要代码证据：

- `src/lib/leave/policy.ts`
- `src/lib/leave/statutory-service.ts`
- `src/lib/leave/sabah-statutory-rule-pack.ts`
- `src/app/(business)/team/leave/actions.ts`

---

## 6. 当前状态机

### Leave request

```text
PENDING
├─→ APPROVED
├─→ REJECTED
└─→ CANCELLED（员工撤回）

APPROVED
└─→ CANCELLED（HR / Manager 取消已批准 Leave）
```

### Leave application events

```text
SUBMITTED
APPROVED
REJECTED
WITHDRAWN
CANCELLED
```

### Supporting document

```text
NOT_REVIEWED
├─→ VERIFIED
├─→ REJECTED
└─→ REVIEW_REQUIRED
```

Document lifecycle：

```text
ACTIVE
SUPERSEDED
REMOVED
```

### Entitlement bucket

```text
ACTIVE
├─→ EXHAUSTED
└─→ EXPIRED
```

---

## 7. 数据模型

主要 Prisma models：

- `LeavePolicy`
- `LeavePolicyVersion`
- `LeaveStatutoryRuleSet`
- `LeaveStatutorySource`
- `LeaveStatutoryRule`
- `LeaveStatutoryEntitlementTier`
- `EmployeeLeaveBalance`
- `LeaveRequest`
- `LeaveSupportingDocument`
- `LeaveRequestDay`
- `EmployeeLeaveEntitlement`
- `LeaveBalanceLedgerEntry`
- `LeaveEntitlementBucket`
- `LeavePeriodRollover`
- `LeaveConsumptionAllocation`
- `LeaveAllocationRestoration`
- `LeaveBucketExpiry`
- `LeaveApplicationEvent`

注意：`EmployeeLeaveBalance` 仍存在于 schema，但当前 canonical current balance 应以 ledger / entitlement buckets 的 projection 为准。后续优化或重构必须避免重新出现两套余额来源。

主要数据库证据：

- `prisma/schema.prisma`
- `prisma/migrations/`

---

## 8. 权限与角色

当前 Leave capabilities：

- `VIEW_LEAVE`
  - 查看授权 branch 内的 Leave balance、applications 和 history。
- `APPROVE_LEAVE`
  - Approve、Reject、Cancel approved Leave。
  - 不允许审批人改变 Leave type 或 pay treatment。
- `EDIT_LEAVE_POLICY`
  - 创建 effective-dated Leave Policy revisions。
- `ADJUST_LEAVE_BALANCE`
  - 追加 immutable balance adjustment。

依赖关系：

```text
APPROVE_LEAVE → VIEW_LEAVE
EDIT_LEAVE_POLICY → VIEW_LEAVE
ADJUST_LEAVE_BALANCE → VIEW_LEAVE
```

主要代码证据：

- `src/lib/auth/staff-permissions.ts`

---

## 9. Reports 与 export

入口：

```text
/team/leave/reports
```

现有 reports：

- Overview
- Current balances
- Approved usage
- Carry forward and expiry
- Manual adjustments
- Employee drilldown
- Evidence summary
- Upcoming approved Leave

支持 CSV export，并包含 CSV injection protection 与 export audit。

Pending request 会与 actual used / remaining 分开显示，不会假装已经扣除。

主要代码证据：

- `src/lib/leave/reporting-service.ts`
- `src/app/(business)/team/leave/reports/page.tsx`
- `src/app/(business)/team/leave/reports/export/route.ts`

---

## 10. 已有自动化测试

### Leave core

- `tests/integration/leave-management.test.ts`
- `tests/integration/leave-management-final-closure.test.ts`
- `tests/integration/leave-management-phase2c.test.ts`
- `tests/unit/leave-entitlement-engine.test.ts`
- `tests/unit/leave-management.test.ts`
- `tests/unit/leave-management-phase2b.test.ts`
- `tests/unit/leave-management-phase2e.test.ts`
- `tests/unit/leave-management-phase2f.test.ts`

覆盖：

- Entitlement / proration / rounding / employment eligibility。
- Policy 不猜测 statutory entitlement。
- Unpaid policy 不消耗 paid tracked balance。
- Rejection reason validation。
- Custom Leave types。
- Carry-forward、expiry、consumption priority、restoration。
- Approval consumes frozen balance。
- Cancellation restores exactly once。
- Concurrent approvals cannot overspend。
- Overlap protection。
- Policy treatment frozen at submission。
- Two-level approval。
- Supporting documents private authorization。
- Required evidence must be verified。
- Canonical ledger projection。
- Reports / CSV safety / export audit。
- Exact Sabah workplace classification only。

### Cross-module tests

- `tests/integration/roster-shift-scheduling-phase1.test.ts`
- `tests/integration/payroll-p5-attendance-integration.test.ts`
- `tests/unit/payroll-p5-attendance-integration.test.ts`
- `tests/integration/hr-payroll-mvp-pilot.test.ts`
- `tests/unit/payroll-calculation.test.ts`
- `tests/unit/payroll-p6a-overtime-approval.test.ts`
- `tests/unit/attendance-cross-midnight-segmentation.test.ts`
- `tests/unit/leave-request-inbox-ux.test.ts`

覆盖：

- Approved full-day Leave 与 Roster 冲突。
- Paid / Unpaid Leave frozen facts。
- Half-day Leave 与 partial work。
- Monthly unpaid Leave deduction。
- Daily paid Leave pay。
- Leave / Attendance conflict。
- Payroll 不直接重新读取 live Leave tables。
- Pending / Approved / Closed inbox 分层。

---

## 11. 已确认的当前缺口与风险

### 11.1 Hourly paid Leave 尚未完成

Hourly-paid employee 的 paid leave unit / rate policy 尚未闭环。系统当前 fail closed：

```text
HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY
```

这应列为真正产品缺口，而不是隐藏错误。

### 11.2 WEEKDAYS Leave 依赖已确认工作安排

如果 Roster / schedule 未发布，员工无法提交 WEEKDAYS Leave。这在计算上是正确的，但当前流程容易让员工只看到技术错误。

优化方向：

- 显示缺少哪一天的 schedule；
- 告诉员工联系谁；
- 给 HR 提供 `Open Roster`；
- 已有固定工作 pattern 时，评估是否可以预先生成 expected schedule。

### 11.3 Approved Leave 取消后的跨模块下一步不够明显

若 Timesheet 尚未锁定，取消后 current workflow 可以继续更新。

若 Timesheet 已锁定：

```text
Cancel approved Leave
→ Reopen monthly Timesheet
→ Review new revision
→ Lock Timesheet again
→ Refresh affected Payroll Draft
```

当前 UI 应把这条链直接显示出来，而不是让 HR 到 Payroll 才发现旧 snapshot 仍在。

### 11.4 Technical readiness code 对 HR 不友好

例如：

```text
LEAVE_POLICY_NOT_READY
LEAVE_STATUTORY_RULE_NOT_ACTIVE
APPROVED_LEAVE_EVIDENCE_INCOMPLETE
```

底层 code 应保留在 Activity / Audit Log；一般页面应显示：

- 发生什么；
- 为什么；
- 哪一笔员工 / policy / month 受影响；
- 下一步去哪里修复；
- `Fix` button。

### 11.5 Reason 字段仍是底层强规则

当前以下动作要求 reason / note：

- 员工申请 Leave；
- 员工撤回 pending Leave；
- HR 拒绝 Leave；
- HR 取消 approved Leave；
- Manual balance adjustment；
- Policy revision。

如果产品要减少 reason，必须逐个动作决定：

- 完全取消；
- 只在 rejection / cancellation / manual adjustment 时保留；
- 改成 optional；
- 由系统自动产生 structured audit reason。

不能只删除 input 后继续让服务层 validation 失败。

### 11.6 Supporting document review 安全但操作较重

Required evidence 必须逐份 verified 才能最终批准。这保护了 Medical / Statutory Leave，但大量审批时可能很慢。

可优化为：

- inline preview；
- `Verify all valid documents`；
- 清楚显示缺失 / rejected / unreviewed；
- 只在 policy 真正 requires evidence 时展开证据区。

### 11.7 Employee 不能直接修正已提交请求

当前只能 withdraw + resubmit。这样审计清楚，但员工改错一个日期也要重做。

如果未来开放 edit，必须创建新 revision 或 amendment event，不能覆盖原始申请。

### 11.8 Legacy balance model 可能造成误读

Schema 仍有 `EmployeeLeaveBalance`，同时已有 canonical ledger 和 buckets。任何新 UI、report 或 API 都必须继续以 ledger projection 为 authoritative balance，避免两套余额不一致。

### 11.9 Statutory workflow 对一般 HR 较复杂

Company policy 与 verified legal rule 是两条不同语义：

- Company policy 可以正常运行，但不代表 statutory verified。
- Legal candidate 不能未经 review / sign-off 就自动启用。
- Sabah candidate 不能应用到其他州。

优化必须简化页面说明，但不能删除 jurisdiction、evidence、sign-off 和 activation 边界。

### 11.10 Cancelled approved Leave 的过期 bucket 恢复规则需解释

如果原 carry-forward 已过期，取消 Leave 不会复活已经失效的单位。这是正确的 canonical rule，但 UI 应在确认取消前显示预计恢复多少、多少因 expiry 不会恢复。

---

## 12. 建议给 ChatGPT 的优化任务

请基于以上“当前已经存在”的能力优化 Tetamu Leave，不要重写 Leave Engine。

### 优化目标

1. 员工 Staff App 申请流程最多 3 步：
   ```text
   选择 Leave type 与日期
   → 确认系统计算的工作日 / 天数并上传必要证明
   → Review & submit
   ```
2. 申请前即时告诉员工：
   - 当前余额；
   - pending units；
   - 本次将使用多少；
   - 批准后预计剩余；
   - 哪些日期不计入；
   - 是否必须上传证明。
3. HR Leave Inbox 保留三层：
   ```text
   Pending approval
   Approved
   Rejected & cancelled
   ```
4. 大量请求时使用 compact list/table、filters、count、pagination；只有展开当前 row 才显示 evidence 与 actions。
5. Supporting document 使用 modal preview，并提供批量 verify 与明确的 evidence state。
6. 批准前清楚显示：
   - Balance before；
   - Units requested；
   - Balance after approval；
   - Bucket / carry-forward expiry impact；
   - Paid / Unpaid；
   - Roster / Attendance conflicts。
7. Cancel approved Leave 时，在确认卡片中显示：
   - 将恢复多少 balance；
   - 是否有 expired units 不会恢复；
   - Timesheet 是否已 locked；
   - 是否需要 Reopen Timesheet 与 Refresh Payroll Draft。
8. 所有 technical readiness error 转成业务语言，并给明确 `Fix` button。
9. Leave Policy Settings 区分：
   - Company leave policy；
   - Legal verification status；
   - Entitlement / carry-forward；
   - Evidence requirement；
   - Payroll treatment。
10. 保留 Activity / Audit Log 作为技术与治理记录，不把版本号、digest、technical codes 塞进普通成功提示。

### 必须保留的系统约束

- Effective-dated policy revision 不可被覆盖。
- 已提交 Leave 的 frozen snapshot 不可被后续 policy 倒改。
- Payroll 只能读取 locked Timesheet，不能直接读取 live Leave tables。
- Locked Timesheet revision 不得被隐式重写。
- 两级审批开启时，Level 1 不得提前扣减最终余额。
- Employee 不能审批自己的 Leave。
- Required private documents 必须保持 tenant / employee / reviewer authorization。
- Approved balance consumption 与 cancellation restoration 必须幂等。
- Concurrent approvals 不得超额使用 balance。
- Expired carry-forward 不得因取消 Leave 而被错误复活。
- Exact statutory jurisdiction 不可使用 nationwide guessing。
- Pending units 与 actual used balance 必须分开。
- Manual adjustment 必须保留 immutable audit event。

### 请 ChatGPT 输出

1. 优化后的 end-to-end Leave flow。
2. Employee Staff App IA、步骤、文案与 validation states。
3. HR Leave Inbox IA、tabs、filters、compact row 与 detail drawer。
4. Approval / evidence / cancellation UX。
5. Leave Policy、entitlement、carry-forward settings IA。
6. Roster / Attendance / Timesheet / Payroll cross-module handoff。
7. Error / empty / success / locked states。
8. Mobile 与 desktop layouts。
9. 不改变现有 engine 的分阶段实施计划。
10. Hourly paid Leave、locked Timesheet amendment 与 legacy balance source 的技术收尾清单。

---

## 13. 最终流程摘要

```text
EMPLOYEE
Staff App /staff/leave
→ View balance and policy
→ Select leave type, dates and unit
→ System reads confirmed work schedule
→ Upload required private documents
→ Submit
→ LeaveRequest: PENDING

HR / MANAGER
/team/leave, /team/approvals or mobile approvals
→ Review employee, dates, balance and evidence
→ Optional Level 1 manager review
→ Final Owner approval / rejection
├─ REJECTED → closed history
└─ APPROVED
   → consume canonical entitlement buckets
   → create decision digest and audit events
   → publish approved time-off fact

ROSTER & ATTENDANCE
APPROVED Leave
→ visible in Roster / Staff Schedule
→ paid or unpaid Leave classification
→ detect Leave-Attendance conflicts

MONTHLY TIMESHEET
Approved Leave facts
→ review Attendance
→ lock monthly Timesheet
→ freeze policy, pay and statutory snapshot

PAYROLL
Locked Timesheet only
├─ Monthly paid + paid leave → included in base salary, no duplicate earning
├─ Monthly paid + unpaid leave → unpaid absence deduction
├─ Daily paid + paid leave → paid leave pay
├─ Half day → leave fraction + worked fraction
└─ Hourly paid leave → CURRENT GAP: policy not ready

CANCELLATION
Approved Leave cancelled
→ restore valid entitlement allocations exactly once
→ expired carry-forward stays expired
→ if Timesheet already locked:
   Reopen Timesheet → lock new revision → refresh Payroll Draft
```
