# TETAMU Payroll — LINDUNG 24 Applicability Audit

审计日期：2026-08-26  
审计边界：Railway `testing`，只读审计  
目标 Business：`Payroll UAT Business`  
目标 Employee：`Real Device Payroll UAT Staff` / `UAT-PAYROLL-001`  
目标 Payroll Run：`2972941a-8067-4076-bf3b-24ddf08b308a`  
目标 Payroll Entry：`09a34a1a-fc19-40f6-bede-7ce2956b84eb`

## 1. Executive Summary

最终分类是：

```text
D. INSUFFICIENT_DATA_TO_DETERMINE
```

`LINDUNG24_PROFILE_INCOMPLETE` 不代表系统已经证明这名员工必须缴纳 LINDUNG 24。它代表当前 membership 缺少 resolver 所需的两类事实：员工的 statutory nationality，以及适用于 August 2026 的 Act 4 coverage / participation evidence。代码在资料不足时采用 fail-closed，因此 Payroll Readiness 正确停止。

当前证据既不能证明员工适用，也不能证明员工不适用。Repository 的工程闭环文件明确把法律/法定审核留给人工 sign-off，因此：

```text
LEGAL APPLICABILITY NOT VERIFIED
```

本轮没有修改员工、Business、LINDUNG 24、Payroll Draft、Payroll Run 或任何 Testing/Production 数据。

## 2. Testing Boundary

- `railway status --json` 当前指向项目 `Tetamu-POS`、environment `testing`；Testing Web、Staff App、Worker、WhatsApp 与 Postgres services 均属于该 environment。
- 本轮没有连接、读取或修改 Production。
- 当前 Testing Postgres 的私有连接需要本机 SSH key 口令；在不索取凭证、不改变基础设施的前提下，无法再次直接查询 live rows。Testing Web 也没有可复用的已登录 session。
- 因此员工、Business、Run 与 Entry 的事实来自同日生成的 canonical Testing fixture 报告：
  - `docs/TETAMU_ISOLATED_PAYROLL_UAT_BUSINESS_PREPARATION.md`
  - `docs/TETAMU_AUGUST_ISOLATED_PAYROLL_UAT_TO_PUBLISHED_PAYSLIP.md`
- 当前代码、schema、tests、Railway environment 与既有 blocker 已重新核对；无法独立 live re-query 的限制不改变 applicability 分类，因为 blocker 本身只证明资料不足，不证明适用性。

## 3. Payroll Blocker

Testing fixture 已建立：

- Basic salary：RM 3,000.00
- Gross pay：RM 3,000.00
- Draft net pay：RM 3,000.00
- Payroll Run：`2972941a-8067-4076-bf3b-24ddf08b308a`
- Payroll Entry：`09a34a1a-fc19-40f6-bede-7ce2956b84eb`

当前 statutory snapshot / Payroll Readiness blocker：

```text
LINDUNG24_PROFILE_INCOMPLETE
```

Readiness 将任何 `BLOCKED` statutory snapshot 转成 `BLOCKING` issue，Finalize 因而不能继续。证据：`src/lib/payroll/readiness.ts` 的 statutory snapshot loop 与 `readinessCodeForStatutoryBlocker()`。

## 4. Blocker Source Trace

Canonical trace：

```text
Payroll Draft generation
  → materializeStatutoryP2()
  → loops EPF / SOCSO / EIS / LINDUNG24 / PCB
  → resolveLindung24ParticipationForPeriod()
  → participation?.act4Covered ?? null
  → resolveLindung24Eligibility()
  → statutoryNationality / act4Covered missing
  → INSUFFICIENT_PROFILE
  → LINDUNG24_PROFILE_INCOMPLETE
  → BLOCKED statutory snapshot
  → BLOCKING Payroll Readiness issue
  → Finalize stopped
```

关键实现：

- `src/lib/payroll/statutory-p2.ts`：`materializeStatutoryP2()`；固定 materialize 五种 scheme，并在 LINDUNG 24 分支调用专属 resolver。
- `src/lib/payroll/lindung24-participation.ts`：`resolveLindung24ParticipationForPeriod()` 与 `resolveLindung24Eligibility()`。
- `src/lib/payroll/readiness.ts`：将 blocked snapshot 映射为 Payroll blocking issue。

## 5. Applicability Function

真正决定 LINDUNG 24 applicability 的函数是：

```text
resolveLindung24Eligibility({
  act4Covered,
  isEmployee,
  statutoryNationality
})
```

真实返回值只有：

- `ELIGIBLE`，并分类为 `LOCAL` 或 `FOREIGN`
- `NOT_ELIGIBLE`
- `INSUFFICIENT_PROFILE`

判定规则：

1. `isEmployee=false` → `NOT_ELIGIBLE / NOT_AN_EMPLOYEE_UNDER_CONTRACT_OF_SERVICE`
2. `act4Covered=null` 或 `statutoryNationality=null` → `INSUFFICIENT_PROFILE`
3. `act4Covered=false` → `NOT_ELIGIBLE / NOT_COVERED_BY_EMPLOYEES_SOCIAL_SECURITY_ACT_1969`
4. 其余 → `ELIGIBLE`，nationality 决定 local/foreign category

代码不会根据 phone、identity format、branch、salary 或 employment type 猜测 eligibility。

## 6. Employee Inputs

已确认的 Testing employee facts：

- Membership：`091ba7be-ced0-418b-8cf9-526921f10866`
- Employee ID：`UAT-PAYROLL-001`
- Active membership / active employment
- Joined：2026-07-01
- Monthly compensation：RM 3,000.00，effective 2026-08-01

用于 applicability、但当前没有被证明完整的 facts：

- `EmployeeBusinessMembership.statutoryNationality`
- August 2026 effective `EmployeeLindung24ParticipationVersion.act4Covered`
- matching participation state、employer context、selected employer 与 evidence source

Fixture preparation script 没有创建 statutory nationality 或 `EmployeeLindung24ParticipationVersion`；fixture report 亦记录 statutory profile 尚未配置。`lindung24OptIn=false` 只是 legacy default，不能解释为 Not Applicable。

## 7. Business Inputs

当前 schema 没有 Business-level LINDUNG 24 applicability/profile field。Business 只提供 tenant boundary、permission scope、RuleSet/Payroll scope；员工参与证据绑定于：

```text
businessId + membershipId
```

因此 `Payroll UAT Business` 没有一个可以自动替员工继承的 LINDUNG 24 default。当前证据没有显示该 Business 配置了 employee-specific participation record。

## 8. Default State

当前 canonical default 不是“关闭”或“不适用”：

- membership legacy `lindung24OptIn` schema default 是 `false`；closure 文件明确标为 legacy compatibility field，不再是 Payroll source of truth。
- 没有有效 participation version 时，resolver 会先检查 `act4Covered` 与 nationality。
- 资料不足时返回 `LINDUNG24_PROFILE_INCOMPLETE`。
- 资料显示 eligible 但没有 participation version 时返回 `LINDUNG24_PARTICIPATION_REQUIRED`。

所以“没有设置”与“Not Applicable”是不同状态。

## 9. Profile State

当前 Employee LINDUNG 24 state 应描述为：

```text
PROFILE INCOMPLETE / APPLICABILITY UNDETERMINED
```

不是：

```text
APPLICABLE
NOT APPLICABLE
OPTIONAL
```

`EmployeeLindung24ParticipationVersion` 必填 schema fields 包括：status、employerContext、selectedEmployer、act4Covered、sourceType、sourceReference、reason、effectiveFromMonth；`officialSubmittedAt` 在 voluntary opt-in/opt-out 时为业务必填。`statutoryNationality` 存在 membership profile 上，并且 canonical write service 在写 participation 前明确要求它存在。

## 10. Inheritance

没有跨 Business 或跨 membership 的 LINDUNG 24 profile inheritance：

- participation model 通过 composite foreign key 绑定 `businessId + membershipId`。
- 同一 global employee 在 Royal Salon 的任何资料不会自动成为 `Payroll UAT Business` 的 participation evidence。
- multiple-employer 只保存 current tenant 是否被 official evidence 选中，不会读取或合并另一 Business 的自然人资料。

因此 isolated Testing membership 必须有自己的、可审核的 evidence version。

## 11. Payroll Readiness Behavior

`materializeStatutoryP2()` 有一个重要不对称：

- `requiredSchemes` 只决定需要预载哪些 RuleSet/profile support。
- 后续 materialization loop 仍固定遍历全部五种 scheme。
- LINDUNG 24 在进入通用 `schemeRequired()` 逻辑前，先执行专属 participation resolver。

因此即使 `socsoEnabled=false`、legacy `lindung24OptIn=false`、nationality 尚未设定，LINDUNG 24 仍会因资料不足而产生 blocker。这个 blocker 是 fail-closed safety design，但文案“Complete participation”容易被理解成系统已证明必须参与；实际只证明 applicability 未决。

## 12. Comparison with EPF / SOCSO / EIS / PCB

| Scheme | 未启用/无 profile 时当前行为 | 与 LINDUNG 24 的差别 |
|---|---|---|
| EPF | `epfEnabled=false` 可先判 `NOT_APPLICABLE` | 先使用 common `schemeRequired()` |
| SOCSO | `socsoEnabled=false` 可先判 `NOT_APPLICABLE` | 先使用 common `schemeRequired()` |
| EIS | `eisEnabled=false` 可先判 `NOT_APPLICABLE` | 先使用 common `schemeRequired()` |
| PCB | 无 tax revision/TIN 时 scheme 不 required | 由 tax profile gate 决定 |
| LINDUNG 24 | 专属 resolver 先检查 nationality + Act 4 evidence；缺少即 blocker | 不会把 legacy false 当 Not Applicable |

这项差异是现有 implementation fact；它不等于法律上所有员工一律适用。

## 13. State Machine

只使用当前代码/schema 存在的状态：

### Eligibility state

```text
INSUFFICIENT_PROFILE
NOT_ELIGIBLE
ELIGIBLE (LOCAL | FOREIGN)
```

### Participation evidence enum

```text
MANDATORY
DEFAULT_PARTICIPATING
VOLUNTARY_OPT_IN
VOLUNTARY_OPT_OUT
```

### Employer context / selection

```text
SINGLE_EMPLOYER | MULTIPLE_EMPLOYER
CURRENT_BUSINESS | OTHER_EMPLOYER | PERKESO_SELECTION_PENDING
```

### Period resolver outcome

```text
NOT_APPLICABLE
NO_CONTRIBUTION
CONTRIBUTION_REQUIRED
BLOCKED
```

### Snapshot outcome

```text
CALCULATED
MANUAL
BLOCKED
NOT_APPLICABLE
```

## 14. Test Coverage

本轮只执行目标 unit file：

```text
pnpm exec tsx --test tests/unit/payroll-lindung24-participation.test.ts
7 passed / 0 failed
```

覆盖：

- missing `act4Covered` + nationality → `INSUFFICIENT_PROFILE`
- `act4Covered=false` → `NOT_ELIGIBLE`
- local/foreign participation transitions
- voluntary opt-out validation
- multiple-employer selected-employer handling
- legacy/overlap/once-in-always-in fail-closed
- permission + whole-business scope

Integration test `tests/integration/payroll-lindung24-participation-closure.test.ts` 覆盖 tenant binding、immutability、refund history 与真实 payroll materialisation。当前明显测试缺口：没有一项 materialization regression test 明确断言“完全未配置、所有 flags false 的普通 fixture”应 block 或应 not-applicable；这应由产品/法定决定后补测试，而不能在本轮擅自选择结果。

## 15. Classification

```text
D. INSUFFICIENT_DATA_TO_DETERMINE
```

证据：

- 当前 blocker 的直接来源是 `INSUFFICIENT_PROFILE`。
- 没有 `act4Covered=false` 的 evidence，不能分类 B。
- 没有完整 nationality + Act 4 participation evidence，不能分类 A。
- 代码没有一个无条件 C/optional 的默认分支。
- 当前 implementation 与 closure 文档一致采用 fail-closed，尚不足以判定 E/fixture defect；若产品决定 Testing-only non-statutory fixture 应跳过 LINDUNG 24，则需要另行作产品变更审计。

## 16. Missing Evidence

最低需要人工核实，而不是猜测：

1. statutory nationality
2. whether the employee is covered by Act 4 (`act4Covered`)
3. effective-from month
4. participation status
5. single/multiple employer context
6. selected payroll employer
7. evidence source type
8. evidence reference
9. audit reason/note
10. official submitted timestamp when opt-in/opt-out

哪个字段清除当前 `LINDUNG24_PROFILE_INCOMPLETE`：两项 eligibility facts 都必须完整——`statutoryNationality` 非 null，且 applicable period 能取得非 null `act4Covered`。之后若 eligibility 为 eligible，但 participation version 仍不存在，会转成 `LINDUNG24_PARTICIPATION_REQUIRED`，不会直接 ready。

## 17. Canonical Configuration Workflow

Desktop HR 入口：

```text
People
→ Employee UAT-PAYROLL-001
→ Statutory & Tax
→ LINDUNG 24 coverage
→ Edit coverage
```

实际 route：

```text
/team/people/091ba7be-ced0-418b-8cf9-526921f10866?section=statutory
```

Page / component：

- `src/components/employee-profile-payroll.tsx`
- `Lindung24ParticipationForm`

Action / service：

- `recordEmployeeLindung24ParticipationAction()` in `src/app/(business)/team/people/[personId]/payroll/actions.ts`
- `recordEmployeeLindung24ParticipationAndRefreshDrafts()`
- `recordEmployeeLindung24Participation()`

Payroll Run 的 Fix link 也会导向同一个 employee statutory route。

## 18. Permissions

真实 capability：

```text
PAYROLL_READ
VIEW_STATUTORY_PROFILE
EDIT_STATUTORY_PROFILE
```

其中 `EDIT_STATUTORY_PROFILE` implies `VIEW_STATUTORY_PROFILE` 与 `PAYROLL_READ`。Canonical service 还要求 whole-business branch scope；branch-only staff 即使有部分 payroll access 也会被 `LINDUNG24_WHOLE_BUSINESS_SCOPE_REQUIRED` 拦下。

因此“谁能编辑”应表述为：具有上述 statutory capabilities 且拥有整个 Business scope 的 authorized HR/payroll actor。代码没有把 Business Owner、HR、Payroll Admin 名称硬编码为唯一答案；应以实际 granted capabilities 为准。Staff self-service、attendance-only、branch-only actor 不能编辑。

## 19. Draft Refresh Requirements

完成或更正 profile 后必须重新 materialize Draft：

```text
Record genuine employee statutory nationality / LINDUNG 24 evidence
→ canonical write creates a new effective-dated participation revision
→ recordEmployeeLindung24ParticipationAndRefreshDrafts()
→ find affected DRAFT Payroll Runs
→ generatePayrollRun()
→ re-materialize statutory snapshots
→ rerun Payroll Readiness
→ only if all gates pass, proceed to review/finalize
```

Canonical action 会尝试自动 refresh affected Drafts。若某个旧 Draft 因 Timesheet 等原因无法 regenerate，service 会保留有效 participation evidence 并返回实际 refreshed count；该 Draft 仍需人工在 canonical Payroll flow 手动 refresh。答案：`YES`。

## 20. Risks

1. **Legal risk**：repository 只提供 engineering candidate 与 retained evidence；没有记录 legal/PERKESO/government approval。
2. **Inference risk**：根据 full-time、salary、nationality-looking phone 或另一 Business membership 猜 applicability 会违反 resolver design。
3. **Legacy risk**：把 `lindung24OptIn=false` 当作 Not Applicable 会与 canonical effective-dated model 冲突。
4. **UX risk**：Payroll blocker 文案可能让 HR 误以为员工已被证明 applicable。
5. **Fixture/product risk**：LINDUNG 24 专属 resolver 总是运行，而 EPF/SOCSO/EIS/PCB 有 disabled/not-required gate；缺少专门 regression test 来锁定完全未配置 fixture 的预期。
6. **Audit risk**：UI 把 reference/reason 显示为 optional 的部分文案与 service 的 `min(5)` validation 不完全一致。

## 21. Exact Next Step

```text
NEXT:
Human/legal review required before Payroll can continue.
```

授权 HR/statutory reviewer 应先核实这名员工在 `Payroll UAT Business` 下的真实 statutory nationality 与 Act 4/LINDUNG 24 participation evidence：

- 如果真实证据显示不适用，应通过同一 canonical employee statutory workflow 记录能够让 resolver 返回 `NOT_APPLICABLE` 的事实；不要用 legacy flag 或直接 DB update。
- 如果真实证据显示适用，应记录合法 participation state、effective month、employer selection 与 source evidence。
- 记录后 refresh Draft、重新 materialize snapshot 并 rerun readiness。

本审计不能替人工选择 A 或 B，也不能替 Testing fixture 编造法定事实。

## 22. Final Verdict

```text
Employee: UAT-PAYROLL-001
Payroll Run: 2972941a-8067-4076-bf3b-24ddf08b308a
Current Blocker: LINDUNG24_PROFILE_INCOMPLETE
Classification: D. INSUFFICIENT_DATA_TO_DETERMINE
Proven Applicable: NOT ENOUGH EVIDENCE
Proven Not Applicable: NOT ENOUGH EVIDENCE
Canonical HR UI: /team/people/091ba7be-ced0-418b-8cf9-526921f10866?section=statutory
Draft Refresh Required: YES
Legal Applicability: NOT VERIFIED
Data Changed: NO
Payroll Changed: NO
Production Touched: NO
```
