# TETAMU PAYROLL — 当前流程与优化交接文档

> 整理日期：2026-08-24
> 文档性质：根据当前 Tetamu 代码库整理的真实现状，不是未来构想。
> 用途：可直接交给 ChatGPT 分析并优化 Payroll 的员工资料、考勤、工资计算、法定扣款、审核、付款、Payslip 与官方申报流程。

## 1. 一句话说明

Tetamu Payroll 目前已经具备以下主链：

```text
Employee Payroll Profile
→ Compensation / Monthly additions / Work rules / Bank / Statutory & Tax
→ Locked Monthly Timesheet
→ Approved Commission / Variable pay / Corrections / Claims reimbursement
→ Generate Payroll Draft
→ Build frozen employee entries and canonical component lines
→ Calculate gross pay, statutory deductions and net pay
→ Payroll Readiness
→ Submit for Review
→ Finalize Payroll
→ Frozen statutory snapshots
→ Publish Payslips
→ Create Payment Batch
→ EPF / PERKESO / CP39 statutory export and submission tracking
```

Payroll Engine 已经包含 effective-dated compensation、recurring pay、locked Timesheet bridge、component ledger、variable pay、commission、claims reimbursement、EPF、SOCSO、EIS、LINDUNG 24、PCB、CP38、readiness、finalization、payslip publication、payment batch 与 statutory exports。

优化重点应放在：

- 让 HR 清楚知道现在进行到哪一步；
- 把 blocker 变成可理解、可直接修复的任务；
- 减少重复入口和技术术语；
- 保留现有冻结、版本、审计与不可变记录；
- 不要为了简化 UI 而绕过 canonical Payroll Engine。

---

## 2. 当前完整业务流程

### 2.1 公司 Payroll Settings

入口：

```text
HR & Payroll → Payroll → Payroll settings
Route: /team/payroll/settings
```

公司目前可以设置：

- Working days / month
- Paid minutes / day
- Break minutes
- Normal OT multiplier
- Rest-day work multiplier
- Rest-day OT multiplier
- Public-holiday work multiplier
- Public-holiday OT multiplier
- Public-holiday pay policy
- State / holiday label
- Branch public-holiday dates

生成 Payroll Draft 时，这些设置会复制进 `PayrollRun` snapshot。Draft 建立后，即使公司设置随后改变，旧 Draft 也不会静默变成另一套规则；必须回到 Draft 并 refresh / regenerate 才会采用新设置。

当前 ordinary work、OT、rest day 与 public holiday pay 采用公司 HR 设置作为 canonical work-pay policy。它不是自动套用 Sabah candidate rule。

主要代码证据：

- `src/app/(business)/team/payroll/settings/page.tsx`
- `src/lib/payroll/company-work-pay.ts`
- `src/lib/payroll/service.ts` → `generatePayrollRun`
- `prisma/schema.prisma` → `PayrollSetting`, `PayrollRun`

---

### 2.2 Employee Payroll Profile

入口：

```text
People → Employee → Compensation
People → Employee → Time & Leave
People → Employee → Access / Bank / Statutory & Tax
```

当前员工 Payroll setup 包含以下资料。

#### A. Compensation

- Pay basis：Monthly / Daily / Hourly
- Base rate
- Currency
- Effective payroll month
- Version history

每次变更都会建立 effective-dated `EmployeeCompensationVersion`。Payroll 按月份选择适用版本，并把 version ID、rate、pay basis、effective month 和 source 冻结进 employee Payroll Entry。

#### B. Monthly additions / Monthly deductions

底层名称仍为 recurring pay，目前支持：

- 固定每月加项，例如 Transport allowance、Phone allowance；
- 固定每月扣项；
- Stable component code；
- Effective month；
- Version 与 supersession。

生成 Draft 时会建立 `PayrollEntryRecurringPaySnapshot`，之后修改员工 profile 不会回写旧 Draft。

#### C. Work rules

- Working days / month
- Paid work / day
- Expected break / day
- Planned span / day

员工级设置可以覆盖公司默认值。

#### D. Salary bank account

- Bank
- Account holder
- Account number
- Effective date / active version
- Verification state

银行账号以 encrypted version 保存，并保留 last 4 digits 与 fingerprint。UI 可以决定授权 HR 看多少资料，但 Payment artifact 与 audit 不应泄漏完整账号。

#### E. Statutory & Tax

- Nationality / residency facts
- EPF / KWSP participation and member number
- SOCSO / PERKESO category and member number
- EIS / SIP participation
- LINDUNG 24 participation and selected employer evidence
- Identity number
- Tax Identification Number (TIN)
- PCB employee profile
- TP1 relief declarations
- TP3 previous-employer amounts
- Current-year PCB YTD ledger
- CP38 instruction

主要代码证据：

- `src/app/(business)/team/people/[personId]/page.tsx`
- `src/app/(business)/team/people/[personId]/payroll/actions.ts`
- `src/lib/payroll/employee-profile-write/compensation.ts`
- `src/lib/payroll/employee-profile-write/work-target.ts`
- `src/lib/payroll/employee-profile-write/statutory-tax.ts`
- `src/lib/payroll/compensation-version.ts`
- `src/lib/payroll/recurring-pay.ts`
- `src/lib/payroll/payment/bank-account-service.ts`
- `src/lib/payroll/pcb-profile.ts`
- `src/lib/payroll/pcb-declarations.ts`
- `src/lib/payroll/pcb-tax-year-ledger.ts`
- `src/lib/payroll/cp38-instruction.ts`
- `src/lib/payroll/lindung24-participation.ts`

---

### 2.3 Attendance / Leave / Roster 如何进入 Payroll

Payroll 不应直接读取仍会变化的 live Attendance、Roster 或 Leave request。

当前 canonical flow 是：

```text
Roster / Attendance / Approved Leave / OT approval
→ Monthly Timesheet revision
→ HR review
→ Lock Timesheet
→ Payroll Draft reads that exact locked revision
```

`PayrollRun` 会冻结：

- Timesheet revision ID
- Revision number
- Source digest
- Locked time
- Employee day facts
- Work segments
- Paid / unpaid Leave facts
- Approved overtime minutes
- Rest-day work
- Public-holiday work
- Unauthorized / authorized absence

若 Timesheet 被 reopen 并建立新 revision，旧 Payroll Draft 会显示 stale attendance source，必须 refresh Draft。Payroll Review 与 Finalize 也会再次确认仍在使用当前 locked revision。

No Show 在 Timesheet 中会成为 unauthorized absence / unpaid absence facts，再按 pay basis 与 company policy进入扣款。Approved paid / unpaid Leave 会从 frozen Timesheet facts 进入工资计算。

主要代码证据：

- `src/lib/payroll/timesheet-bridge.ts`
- `src/lib/payroll/attendance-integration.ts`
- `src/lib/attendance/timesheet-service.ts`
- `prisma/schema.prisma` → `PayrollAttendanceInputSnapshot`
- `tests/integration/payroll-p5-attendance-integration.test.ts`
- `tests/unit/attendance-payroll-timesheet-bridge.test.ts`

---

### 2.4 Commission、Variable pay、Corrections 与 Claims

#### Commission

Commission 不是直接写入工资总额。

当前流程：

```text
Eligible paid sales
→ Calculate Commission period
→ Review employee statements
→ Approve and lock period
→ Link approved statement to Payroll month
→ Create approved PayrollVariablePay
→ Payroll Draft materialises a component line
```

已批准 Commission statement 会冻结来源、rate revision、calculation digest 与 amount。后续修改 Commission rate 不会改变旧 statement。

#### Variable pay

支持：

- Bonus
- Commission
- Incentive
- One-off earning
- One-off deduction
- Arrears
- Recovery

状态：

```text
DRAFT → APPROVED → APPLIED
          └────────→ CANCELLED（未应用时）
```

#### Corrections

Finalized Payroll 的差异应通过 append-only correction 进入未来 Payroll，不应直接改旧 Payroll Entry。

#### Claims reimbursement

Approved Claim 选择 `Add to payroll` 后，系统会建立 `PayrollClaimReimbursementSnapshot` 并连接到特定 Draft employee entry。

重要规则：

- Business reimbursement 不应增加 gross salary；
- Claim statutory treatment 未确认时，只暂停该笔 reimbursement；
- 员工 salary Payroll 仍可继续；
- 如果 Draft 没有该员工的 eligible entry，不能连接到该 Draft；
- 修好 Claim category treatment 后，要 re-evaluate reimbursement。

主要代码证据：

- `src/lib/commission/service.ts`
- `src/lib/payroll/variable-pay.ts`
- `src/lib/payroll/entry-editor.ts`
- `src/lib/claims/service.ts`
- `src/lib/payroll/service.ts`
- `prisma/schema.prisma` → `PayrollVariablePay`, `PayrollCorrection`, `PayrollClaimReimbursementSnapshot`
- `tests/integration/commission-engine.test.ts`
- `tests/integration/payroll-p4c-variable-pay-correction.test.ts`
- `tests/integration/expense-phase2a-claims-payroll-integration.test.ts`

---

### 2.5 Generate Payroll Draft

入口：

```text
Payroll → Payroll runs
Route: /team/payroll/runs
```

选择月份并生成 Draft 时，系统会：

1. 确认该月份存在 locked Timesheet。
2. 找出在该月份 employment period 内的员工。
3. 为每位员工找出适用 Compensation version。
4. 读取员工级或公司级 work rules。
5. 从 locked Timesheet 建立 Attendance snapshot。
6. 计算 normal work、OT、rest day、public holiday、paid leave、unpaid absence。
7. 复制适用的 Monthly additions / deductions。
8. 加入已批准 Variable pay、Commission 与 Corrections。
9. 建立 canonical `PayrollEntryComponent` lines。
10. 执行 EPF、SOCSO、EIS、LINDUNG 24、PCB 与 CP38 statutory materialisation。
11. 从 component lines 重新汇总 gross、deductions 与 net pay。
12. 建立 audit log 与 source digests。

同一个 business 与同一 period 只有一笔 canonical `PayrollRun`。现有 Draft 可以 regenerate；进入 Review 或已经 Finalized 的 run 不能直接 regenerate。

主要代码证据：

- `src/lib/payroll/service.ts` → `generatePayrollRun`
- `src/lib/payroll/component-service.ts`
- `src/lib/payroll/component-calculation.ts`
- `src/lib/payroll/attendance-integration.ts`
- `src/lib/payroll/statutory-p2.ts`
- `prisma/schema.prisma` → `PayrollRun`, `PayrollEntry`, `PayrollEntryComponent`

---

### 2.6 工资如何计算

当前 pay basis：

- MONTHLY
- DAILY
- HOURLY

计算项目包括：

- Basic / regular pay
- Paid Leave pay
- Unpaid absence deduction
- Normal OT
- Rest-day work / OT
- Public-holiday work / OT
- Monthly additions
- Monthly deductions
- Approved variable pay
- Commission
- Corrections
- Claim reimbursement（不增加 gross salary）
- EPF employee / employer
- SOCSO employee / employer
- EIS employee / employer
- LINDUNG 24
- PCB
- CP38

基本关系：

```text
Gross Pay
= Basic / regular pay
+ Paid Leave pay
+ OT / holiday pay
+ taxable or ordinary earning components

Net Pay
= Gross Pay
- other deductions
- EPF employee
- SOCSO employee
- EIS employee
- LINDUNG 24 employee
- PCB
- CP38
+ approved business reimbursements paid through payroll
```

Canonical source 是 `PayrollEntryComponent` lines。`PayrollEntry` 上的 gross、net 与 statutory columns 是汇总和 frozen output，系统会做 reconciliation，避免 UI 或旧 aggregate column 与 component ledger 不一致。

主要代码证据：

- `src/lib/payroll/calculation.ts`
- `src/lib/payroll/company-work-pay.ts`
- `src/lib/payroll/component-calculation.ts`
- `src/lib/payroll/component-service.ts`
- `tests/unit/payroll-calculation.test.ts`
- `tests/integration/payroll-p4b-component-calculation.test.ts`

---

### 2.7 Statutory calculations

Payroll 目前支持：

- EPF / KWSP
- SOCSO / PERKESO
- EIS / SIP
- LINDUNG 24
- PCB / MTD
- CP38

每个 statutory result 会建立 `PayrollEntryStatutorySnapshot`，记录：

- Scheme
- Status
- RuleSet / rule version
- Employee profile revision
- Tax profile revision
- Calculation inputs
- Employee amount
- Employer amount
- Blocker code
- Source digest

只有 effective date 覆盖 Payroll month、通过 governance 并处于 `ACTIVE` 的 rule set 才能用于正式 materialisation。

Statutory rule governance：

```text
Evidence
→ HR Review
→ Approval
→ Payroll Use / Activation
```

Employee Entry 不允许直接手填 EPF、SOCSO、EIS、PCB、CP38 等法定金额；必须通过受控 statutory source workflow。代码会用 `assertNoDirectStatutoryEntryValues` 阻止直接覆盖。

#### PCB / MTD 当前能力

目前已有：

- 2026 rule version：`HASIL_MTD_SPEC_2026`
- Calculator version：`TETAMU_PCB_2026_1.1.0`
- Normal remuneration
- Additional remuneration
- Excluded / unresolved treatment
- Employee PCB profile
- Marital / spouse / children / disability facts
- Zakat
- TP1 declarations
- TP3 previous-employer amounts
- Current-year YTD ledger
- EPF allocation
- Non-resident handling
- CP38
- 5-sen rounding
- Frozen calculation snapshots
- CP39 export layout

但 PCB 正式 readiness 仍取决于：employee profile、YTD ledger、pay-item treatment、active rule、软件验证 / governance 状态和该 Payroll Draft 的 frozen source 是否仍是最新版本。

主要代码证据：

- `src/lib/payroll/statutory-p2.ts`
- `src/lib/payroll/statutory-p2c.ts`
- `src/lib/payroll/pcb-2026.ts`
- `src/lib/payroll/pcb-profile.ts`
- `src/lib/payroll/pcb-declarations.ts`
- `src/lib/payroll/pcb-tax-year-ledger.ts`
- `src/lib/payroll/cp38-instruction.ts`
- `src/lib/payroll/lindung24.ts`
- `src/lib/payroll/lindung24-participation.ts`
- `tests/unit/payroll-pcb-2026.test.ts`
- `tests/integration/payroll-pcb-vc1-disposable-e2e.test.ts`

---

### 2.8 Payroll Readiness

Readiness 是 Draft 进入 Review 和 Review 进入 Finalize 前的统一检查。

主要 blocker 包括：

- Missing Compensation
- Monthly mid-period proration not supported
- Missing locked Timesheet
- Stale Timesheet revision
- Attendance facts not materialised
- OT approval source not ready
- Component reconciliation failed
- Approved variable pay / correction missing
- Empty Payroll Run
- Incomplete statutory profile
- EPF / SOCSO / EIS profile missing
- PCB profile incomplete
- PCB YTD ledger incomplete
- PCB additional-pay EPF allocation required
- CP38 instruction not ready
- Active statutory rule not available
- Statutory classification required
- Stale statutory profile / rule source
- LINDUNG 24 participation incomplete
- Work-pay evidence or reconciliation problem

非工资阻挡项：

- Missing bank account：影响 Payment batch，不阻挡 Payroll finalization；
- Unverified bank account：feature flag 开启时影响 Payment readiness；
- Claim treatment not ready：只暂停该笔 reimbursement，salary Payroll 可继续。

UI 应把这些问题合并为：

```text
Payroll setup incomplete — N items
```

展开后每项显示：

- Employee
- Plain-language reason
- Affected step
- Fix button
- Fix 后是否需要 Refresh Draft

主要代码证据：

- `src/lib/payroll/readiness.ts`
- `src/app/(business)/team/payroll/runs/[runId]/page.tsx`
- `tests/unit/payroll-p7-final-readiness-closure.test.ts`

---

### 2.9 Draft、Review 与 Finalize

Payroll Run 状态：

```text
DRAFT
→ REVIEW
→ FINALIZED
```

允许的 transition：

```text
DRAFT → Submit for Review → REVIEW
REVIEW → Return to Draft → DRAFT
REVIEW → Finalize → FINALIZED
FINALIZED → Reopen → DRAFT（只在没有下游不可变记录时）
```

#### Submit for Review

系统会确认：

- Run 不是空的；
- Timesheet revision 仍是 current locked source；
- 所有 blocking readiness issues 已解决；
- statutory record 不再需要人工 review；
- holiday-pay previews 已确认或排除。

#### Finalize

系统会再次检查 readiness 和 Timesheet source，并记录 finalizer、时间与 audit。

默认实行 submitter / approver separation。Business owner self-approval 需要明确 override。代码层仍支持 high-risk step-up feature；UI 即使暂时隐藏 MFA，也不代表这些安全路径已从底层删除。

Finalize 后：

- Payroll amount 与 frozen facts 成为正式记录；
- 不会自动汇款；
- 不会自动让员工看到 Payslip；
- 不会自动代表 EPF、PERKESO 或 LHDN 已接受申报。

#### Reopen 限制

Finalized Payroll 只有在没有以下下游记录时才能 reopen：

- Active / approved Payment batch or payment artifact
- Statutory submission / export record
- Published Payslip

否则必须走 correction / new revision workflow，不能破坏已发布历史。

主要代码证据：

- `src/lib/payroll/workflow.ts`
- `src/lib/payroll/service.ts` → `submitPayrollRunForReview`
- `src/lib/payroll/service.ts` → `returnPayrollRunToDraft`
- `src/lib/payroll/service.ts` → `finalizePayrollRun`
- `src/lib/payroll/service.ts` → `reopenPayrollRun`

---

### 2.10 Payslip

HR 可以先 preview Payroll document，但员工 Staff App 只会看到已明确发布的 frozen Payslip。

流程：

```text
FINALIZED Payroll
→ Generate frozen PDF bytes
→ Store SHA-256 digest and publication record
→ Publish Payslips
→ Employee Staff App → Payslips
```

入口：

```text
HR: /team/payroll/runs/:runId
Staff: /staff/payslips
```

一旦发布，Payslip document bytes 是 snapshot，不应随之后的 profile、company name、bank 或 salary changes 改变。

主要代码证据：

- `src/lib/payroll/payslip-publication.ts`
- `src/lib/payroll/documents.ts`
- `src/lib/payroll/export.ts` → `buildPayslipPdf`
- `src/app/staff/payslips/page.tsx`
- `prisma/schema.prisma` → `PayrollPayslipPublication`

---

### 2.11 Salary Payment

Payment 是 Finalized Payroll 之后的独立流程。

入口：

```text
Payroll → Payments
Route: /team/payroll/payments
```

流程：

```text
FINALIZED Payroll
→ Evaluate employee bank readiness
→ Create Payment Batch
→ Resolve blocked instructions
→ Submit batch for approval
→ Approve batch
→ Create payment instruction / artifact
```

Payment Batch 状态：

```text
DRAFT
→ AWAITING_APPROVAL
→ APPROVED
→ INSTRUCTION_READY
```

其他状态：

- CANCELLED
- SUPERSEDED

Payment instruction blockers：

- Missing bank account
- Bank account unverified
- Inactive bank account
- Bank account not effective
- Net pay zero
- Net pay negative
- Duplicate payment allocation
- Business mismatch

Batch creator 不能批准同一批付款。Approved instruction 不能通过普通 cancel 改写；需使用 correction batch。

目前代码具备 payment batch、encrypted instruction snapshot、readiness、approval、audit 与 internal artifact。是否已经连接真实银行付款 rail，不能从这些记录推断；正式付款仍要以 provider / bank integration 和外部 bank confirmation 为准。

主要代码证据：

- `src/lib/payroll/payment/payment-readiness.ts`
- `src/lib/payroll/payment/payment-batch-service.ts`
- `src/lib/payroll/payment/payment-artifact-service.ts`
- `src/lib/payroll/payment/bank-account-crypto.ts`
- `src/app/(business)/team/payroll/payments/page.tsx`
- `tests/integration/payroll-payment-foundation.test.ts`

---

### 2.12 Statutory export and submission

入口：

```text
Payroll → Statutory submissions
Route: /team/payroll/statutory
```

Finalized Payroll 可以建立：

- KWSP e-Caruman CSV
- PERKESO Combined SOCSO + EIS text file
- LHDN CP39 text file

流程：

```text
FINALIZED Payroll
→ Validate business + employee statutory identities
→ Build official-format file
→ Encrypt and store artifact
→ Download and validate in official portal
→ Mark Submitted
→ Mark Accepted / Rejected
→ If rejected, create correction revision
```

Submission 状态：

```text
DRAFT → EXPORTED → SUBMITTED → ACCEPTED
                              └→ REJECTED → correction revision
```

系统会记录 export version、revision、hash、encrypted artifact、submission reference、rejection reason 与 audit。

重要：系统生成 CP39 / EPF / PERKESO 文件，不等于政府 portal 已接受，也不等于法定款项已付款。UI 必须明确区分 `File ready`、`Submitted` 与 `Accepted`。

主要代码证据：

- `src/lib/payroll/statutory-submission.ts`
- `src/lib/payroll/statutory-artifact.ts`
- `src/lib/payroll/statutory-artifact-crypto.ts`
- `src/app/(business)/team/payroll/statutory/page.tsx`
- `tests/unit/payroll-statutory-submission.test.ts`

---

## 3. 当前主要入口

| 目的 | Route |
|---|---|
| Payroll overview / workspace | `/team/payroll/workspace` |
| Payroll runs | `/team/payroll/runs` |
| Create / open month | `/team/payroll?month=YYYY-MM` |
| Payroll run detail | `/team/payroll/runs/:runId` |
| Employee entry detail | `/team/payroll/runs/:runId/entries/:entryId` |
| Company payroll settings | `/team/payroll/settings` |
| Employee payroll profile | `/team/people/:personId?section=payroll` |
| Employee statutory & tax | `/team/people/:personId?section=statutory` |
| Salary payments | `/team/payroll/payments` |
| Statutory submissions | `/team/payroll/statutory` |
| Staff payslips | `/staff/payslips` |
| Commission | `/team/commission` |
| Claims reimbursement | `/team/claims` |
| Monthly timesheets | `/team/attendance/timesheets` |

当前 IA 存在 `/team/payroll`、`/workspace`、`/runs`、员工 Profile 与多个 downstream 页面。优化时应明确一个主入口和可预测的 breadcrumb，不要让用户在 Payroll overview、workspace、runs 之间猜测。

---

## 4. 权限与职责分离

Payroll 并不是任何 HR 用户都能完成全部操作。

当前流程包含：

- View Payroll
- Manage employee compensation
- Manage recurring / variable pay
- Generate / edit Draft
- Submit for Review
- Finalize Payroll
- Publish Payslips
- Create / approve Payment batch
- Export / update statutory submission
- Manage bank account
- Manage statutory / tax profile

高风险流程有 maker-checker / self-approval 限制：

- Payroll submitter 与 finalizer 默认分离；
- Payment batch creator 与 approver 分离；
- Commission calculator 与 approver 分离；
- Statutory rule reviewer、approver、activator可按 capability 分离。

优化 UI 时，不可只是把按钮隐藏后让用户无从理解。应该显示：

```text
You can review this payroll, but final approval requires a Payroll Approver.
```

并提供可执行的下一步。

---

## 5. 当前状态模型总览

### Payroll Run

```text
DRAFT → REVIEW → FINALIZED
```

### Variable pay / Correction

```text
DRAFT → APPROVED → APPLIED
  └──────────────→ CANCELLED
```

### Commission

```text
Period: OPEN → CALCULATED → LOCKED
Statement: CALCULATED → APPROVED → APPLIED_TO_PAYROLL
```

### Payslip

```text
Not published → Published frozen PDF
```

### Payment Batch

```text
DRAFT → AWAITING_APPROVAL → APPROVED → INSTRUCTION_READY
  └→ CANCELLED / SUPERSEDED
```

### Statutory Submission

```text
DRAFT → EXPORTED → SUBMITTED → ACCEPTED
                              └→ REJECTED
```

### Statutory RuleSet

```text
DRAFT
→ ENGINEERING_VERIFIED
→ READY_FOR_HUMAN_SIGN_OFF
→ HUMAN_SIGNED_OFF
→ ACTIVE
→ RETIRED
```

---

## 6. 已实现且应保留的能力

- Effective-dated Compensation versions
- Monthly additions / deductions versions
- Employee work-rule overrides
- Locked Timesheet as canonical attendance source
- Attendance / Leave / OT frozen snapshots
- Monthly, daily and hourly pay basis
- Company-defined OT / rest day / public holiday multipliers
- Canonical Payroll component ledger
- Component reconciliation
- Approved variable pay and append-only corrections
- Frozen Commission statements linked to Payroll
- Claims reimbursement bridge
- EPF / SOCSO / EIS / LINDUNG 24 / PCB / CP38 materialisation
- PCB profile, TP1, TP3 and YTD ledger
- Payroll Readiness with employee-level blockers
- DRAFT / REVIEW / FINALIZED workflow
- Audit logs and source digests
- Frozen Payslip publication
- Encrypted bank account versions
- Payment readiness and approval batches
- EPF / PERKESO / CP39 export artifacts
- Submission status tracking
- Automated unit and integration coverage

---

## 7. 当前不完整、容易误解或有风险的地方

### 7.1 Mid-period monthly proration 未完成

Monthly employee 如果在月中入职或离职，当前 `assertSupportedPayrollProration` 会阻挡 Payroll，并报：

```text
MID_PERIOD_PRORATION_NOT_READY
```

在没有批准的 proration policy 前，不能假装自动算对。

### 7.2 Hourly paid Leave 仍可能被 policy blocker 阻挡

`HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY` 仍存在。不能只靠 UI 隐藏。

### 7.3 OT 依赖 approved source

有 OT minutes 但缺少已批准 source 或 rate policy 时会阻挡。Roster 或 raw clock records 本身不等于 approved OT。

### 7.4 Statutory governance 对一般 HR 太技术化

底层 Evidence → HR Review → Approval → Activation 必须保留，但普通 Payroll 页面不应显示内部 error code、digest、candidate version 与 engineering terminology。

### 7.5 PCB 正式 readiness 与“计算器有代码”不是同一件事

PCB engine 已存在，但某个 Payroll month 是否可正式使用，仍取决于 active rule、employee profile、YTD、pay-item treatment、software verification 和 frozen source freshness。

### 7.6 Claims reimbursement 与 salary 应解耦

Claim treatment 未确认只应暂停 reimbursement，不能阻挡全体工资。当前 readiness 已把它列为 `REVIEW`，UI 也应延续这个逻辑。

### 7.7 Bank readiness 与 Payroll finalization 应分层

员工没有银行账号，不代表工资不能算；它代表不能生成正常 bank payment instruction。UI 不应把 `Payroll ready` 与 `Payment ready` 混成同一个红色 blocker。

### 7.8 Finalize、Publish、Pay、Submit 是四件不同的事

当前技术上已经分开，但 UI 和成功提示仍很容易让用户误以为：

```text
Finalize = Payslip published = Salary paid = Statutory submitted
```

必须用明确状态和下一步区分。

### 7.9 Reopen 受下游不可变记录限制

一旦 Payslip、Payment artifact 或 statutory submission 已建立，不能直接 reopen。UI 应在执行下游操作前解释不可逆影响，而不是失败后才显示技术错误。

### 7.10 Real bank payment rail 不能从内部 artifact 推断

当前 payment batch 与 artifact 是完整 foundation，但没有外部 provider confirmation 时，不能把 `INSTRUCTION_READY` 显示成 `Paid`。

### 7.11 Official portal acceptance 仍是外部事实

EPF / PERKESO / CP39 文件生成后仍需在官方 portal 验证、提交和记录接受状态。

### 7.12 MFA / step-up 底层仍存在

早前 UI 选择暂时隐藏部分 MFA，但底层 feature flag、high-risk authorization 和审计代码仍存在。未来优化需决定产品 policy，不能假设已经完全删除。

---

## 8. 建议的 Payroll 信息架构

建议 Payroll 主页面只保留六个阶段：

```text
1. Prepare
2. Calculate
3. Review
4. Finalize
5. Pay employees
6. Submit statutory files
```

### Prepare

显示：

- Employee setup
- Locked Timesheet
- Commission / variable pay / claims inputs
- Statutory profiles

### Calculate

显示：

- Generate / Refresh Draft
- Employee gross / deductions / net
- Component details

### Review

显示：

- Readiness summary
- Employee issues with Fix button
- Changes since last Draft
- Submit for Review

### Finalize

显示：

- Final totals
- Approver
- Immutable effects
- Finalize action

### Pay employees

显示：

- Bank readiness
- Payment batch
- Approval
- Instruction status

### Submit statutory files

显示：

- EPF
- PERKESO / EIS
- PCB / CP39
- File / Submitted / Accepted states

Payslip 应放在 Finalize 后的明显下一步，而不是混在 payment 或 records 内。

---

## 9. 建议的 HR 操作流程

```text
Step 1 — Complete employee setup
Step 2 — Lock monthly Timesheet
Step 3 — Approve Commission and variable pay
Step 4 — Generate Payroll Draft
Step 5 — Resolve employee setup issues
Step 6 — Review employee calculations
Step 7 — Submit Payroll for approval
Step 8 — Finalize Payroll
Step 9 — Publish Payslips
Step 10 — Create and approve Payment Batch
Step 11 — Export and track statutory submissions
```

每一步应有：

- Current status
- What this step does
- What it does not do
- Blocking items
- Fix action
- Next step

---

## 10. 建议的 UI 文案

| 当前技术文案 | 建议文案 |
|---|---|
| Payroll Run | Payroll month |
| Generate Payroll Run | Calculate payroll |
| Regenerate | Refresh calculation |
| Payroll readiness | Setup checks |
| Statutory readiness | EPF, SOCSO, EIS and tax checks |
| Submit for Review | Send for approval |
| Finalize Payroll | Confirm final payroll |
| Recurring earnings | Monthly additions |
| Recurring deductions | Monthly deductions |
| Variable pay | Bonus and one-off pay |
| PayrollEntryComponent | Pay item |
| Payment instruction | Bank payment item |
| Publish payslips | Make payslips available to staff |
| Statutory artifact | Submission file |
| EXPORTED | File ready |
| INSTRUCTION_READY | Bank file ready |
| STALE_ATTENDANCE_SOURCE | Timesheet changed — refresh payroll |
| STATUTORY_RULE_NOT_AVAILABLE | Calculation rule is not active |
| PCB_PROFILE_INCOMPLETE | Complete this employee’s tax details |

内部 enum、error code、revision、digest 与 provider payload 不应直接出现在一般 HR 页面。

---

## 11. 自动化测试现状

当前已有大量 Payroll tests，覆盖：

- Calculation
- Compensation versions
- Recurring pay
- Component ledger and reconciliation
- Variable pay and corrections
- Attendance integration
- Timesheet bridge
- OT approval
- Cross-midnight work
- Company work-pay rules
- Holiday pay
- Final readiness
- EPF / SOCSO / EIS / LINDUNG 24
- PCB engine, profile, YTD and runtime
- CP38
- Statutory governance and artifacts
- Statutory submission formats
- Bank-account security
- Payment batches
- Claims payroll bridge
- Commission engine
- End-to-end pilot and disposable PCB test

代表性测试：

- `tests/integration/hr-payroll-mvp-pilot.test.ts`
- `tests/integration/payroll-p4d-unified-workflow.test.ts`
- `tests/integration/payroll-p5-attendance-integration.test.ts`
- `tests/integration/payroll-pcb-vc1-disposable-e2e.test.ts`
- `tests/integration/payroll-payment-foundation.test.ts`
- `tests/unit/payroll-p7-final-readiness-closure.test.ts`
- `tests/unit/payroll-statutory-submission.test.ts`

这些测试证明有对应代码路径，不代表每个 external portal、bank rail 或政府 approval 已在 production 获得官方认证。

---

## 12. 给 ChatGPT 的优化任务

可直接复制以下内容：

```text
请优化 Tetamu → HR & Payroll → Payroll 的整体 UX。

这次不是重写 Payroll Engine。

现有底层已经有：

- Effective-dated employee Compensation
- Monthly additions / deductions
- Employee work-rule overrides
- Locked Monthly Timesheet as canonical attendance source
- Paid / unpaid Leave and approved OT snapshots
- Monthly / Daily / Hourly calculations
- Canonical Payroll component ledger
- Variable pay, Commission, Corrections and Claims reimbursement
- EPF, SOCSO, EIS, LINDUNG 24, PCB and CP38
- Payroll Readiness
- DRAFT → REVIEW → FINALIZED workflow
- Frozen Payslips
- Payment batches
- EPF / PERKESO / CP39 exports and submission tracking

请保留：

- 所有 versioning
- frozen snapshots
- source digests
- audit logs
- maker-checker restrictions
- finalized / published record immutability
- canonical component reconciliation
- locked Timesheet requirement
- active statutory rule requirement

请重点优化：

1. Payroll 主页面改成 Prepare → Calculate → Review → Finalize → Pay → Submit 六个清楚阶段。
2. Payroll setup incomplete 要按员工列出原因，并提供对应 Fix 按钮。
3. 把技术 error code 转成 HR 看得懂的文案。
4. 明确区分 Payroll ready、Payment ready、Payslip published 与 Statutory submitted。
5. Claims treatment 未确认时只暂停该笔 reimbursement，不阻挡 salary Payroll。
6. Missing bank account 只影响 Payment，不阻挡 Payroll finalization。
7. Finalize 后给出 Publish payslips、Create payment batch、Prepare statutory files 三个下一步。
8. 在不可逆动作前解释影响，不要等失败后才显示技术错误。
9. 减少 /team/payroll、/workspace、/runs 之间的重复入口。
10. Employee Payroll Profile 使用 Compensation、Monthly additions、Work rules、Bank account、Statutory & tax 的清楚分组。
11. 保留员工 entry 的 component breakdown，但默认显示简洁 Gross / Deductions / Net summary。
12. 不要把 internal revision、digest、artifact、candidate、materialisation 等术语直接显示给普通 HR。

不要：

- 绕过 locked Timesheet；
- 直接修改 finalized Payroll；
- 允许手填 statutory totals；
- 把 Finalize 当作 Paid；
- 把 file generated 当作 government accepted；
- 因一笔 Claim reimbursement 未确认而阻挡全部工资；
- 删除版本、审计或 source snapshots；
- 用 UI shortcut 写入 aggregate totals 而绕过 PayrollEntryComponent。

请先输出：

1. 新的信息架构；
2. Desktop 与 mobile 页面结构；
3. 各阶段状态和 CTA；
4. blocker → plain language → Fix route mapping；
5. 哪些现有 routes / components 复用；
6. 哪些只改文案和布局；
7. 哪些需要后端补强；
8. migration 风险；
9. acceptance criteria；
10. test plan。
```

---

## 13. 结论

Tetamu Payroll 不是尚未开始的工资页面，而是已经具备完整 canonical 主链的 Payroll platform：

```text
Employee setup
→ Locked Timesheet
→ Frozen pay inputs
→ Draft calculation
→ Readiness
→ Review
→ Finalize
→ Payslip / Payment / Statutory submission
```

当前最重要的产品问题不是“有没有 Payroll Engine”，而是：流程被拆散在太多入口、技术 blocker 太难理解、Finalize 后的三条下游路径容易混淆。

下一轮优化应在不破坏底层 governance 的前提下，把 Payroll 做成一条 HR 能顺着完成、每一步都知道原因与下一步的工作流。
