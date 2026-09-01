# TETAMU STAFF PAYSLIPS V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Staff 3000 的 `/staff/payslips` 已完成 Payslips V2 list + protected PDF UX，并已部署到 Railway Testing。实现保持 published-record-only、Net-first、整行单一 PDF 下载交互，没有推导 Deductions、工资付款状态或动态重建历史值。

范围声明：**LOCAL / RAILWAY TESTING ONLY**。本轮停在 Payslips V2；未继续 HTML Payslip Detail、Commission V2、Profile V2 或 Claim settlement。

## 2. PAGE STRUCTURE

页面使用共享 `StaffV2PageHeader`、`StaffV2SectionLabel`、`StaffV2RowGroup`、`StaffV2EmptyState` 与 Staff V2 tokens。结构为：Page Header → `PUBLISHED PAYSLIPS` → 单一 grouped surface。没有 giant hero、月份大卡或第二套 Staff 设计系统。

## 3. PUBLISHED HISTORY

只使用 `loadPublishedPayslipsForEmployee()` 读取 `PayrollPayslipPublication`，并以当前 session 的 `businessId + membershipId` 限定。每一行来自 publication-bound payroll period、`PayrollEntry.netPay` 与 `publishedAt`；PDF 仍来自 immutable publication bytes。

## 4. ORDERING

保留 canonical reader 排序：`payrollRun.periodStart DESC`，其次 `publishedAt DESC`。本地多月份 smoke 验证 August → July → June。没有按下载活动或文件名排序。

Publication 唯一性由 `payrollEntryId @unique` 与 `[payrollEntryId, businessId, membershipId]` 复合唯一约束保证；前端没有按月份静默 dedupe，因此不会错误合并合法的不同 payroll periods。

## 5. NET PAY

每行主要金额直接显示 publication-bound `PayrollEntry.netPay`，由 `Intl.NumberFormat("en-MY", { currency: "MYR" })` 格式化。没有 UI 计算。已验证 RM 1.00、RM 3,245.60 与 RM 123,456.78 的布局契约。

## 6. DEDUCTIONS OMITTED

Payslips list 不显示 Deductions，不计算 `Gross - Net`，也不显示 Gross。Pay Hub 既有设计未修改且仍不显示 Deductions。`staff-payslip-inline-summary` 等已无使用的 legacy list selector 已精确移除；Commission 仍依赖的 legacy selectors 保留。

## 7. STATUS

已发布记录只以 `Available since {publishedAt}` 表达。没有 `Paid`、`Transferred`、`Payment processing` 或 `Banked`，并明确保持 `publishedAt != payment date`。

## 8. DOWNLOAD PDF UX

每个月是一条完整 `<a>` 下载目标，整行可操作，没有嵌套 button/link。视觉尾端为 download icon；accessible label 包含期间、PDF 与 Net，例如：`Download August 2026 payslip PDF, net pay RM 3,245.60`。目标高度 76px，下载 affordance 至少 44px。

## 9. PDF ROUTE

路由保持 `/staff/payslips/[publicationId]`，语义未改变。没有新增 `/details`、公共 storage URL 或 shareable signed URL。HTML Payslip Detail 未实现。

## 10. PDF SECURITY

既有 route 原封不动保留：

- `getEmployeeSelfServiceAuthContext(request)`
- PAYROLL entitlement
- `businessId + membershipId + publicationId` own-only 查询
- 非法/foreign/logged-out 统一 fail closed
- `Content-Type: application/pdf`
- `Content-Disposition: attachment` 与 sanitized filename
- `Cache-Control: private, no-store`

聚焦 PostgreSQL integration 与本地 HTTP closure 已验证 own success、foreign membership、foreign business/workplace、foreign UUID、logged-out、revoked session、PAYROLL disabled。Service Worker 仍只缓存 PWA assets/manifest，不缓存 Payslip route。

## 11. ATTENDANCE-INDEPENDENT ACCESS

PAYROLL enabled、`attendanceEnabled=false` 的员工仍可读取列表与下载自己的 PDF。Integration 同时验证旧 Attendance-required auth 会 revoke，而 self-service auth 仍可成功，证明 Payslip 不再错误依赖 Attendance eligibility。

## 12. MANAGER-AS-EMPLOYEE

Staff Payslips reader 不读取 manager/team scope；Manager 在 Staff App 仍只使用自己的 employee `businessId + membershipId`。本地 persona 验证只出现自己的 RM 123,456.78，不出现另一员工的三个月金额。没有员工选择器、团队工资或 branch salary search。

## 13. MULTI-EMPLOYER

同一 EmployeeAccount 的 Employer A/B session 使用不同 membership/business scope。A publication 在 B session 下返回 404；B 页面不聚合 A 历史。workplace switch 后旧 employer publication fail closed，页面不会保留旧 employer amount。

## 14. HISTORICAL IMMUTABILITY

历史期间、Net 与 PDF 全部绑定 `PayrollPayslipPublication` 及其 PayrollEntry/PayrollRun。数据库 migration 的 immutable trigger 拒绝 published row update/delete，并验证 payroll run 必须 FINALIZED。UI 不读取 current compensation、Attendance、Claims、Commission 或 live payroll components，因此历史行不会随后续业务变化漂移。

## 15. EMPTY

空状态为紧凑 V2 surface：`No payslips available yet.` / `Your published payslips will appear here when they become available.`。没有推断“No payroll”或“Payroll preparing”，没有插图或绿色大卡。

## 16. LOADING

Loading 使用真实 V2 Page Header 与 3 条固定 76px row skeleton，设置 `aria-busy=true`，几何稳定；reduced-motion 下停止 pulse。旧 heading-only loading 已移除。

## 17. ERROR

Error 使用 `role=alert` 与员工安全文案：`Payslips couldn't load.`、`No stale or unpublished payslip is shown.`、`Try again`。没有暴露 Prisma、PayrollRun、publication ID、database、statutory 或 payment status。

## 18. MOBILE 360

360×800 populated：`scrollWidth 360 === innerWidth 360`、3 rows、最小 row 76px、0 clipped rows、单一 anchor/row。RM 123,456.78 专项截图同样无横向溢出。

证据：`artifacts/staff-payslips-v2/populated-360x800.png`、`artifacts/staff-payslips-v2/large-net-360x800.png`。

## 19. MOBILE 390

390×844 populated：一次可清楚扫描 3 个月，`scrollWidth 390 === innerWidth 390`，无 clipped rows。空状态与 Manager-as-employee 也在 390 验证。

证据：`artifacts/staff-payslips-v2/populated-390x844.png`、`empty-390x844.png`、`manager-as-employee-390x844.png`。

## 20. MOBILE 412

412×915 保持与 390 相同 IA 与 76px row，没有放大卡片；`scrollWidth 412 === innerWidth 412`、3 rows、0 clipped rows。

证据：`artifacts/staff-payslips-v2/populated-412x915.png`。

## 21. LARGE AMOUNTS

金额使用 tabular numerals、响应式字号、`min-width: 0` 与可换行安全布局。RM 123,456.78 在 360 上保持完整可读，不挤压 44px 下载目标；不以过小字体掩盖溢出。

## 22. ACCESSIBILITY

- 全页一个 H1（所有视觉状态 `h1Count=1`）
- grouped surface 为 `role=list`，每行 `role=listitem`
- 每行仅一个交互目标
- accessible label 包含 month + PDF + Net
- `Net pay` 文字标签与金额共同提供语义
- 76px row / 44px affordance
- `:focus-visible` 轮廓
- availability 由文字而非颜色表达
- Loading `aria-busy`、Error `role=alert`
- long text / large amount 可 reflow，无固定英文月份宽度

## 23. PAY HUB REGRESSION

Pay Hub 未修改，仍为 Current Pay、Net、Gross、Download PDF、Commission、Payslips；Payslips row 仍到 `/staff/payslips`。相关 focused 与 full unit regression PASS。

## 24. COMMISSION REGRESSION

Commission UI 未修改。reader 继续要求 `statement.calculationRevision === period.currentRevision`，并只返回安全状态集合；current-revision regression PASS。

## 25. PAYMENT STATUS SAFETY

Payslips 页面与 helper 均无 `Paid`、`Transferred`、`Payment processing`、`Banked`。产品只声称 PDF 已 `Available`，没有推断工资 settlement。

## 26. CLAIM SETTLEMENT GAP

`CLAIM PAYROLL SETTLEMENT = GAP` 保持不变。Payslips 不读取、不显示、不重建 Claim reimbursement lifecycle；没有尝试把 `PAYROLL_LINKED` 写成 `PAYROLL_SETTLED`。

## 27. FILES CHANGED

产品代码：

- `src/app/staff/payslips/page.tsx`
- `src/app/staff/payslips/loading.tsx`
- `src/app/staff/payslips/error.tsx`
- `src/components/staff-pwa/staff-payslips-v2.tsx`
- `src/components/staff-pwa/staff-payslips-v2.module.css`
- `src/app/staff/staff.css`（只移除已确认无引用的旧 Payslip selectors）

测试/证据：

- `tests/unit/staff-payslips-v2.test.ts`
- `tests/unit/staff-pay-read-only-correctness.test.ts`
- `tests/unit/staff-pwa.test.ts`
- `tests/unit/payroll-p4d-unified-workflow.test.ts`
- `scripts/prepare-staff-payslips-v2-visual-fixtures.ts`
- `scripts/capture-staff-payslips-v2-visuals.mjs`
- `scripts/verify-staff-payslips-v2-local.mjs`
- `artifacts/staff-payslips-v2/*`

## 28. TEST RESULTS

- Payslips/Pay/PDF/Staff focused unit：63/63 PASS
- embedded PostgreSQL focused integration：3/3 PASS
- 本地 authenticated HTTP closure：ordering、own PDF、Attendance-independent、foreign membership、multi-employer、logged-out、PAYROLL-disabled、manager-own-only 全 PASS
- Visual：6/6 states PASS；360/390/412 均无 overflow
- TypeScript `npx tsc --noEmit`：PASS
- ESLint：PASS
- `git diff --check`：PASS
- production build：PASS（Next 16.3.0 webpack）

Build 仅出现既有 Next middleware deprecation / Edge import warning；无 Payslips 新错误。

## 29. FULL UNIT STATUS

`npm test`：**1383/1383 PASS**，0 fail，0 skipped，约 15.6 秒。

## 30. CSS DEBT STATUS

新增一个窄范围 CSS Module：`staff-payslips-v2.module.css`。没有创建 overrides layer、MegaCard 或 MonthCard。共享 Staff V2 tokens/primitives 继续是唯一设计基础；仅删除确认为 Payslips legacy 且已无引用的 selector，未清理 Commission/Profile CSS。

## 31. NO BACKEND CHANGE

**NO BACKEND CHANGE**。

未修改 Payroll、Payslip publication reader/service、PDF generation/route、Payroll locking、Compensation、Commission、Claims reimbursement、Payment batch、Attendance、Timesheet、RBAC、session/device、API contracts 或 Prisma schema。实现只消费既有 published read model。

## 32. NO NEW MIGRATION

**NO NEW MIGRATION**。`prisma/migrations` 仍为 **212**。

## 33. TESTING DEPLOYMENT

Commit: `ae1d389`  
Deployment ID: `78d211b5-5155-4f37-b6f2-b965c59eb138`  
Status: **SUCCESS**

目标明确为 Railway `Tetamu-POS / testing / tetamu-staff-app`，region 配置为 `asia-southeast1-eqsg3a`。Post-deploy `/api/health` 返回 `ok: true`；`/staff/pay`、`/staff/payslips`、`/staff/commission` 均可响应，未登录浏览器显示 Staff login；foreign PDF UUID 返回统一 404。

既有 in-app Testing session 已停在 `/staff/login`，因此没有自动发送 OTP，也没有重复登录。Testing authenticated owner visual click/download 仍待 owner 使用现有登录流程复核；同一 production-code path 已在本地真实 session + PostgreSQL 完成 authenticated GET/PDF closure。

**TESTING ONLY**

## 34. PRODUCTION STATUS

**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮未查询、部署、迁移或修改 Production。
