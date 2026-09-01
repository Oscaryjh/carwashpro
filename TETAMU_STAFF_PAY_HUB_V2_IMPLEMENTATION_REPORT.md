# TETAMU STAFF 3000 — PAY HUB V2 IMPLEMENTATION REPORT

Scope: **Staff 3000 only**  
Environment: **LOCAL / RAILWAY TESTING ONLY**  
Implementation commit: `18057f6`  
Railway Testing deployment: `ed4cadcb-e55b-4b19-87b9-8cc106586258`

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Pay Hub V2 已完成、通过完整 gates，并已部署到 Railway Testing。页面现在只呈现 published evidence：最新已发布期间、Net、Gross、PDF 下载、Commission 入口及 Payslips 历史入口。没有虚构 deductions、salary payment status、Claim reimbursement 或 Payroll admin state。

Railway Testing health 已确认本次 deployment 为 `SUCCESS`。现有 in-app-browser Staff session 已过期，所以部署后的 authenticated owner visual review 仍需 owner 自行登录后确认；本轮没有重复发送真实 OTP。已登录行为已由 local production-mode 真 session、fixture 和 embedded PostgreSQL integration 覆盖。

## 2. PAGE STRUCTURE

最终层级：

1. `Pay` Page Header
2. `CURRENT PAY`：published summary 或 compact empty state
3. `EARNINGS`：Commission（仅 COMMISSION enabled）
4. `HISTORY`：Payslips（仅 PAYROLL enabled）
5. subtle privacy copy

复用 `StaffV2PageHeader`、`StaffV2CompactSummary`、`StaffV2ListRow`、`StaffV2ActionRow`、`StaffV2StatusBadge`、`StaffV2EmptyState` 和 shared bottom navigation；没有 giant hero 或 dashboard card wall。

## 3. CURRENT PAY

唯一来源仍为 `loadPublishedPayslipsForEmployee({ businessId, membershipId })` 的最新 publication。Pay Hub 不读取 live PayrollRun draft、Attendance、Claims、live Commission 或 compensation 来重建薪资。

PAYROLL disabled + COMMISSION enabled 时，不渲染假的 Payslip empty state，只显示 Commission。两者都 disabled 时保留既有 module-not-enabled 行为。

## 4. PUBLISHED PERIOD

期间来自 publication 所属 PayrollRun 的 `periodStart`，以 `Asia/Kuala_Lumpur` 和 `en-MY` 格式显示，例如 `August 2026`。状态只显示 `Available`，表示 publication 可用，不暗示已经支付。

## 5. NET PAY

Net pay 直接显示 publication-bound `payrollEntry.netPay`，是页面最强金额。UI 不做重新计算；使用 MYR formatter、tabular numerals、独立行和可换行保护。

## 6. GROSS PAY

Gross pay 直接显示 publication-bound `payrollEntry.grossPay`，作为 Net 之后的次要事实。没有给予与 Net 相同视觉权重，也没有从其他组件重算。

## 7. DEDUCTIONS OMITTED

Pay Hub V2 完全不显示 Deductions，也没有 `Gross - Net` 推导或 unavailable placeholder。原因保持为：canonical publication-bound `totalDeductions` 仍需要 read-model enrichment。

## 8. DOWNLOAD PDF

CTA 固定为 `Download PDF`，目的地保持 `/staff/payslips/[publicationId]`，没有新建 HTML detail route。Accessible label 包含月份和文件类型，例如 `Download August 2026 payslip PDF`。

## 9. COMMISSION ENTRY

仅在 COMMISSION enabled 时显示：

- Title: `Commission`
- Meta: `View statements`
- Route: `/staff/commission`

Hub 不显示 Commission 金额，不改变现有 Commission 页面。

## 10. PAYSLIPS ENTRY

仅在 PAYROLL enabled 时显示：

- Title: `Payslips`
- Meta: `View all published payslips`
- Route: `/staff/payslips`

没有把历史月份卡片嵌进 Hub，也没有视觉重写 Payslips 页面。

## 11. NO PUBLICATION

安全文案为：

- `Payslip not available yet.`
- `Your payslip will appear here when your employer makes it available.`

没有显示 Preparing、Payroll not run、Finalizing 或 Payment pending。Commission enabled 时仍继续显示 Commission 入口。

## 12. PRIVACY

使用轻量文案：`Your pay information is private to this employee account.` 没有 modal、warning banner、bank account、last4 或 hide/reveal toggle。

## 13. PAYMENT STATUS SAFETY

页面没有 Paid、Salary paid、Transferred、Banked 或 Payment processing。`Available` 只描述 published payslip evidence，不把 PayrollPaymentBatch 当作员工银行到账证据。

## 14. MULTI-EMPLOYER

页面 reader 始终使用当前 Staff session 的 `businessId + membershipId`。Local fixture 让同一个 EmployeeAccount 同时拥有两个 Business membership；两套 session 只读取各自 workplace publication。Integration 进一步验证 Business A session 不能下载 Business B publication，workplace switch 后旧 publication fail closed。

## 15. MANAGER-AS-EMPLOYEE

Manager capability 没有进入 Pay Hub query 或 props。Manager 在 Staff Pay 仍只按自己的 membership 读取。Local manager-as-employee fixture 与 own-only integration 均通过；没有 team salary、branch salary 或 approval/admin action。

## 16. LOADING

新增 route-level `loading.tsx`：稳定 Page Header、compact current-pay geometry 和 row skeleton，包含 `aria-busy="true"`、reduced-motion support，没有 giant hero skeleton。

## 17. ERROR

新增 employee-safe `error.tsx`：

- `Pay couldn't load.`
- `Try again.`
- `role="alert"`

不会暴露 Prisma、PayrollRun、publication ID、statutory 或 payment batch 信息。

## 18. MOBILE 360

Published 与 RM123,456.78 状态均实测：

- `innerWidth=360`
- `scrollWidth=360`
- 最小 touch height `52px`
- 无 clipped target
- bottom-nav clearance `157px`

证据：`artifacts/staff-pay-hub-v2/published-360x800.png`、`artifacts/staff-pay-hub-v2/long-large-amount-360x800.png`。

## 19. MOBILE 390

Published、no-publication、manager-as-employee 均实测：

- `innerWidth=390`
- `scrollWidth=390`
- 最小 touch height `52px`
- bottom-nav clearance `176px`（published）/ `367px`（empty）

首屏包含 Header、period/status、Net、Gross、PDF、Commission、Payslips 和 privacy copy。证据位于 `artifacts/staff-pay-hub-v2/*390x844.png`。

## 20. MOBILE 412

Published 状态实测：

- `innerWidth=412`
- `scrollWidth=412`
- 最小 touch height `52px`
- bottom-nav clearance `244px`
- IA 与 390 完全一致，没有放大卡片

证据：`artifacts/staff-pay-hub-v2/published-412x915.png`。

## 21. LARGE AMOUNTS

Fixtures 覆盖 RM1.00、普通四位金额和 RM123,456.78；CSS 使用 `min-width: 0`、`minmax(0, 1fr)`、own-line amount、`overflow-wrap:anywhere` 与 tabular numerals。RM123,456.78 在 360px production-mode screenshot 完整显示，没有横向溢出或不可读缩字。

## 22. ACCESSIBILITY

- 一个 `h1`（Pay）
- currency 文本具有清楚 label/value，并保留 `RM` 与完整数值
- `Available` 使用文字，不只靠颜色
- full-row accessible names
- PDF label 含 month/file type
- visible targets 最小高度 52px（高于 44px）
- shared focus-visible/list semantics
- loading `aria-busy`
- error `role=alert`
- amount/copy 可换行，支持 text zoom

## 23. PDF SECURITY REGRESSION

Embedded PostgreSQL integration PASS：

| Case | Result |
|---|---|
| own PDF | 200, `application/pdf`, `%PDF` |
| PAYROLL enabled + Attendance disabled | PASS |
| PAYROLL disabled | 403 |
| foreign membership | 404 |
| foreign business / switched workplace old publication | 404 |
| missing/foreign/malformed UUID | 404 |
| revoked session | 404 |
| cache policy | `private, no-store` |
| disposition | `attachment` |

Protected download route、session/device、module entitlement 与 ownership check 均未修改。

## 24. COMMISSION REVISION REGRESSION

Integration PASS：employee Commission reader 只返回 `statement.calculationRevision === period.currentRevision`，旧 revision 被抑制，并同时满足 businessId 与 membershipId scope。

## 25. CLAIM SETTLEMENT GAP

**CLAIM PAYROLL SETTLEMENT = GAP**，本任务没有修复或隐藏 `PAYROLL_LINKED → PAYROLL_SETTLED` 缺口。Pay Hub 不读取、不合计、不呈现 Claim reimbursement lifecycle。

## 26. HOME / TIME / REQUESTS REGRESSION

Focused Staff regressions 共 `119/119 PASS`，覆盖 Pay Hub、Pay correctness、Staff PWA/nav、Home V2、Time Hub、Requests Hub、Approval Center、Android Home、Leave 与 Claims。Bottom nav 仍是 `Home / Time / Requests / Pay / Profile`；上述页面均未修改。

## 27. FILES CHANGED

Runtime presentation：

- `src/app/staff/pay/page.tsx`
- `src/app/staff/pay/loading.tsx`
- `src/app/staff/pay/error.tsx`
- `src/components/staff-pwa/staff-pay-hub-v2.tsx`
- `src/components/staff-pwa/staff-pay-hub-v2.module.css`

Tests / LOCAL-only evidence：

- `tests/unit/staff-pay-hub-v2.test.ts`
- `tests/unit/staff-pwa.test.ts`
- `scripts/prepare-staff-pay-hub-v2-visual-fixtures.ts`
- `scripts/capture-staff-pay-hub-v2-visuals.mjs`
- `artifacts/staff-pay-hub-v2/*`

没有修改 `/staff/payslips`、`/staff/commission`、Home、Time、Requests、Profile、Approval Center 或 3100。

## 28. TEST RESULTS

| Gate | Result |
|---|---:|
| Pay Hub V2 focused tests | PASS |
| Expanded Staff regressions | 119/119 PASS |
| Embedded PostgreSQL integration | 12/12 PASS |
| TypeScript `tsc --noEmit` | PASS |
| ESLint | PASS, 0 errors; 3 unrelated pre-existing warnings |
| `git diff --check` | PASS |
| Next production build | PASS |
| 6-state Chrome production-mode visual capture | PASS |
| Railway Testing build/deploy | SUCCESS |
| Railway `/api/health` | `ok=true`, `database=ready`, `environment=testing` |
| unauthenticated Pay/Payslips/Commission | fail closed to Staff sign-in |

## 29. FULL UNIT STATUS

`npm test`: **1375/1375 PASS**, 0 failed, 0 skipped, 0 todo。

## 30. CSS DEBT STATUS

只新增 narrow CSS module `staff-pay-hub-v2.module.css`，复用 shared V2 tokens/primitives。没有 `staff-pay-v2-overrides.css`、第三层 giant override、PayMegaCard、SalaryHeroCard 或 PayDashboardCard；未清理与本任务无关的 legacy Payslip/Commission CSS。

## 31. NO BACKEND CHANGE

**CONFIRMED — NO BACKEND CHANGE.**

Payroll、Payslip publication、locking、Compensation、Commission calculation/approval、Claims reimbursement、Payment batch、Attendance、Timesheet、RBAC、session/device、API contracts 与 Prisma schema 均未修改。新增 fixture/capture scripts 受 Local-host guard 限制，只用于视觉验证。

## 32. NO NEW MIGRATION

**CONFIRMED — NO NEW MIGRATION.** `prisma/migrations` 无变更。隔离 Local PostgreSQL 只应用现有 212 migrations。

## 33. TESTING DEPLOYMENT

- Target: `Tetamu-POS / testing / tetamu-staff-app`
- Region: Southeast Asia (`asia-southeast1-eqsg3a`)
- URL: `https://tetamu-staff-app-testing.up.railway.app`
- Commit: `18057f6`
- Deployment ID: `ed4cadcb-e55b-4b19-87b9-8cc106586258`
- Status: **SUCCESS**
- Health release evidence: deployment ID matches; `environment=testing`; database `ready`

Post-deploy public/unauthenticated smoke PASS。Existing browser Staff session 已过期，受保护 routes 均显示 Staff sign-in，无数据泄漏；没有为了 smoke 再发送 OTP。Owner 登录后的 physical-device review 是下一步，不是代码 blocker。

## 34. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮在 Pay Hub V2 停止。没有继续 Payslips V2、HTML Payslip Detail、Commission V2 或 Profile V2。
