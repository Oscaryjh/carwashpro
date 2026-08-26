# Tetamu HR & Payroll 当前系统功能与业务逻辑

> 整理日期：2026-08-25
> 文档性质：Current State / As-Is，根据当前 Tetamu 代码库、数据库模型、页面路由、服务与测试整理。
> 使用方式：可直接交给 ChatGPT，作为后续产品分析、流程优化、UI/UX 重构或测试规划的系统背景。
> 重要边界：本文描述“系统目前具备什么能力与约束”，不代表每个 Business 已经完成资料配置，也不代表 EPF、PERKESO、LHDN、银行等外部机构已经认证或接受任何结果。

---

## 1. 系统一句话说明

Tetamu HR & Payroll 是一套以员工资料为中心、以版本与冻结快照保证历史一致性的 Workforce 系统。它目前覆盖：

```text
Employee
→ Roster / Leave / Attendance
→ Monthly Timesheet
→ Claims / Commission / Variable Pay
→ Payroll Draft
→ Statutory & Tax Calculation
→ Readiness Checks
→ Review / Finalize
→ Frozen Payroll & Statutory Snapshots
→ Payslip / Salary Payment / Statutory Submission
```

系统的核心原则是：

- 可变化的员工资料使用 effective-dated version；
- Payroll 不直接依赖仍会变化的 live records，而依赖 locked Timesheet 和 frozen source snapshot；
- Payroll 的金额由 canonical component lines 汇总，不应直接手改 aggregate totals；
- Finalized、Published、Submitted 等历史记录不可被普通编辑静默改写；
- 高风险操作有 capability、scope、maker-checker、audit 与部分 step-up 基础设施；
- UI 可以简化，但不能绕过底层版本、审核、冻结、审计和 reconciliation。

---

## 2. “已开发”不等于“当前可用”

判断一个功能能否用于真实 Payroll，需要区分四层：

| 层级 | 含义 | 例子 |
|---|---|---|
| Code available | 代码、模型与服务已存在 | PCB calculator、Leave entitlement engine |
| Module enabled | Business 已启用对应模块 | HR、PAYROLL、STATUTORY、CLAIMS、COMMISSION |
| Business configured | 公司与员工资料已填完整 | Salary、work rules、bank、TIN、EPF/SOCSO profile |
| Governance / source ready | 受控规则与输入已审核、激活、冻结 | Active statutory rule、locked Timesheet、approved OT |

因此：

- 有 PCB engine，不代表某个月的 PCB 已可正式计算；
- 有员工银行账号，不代表 Payment batch 已批准或银行已付款；
- Payroll Finalized，不代表 Payslip 已发布、工资已支付或 statutory file 已提交；
- Leave / Claim 已批准，不代表其 Payroll treatment 已完成；
- Staff App 页面存在，不代表该员工已建立可登录的 membership、手机号与模块 entitlement。

---

## 3. 模块架构与依赖

当前模块依赖来自 `src/lib/modules/registry.ts`：

```text
CORE
├─ COMMISSION
└─ HR
   ├─ CLAIMS
   └─ PAYROLL
      └─ STATUTORY
```

主要模块：

| 模块 | 主要职责 | 依赖 |
|---|---|---|
| HR | People、Attendance、Roster、Holidays、Leave、Approvals | 无 |
| CLAIMS | 员工费用申请、审批、报销、Payroll bridge | HR |
| COMMISSION | Commission rule、calculation、approval、Payroll bridge | CORE |
| PAYROLL | Compensation、Timesheet input、工资计算、Payslip、Payment | HR |
| STATUTORY | EPF、SOCSO、EIS、LINDUNG 24、PCB、CP38、submission | PAYROLL |

页面与操作还会受 capability 与 branch / business scope 限制；仅启用模块不会自动赋予所有用户管理权限。

---

## 4. HR & Payroll 主导航

主导航定义于：

- `src/app/(business)/team/layout.tsx`
- `src/components/hr-payroll-workspace-nav.tsx`

当前入口：

| 导航 | Route | 用途 |
|---|---|---|
| People | `/team` | 员工目录、员工 360 Profile、Staff App access |
| Action Center | `/team/approvals` | 跨模块待处理事项与审批 |
| Attendance | `/team/attendance` | 打卡、异常、修正、OT、Timesheet |
| Roster | `/team/roster` | 排班、模板、发布与员工 schedule |
| Holidays | `/team/holidays` | Public holiday calendar |
| Leave | `/team/leave` | Leave request、policy、balance、reports |
| Claims | `/team/claims` | Claims approval、receipt、reimbursement、category policy |
| Commission | `/team/commission` | Commission rules、period、statement 与 Payroll link |
| Payroll | `/team/payroll` | Payroll setup、runs、payments、statutory 与 settings |
| Team activity | `/team?section=activity` | 团队活动与审计可见性 |

Payroll 子导航：

| 导航 | Route |
|---|---|
| Overview | `/team/payroll` |
| Workspace | `/team/payroll/workspace` |
| Payroll runs | `/team/payroll/runs` |
| Payments | `/team/payroll/payments` |
| Statutory | `/team/payroll/statutory` |
| Settings | `/team/payroll/settings` |

---

## 5. Employee 360 Profile

### 5.1 信息架构

当前员工页面已从许多平行 tabs 合并为五个工作区，定义于 `src/lib/team/employee-profile-tabs.ts`：

| Tab | 内容 |
|---|---|
| Overview | 联系资料、生日、employment summary、今日状态、需要处理事项 |
| Work | Branch、workplace、services、position、role、level、appointments |
| Time & Leave | Attendance、Roster / Schedule、Timesheet、Leave balance 与 records |
| Compensation | Salary、monthly additions/deductions、Commission、Claims、Bank、Statutory & Tax |
| Access | Staff App、POS / login access、permissions、devices |

旧的 `attendance`、`leave`、`claims`、`commission`、`payroll`、`statutory` query section 会映射至新结构，避免旧链接立即失效。

### 5.2 当前可管理的员工资料

- 员工姓名、employee code、电话、生日、email；
- employment type、joined / termination date、active status；
- branch assignments、primary branch；
- services 与 appointment availability；
- staff role、staff level 与 capability；
- pay basis、base rate、currency、effective month；
- monthly additions / deductions；
- employee work target override；
- bank account version；
- statutory participation、identity、TIN、PCB profile；
- Staff App membership、device 与 access 状态。

### 5.3 编辑限制

- 只有具备相应 capability 的 Business user 才能看见或执行编辑；
- Profile 中的编辑按钮可能因 module 未启用、scope 不符或对象不是 canonical employee record 而隐藏；
- 已形成 Attendance identity history 的电话不是普通字段，不能直接无痕替换；
- Compensation、bank、statutory 等敏感变更走专属 command/service，不应由通用员工表单直接覆盖；
- 删除有历史记录的测试员工可能受 referential / audit 约束，应优先 deactivate 或使用受控测试资料清理流程。

### 5.4 主要代码

- `src/app/(business)/team/page.tsx`
- `src/app/(business)/team/actions.ts`
- `src/app/(business)/team/people/[personId]/page.tsx`
- `src/components/employee-profile-360.tsx`
- `src/lib/team/employee-profile-read.ts`
- `src/lib/team/employee-profile-*-read.ts`
- `src/app/(business)/team/configuration-actions.ts`

---

## 6. Action Center / Approvals

### 6.1 用途

Action Center 是 HR 的统一工作队列，不负责重新实现每个模块的业务规则。它通过 projector 把各模块待处理事项汇总，再将用户带回 canonical domain workflow 完成动作。

当前投影范围包括：

- Attendance exception / resolution；
- Attendance P2 correction；
- Overtime review；
- Monthly Timesheet approval / lock；
- Leave request；
- Claim review；
- Commission review；
- Payroll review / approval。

### 6.2 两种处理方式

- Quick action：安全且条件明确的简单动作可在 inbox 完成；
- Domain delegation：复杂事项进入原模块 detail page，避免 Approval Center 复制业务逻辑。

### 6.3 审批逻辑

Leave 与 Claims 支持：

- `ONE_LEVEL`：单层审批；
- `TWO_LEVEL_ALWAYS`：固定两层；
- `TWO_LEVEL_THRESHOLD`：达到金额或条件后进入第二层；
- Owner / Manager actor level；
- branch 与 tenant scope；
- self-approval 限制；
- stale state / concurrency guard；
- 审批 decision 与 audit trail。

### 6.4 主要代码

- `src/app/(business)/team/approvals/page.tsx`
- `src/app/(business)/team/approvals/settings/page.tsx`
- `src/lib/approvals/service.ts`
- `src/lib/approvals/policy-service.ts`
- `src/app/staff/approvals/page.tsx`
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`

---

## 7. Attendance

### 7.1 员工端

Staff App 可执行：

```text
Clock in
→ Break start
→ Break end
→ Clock out
```

系统根据现有 session state 决定下一步允许的动作，不依赖前端自行猜测。

员工还可查看 attendance history、monthly timesheet，并提交 exception / correction request。

### 7.2 打卡验证

Attendance punch 会处理：

- employee session 与 membership；
- business / branch scope；
- punch state machine；
- geofence 与 distance evidence；
- device / request context；
- idempotency；
- write rate limit；
- cross-midnight work segmentation；
- duration 与 break calculation。

### 7.3 异常与修正

异常处理不是直接改掉原始 Punch。系统保留：

- raw punch；
- Attendance exception；
- resolution case 与 event；
- manager adjustment；
- final result；
- P2 expected-day materialisation；
- correction request；
- audit trail。

### 7.4 OT

OT minutes 本身不等于可支付 OT。Payroll 依赖：

- 已完成 attendance facts；
- OT review 已批准或调整；
- 可用的 multiplier / work-pay policy；
- 当前 locked Timesheet revision。

OT review 状态：

```text
PENDING_REVIEW
→ APPROVED / REJECTED / ADJUSTED / NOT_APPLICABLE
```

### 7.5 Monthly Timesheet

Timesheet 是 Attendance 与 Payroll 的 canonical bridge：

```text
DRAFT
→ Branch ready
→ APPROVED
→ LOCKED
```

锁定后 Payroll 才能稳定读取。若要修改已锁定月份：

```text
LOCKED revision N
→ Begin controlled revision
→ New DRAFT revision N+1
→ Review / approve / lock again
```

旧 revision 保留，不被新 revision 改写。

### 7.6 主要代码

- `src/app/(business)/team/attendance/`
- `src/lib/attendance/punch-service.ts`
- `src/lib/attendance/state-machine.ts`
- `src/lib/attendance/geofence.ts`
- `src/lib/attendance/management-service.ts`
- `src/lib/attendance/resolution-workflow-service.ts`
- `src/lib/attendance/p2-service.ts`
- `src/lib/attendance/overtime-service.ts`
- `src/lib/attendance/timesheet-service.ts`
- `src/lib/attendance/cross-midnight-segmentation.ts`

---

## 8. Roster

### 8.1 当前功能

- Week / Month / Staff / Grid / Shift views；
- shift template；
- employee default schedule versions；
- working day / rest day；
- quick assign；
- custom shift；
- bulk assignment；
- copy previous schedule；
- branch filter；
- draft validation；
- weekly / monthly publish；
- published assignment snapshot；
- employee Staff App schedule。

### 8.2 核心逻辑

Roster assignment 在 Draft 中可编辑；Publish 后系统建立 publication snapshot，员工端只读取已发布 schedule，不把 manager 的未发布草稿提前展示给员工。

Roster 还会参考：

- employee branch assignment；
- employment period；
- default work schedule；
- approved Leave；
- public holiday；
- locked Timesheet boundary。

如果目标月份 Timesheet 已锁定，不能直接发布或改写会影响该月份 attendance source 的 roster；必须先走 Monthly Timesheet 的 controlled revision。

### 8.3 状态

```text
RosterPeriod: DRAFT → PUBLISHED
```

### 8.4 主要代码

- `src/app/(business)/team/roster/page.tsx`
- `src/app/(business)/team/roster/actions.ts`
- `src/app/(business)/team/roster/roster-views.tsx`
- `src/app/(business)/team/roster/templates/page.tsx`
- `src/app/(business)/team/roster/employee-schedules/page.tsx`
- `src/lib/roster/service.ts`
- `src/lib/roster/shift-template-service.ts`
- `src/lib/roster/employee-schedule-service.ts`

---

## 9. Public Holidays

### 9.1 当前功能

- Malaysia official calendar import；
- business / branch holiday；
- state / jurisdiction identification；
- create、revise、cancel；
- year / month calendar navigation；
- holiday name、date、source 与 effective record。

### 9.2 跨模块作用

Holiday 会影响：

- Roster calendar；
- Attendance expected day；
- Timesheet day classification；
- Payroll public-holiday work / OT calculation。

Holiday calendar 本身不会自动决定最终 pay multiplier；Payroll 仍使用 Business 的 work-pay settings 与 frozen day facts。

### 9.3 主要代码

- `src/app/(business)/team/holidays/page.tsx`
- `src/lib/holidays/service.ts`
- `src/lib/holidays/malaysia-official-calendar.ts`
- `src/lib/holidays/domain.ts`

---

## 10. Leave

### 10.1 员工申请流程

```text
Staff App 查看 Leave balance / policy
→ 选择 leave type、日期、full/half day
→ 按 policy 上传 supporting document
→ 系统检查 entitlement、overlap、policy 与日期
→ Submit
→ Manager / HR approval
→ Approved Leave materialises into attendance/timesheet facts
```

员工可以取消仍允许取消的申请；已批准 Leave 的取消由 HR 走受控流程并恢复适用 balance allocation。

### 10.2 Policy 与 entitlement

公司 Leave Policy 支持：

- policy version 与 effective period；
- paid / unpaid；
- weekdays / calendar days；
- full day / half day；
- entitlement tiers；
- service month eligibility；
- proration；
- rounding；
- carry forward 与 expiry；
- supporting document requirement；
- concurrency / overlap rule。

Entitlement 不只是一个可修改数字。系统使用：

- employee entitlement；
- entitlement bucket；
- consumption allocation；
- balance ledger event；
- carry-forward allocation；
- cancellation restoration；
- expiry event。

### 10.3 Leave request 状态

```text
PENDING
→ APPROVED / REJECTED / CANCELLED
```

后台 UI 应按 Pending approval、Approved、Cancelled approved leave 分区，避免不同生命周期混在同一列表。

### 10.4 Leave 与 Payroll

Approved Leave 先成为 Attendance / Timesheet 的 frozen day facts，再进入 Payroll：

- Paid Leave：按 pay basis 与 policy形成 paid leave component；
- Unpaid Leave：形成 unpaid absence / leave deduction；
- Half day：按 day fraction 处理；
- Hourly paid leave 仍可能受未完成 policy blocker 限制；
- 已 finalized Payroll 不会因之后取消 Leave 自动重写。

### 10.5 Reports

当前有：

- overview；
- balance report；
- usage report；
- carry-forward report；
- adjustment report；
- employee drilldown；
- CSV export。

### 10.6 主要代码

- `src/app/(business)/team/leave/page.tsx`
- `src/app/(business)/team/leave/actions.ts`
- `src/app/(business)/team/leave/reports/`
- `src/lib/leave/service.ts`
- `src/lib/leave/policy.ts`
- `src/lib/leave/entitlement-engine.ts`
- `src/lib/leave/bucket-engine.ts`
- `src/lib/leave/ledger-projection.ts`
- `src/lib/leave/document-service.ts`
- `src/lib/leave/reporting-service.ts`

---

## 11. Claims

### 11.1 员工申请流程

```text
Staff App → My Claims
→ 选择 category
→ 填 expense date、amount、merchant / description
→ 按 category policy 上传 receipt
→ Submit Claim
```

系统会检查 category 当前有效 policy、金额上限、receipt / description requirement、日期、duplicate fingerprint 与 attachment policy。

### 11.2 后台审批

HR / Manager 可以：

- 过滤 employee 与 status；
- 查看 claim lines；
- 在 modal 中 preview receipt 或打开原文件；
- approve、partially approve、reject；
- cancel approved Claim；
- 依据 approval policy 进入一层或两层审批。

Claim 状态：

```text
DRAFT
→ SUBMITTED
→ PARTIALLY_APPROVED / APPROVED / REJECTED
→ WITHDRAWN / CANCELLED（按当前生命周期条件）
```

### 11.3 批准后的报销方式

审批与报销是两个阶段。Approved Claim 可选择：

#### A. Business reimbursement / Pay separately

```text
Approved Claim
→ Outside-payroll pending
→ HR 记录实际付款
→ Outside-payroll paid
```

#### B. Through payroll / Add to payroll

```text
Approved Claim
→ 选择含该员工 eligible entry 的 Draft Payroll
→ 建立 PayrollClaimReimbursementSnapshot
→ Payroll component 显示 reimbursement
→ Payroll finalized 后进入 settled state
```

### 11.4 Statutory treatment 边界

- Business reimbursement 不应增加 gross salary；
- Category treatment 未确认时，只暂停该笔 reimbursement；
- 员工正常 salary 仍可继续计算；
- 如果 Draft 没有该 employee entry，不能 link；
- 修正 category treatment 后必须 re-evaluate reimbursement；
- 旧 Claim 保留当时 policy revision，不被新 category policy 静默改写。

### 11.5 Reimbursement 状态

```text
AWAITING_CHANNEL
→ OUTSIDE_PAYROLL_PENDING → OUTSIDE_PAYROLL_PAID
→ PAYROLL_LINKED → PAYROLL_SETTLED
→ CANCELLED
```

Payroll bridge snapshot：

```text
BLOCKED_STATUTORY / READY / SETTLED / CANCELLED
```

### 11.6 主要代码

- `src/app/(business)/team/claims/page.tsx`
- `src/app/(business)/team/claims/actions.ts`
- `src/app/(business)/team/claims/claim-category-policy-form.tsx`
- `src/app/(business)/team/claims/claim-receipt-preview.tsx`
- `src/app/staff/claims/page.tsx`
- `src/lib/claim/service.ts`
- `src/lib/claim/reimbursement.ts`
- `src/lib/claim/presentation.ts`
- `src/lib/claim/attachment-policy.ts`
- `src/lib/claim/private-attachment-storage.ts`

---

## 12. Commission

### 12.1 Rule scope

Commission Engine 支持以当前 rule revision 处理：

- Services；
- Products；
- Packages；
- category-level rate；
- specific item rate；
- employee personal override；
- fixed amount / percentage / tiered calculation；
- discount allocation；
- attribution 与 source event。

员工 Profile 中的 personal rate 只覆盖该员工；Company Commission Settings 仍是默认来源。Specific items 应作为清晰列表展示，不应只显示笼统 category rate。

### 12.2 月度流程

```text
Eligible paid POS sales
→ Capture source events
→ Calculate Commission period
→ Build employee statements / accruals
→ Review
→ Approve and lock period
→ Link approved statements to Payroll
→ Create approved variable-pay source
```

### 12.3 调整与退款

- void / refund 会产生 reversal 或 adjustment；
- manual correction 使用受控 adjustment；
- 已锁定 statement 保留 source、rule revision 与 digest；
- 后续改 Commission rate 不会重算旧 statement；
- Payroll link 前须为 approved statement。

### 12.4 状态

```text
CommissionPeriod: OPEN → CALCULATED → LOCKED
CommissionAccrual: ACTIVE → REVERSED
```

### 12.5 主要代码

- `src/app/(business)/team/commission/page.tsx`
- `src/app/(business)/team/commission/actions.ts`
- `src/app/(business)/team/people/[personId]/commission-actions.ts`
- `src/app/staff/commission/page.tsx`
- `src/lib/commission/service.ts`
- `src/lib/commission/read.ts`
- `src/lib/commission/calculation.ts`

---

## 13. Employee Payroll Profile

### 13.1 Compensation

- Pay basis：Monthly / Daily / Hourly；
- Base rate；
- Currency；
- Effective payroll month；
- version history；
- Payroll 按月份解析适用版本。

每次修改建立 `EmployeeCompensationVersion`。旧 Payroll Entry 使用其已冻结版本，不读取今天的员工工资覆盖历史。

### 13.2 Monthly additions / deductions

底层为 recurring pay，目前 UI 使用较易理解的文案：

- Monthly additions；
- Monthly deductions；
- 例如 Transport allowance、Phone allowance；
- stable component code；
- amount、effective month、version、supersession。

Draft 生成时建立 recurring-pay snapshot。

### 13.3 Work rules

- Working days / month；
- Paid work / day；
- Expected break / day；
- Planned span / day。

员工 override 优先于 company default。它决定 payroll rate conversion 与 expected work target，但不应直接把 attendance 归类成 OT；OT 仍需实际 frozen facts 与 approval。

### 13.4 Bank account

- Bank / e-wallet bank directory；
- account holder；
- account number；
- active/effective version；
- encryption、last four digits、fingerprint；
- payment readiness。

缺银行账号影响 Payment，不应阻挡 Salary Calculation 或 Payroll Finalize。

### 13.5 主要代码

- `src/app/(business)/team/people/[personId]/payroll/actions.ts`
- `src/lib/payroll/employee-profile-write/`
- `src/lib/payroll/compensation-version.ts`
- `src/lib/payroll/recurring-pay.ts`
- `src/lib/payroll/payment/bank-account-service.ts`
- `src/lib/payroll/payment/bank-account-crypto.ts`

---

## 14. Payroll Settings

入口：`/team/payroll/settings`

当前公司级配置包括：

- Working days / month；
- Paid minutes / day；
- Break minutes；
- Normal OT multiplier；
- Rest-day work / OT multiplier；
- Public-holiday work / OT multiplier；
- Holiday pay policy；
- State / holiday label；
- branch public holiday dates。

生成 Payroll Draft 时会冻结 settings snapshot。公司之后改变设置，不会静默重写已存在 Draft；需要 refresh / regenerate Draft 才能使用新配置。

当前 ordinary work、OT、rest day 与 public holiday pay 以 Business 自行配置的 company work-pay policy 为 canonical source，不会因为系统内存在 Sabah candidate rule 就自动套用。

主要代码：

- `src/app/(business)/team/payroll/settings/page.tsx`
- `src/app/(business)/team/payroll/actions.ts`
- `src/lib/payroll/company-work-pay.ts`
- `src/lib/payroll/holiday-pay-policy.ts`

---

## 15. Payroll Draft 与计算引擎

### 15.1 生成 Draft

入口：`/team/payroll/runs`

生成某个月 Payroll Draft 时，系统会：

1. 确认月份与 canonical run；
2. 读取 current locked Timesheet revision；
3. 找出 employment period 内的员工；
4. 解析适用 Compensation version；
5. 解析员工 override 或公司 work target；
6. 建立 Attendance input snapshot；
7. materialise normal work、Leave、absence、OT、rest-day、holiday facts；
8. 加入 recurring pay；
9. 加入 approved variable pay、Commission、Corrections；
10. 加入符合条件的 Claims reimbursement；
11. 建立 canonical `PayrollEntryComponent` lines；
12. materialise statutory deductions；
13. 从 component lines 汇总 gross、deductions、reimbursements、net；
14. 执行 reconciliation 与 readiness；
15. 保存 source IDs、versions、digests 与 audit。

### 15.2 Pay basis

当前 calculation 支持：

- MONTHLY；
- DAILY；
- HOURLY。

已知限制：Monthly employee 的 mid-period proration 在未有获批准 policy 时会以 `MID_PERIOD_PRORATION_NOT_READY` 阻挡；不可假装自动计算正确。

### 15.3 Pay items

- Basic / regular pay；
- Paid Leave pay；
- Unpaid absence deduction；
- Normal OT；
- Rest-day work / OT；
- Public-holiday work / OT；
- Monthly additions；
- Monthly deductions；
- Variable pay；
- Commission；
- Correction / arrears / recovery；
- Claim reimbursement；
- EPF、SOCSO、EIS、LINDUNG 24、PCB、CP38。

### 15.4 Canonical totals

```text
Gross Pay
= ordinary earnings
+ approved variable earnings
+ eligible OT / work-pay earnings

Net Pay
= Gross Pay
- ordinary deductions
- employee statutory deductions
- PCB
- CP38
+ business reimbursements paid through payroll
```

Claims business reimbursement 不应增加 gross salary。

### 15.5 主要代码

- `src/lib/payroll/service.ts`
- `src/lib/payroll/calculation.ts`
- `src/lib/payroll/component-service.ts`
- `src/lib/payroll/component-calculation.ts`
- `src/lib/payroll/attendance-integration.ts`
- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/variable-pay.ts`

---

## 16. Payroll Readiness

Readiness 在 Draft 送审及 Review Finalize 前检查当前输入是否足以形成可信的正式 Payroll。

### 16.1 常见 blocking items

- Missing Compensation；
- unsupported mid-period proration；
- missing / stale locked Timesheet；
- incomplete Attendance facts；
- OT source not approved；
- component reconciliation failed；
- variable pay / correction source invalid；
- empty Payroll Run；
- incomplete statutory profile；
- active statutory rule unavailable；
- statutory classification unresolved；
- stale statutory profile / rule source；
- PCB profile / YTD / additional-pay allocation incomplete；
- CP38 instruction invalid；
- LINDUNG 24 participation incomplete。

### 16.2 非 Payroll Calculation blocker

- Missing bank account：影响 Payment readiness；
- Unverified bank account：按 feature / policy 影响 Payment；
- Claim category treatment unresolved：只 hold 该 reimbursement；
- Payslip 未发布：不改变 finalized Payroll totals；
- statutory file 未提交：不改变 finalized Payroll，但属于下游 compliance task。

### 16.3 UI 应表达的结构

```text
Payroll setup incomplete — N items
└─ Employee
   ├─ Plain-language reason
   ├─ Affected step
   ├─ Fix action / route
   └─ Whether Draft refresh is required
```

主要代码：

- `src/lib/payroll/readiness.ts`
- `src/lib/payroll/workspace.ts`
- `src/app/(business)/team/payroll/runs/[runId]/page.tsx`

---

## 17. Payroll Run Workflow

### 17.1 状态

```text
DRAFT
→ REVIEW
→ FINALIZED
```

允许的主要 transition：

```text
DRAFT → Submit for Review → REVIEW
REVIEW → Return to Draft → DRAFT
REVIEW → Finalize → FINALIZED
FINALIZED → Reopen → DRAFT（仅在没有不可变 downstream record 时）
```

### 17.2 Submit for Review

系统会确认：

- run 非空；
- locked Timesheet source 仍是 current；
- blocking readiness 已解决；
- component reconciliation 成功；
- statutory entries 不再需要处理；
- holiday / work-pay decision 完成。

### 17.3 Finalize

Finalize 会再次检查 readiness 和 source freshness，并冻结正式记录。Finalize 不会自动：

- 发布 Payslip；
- 汇款；
- 提交 statutory files；
- 代表官方 portal 已接受。

### 17.4 Reopen

若已存在 Published Payslip、approved payment artifact 或 statutory submission / export 等不可变 downstream record，不能普通 reopen；应走 correction / revision workflow。

### 17.5 主要代码

- `src/lib/payroll/workflow.ts`
- `src/lib/payroll/service.ts`
- `src/app/(business)/team/payroll/actions.ts`

---

## 18. Statutory & Tax

### 18.1 当前 Scheme

- EPF / KWSP；
- SOCSO / PERKESO；
- EIS / SIP；
- LINDUNG 24；
- PCB / MTD；
- CP38。

### 18.2 Employee statutory profile

可记录：

- nationality / residency facts；
- EPF、SOCSO、EIS participation；
- SOCSO coverage category；
- identity number；
- TIN；
- EPF / KWSP member number；
- SOCSO / PERKESO member number；
- LINDUNG 24 participation evidence；
- PCB tax profile；
- TP1 declarations；
- TP3 previous-employer facts；
- current-year YTD ledger；
- CP38 instruction。

填写 member number 不等于 participation switch、nationality、SOCSO category 和 rule activation 已完成。显示 `Not enrolled` 或 `Not configured` 时，应分别检查 profile 与 scheme setting，而不是只看 ID number。

### 18.3 Rule governance

Statutory rule 的受控流程：

```text
Official Evidence
→ Engineering / calculation verification
→ HR human review
→ Approval / sign-off
→ Payroll use / activation
→ Retirement / replacement
```

只有 effective date 覆盖 Payroll month 且 active 的 exact rule revision 才能用于正式 materialisation。

### 18.4 PCB / MTD 当前能力

现有代码包括：

- 2026 PCB calculator；
- normal remuneration；
- additional remuneration；
- pay-item tax classification；
- marital / spouse / children / disability facts；
- zakat；
- TP1 relief declarations；
- TP3 previous-employer remuneration、PCB、EPF；
- current-year YTD remuneration 与 PCB ledger；
- EPF allocation used by PCB；
- non-resident handling；
- CP38；
- five-sen rounding；
- minimum / rule boundaries；
- calculation breakdown与 frozen snapshot；
- CP39 export layout；
- rule version、evidence、review 与 software verification framework。

但“Calculator code exists”不等于“正式可用”。具体 Payroll month 仍需满足 active rule、employee profile、YTD、pay-item treatment、software/governance verification 与 source freshness。

### 18.5 Frozen statutory snapshot

每个 Payroll Entry 会记录 scheme-level frozen result，包括：

- rule / ruleset version；
- employee profile revision；
- tax profile revision；
- inputs；
- employee / employer amount；
- status / blocker；
- source digest。

这些 snapshot 保证以后修改员工 profile 或 statutory rule 时，不会改变已 finalised 的历史 Payroll。

### 18.6 主要代码

- `src/lib/payroll/statutory.ts`
- `src/lib/payroll/statutory-p2.ts`
- `src/lib/payroll/statutory-p2c.ts`
- `src/lib/payroll/statutory-governance-service.ts`
- `src/lib/payroll/statutory-activation-service.ts`
- `src/lib/payroll/statutory-evidence-pack.ts`
- `src/lib/payroll/pcb-2026.ts`
- `src/lib/payroll/pcb-profile.ts`
- `src/lib/payroll/pcb-declarations.ts`
- `src/lib/payroll/pcb-tax-year-ledger.ts`
- `src/lib/payroll/cp38-instruction.ts`
- `src/lib/payroll/lindung24-participation-service.ts`
- `src/app/admin/statutory/`

---

## 19. Payslip

流程：

```text
FINALIZED Payroll
→ Build frozen PDF bytes
→ Store digest and publication record
→ HR publishes Payslips
→ Employee Staff App sees published Payslip
```

Preview 与 Publish 是两件事。员工只应看到已明确发布的 frozen Payslip；之后修改员工姓名、公司资料、salary 或 bank，不应改变旧 PDF。

主要代码：

- `src/lib/payroll/payslip-publication.ts`
- `src/lib/payroll/documents.ts`
- `src/lib/payroll/export.ts`
- `src/app/(business)/team/payroll/payslips/[entryId]/route.ts`
- `src/app/staff/payslips/page.tsx`

---

## 20. Salary Payment

### 20.1 流程

```text
FINALIZED Payroll
→ Evaluate bank readiness
→ Create Payment Batch
→ Resolve blocked instructions
→ Submit for approval
→ Approve batch
→ Create payment instruction / artifact
```

### 20.2 Payment Batch 状态

```text
DRAFT
→ AWAITING_APPROVAL
→ APPROVED
→ INSTRUCTION_READY

Alternative: CANCELLED / SUPERSEDED
```

### 20.3 常见 blocker

- missing / inactive / not-effective bank account；
- verification required by current feature policy；
- zero or negative net pay；
- duplicate payment allocation；
- business mismatch。

Batch creator 与 approver 分离。`INSTRUCTION_READY` 表示内部 instruction 或 bank file 已准备，不应显示为 `Paid`，除非已有真实 provider / bank confirmation。

主要代码：

- `src/app/(business)/team/payroll/payments/page.tsx`
- `src/app/(business)/team/payroll/payments/actions.ts`
- `src/lib/payroll/payment/`

---

## 21. Statutory Export 与 Submission Tracking

Finalized Payroll 可建立：

- KWSP / EPF submission file；
- PERKESO combined SOCSO + EIS file；
- LHDN CP39 file。

流程：

```text
FINALIZED Payroll
→ Validate business and employee identities
→ Build official-format file
→ Encrypt/store artifact and hash
→ Download / external portal validation
→ Mark Submitted
→ Mark Accepted or Rejected
→ Rejected: controlled correction revision
```

状态：

```text
DRAFT → EXPORTED → SUBMITTED → ACCEPTED
                              └→ REJECTED
```

`File ready`、`Submitted`、`Accepted` 与 `Paid` 必须分开。系统生成文件不代表政府 portal 已接受。

主要代码：

- `src/app/(business)/team/payroll/statutory/page.tsx`
- `src/app/(business)/team/payroll/statutory/actions.ts`
- `src/lib/payroll/statutory-submission.ts`
- `src/lib/payroll/statutory-artifact.ts`
- `src/lib/payroll/statutory-artifact-crypto.ts`

---

## 22. Staff App / Employee Self-Service

### 22.1 当前入口

Staff navigation 定义于 `src/lib/staff-pwa/navigation.ts`：

| 功能 | Route |
|---|---|
| Home | `/staff` |
| Attendance history / clock | `/staff/history` |
| Leave | `/staff/leave` |
| Timesheet | `/staff/timesheet` |
| My Schedule | `/staff/roster` |
| My Claims | `/staff/claims` |
| My Commission | `/staff/commission` |
| My Payslips | `/staff/payslips` |
| My Profile | `/staff/profile` |
| Mobile Approvals | `/staff/approvals` |

实际显示哪些入口取决于 employee membership 的 module access。

### 22.2 OTP 与 session

Staff App 使用手机号 OTP 登录，provider 配置支持：

- local / mock；
- Twilio Verify；
- SMS123。

核心逻辑：

```text
Phone input
→ Normalize E.164 / find eligible employee membership
→ Create OTP challenge
→ Provider sends OTP
→ Verify OTP hash / provider result
→ Select membership when multiple workplaces exist
→ Bind device and create employee session
```

安全能力包括：

- hashed identifier / OTP / session token；
- expiry；
- resend / verification rate limit；
- same-origin request protection；
- device binding / revocation；
- business membership selection；
- session cookie；
- generic response to reduce account enumeration。

Staff App 无法登录不应只按“页面存在”判断；还需检查 provider credentials、deployment environment、phone normalization、employee membership、duplicate/ambiguous membership、provider delivery log 与 rate limit。

### 22.3 主要代码

- `src/app/staff/`
- `src/app/api/employee-auth/`
- `src/lib/attendance/employee-auth/config.ts`
- `src/lib/attendance/employee-auth/otp-service.ts`
- `src/lib/attendance/employee-auth/membership.ts`
- `src/lib/attendance/employee-auth/session.ts`
- `src/lib/attendance/employee-auth/device-service.ts`

---

## 23. 核心状态总表

| Domain | 状态 / 流程 |
|---|---|
| Attendance exception | PENDING → APPROVED / REJECTED / CANCELLED |
| Attendance resolution | OPEN → UNDER_REVIEW → RETURNED / RESOLVED / SUPERSEDED |
| Overtime | PENDING_REVIEW → APPROVED / REJECTED / ADJUSTED / NOT_APPLICABLE |
| Monthly Timesheet | DRAFT → APPROVED → LOCKED → controlled new revision |
| Roster Period | DRAFT → PUBLISHED |
| Leave Request | PENDING → APPROVED / REJECTED / CANCELLED |
| Claim | DRAFT → SUBMITTED → PARTIALLY_APPROVED / APPROVED / REJECTED / WITHDRAWN / CANCELLED |
| Claim Reimbursement | AWAITING_CHANNEL → OUTSIDE_PAYROLL_PENDING / PAYROLL_LINKED → PAID / SETTLED |
| Commission Period | OPEN → CALCULATED → LOCKED |
| Variable Pay / Correction | DRAFT → APPROVED → APPLIED / CANCELLED |
| Payroll Run | DRAFT → REVIEW → FINALIZED |
| Payslip | Not published → Published frozen PDF |
| Payment Batch | DRAFT → AWAITING_APPROVAL → APPROVED → INSTRUCTION_READY |
| Statutory Rule | Draft / verified / reviewed / signed off → ACTIVE → RETIRED |
| Statutory Submission | DRAFT → EXPORTED → SUBMITTED → ACCEPTED / REJECTED |

---

## 24. 核心数据模型

以下是当前 schema 中与 HR & Payroll 直接相关的主要 model 群组；不是完整字段清单。

### People / Access

- `StaffRoleProfile`
- `StaffLevel`
- `EmployeeAccount`
- `EmployeeBusinessMembership`
- `EmployeeBranchAssignment`
- `EmployeeDevice`
- `EmployeeSession`
- `EmployeeOtpChallenge`

### Attendance / Timesheet

- `EmployeeAttendance`
- `AttendancePunch`
- `AttendanceException`
- `AttendanceAdjustment`
- `AttendanceResolutionCase`
- `AttendanceFinalResult`
- `AttendanceExpectedDay`
- overtime review/event models
- `AttendanceMonthlyTimesheet`
- `AttendanceTimesheetRevision`
- `AttendanceTimesheetRevisionEntry`
- branch readiness and source snapshot models

### Roster / Holiday

- `RosterShiftTemplate`
- `EmployeeRosterScheduleVersion`
- `RosterPeriod`
- `RosterAssignment`
- `RosterPublication`
- `RosterPublishedAssignment`
- holiday / calendar records

### Leave

- `LeavePolicy`
- `LeavePolicyVersion`
- `LeaveRequest`
- `LeaveRequestDay`
- `LeaveSupportingDocument`
- `EmployeeLeaveEntitlement`
- `EmployeeLeaveBalance`
- `LeaveBalanceLedgerEntry`
- `LeaveEntitlementBucket`
- carry-forward / consumption / restoration / expiry models
- statutory leave rule-set models

### Claims

- `ClaimCategory`
- `ClaimPolicyRevision`
- `EmployeeClaim`
- `ClaimLine`
- `ClaimAttachment`
- `ClaimReimbursement`
- `PayrollClaimReimbursementSnapshot`
- `ClaimEvent`
- `HrApprovalPolicy`
- `HrApprovalDecision`

### Commission

- `CommissionRule`
- `CommissionRuleRevision`
- `CommissionSourceEvent`
- `CommissionPeriod`
- `CommissionStatement`
- `CommissionAccrual`
- `CommissionAdjustment`

### Payroll / Statutory / Payment

- `EmployeeCompensationVersion`
- `EmployeeRecurringPayComponent`
- recurring-pay version / snapshot models
- `PayrollSetting`
- `PayrollRun`
- `PayrollEntry`
- `PayrollEntryComponent`
- `PayrollAttendanceInputSnapshot`
- `PayrollVariablePay`
- `PayrollCorrection`
- `PayrollEntryStatutorySnapshot`
- statutory rule / evidence / review / sign-off / activation models
- PCB profile / declaration / YTD data
- `EmployeeCp38Instruction`
- `EmployeeBankAccountVersion`
- `PayrollPayslipPublication`
- payment batch / instruction / command / event / artifact models
- `PayrollStatutorySubmission`
- `PayrollStatutoryExportArtifact`

Schema source：`prisma/schema.prisma` 与 `prisma/migrations/`。

---

## 25. 权限、安全与审计

### 25.1 Capability groups

系统已有细分 capability，例如：

- View / create / edit / publish Roster；
- View / modify Attendance；
- Approve Leave；
- Review Claim、manage Claim settings、link to Payroll；
- Manage Commission rules、calculate、approve、adjust、link to Payroll；
- View Payroll、edit Compensation、create run、edit entry、submit review、approve/finalize、reopen；
- Publish Payslip；
- View / edit / verify Bank account；
- Create / submit / approve / export Payment batch；
- View / edit statutory profile、tax profile、export / submit statutory file。

### 25.2 Scope

- Business tenant isolation；
- allowed branch IDs；
- whole-business operation 对 Payroll 等敏感功能有专门检查；
- Employee Staff App 只能读取自己的 membership-scoped records。

### 25.3 历史一致性

- effective-dated versions；
- source IDs / digests；
- append-only events / corrections；
- frozen Timesheet revision；
- frozen Payroll components；
- frozen statutory snapshot；
- frozen Payslip bytes；
- encrypted bank / statutory artifacts；
- audit records。

### 25.4 Duties separation

- Payroll submitter 与 finalizer 默认分离；
- Payment batch creator 与 approver 分离；
- Commission calculator 与 approver 分离；
- Statutory reviewer / approver / activator 可分离；
- UI 暂时隐藏部分 MFA 不等于底层 high-risk / step-up code 已删除。

---

## 26. 端到端业务流程

### 26.1 员工入职到可计算工资

```text
Create Employee
→ Assign business membership and branch
→ Complete phone / Staff App access
→ Set employment dates, pay basis and compensation
→ Set work target / default schedule
→ Set bank account
→ Complete statutory & tax profile
→ Enable applicable modules
→ Publish Roster
→ Start Attendance collection
```

### 26.2 每月 Payroll

```text
1. Publish Roster
2. Collect Attendance and resolve exceptions
3. Review OT
4. Approve Leave / Claims / Commission / Variable Pay
5. Approve and lock Monthly Timesheet
6. Generate or refresh Payroll Draft
7. Resolve employee and statutory readiness items
8. Review component breakdown and totals
9. Submit Payroll for review
10. Finalize Payroll
11. Publish Payslips
12. Create / approve Payment Batch
13. Export statutory files
14. Track Submitted / Accepted / Rejected
```

### 26.3 修改已锁定 Attendance

```text
Open Monthly Timesheet
→ Begin controlled revision
→ Correct facts
→ Approve and lock new revision
→ Existing Payroll Draft becomes stale
→ Refresh Payroll Draft
```

### 26.4 修改已 Finalized Payroll

```text
If no immutable downstream record:
  Controlled reopen may be allowed

If Payslip / Payment / Statutory downstream exists:
  Create future correction / revision
  Preserve old finalized record
```

---

## 27. 当前已知限制与产品风险

1. Payroll Overview、Workspace 与 Runs 仍有重复感，主流程入口不够单一。
2. Monthly mid-period proration 仍有明确 blocker，尚不可假装自动支持。
3. Hourly paid Leave 的 paid-unit policy 仍可能未完成。
4. OT 必须有 approved source；raw attendance 不等于 payable OT。
5. Statutory governance 已完整但对一般 HR 仍偏技术化。
6. PCB calculator 已存在，但正式 readiness 仍受 profile、YTD、classification、active rule 与 software verification 限制。
7. Claim approval 与 reimbursement 是两阶段，UI 仍容易让用户误以为批准即已付款。
8. Claim Payroll link 要求目标 Draft 已有 eligible employee entry。
9. Missing bank account 只应影响 Payment，不能误显示为 Payroll calculation blocker。
10. Finalize、Publish Payslip、Pay、Submit Statutory 是四个独立动作。
11. Payment foundation / artifact 不等于真实 bank rail 已完成付款。
12. Statutory file generated 不等于 official portal accepted。
13. Staff OTP 是否送达还依赖 deployment environment、provider、carrier、rate limit 与 employee identity，不是纯 UI 问题。
14. 已有历史记录的 employee identity 字段不能随意修改或 hard-delete。
15. 大量旧 route/query 仍为兼容性保留，优化 IA 时要有 redirect / mapping 计划。

---

## 28. 自动化测试覆盖

当前测试目录：`tests/unit/`、`tests/integration/`。

已存在的覆盖领域包括：

- People / employee profile / role / level / access；
- employee OTP、membership、session 与 Staff App；
- Attendance punch、geofence、exception、resolution、P2、OT；
- Monthly Timesheet approval、lock、revision 与 Payroll bridge；
- Roster templates、assignments、publish、Staff App schedule；
- Leave policy、entitlement、bucket、ledger、documents、reports、Payroll handoff；
- Claims category policy、submission、receipt、approval、reimbursement 与 Payroll bridge；
- Commission calculation、approval、adjustment、refund 与 Payroll bridge；
- Payroll calculation、components、recurring pay、variable pay、corrections；
- Payroll readiness、workflow、finalization、payslip；
- EPF / SOCSO / EIS / LINDUNG 24 / PCB / CP38；
- statutory governance、artifact、submission formats；
- bank account security 与 Payment batch。

代表性文件：

- `tests/integration/hr-payroll-mvp-pilot.test.ts`
- `tests/integration/payroll-p5-attendance-integration.test.ts`
- `tests/integration/payroll-p4d-unified-workflow.test.ts`
- `tests/integration/payroll-payment-foundation.test.ts`
- `tests/integration/payroll-pcb-vc1-disposable-e2e.test.ts`
- `tests/integration/commission-engine.test.ts`
- `tests/unit/payroll-p7-final-readiness-closure.test.ts`
- `tests/unit/payroll-statutory-submission.test.ts`
- `tests/integration/attendance-employee-auth.test.ts`

测试证明代码路径存在并符合测试条件，不应被解释为外部政府、银行、SMS carrier 或 Production environment 已通过认证。

---

## 29. 给 ChatGPT 的精简背景

可直接复制以下区块：

```text
Tetamu HR & Payroll 当前不是一个单页工资工具，而是一个带版本、审核、冻结快照和审计记录的 Workforce platform。

现有模块：
- People / Employee 360 Profile
- Action Center / Approvals
- Attendance / OT / Monthly Timesheet
- Roster / Shift templates / Publish
- Public Holidays
- Leave policy / entitlement / balance / approval / reports
- Claims / receipts / approval / reimbursement / Payroll bridge
- Commission rules / statements / approval / Payroll bridge
- Payroll profile / Draft / calculation / readiness / review / finalize
- EPF / SOCSO / EIS / LINDUNG 24 / PCB / CP38
- Payslip publication
- Salary Payment batches
- Statutory export and submission tracking
- Staff App self-service with OTP login

核心主链：
Employee setup
→ Published Roster
→ Attendance / Leave / OT
→ Locked Monthly Timesheet
→ Claims / Commission / Variable Pay
→ Payroll Draft
→ Component calculation
→ Statutory materialisation
→ Readiness
→ Review
→ Finalize
→ Frozen snapshots
→ Payslip / Payment / Statutory submission

必须保留：
- effective-dated versions
- locked Timesheet as canonical attendance source
- PayrollEntryComponent as canonical pay ledger
- source IDs and digests
- frozen statutory snapshots
- audit trail
- maker-checker restrictions
- finalized / published record immutability
- branch and tenant isolation

需要特别区分：
- code exists
- module enabled
- business configured
- employee profile complete
- statutory rule reviewed and active
- external file accepted / money actually paid

不要把以下概念混为一谈：
- Approved Claim ≠ Reimbursed
- Finalized Payroll ≠ Payslip Published
- Payment instruction ready ≠ Salary Paid
- Statutory file generated ≠ Government accepted
- PCB calculator exists ≠ PCB production readiness complete

当前主要风险：
- Payroll IA 有重复入口
- technical blockers 对 HR 不友好
- mid-period monthly proration 尚未完成
- hourly paid Leave policy 仍可能阻挡
- Claim reimbursement 与 salary 必须解耦
- bank readiness 只影响 Payment
- PCB / statutory 仍依赖 profile、YTD、classification、active rule 与 governance
- external bank, government portal and SMS delivery cannot be inferred from internal status
```

---

## 30. 代码与既有专题文档索引

### 主要目录

- `src/app/(business)/team/`
- `src/app/staff/`
- `src/app/api/employee-auth/`
- `src/lib/team/`
- `src/lib/approvals/`
- `src/lib/attendance/`
- `src/lib/roster/`
- `src/lib/holidays/`
- `src/lib/leave/`
- `src/lib/claim/`
- `src/lib/commission/`
- `src/lib/payroll/`
- `prisma/schema.prisma`
- `prisma/migrations/`
- `tests/unit/`
- `tests/integration/`

### 专题文档

- `docs/TETAMU_LEAVE_CURRENT_FLOW_AND_OPTIMIZATION_BRIEF.md`
- `docs/TETAMU_CLAIMS_CURRENT_FLOW_AND_OPTIMIZATION_BRIEF.md`
- `docs/TETAMU_PAYROLL_CURRENT_FLOW_AND_OPTIMIZATION_BRIEF.md`
- `docs/tetamu-roster-complete-feature-report.md`
- `docs/unified-hr-approval-center-final-closure.md`
- `docs/employee-self-service-staff-app-final-closure.md`
- `docs/hr-leave-management-final-closure.md`
- `docs/hr-claims-reimbursements-final-closure.md`
- `docs/commission-engine-final-closure.md`
- `docs/payroll-p7-final-readiness-closure.md`
- `docs/statutory-pcb-2026-closure.md`
- `docs/statutory-epf-closure.md`
- `docs/statutory-socso-eis-classification-activation-closure.md`
- `docs/statutory-lindung24-participation-closure.md`

---

## 31. 最终结论

Tetamu 目前已经具备完整的 HR → Time → Pay → Compliance 主干：

```text
People
→ Work & Schedule
→ Attendance & Leave
→ Locked Timesheet
→ Earnings / Deductions / Reimbursements
→ Payroll Calculation
→ Statutory Readiness
→ Finalized Payroll
→ Employee / Bank / Government outputs
```

后续优化的重点不应是另建一套简化逻辑，而应是：

1. 把现有 canonical workflow 做成 HR 看得懂的阶段；
2. 将技术 blocker 转换成具体原因、影响范围与 Fix action；
3. 清楚区分 Calculation、Approval、Publication、Payment 与 Submission；
4. 保留 versioning、snapshot、audit、reconciliation 与权限边界；
5. 对尚未完成的 policy 或 external integration 诚实显示，不用 UI 掩盖。

这份文档可作为 ChatGPT 进行下一轮 IA、UX、流程或测试优化时的 Current State 基线。
