# TETAMU STAFF 3000 — PAY V2 READ-ONLY CORRECTNESS PREREQUISITES REPORT

审计与交付日期：2026-09-01（Asia/Singapore）  
Canonical workspace：`C:\CodexTetamuP0`  
Canonical Staff App：3000 ONLY  
范围：LOCAL / RAILWAY TESTING ONLY

## 1. FINAL VERDICT

**READY**

本轮成功关闭 Pay V2 的三个代码前置问题：员工端不再伪造 deductions、Commission 只返回 period 的 current revision、Payslip PDF 不再依赖 Attendance eligibility。Claim payroll settlement 的现况也已从真实代码明确分类为 **GAP**；这符合本阶段“明确识别剩余 gap、不要发明新 workflow”的成功标准。

本轮没有开始 Pay Hub V2、Payslips V2、HTML Payslip Detail、Commission V2 或 Profile V2。

## 2. WRONG DEDUCTIONS BEFORE

以下两个员工界面把 `grossPay - netPay` 当成 Deductions：

- `/staff/pay`
- `/staff/payslips`

这在存在非工资 reimbursement 时不成立，因为 canonical payroll aggregate 是：

`net = gross - non-statutory deductions - statutory deductions + reimbursement`

因此 `gross - net` 会把 reimbursement 抵消进所谓 deductions，既不是 canonical deduction total，也不是安全的历史展示值。

## 3. DEDUCTIONS FIX

- `/staff/pay` 已移除 Deductions summary item。
- `/staff/payslips` 已移除每期 row 内的 Deductions 数值。
- Gross 与 Net 继续直接读取已发布 payslip 所绑定的 `PayrollEntry.grossPay` / `netPay`，没有改变金额。
- 没有用另一种估算值替代，也没有增加新 money widget。

## 4. CANONICAL DEDUCTIONS READINESS

**READ MODEL ENRICHMENT REQUIRED**

Payroll 内部有 canonical evidence，包括 `PayrollEntryComponent(type = DEDUCTION)` 与 finalized statutory snapshots（EPF、SOCSO、EIS、PCB、CP38、LINDUNG24 等）。但是当前员工 publication-bound list reader 只安全返回已发布记录的 Gross / Net；它没有一个已固化、publication-bound 的 `totalDeductions` 字段或结构化 immutable breakdown。

在没有安全 read-model enrichment 前，员工 Pay / Payslip list 正确行为是省略 Deductions，而不是从 live/mutable records 重建。

## 5. REIMBURSEMENT / NET SAFETY

验证了 `PayrollClaimReimbursementSnapshot` 通过 payroll aggregate 加入 Net，但不会加入 Gross。新增 regression 以 cents 验证：

- Gross：`300000`，保持不变。
- Canonical statutory deductions：`39000`。
- Reimbursement：`12345`。
- Net：`300000 - 39000 + 12345`。
- `Gross - Net` 不等于 `39000`，因此不得解释为 Deductions。

没有改变 reimbursement calculation、gross calculation 或 net calculation。

## 6. COMMISSION CURRENT-REVISION GAP

修复前，`getEmployeeCommissionStatements` 只按 business、membership 与安全状态过滤，没有强制：

`statement.calculationRevision === period.currentRevision`

同一 period 重新计算后，旧 statement revision 可能与新 revision 一起被员工 reader 当成当前 statement 返回。

## 7. COMMISSION FIX

`getEmployeeCommissionStatements` 现在在数据库层 join `commission_statements` 与 `commission_periods`，并强制：

`statement.calculation_revision = period.current_revision`

同时保留：

- `businessId` scope
- `membershipId` scope
- 状态只限 `CALCULATED` / `APPROVED` / `APPLIED_TO_PAYROLL`
- 原有 order / accrual read behavior

旧 revision canonical rows 没有删除或修改。过滤在 DB 完成，不会先加载全部历史 revision 再在内存筛选。

员工文案保持：

- `CALCULATED` → Estimated · pending review
- `APPROVED` → Approved · frozen
- `APPLIED_TO_PAYROLL` → Approved · sent to Payroll

没有把任何 Commission 状态显示为 Paid。

## 8. COMMISSION REVISION TEST

真实 PostgreSQL integration scenario 已覆盖：

- period revision 1 + statement revision 1
- period current revision 更新为 2 + statement revision 2
- employee reader 只返回 revision 2
- revision 1 被抑制但数据库 row 保留
- 第二个 period 的 current statement 仍可见
- 同 business 的另一 membership 不可见
- 另一 business 的 statement 不可见
- 返回的每个 statement 均满足 `calculationRevision === period.currentRevision`

静态 regression 还锁定安全状态集合与 `APPLIED_TO_PAYROLL != Paid`。

## 9. PAYSLIP PDF AUTH BEFORE

`/staff/payslips/[publicationId]` 原本调用 attendance-default 的 `getEmployeeAuthContext(request)`。该 guard 会要求 Attendance eligibility；合法 PAYROLL 员工即使有有效 Staff session 与自己的 published payslip，只要 Attendance 不适用，也可能被错误 fail-closed，并撤销该 session。

PDF 的实际 ownership query 原本已经正确绑定：

- `publicationId`
- `businessId`
- `membershipId`

问题是入口 auth guard 耦合错了，不是 publication ownership 太弱。

## 10. PAYSLIP AUTH FIX

PDF route 改用 `getEmployeeSelfServiceAuthContext(request)`，并继续执行：

- 有效 Staff employee device/session
- 当前 session 的 business / membership
- `PAYROLL` module entitlement
- `loadOwnPublishedPayslip({ publicationId, businessId, membershipId })`
- 未拥有或无效 publication 统一 fail closed

route 没有公开化，没有新增 auth framework，也没有削弱 publication ownership。

## 11. ATTENDANCE-INDEPENDENT PAYSLIP ACCESS

真实 PostgreSQL integration 已建立：

- employee membership `attendanceEnabled = false`
- PAYROLL enabled
- published own payslip
- valid active Staff session

结果：

- attendance-default guard 拒绝该 session，证明旧耦合确实存在。
- self-service guard 接受独立有效 session。
- published payslip list 可读取。
- own PDF 返回 200 与有效 `%PDF` bytes。
- PAYROLL disabled 时 PDF 返回 403。

因此 Payslip access 已不依赖 Attendance，但仍依赖 PAYROLL 与有效 Staff session。

## 12. PAYSLIP SECURITY REGRESSION

已覆盖并通过：

- own publication → 200
- other membership publication → 404
- other business publication → 404
- guessed valid foreign UUID → 404
- invalid UUID → 404
- logged out → 404
- revoked session → 404
- workplace / employer switch 后旧 employer publication → 404
- PAYROLL disabled → 403
- manager-as-employee fixture 只使用自己的 membership scope；角色不会扩张 ownership

所有 foreign ownership 情况没有返回薪资内容。

## 13. PDF RESPONSE / CACHE

保持原 contract：

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="..."`
- `Cache-Control: private, no-store`
- filename 继续经过既有 sanitization
- route 名称不变
- PWA service worker 仍不缓存 `/staff/payslips/...`

没有改成 public URL，也没有创建 HTML payslip detail。

## 14. CLAIM PAYROLL SETTLEMENT AUDIT

真实代码链如下：

1. `selectClaimReimbursementChannel` 负责从 `AWAITING_CHANNEL` 选择 PAYROLL channel。
2. 它在目标 Draft Payroll Run / employee PayrollEntry 内创建 `PayrollClaimReimbursementSnapshot`。
3. statutory treatment 已满足时 snapshot 创建为 `READY`；否则为 `BLOCKED_STATUTORY`。
4. 同一 transaction 把 Claim reimbursement 更新为 `PAYROLL_LINKED`。
5. `reevaluateClaimPayrollTreatment` 可把 `BLOCKED_STATUTORY` snapshot 更新为 `READY`，并重算 entry aggregates。
6. payroll aggregate 会读取 READY reimbursement snapshot，把 amount 加入 Net、不会加入 Gross。
7. `finalizePayrollRun` 当前没有更新 snapshot 为 `SETTLED`，也没有把 Claim reimbursement 更新为 `PAYROLL_SETTLED`。

Repo-wide writer audit 没有找到 application/service writer 关闭最后两个状态；只发现 schema、reader 与 presentation 对这些终态的认识。

## 15. CLAIM SETTLEMENT OWNER

| Lifecycle transition | 当前 owner | 现况 |
|---|---|---|
| `AWAITING_CHANNEL → PAYROLL_LINKED` | `selectClaimReimbursementChannel` | 存在；同时创建 snapshot |
| snapshot create | `selectClaimReimbursementChannel` | 存在；`READY` 或 `BLOCKED_STATUTORY` |
| `BLOCKED_STATUTORY → READY` | `reevaluateClaimPayrollTreatment` | 存在；只允许 Draft Payroll Run |
| snapshot `READY → SETTLED` | 无 application writer | 缺失 |
| reimbursement `PAYROLL_LINKED → PAYROLL_SETTLED` | 无 application writer | 缺失 |

目前没有 canonical final settlement owner，也没有自动或人工 closure path。

## 16. CLAIM SETTLEMENT STATUS

**GAP**

系统能安全完成 payroll linking、snapshot creation 与 READY eligibility，但不能由现有 canonical application path 完成：

`PAYROLL_LINKED → PAYROLL_SETTLED`

本轮按约束只做 audit 与 characterization，没有发明 writer、没有把 payroll finalization 擅自解释成 claim settlement，也没有预造 passing behavior。

语义继续保持：

- Claim Approved != Paid
- PAYROLL_LINKED != included in published payslip
- published payslip reimbursement snapshot 是进入该 pay result 的 evidence
- PAYROLL_SETTLED != salary bank transfer completed

## 17. PAYMENT STATUS GAP

**PAYMENT_STATUS_READ_MODEL_REQUIRED — unchanged**

当前 PayrollPaymentBatch / instruction statuses 是 payment preparation，不是银行结算证据。因此 Staff Pay 没有新增 Paid、Transferred 或 Payment processing 状态。

## 18. MULTI-EMPLOYER

- Payslip list 与 PDF 始终使用当前 session 的 `businessId + membershipId`。
- employer/workplace switch 后，旧 employer publication fail closed。
- Commission reader 同样在 DB 层绑定 business + membership。
- 没有跨 employer 汇总 salary 或 commission。

## 19. MANAGER-AS-EMPLOYEE

Manager 在 Staff App Pay 仍只作为当前 employee membership 读取自己的数据。Manager capability/role 不会扩大 Payslip 或 Commission scope，也不会获得其他员工的 Staff payslip。Payroll admin/team routes 没有被暴露到 Staff employee reader。

## 20. FILES CHANGED

受控部署提交 `87f09e765b019f853eeeed0b70990737c1d9c056` 包含 7 个文件：

- `src/app/staff/pay/page.tsx`
- `src/app/staff/payslips/page.tsx`
- `src/app/staff/payslips/[publicationId]/route.ts`
- `src/lib/commission/read.ts`
- `tests/unit/staff-pay-read-only-correctness.test.ts`
- `tests/integration/staff-pay-read-only-correctness.test.ts`
- `tests/unit/staff-pwa.test.ts`

本报告为审计交付物，不属于已部署 runtime commit。

## 21. TEST RESULTS

| Gate | Result |
|---|---|
| 新 Pay correctness unit | PASS，5/5 |
| 新 PostgreSQL integration | PASS，2/2 |
| 相关 embedded PostgreSQL integrations | PASS，12/12 |
| TypeScript `tsc --noEmit` | PASS |
| Scoped ESLint | PASS |
| Full `npm run lint` | PASS，0 errors；5 个既有无关 warnings |
| Production build | PASS |
| 受控 commit `git diff --check HEAD^ HEAD` | PASS |

相关 regression 组合包含 Staff auth/session、Attendance employee auth、Commission engine、Claims reimbursement、Payroll payslip、P4D 与本轮 Pay security scenarios。

## 22. FULL UNIT STATUS

**PASS — 1412/1412**

第一次 full unit run 唯一失败是旧测试仍要求显示 Deductions；测试按正确产品 contract 更新为“不得显示推导 Deductions”后，完整 unit suite 全部通过。没有放宽业务规则。

## 23. INTEGRATION STATUS

**PASS — relevant embedded PostgreSQL integration 12/12**

本轮新 integration 2/2 在全新临时 PostgreSQL、完整 212 migrations 上通过。相关既有 embedded suites 与新 suite 合计 12/12。没有宣称执行整个仓库的所有 integration 文件；执行的是任务要求相关的 Staff auth、Claims reimbursement、Commission、Payroll/Payslip 与 Pay correctness integration 集合。

Railway Testing post-deploy：

- `/api/health` → 200
- `/staff/pay` → 200，未登录时显示 Staff login，不泄露 Pay data
- `/staff/payslips` → 200，未登录时显示 Staff login，不泄露 Payslip data
- `/staff/commission` → 200，未登录时显示 Staff login，不泄露 Commission data

部署后没有额外发送真实 OTP；authenticated own-PDF contract 已由真实 PostgreSQL route integration 验证。

## 24. SECURITY STATUS

**PASS for implemented prerequisite scope**

已明确验证：

- Pay employee ownership
- Payslip PDF business + membership + publication ownership
- Commission business + membership ownership
- manager-as-employee isolation
- revoked session denial
- logged-out denial
- PAYROLL module gate
- COMMISSION page 继续使用 canonical `requireEmployeeModulePage("COMMISSION")`
- workplace switch 后旧 employer data denial
- no manager/team salary route leakage introduced

## 25. NO NEW WORKFLOW

**CONFIRMED**

没有创建 payroll engine、claim settlement engine、auth framework、HTML payslip detail 或第二套 payment workflow。Claim final settlement gap 被记录而没有被伪造修复。

## 26. NO NEW MIGRATION

**CONFIRMED — NO NEW MIGRATION**

数据库 schema 未修改；测试使用现有完整 212 migrations。

## 27. TESTING DEPLOYMENT

**TESTING ONLY**

- Commit：`87f09e765b019f853eeeed0b70990737c1d9c056`
- Deployment ID：`21070eef-f22a-4d6f-93bb-45a74c607e64`
- Status：`SUCCESS`
- Service：`tetamu-staff-app`
- Environment：`testing`
- URL：`https://tetamu-staff-app-testing.up.railway.app`
- Railway production build：PASS（Next.js compiled、TypeScript、145 static pages generation）
- Health / route smoke：PASS

部署来源是干净受控 worktree / branch `codex/staff-pay-read-only-prereqs`，没有把 canonical workspace 中其他未完成修改带入 Testing。

## 28. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

---

Stop rule 已执行：本轮停止于 Pay V2 read-only correctness prerequisites，等待 owner review。
