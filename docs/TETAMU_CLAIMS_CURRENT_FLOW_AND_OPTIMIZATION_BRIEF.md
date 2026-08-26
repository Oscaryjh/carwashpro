# TETAMU CLAIMS — 当前流程与优化交接文档

> 整理日期：2026-08-24
> 文档性质：根据当前 Tetamu 代码库整理的现状说明，不是未来构想。
> 用途：可直接交给 ChatGPT 分析并优化 Claims 的流程、信息架构、文案与 UI/UX。

## 1. 一句话说明

Tetamu Claims 目前已经具备以下主链：

```text
员工 Staff App 提交 Claim
→ 系统按当时有效的 Category Policy 验证并冻结规则快照
→ HR / Manager 审批
→ 如有批准金额，创建独立的 Reimbursement
→ 后台选择 Through payroll 或 Pay separately
→ Through payroll 写入指定 Payroll Draft 的员工 Payroll Entry
→ Pay separately 由后台记录直接付款完成
```

Claims 不是工资项目。通过 Payroll 发放时，已验证的 business reimbursement 会增加员工 **net pay**，不会增加 gross salary。

---

## 2. 当前完整业务流程

### 2.1 员工申请 Claim

入口：

```text
Staff App → Claims
Route: /staff/claims
```

员工目前可以填写：

- Purpose / 申请用途
- Claim category / 类别
- Expense date / 消费日期
- Merchant / 商户（可选）
- Description / 说明
- Amount / 金额（一般报销）
- Distance in km / 公里数（Mileage）
- Receipt / 收据附件

当前 Staff UI 一次提交一条 Claim line。底层数据结构支持一个 Claim 有多条 lines，但当前表单没有开放多行编辑。

提交时系统会：

1. 产生 `clientRequestId`，避免重复请求造成重复 Claim。
2. 使用 `MYR` 作为币种。
3. 找出该类别在消费日期对应的有效 `ClaimPolicyRevision`。
4. 按 policy 检查：
   - 是否必须填写 description；
   - 是否必须上传 receipt；
   - 单笔金额是否超过上限；
   - Mileage 是否应由公里数 × 当时政策费率计算。
5. 把类别名称、政策版本、报销处理方式等冻结到 Claim line snapshot。
6. 私密保存收据附件，并记录审计事件。
7. 检查疑似重复 Claim；目前只显示 warning，不会自动拒绝。
8. 创建状态为 `SUBMITTED` 的 Claim。

员工提交后可以在 Staff App 查看：

- Claim 状态
- 申请金额与批准金额
- 每条 line 的审核结果
- Manager reason / withdrawal reason
- Receipt
- Reimbursement channel 和 payment status

员工只有在 Claim 仍是 `SUBMITTED` 时可以撤回，并且当前界面会要求填写撤回原因。

主要代码证据：

- `src/app/staff/claims/page.tsx`
- `src/components/staff-pwa/staff-claims.tsx`
- `src/app/api/employee-claims/route.ts`
- `src/lib/claim/service.ts`

---

### 2.2 后台收到待审批 Claim

主要入口：

```text
HR & Payroll → Claims
Route: /team/claims
```

另外，待处理 Claim 也会出现在统一审批中心：

```text
HR & Payroll → Actions / Approvals
Route: /team/approvals
```

Claims 主页面目前把流程分成三类工作量：

1. `Pending approval`
   - 员工已提交，等待 HR / Manager 审核。
2. `Choose reimbursement`
   - Claim 已批准，但还没有选择通过 Payroll 或单独付款。
3. `Complete payment`
   - 已选择 Pay separately，但还没有记录付款完成。

HR 打开一笔 Claim 后可看到：

- Employee
- Category
- Expense date
- Submitted date
- Submitted amount
- Receipt preview
- Duplicate warning
- 每条 Claim line
- Category policy snapshot

当前 Receipt 按钮会打开页面内 modal 预览；浏览器不能预览的文件仍可 `Open original`。

---

### 2.3 HR / Manager 审批

每条 line 可以输入 `Approved amount`。

系统规则：

- Approved amount 不能大于 submitted amount。
- 全额批准：line 为 `APPROVED`。
- 部分批准：line 为 `PARTIALLY_APPROVED`。
- 批准金额为 0：line 为 `REJECTED`。
- 当前底层在减少金额或拒绝时要求原因。
- Claim 最终状态会变成：
  - `APPROVED`
  - `PARTIALLY_APPROVED`
  - `REJECTED`

如果公司启用了两级审批：

```text
Manager Level 1 审批
→ 只记录第一层决定
→ 不创建 Reimbursement
→ Business Owner Level 2 最终审批
→ 才正式创建 Reimbursement
```

如果最终批准金额大于 0，系统会创建一个独立 `ClaimReimbursement`，初始状态为：

```text
AWAITING_CHANNEL
```

主要代码证据：

- `src/app/(business)/team/claims/page.tsx`
- `src/app/(business)/team/claims/actions.ts`
- `src/lib/claim/service.ts`
- `src/lib/approvals/service.ts`

---

### 2.4 批准后选择如何报销

后台必须在一笔批准的 Claim 上选择一种方式：

```text
A. Through payroll
B. Pay separately
```

#### A. Through payroll

后台需要选择一个 Payroll Draft。

系统只允许：

- Payroll Run 状态为 `DRAFT`；
- Claim 所属员工已经有该 Payroll Draft 的 `PayrollEntry`；
- Claims 和 Payroll 模块都处于可用状态。

如果员工不在该 Draft 内，会出现：

```text
The selected Draft Payroll Run has no eligible employee entry.
```

选择成功后系统会创建：

```text
PayrollClaimReimbursementSnapshot
```

并把 Reimbursement 标为：

```text
channel = PAYROLL
status = PAYROLL_LINKED
```

Snapshot 根据 Claim category policy 进入两种状态：

1. `READY`
   - 所有 Claim lines 都是 `VERIFIED_NON_WAGE`。
   - 系统把报销金额加入该 Payroll Entry 的 net pay。
   - 不加入 gross earnings / wage。

2. `BLOCKED_STATUTORY`
   - 至少一个类别仍为 `REVIEW_REQUIRED`。
   - 只有该笔 reimbursement 暂停进入 net pay。
   - 员工的正常 salary payroll 仍可继续，不应被整份 Payroll 阻断。

HR 修正 Category 的 `Payroll treatment` 后，可以执行 `Re-evaluate reimbursement`，把 snapshot 从 `BLOCKED_STATUTORY` 变成 `READY`。

#### B. Pay separately

选择后状态变为：

```text
OUTSIDE_PAYROLL_PENDING
```

后台实际付款后输入 payment reference 并确认，状态变为：

```text
OUTSIDE_PAYROLL_PAID
```

这条直接付款流程已有幂等控制，重复提交不会重复记录同一付款。

主要代码证据：

- `src/lib/claim/reimbursement.ts`
- `src/app/(business)/team/claims/actions.ts`
- `src/app/(business)/team/claims/page.tsx`

---

### 2.5 Claim 进入 Payroll 后发生什么

当 payroll snapshot 为 `READY` 时：

1. `deriveAndPersistEntryAggregates` 读取 Claim reimbursement snapshot。
2. Claim reimbursement 增加 Payroll Entry 的 net pay。
3. Claim reimbursement 不增加 gross salary。
4. Payroll document / payslip 会显示独立的 Claim reimbursement line，并带 Claim number。
5. Payroll export 也会把 Claim 作为独立 reimbursement 呈现。

主要代码证据：

- `src/lib/payroll/component-service.ts`
- `src/lib/payroll/readiness.ts`
- `src/lib/payroll/documents.ts`
- `src/lib/payroll/export.ts`

---

## 3. 当前状态机

### Claim

```text
SUBMITTED
├─→ APPROVED
├─→ PARTIALLY_APPROVED
├─→ REJECTED
└─→ WITHDRAWN

APPROVED / PARTIALLY_APPROVED
└─→ CANCELLED（只限尚未付款的 approved claim）
```

### Reimbursement

```text
AWAITING_CHANNEL
├─→ OUTSIDE_PAYROLL_PENDING
│   └─→ OUTSIDE_PAYROLL_PAID
└─→ PAYROLL_LINKED
    └─→ PAYROLL_SETTLED（Schema/UI 已定义，但当前未找到完成写入）
```

### Payroll bridge snapshot

```text
BLOCKED_STATUTORY
└─→ READY（修正 category policy 后重新评估）

READY
└─→ SETTLED（Schema 已定义，但当前未找到完成写入）
```

---

## 4. Category Policy 如何影响整个流程

入口：

```text
/team/claims?manage=categories
```

每个 Category 的 policy 包含：

- Category name
- Expense type：General expense / Mileage
- Effective date
- Maximum claim amount
- Mileage rate per km
- Receipt required
- Description required
- Payroll treatment

Payroll treatment 当前有两个核心结果：

1. `VERIFIED_NON_WAGE`
   - UI 文案应表达为可正常作为 business reimbursement 处理。
   - 可以进入 Payroll net pay，不提高 gross salary。

2. `REVIEW_REQUIRED`
   - Claim 可以提交和审批。
   - 选择 Payroll 后，该笔 reimbursement 会 hold，直到 policy 被确认。
   - 不应阻塞员工的正常工资。

Policy 是版本化的：保存修改会创建新 revision；旧 Claim 继续使用提交时冻结的历史 snapshot，不会被新政策倒改。

主要代码证据：

- `prisma/schema.prisma`
- `src/lib/claim/service.ts`
- `src/app/(business)/team/claims/claim-category-policy-form.tsx`
- `src/app/(business)/team/claims/page.tsx`

---

## 5. 数据模型

主要 Prisma models：

- `ClaimCategory`
- `ClaimPolicyRevision`
- `EmployeeClaim`
- `ClaimLine`
- `ClaimAttachment`
- `ClaimReimbursement`
- `PayrollClaimReimbursementSnapshot`
- `ClaimEvent`

数据库与 migration 证据：

- `prisma/schema.prisma`
- `prisma/migrations/20260810090000_claims_reimbursements_final_closure/migration.sql`

系统有独立 Claim event / audit 记录，并且不是把报销伪装成 one-off earning。

---

## 6. 权限与角色

当前 Claims 相关 capabilities：

- `VIEW_CLAIM`
- `REVIEW_CLAIM`
- `VERIFY_CLAIM`
- `MANAGE_CLAIM_SETTINGS`
- `LINK_CLAIM_TO_PAYROLL`

代码位置：

- `src/lib/auth/staff-permissions.ts`

注意：该文件部分 capability 的说明仍写着类似 “not available yet”，但对应功能实际上已经存在，属于过期文案，应在后续优化时统一。

---

## 7. 已有自动化测试

主要测试文件：

- `tests/unit/claims-reimbursements-foundation.test.ts`
- `tests/integration/claims-reimbursements-final-closure.test.ts`
- `tests/integration/expense-phase2a-claims-payroll-integration.test.ts`

现有测试覆盖：

- Staff Claims authentication 不依赖 Attendance 模块。
- Claim input、MYR 和 line number validation。
- Partial approval。
- 两级审批在 Owner 最终批准前不会创建 reimbursement。
- Duplicate warning-only。
- 私密 receipt 与 tenant / employee authorization。
- Direct reimbursement settlement idempotency。
- Approved unpaid Claim cancellation。
- Concurrent approval 只有一个 canonical winner。
- Payroll bridge 在处理未验证时 fail closed。
- Verified reimbursement 增加 net pay、不改变 gross wage。
- Claims/Payroll 到 Expense 的 materialization 与 reconciliation。

---

## 8. 已确认的当前缺口与风险

### 8.1 Payroll 结算闭环未完成

Schema、enum、UI 和 Expense adapter 都认识：

```text
ClaimReimbursementStatus.PAYROLL_SETTLED
ClaimPayrollBridgeStatus.SETTLED
```

但当前代码库中没有找到应用代码在 Payroll finalization 或 payment completion 后写入这两个状态。

`finalizePayrollRun()` 当前只把 Payroll Run 更新为 `FINALIZED`，没有同步更新 Claim reimbursement / bridge snapshot。

影响：

- UI 可能长期显示 `Added to payroll`，而不是 `Paid through payroll`。
- Expense integration 可能继续把它视为 unpaid obligation。
- 已通过 Payroll 支付的 Claim 可能无法形成完整结算审计闭环。

证据：

- `src/lib/payroll/service.ts` → `finalizePayrollRun`
- `src/lib/expense/source-integration.ts`
- `src/lib/claim/service.ts`
- 全仓库只找到 `PAYROLL_SETTLED` 的读取/显示和 schema 定义，没有状态写入。

### 8.2 Staff UI 只开放单一 Claim line

底层支持多 line，但员工表单目前一次只能提交一条。这不是数据层缺失，而是 UI 能力未开放。

### 8.3 审批与报销是两个阶段，但页面容易让用户以为是一件事

批准 Claim 之后还必须选择 reimbursement channel。当前文案和卡片密度可能让 HR 不清楚“已批准”不等于“已安排付款”。

### 8.4 Through payroll 依赖员工已存在于 Draft

如果 Draft 没有该员工 entry，选择 Payroll 会失败。当前流程要求 HR 先去 Payroll 创建/刷新 Draft，再回来选择，跨页面成本较高。

### 8.5 Category review 的技术语义对一般 HR 仍不够直接

`VERIFIED_NON_WAGE` / `REVIEW_REQUIRED` 是合理的底层状态，但页面应使用业务语言表达：

- Business reimbursement
- Review before adding to payroll

### 8.6 部分 reason 字段仍是底层强规则

虽然 UI 已在减少不必要的 reason 输入，但服务层仍在以下情况要求或保存理由：

- 减少批准金额
- 拒绝
- 撤回
- 取消 approved Claim
- Category revision audit

优化时要决定哪些应由用户填写、哪些可由系统自动生成，而不能只隐藏输入框后破坏服务验证。

---

## 9. 建议给 ChatGPT 的优化任务

请基于以上“当前已存在”的能力优化 Claims，不要重写 Claim Engine。

### 优化目标

1. 让员工在 Staff App 3 步内完成 Claim：
   ```text
   选类别与日期 → 填金额/说明与收据 → 确认提交
   ```
2. 让 HR 清楚区分：
   ```text
   Pending approval
   → Approved, choose payment method
   → Payment in progress
   → Paid / Cancelled
   ```
3. Claims 主页面应适合同时处理大量申请：
   - compact list/table；
   - status tabs；
   - employee/category/date filters；
   - receipt modal；
   - expanded row 才显示审批操作。
4. 批准后清楚显示两个付款选择：
   - Add to payroll
   - Pay separately
5. 如果员工不在 Payroll Draft：
   - 不要只报技术错误；
   - 说明为什么；
   - 提供 `Open payroll draft` 或创建/刷新员工 entry 的明确下一步。
6. Category treatment 未确认时：
   - 只 hold 该笔 reimbursement；
   - 明确说明 salary payroll 不受影响；
   - 提供直达 Category Settings 的 action。
7. 完成 Payroll settlement 状态闭环：
   - 明确以 Payroll finalized 还是 payment batch paid 作为真正 `PAYROLL_SETTLED` 时点；
   - 同步更新 bridge snapshot、Claim reimbursement、Expense 和 audit event；
   - 保证幂等与不可重复结算。

### 必须保留的系统约束

- Policy revisions 与历史快照不可被覆盖。
- Receipt 必须保持 private authorization。
- Employee/tenant scope 不可放宽。
- Duplicate 继续 warning-only，除非产品明确改变规则。
- Reimbursement 不得变成 gross wage。
- Payroll Draft / finalized snapshot 不得被隐式重写。
- 两级审批开启时，Level 1 不得提前创建 reimbursement。
- Direct payment 与 Payroll settlement 必须幂等。
- Audit event 必须保留。

### 请 ChatGPT 输出

1. 优化后的 end-to-end flow。
2. 员工 Staff App IA 与文案。
3. HR Claims Inbox IA 与文案。
4. Approval、Reimbursement、Payroll 三个阶段的状态与按钮设计。
5. Category Settings 简化方案。
6. Error / empty / success states。
7. Mobile 与 desktop layout。
8. 不改变现有 engine 的分阶段实施计划。
9. Payroll settlement 闭环的技术变更清单与测试清单。

---

## 10. 最终流程摘要

```text
EMPLOYEE
Staff App /staff/claims
→ Submit claim + receipt
→ Policy validation + frozen snapshot
→ SUBMITTED

HR / MANAGER
/team/claims or /team/approvals
→ Review receipt and claim lines
→ Approve / Partially approve / Reject
→ Optional Level 2 Owner approval
→ ClaimReimbursement: AWAITING_CHANNEL

REIMBURSEMENT
├─ Pay separately
│  → OUTSIDE_PAYROLL_PENDING
│  → Record payment
│  → OUTSIDE_PAYROLL_PAID
│
└─ Through payroll
   → Select eligible DRAFT Payroll Run
   → Create PayrollClaimReimbursementSnapshot
   ├─ VERIFIED_NON_WAGE → READY → add to net pay
   └─ REVIEW_REQUIRED → BLOCKED_STATUTORY
      → update category policy
      → re-evaluate → READY

PAYROLL
READY reimbursement
→ Payroll Entry net pay
→ Payroll documents / payslip / export
→ Payroll finalized
→ [CURRENT GAP] reimbursement and bridge are not automatically written to SETTLED
```
