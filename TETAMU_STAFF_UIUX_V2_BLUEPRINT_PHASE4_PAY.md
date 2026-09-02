# TETAMU STAFF 3000 — UI/UX V2 BLUEPRINT PHASE 4

## PAY + PAYSLIPS + COMMISSION

审计日期：2026-09-01  
Canonical workspace：`C:\CodexTetamuP0`  
Canonical Staff App：3000 ONLY  
3100：REFERENCE ONLY / READY TO RETIRE / DO NOT USE  
环境：LOCAL / TESTING ONLY

本文件是产品、UI/UX、read-model 与安全蓝图，不是实现报告。结论来自当前 Staff 3000 工作树、Prisma schema、Payroll / Payslip / Commission / Claims 服务、相关测试，以及 `artifacts/staff-ui-capture` 中 K01、K03、K05 的 390/412 浏览器视觉快照。没有依据旧文档假设功能已存在，也没有访问 Production。

---

## 1. FINAL DESIGN VERDICT

Pay V2 应继续使用现有 `/staff/pay` 作为轻量、个人、只读的入口，并严格分开五个概念：

- **Payroll result**：雇主完成的 payroll 结果，不等于工资已经实际支付。
- **Payslip**：从 `FINALIZED` payroll run 发布出的、员工可访问的 immutable PDF 记录。
- **Commission**：独立的 commission statement；`CALCULATED`、`APPROVED`、`APPLIED_TO_PAYROLL` 分别代表不同阶段。
- **Claim reimbursement**：业务费用偿还，不是工资收入；只有 payslip publication snapshot 能证明它实际进入某次 pay result。
- **Salary payment**：当前模型只做到 payment instruction/batch 准备，没有员工可依赖的实际付款完成证据。

最终设计方向：

1. **保留现有路由，替换呈现层**，不把 Pay 改成 Payroll 管理工具。
2. **Net pay 是已发布 payslip 的主数字**；未发布时不展示草稿金额。
3. **Pay Hub 只展示 canonical read model 已证明的内容**；当前可安全展示 latest published period、gross、net 与 publication availability。
4. **暂不在 Hub 展示 Deductions 数字**。现有 `grossPay - netPay` 在存在 non-wage reimbursement 时会错误，因为 `netPay = gross - deductions + reimbursement`。
5. **Payslip 列表可直接 V2 化；HTML detail 需先补结构化 publication read model**。当前真正 immutable 的完整员工记录是存储的 PDF bytes + SHA-256，而不是一个 Staff HTML detail payload。
6. **Commission V2 必须先关闭 current-revision 缺口**。当前 employee query 没有过滤 `statement.calculationRevision === period.currentRevision`，重新计算过的 period 可能返回旧 statement revision。
7. **不显示 `Paid`**。Payroll payment batch 的 `APPROVED` / `INSTRUCTION_READY` 不是实际付款完成。
8. **Claims 继续拥有 reimbursement lifecycle；Pay 只说明某项是否实际进入已发布 payslip**，不建立第二套 Claims archive。

本轮未发现会扩大他人薪资访问范围的 critical security bypass；但 PDF 路由目前错误使用 attendance-default auth guard，可能让 attendance-disabled 的合法员工看得到列表却下载不到 payslip。这是 fail-closed availability coupling，应在实施期单独修正并测试。

核心原则：**Pay is personal. Pay is read-only. Net pay first. Details on demand. No inferred payment.**

---

## 2. PAY V2 PRODUCT PRINCIPLES

1. 员工只看到当前 workplace session 下自己的 pay 数据。
2. manager 身份不会扩大 Staff Pay 的薪资可见范围。
3. Pay Hub 回答“最近可用的工资记录是什么”，不会伪装成 Payroll engine dashboard。
4. draft、review、finalized-but-unpublished payroll 不作为员工的最终 payslip。
5. 已发布 payslip 的 Net pay 是主数字；Gross 与其他 totals 是辅助事实。
6. UI 不从 label 猜测 earning/deduction，也不从 Claims 重新计算 Net pay。
7. `Approved`、`Added to payroll`、`Included in finalized payroll`、`Paid` 必须保持不同语义。
8. Commission 是 earning source，但 commission statement 不等于当前 payslip line，也不等于已付款。
9. Claims 是 reimbursement lifecycle 的 owner；Payslip publication 是该 reimbursement 是否进入某个 pay result 的 owner。
10. 历史记录只读，不能从 live compensation、attendance、claim 或 commission 重建。
11. 不在 Staff Pay 暴露 payroll run ID、revision、digest、rule pack、bank artifact、statutory submission 或 admin actions。
12. 使用已批准 Staff V2 primitives：Page Header、Compact Summary、grouped List Rows、Action Row、Status Badge、Detail Section、Empty State、共享 period navigator。
13. financial values 必须 mobile-first、可换行、可被辅助技术正确理解。
14. 不新增第三层巨型 CSS override；Pay 页面迁移后应删除其对应 legacy class 依赖。

---

## 3. CURRENT PAY AUDIT

### 3.1 当前真实实现

| 区域 / 元素 | 当前实现 | 主要问题 | V2 决策 |
|---|---|---|---|
| Bottom tab | `Pay`，active prefixes 包括 `/staff/pay`、`/staff/payslips`、`/staff/commission` | IA 正确；只在 PAYROLL 或 COMMISSION module 启用时出现 | **KEEP** |
| Pay page header | `MY PAY / Pay / Find available payslips...` | 使用 legacy hub heading；视觉比已批准 V2 page header 大 | **REPLACE** 为 `StaffV2PageHeader` |
| Latest payslip | 一张大 summary card，显示 month、Available、Gross、Deductions、Net、View payslip | 信息重要，但 card 内又有三张 mini-card；`Deductions = Gross - Net` 在 reimbursement 场景错误 | **KEEP intent / REPLACE data + presentation** |
| Net pay | 来自 published payslip 关联的 `PayrollEntry.netPay` | canonical value 可用；当前视觉仍与 Gross/Deductions 争权 | **KEEP / PROMOTE** |
| Gross pay | 来自 `PayrollEntry.grossPay` | canonical value可用 | **KEEP / SECONDARY** |
| Deductions | 客户端/页面层以 `grossPay - netPay` 推导 | reimbursement 加入 Net、但不进入 Gross，算法会低估甚至产生错误值 | **REMOVE current derivation**；需要 canonical total |
| `View payslip` | 指向 PDF route，但文案说 View | response 是 `Content-Disposition: attachment`，实际是下载，不是 HTML view | **RENAME** 为 `Download PDF`；未来 HTML detail 另设 route |
| Payslips hub card | 大型 legacy hub card | 与 latest payslip CTA 重复，垂直空间较多 | **MERGE** 为 compact History row |
| Commission hub card | 与 Payslips 同等重量的大卡 | Commission 应是次级 earning destination；当前没有可靠 latest-revision summary | **REPLACE** 为 compact row，先不显示总额 |
| Pay no-publication state | `Not available yet` + 中性说明 | 语义安全，但无法区别未运行、准备中、finalized 未发布 | **KEEP copy / SIMPLIFY surface** |
| Payslip list | 每月一张 article；month、available date、Gross/Deductions/Net、全宽 View button | 重复金额与状态；`Deductions` 同样有错误；每月 row 太厚 | **REPLACE** 为 compact month rows |
| Payslip loading | 只显示标题与一句说明 | 没有稳定 skeleton rows | **REPLACE** |
| Payslip error | fail-closed，明确不展示 stale/unpublished document | 安全语义正确；视觉仍是 legacy empty block | **KEEP behavior / NORMALIZE visual** |
| Payslip detail | 没有 HTML page；只有 protected PDF download route | 无 mobile-native detail；当前不能做结构化 detail | **KEEP PDF / READ MODEL ENRICHMENT REQUIRED** |
| Commission header | 整页包在 `staff-page-card`，内用 payslip heading | 沿用 Payslip legacy styles，缺少独立 V2 hierarchy | **REPLACE** |
| Commission statement | period、accrual count、status、final amount | 没有 period navigator、detail route、source title、loading/error；旧 revision 可能混入 | **KEEP canonical statement / REPLACE read + UI** |
| Commission empty | 小型 nested empty block | 文案安全；外层整页 card 造成 nested surface | **SIMPLIFY / FLATTEN** |
| Pay privacy | 进入 Pay 后金额始终可见 | 产品简单，但目前没有显式“私人资料”说明 | **KEEP VISIBLE**；加轻量 privacy copy，不强制 toggle |

### 3.2 视觉快照结论

- `K01-pay-hub-current-390/412`：首屏由 latest payslip 大卡 + Payslips 大卡 + Commission 大卡构成；三个目的地视觉权重接近，且 gross/deductions/net 又被拆成三块。
- `K03-payslip-list-current-390/412`：单一记录也占用高厚度卡片与全宽 CTA；下方大面积空白是内容不足，不应以更大 illustration 填补。
- `K05-commission-current-390/412`：header 与 empty state 双层 card；没有 period/action/read-model 信息，只剩大面积空白。
- 快照未覆盖 360、长金额、commission populated、pay error、commission error、reimbursement payslip；它们不是 physical-device UAT。

---

## 4. CURRENT ROUTES / OWNERSHIP

### 4.1 路由

| Route | 当前类型 | Guard / scope | Canonical source | 决策 |
|---|---|---|---|---|
| `/staff/pay` | Server page | `getEmployeeSelfServiceAuthContext()`；current `businessId + membershipId`；module entitlement | `loadPublishedPayslipsForEmployee` + enabled modules | **KEEP route / REPLACE UI** |
| `/staff/payslips` | Server page | `requireEmployeeModulePage("PAYROLL")` | published payslip list | **KEEP route / REPLACE UI** |
| `/staff/payslips/[publicationId]` | Route handler returning PDF | employee session、PAYROLL module、UUID、`publicationId + businessId + membershipId` | immutable `PayrollPayslipPublication.documentBytes` | **KEEP as protected PDF download** |
| `/staff/commission` | Server page | `requireEmployeeModulePage("COMMISSION")`；current business + membership | `getEmployeeCommissionStatements` | **KEEP route / REPLACE read + UI** |
| HTML payslip detail | **NOT PRESENT** | — | — | 未来建议 `/staff/payslips/[publicationId]/details`，避免破坏现有 download route |
| Commission detail | **NOT PRESENT** | — | — | 只有在 employee-safe detail read model 完成后再新增 |
| Pay child loading/error | Pay：无专属；Payslips：有；Commission：无专属 | — | — | **ADD presentation only during implementation** |

### 4.2 数据所有权

| Product concept | Canonical owner | 当前 Staff reader | 结论 |
|---|---|---|---|
| Payroll process | `PayrollRun` / `PayrollEntry` / components / statutory snapshots | 不直接暴露 process | Staff Pay 不可管理 |
| Published payslip | `PayrollPayslipPublication` | list + own PDF reader | 员工记录 owner |
| Payslip lines | published PDF bytes；生成时来自 finalized entry/components/statutory/reimbursement snapshots | Staff 没有结构化 line reader | HTML detail 需 enrichment |
| Commission | `CommissionPeriod` / `CommissionStatement` / `CommissionAccrual` | `getEmployeeCommissionStatements` | 可读，但 current revision 与 safe labels 不完整 |
| Claim lifecycle | `EmployeeClaim` / `ClaimReimbursement` | Claims V2 overview | 继续由 Claims 拥有 |
| Payroll claim result | `PayrollClaimReimbursementSnapshot`，并被 published PDF 包含 | 只在 PDF 生成路径读取 | Pay detail 可展示；Hub 暂无 reader |
| Salary payment execution | `PayrollPaymentBatch` / `PayrollPaymentInstruction` | Staff 无 reader；模型也无 actual-paid terminal status | `PAYMENT_STATUS_READ_MODEL_REQUIRED` |

### 4.3 权限边界

- current employee auth context 固定 `employeeAccountId + membershipId + businessId + deviceId`。
- list 与 download 都通过 `membershipId + businessId` 约束，不依赖隐藏链接。
- Staff Pay 不读取 manager role，也没有 team salary route；manager 只能看自己的 employee membership pay。
- workplace switch 会撤销旧 session 并建立新 membership/business session；Pay 不跨 employer 聚合。
- module entitlement 控制入口与页面，但不是 ownership guard 的替代品。

---

## 5. PAY HUB V2

### 5.1 IA

有 published payslip：

1. `StaffV2PageHeader`：`Pay`；meta 为当前 employer，不显示 branch-wide/team wording。
2. `CURRENT PAY`：latest published period + Net pay 主值 + `Payslip available` badge。
3. Compact facts：只显示 canonical Gross 与 Net；**在 total deductions read model 完成前省略 Deductions**。
4. Primary action：`Download PDF`；若未来有 HTML detail，则 primary 改为 `View details`，download 为 secondary。
5. `EARNINGS`：Commission compact List Row，仅在 module enabled 时出现；current reader 修正前显示 `View statements`，不显示金额。
6. `HISTORY`：Payslips List Row，`View all payslips`。

没有 published payslip：

1. Page Header。
2. compact status row：`Payslip / Not available yet`。
3. safe copy：`Your payslip will appear here when your employer makes it available.`
4. Commission destination 仍可见（如果 module enabled）。

### 5.2 不进入 Hub 的内容

- payroll readiness、run status、revision、statutory blocker。
- payment batch、bank instruction、bank account。
-完整 Earnings/Deductions line breakdown。
- Claims history 或 reimbursement lifecycle。
- 未经过 canonical latest-revision reader 的 commission total。

### 5.3 Period wording

当前 reader 只能确定“最新已发布 payslip 的 period”，不能确定“当前 calendar payroll 正在处理”。因此标题必须是具体月份，例如 `August 2026`，不能把无 publication 的 September 自动称为 `Preparing`。

---

## 6. PAY CURRENT-PERIOD STATUS

| Canonical evidence | 安全员工文案 | 不可说 | 说明 |
|---|---|---|---|
| current membership 有 `PayrollPayslipPublication` | `Payslip available` | `Paid` | publication 证明员工可以取到 finalized PDF |
| publication 的 periodStart | `August 2026` | `Current payroll`（除非确实是当前 period） | 这是 pay period，不是 payment date |
| 无 publication | `Not available yet` | `Preparing`、`No payroll`、`Not eligible` | 当前 reader 无法区别这些原因 |
| PayrollRun `DRAFT` / `REVIEW` | Staff 当前不可见 | 任何 final amount | 不应暴露草稿计算 |
| PayrollRun `FINALIZED` 但未 publication | Staff 当前不可见 | `Payslip available` | finalized 不等于 published |
| publication exists + stored bytes | `Available since {date}` | `Recently paid` | publishedAt 是发布日，不是付款日 |
| payment batch `APPROVED` / `INSTRUCTION_READY` | Staff 不显示 | `Paid` / `Transferred` | 只是付款准备过程 |

若产品必须区分 `Preparing`、`Finalized awaiting publication` 与 `No payroll`，需要一个明确的 employee-safe current-period read model；不能让 Staff 直接读取 admin PayrollRun。

---

## 7. PAYSLIPS V2

默认结构：

1. `StaffV2PageHeader`：`Payslips`；meta：`Your published pay records.`
2. 按 `payrollRun.periodStart DESC, publishedAt DESC` 排序。
3. 每个 publication 使用 compact List Row：month、Net pay、可选 `Available` badge、chevron。
4. `publishedAt` 放进 row secondary meta 或 detail，不重复占主层级。
5. 不显示 Gross/Deductions/Net 三段句子；Net 是 scanning value。
6. row 至少 56px、整行可点击；若点击仍直接下载，accessible name 必须说明 PDF/download。
7. 历史不限于“current month”；列表清楚显示每一 publication 的 month。

当前 loader 已支持完整 published history，没有分页。记录增长后再评估 pagination；本轮不虚构上限。

---

## 8. PAYSLIP AVAILABILITY

| State | 当前 Staff 可见性 | V2 contract |
|---|---|---|
| Payroll DRAFT | 不可见 | 不展示 payslip 或 amount |
| Payroll REVIEW | 不可见 | 不展示 payslip 或 amount |
| Payroll FINALIZED、未 publish | 不可见 | neutral `Not available yet` |
| Published | 可见 | `Payslip available` + owned PDF action |
| Publication update/delete | DB trigger 禁止 | 历史 record immutable |
| Reopen run after publication | service 拒绝 | 不提供 Staff action |
| Withdraw/unpublish | **NOT SUPPORTED** | 不设计 withdrawn 状态 |
| 其他 membership/business publication | own reader 返回 null | 404，不泄漏是否存在 |

Publication trigger 只允许从 FINALIZED run INSERT，并禁止 publication UPDATE/DELETE。`documentBytes` 与 `documentSha256` 是完整冻结证据。V2 不从 live records 重建已发布 PDF。

---

## 9. PAYSLIP DETAIL

### 9.1 当前能力

- **HTML detail：NOT PRESENT**。
- **PDF detail：READY**，内容包括 period、employee snapshot、attendance、earnings、employee deductions、non-wage reimbursements、net pay、employer contributions 与 statutory metadata。
- Staff reader 目前只返回 PDF bytes、employeeCode snapshot、periodStart；没有结构化 detail payload。

### 9.2 V2 detail hierarchy

未来 HTML detail 必须从 publication-bound、employee-owned structured snapshot 读取：

1. Page Header：month + `Payslip available`。
2. Compact Summary：Net pay 最强；Gross 与 canonical total deductions 次级。
3. Earnings Detail Section。
4. Deductions Detail Section。
5. Reimbursements Detail Section（只有 publication snapshot 有 line 时）。
6. pay period / employer / publication date metadata。
7. `Download PDF` Action Row。

在 structured publication read model 完成前，不应把 live PayrollEntry、Claims 或 Commission 拼成“HTML payslip”。可先只实施 Payslips V2 list + protected PDF download。

---

## 10. EARNINGS

Canonical source 是 `PayrollEntryComponent`：

- `type = EARNING`
- frozen `name`
- `amount`
- `currency`
- `sourceType`
- `sortOrder`

PDF 生成器优先使用 component earnings；没有 components 时才 fallback 到 Basic pay、Overtime pay、Public holiday pay、Allowances。V2 HTML detail 应遵循相同 canonical order，不按 label 字符串猜分类。

Commission 若已经通过 `PayrollVariablePay` 进入 payroll，会作为 canonical earning component（例如 frozen `Commission`/`Approved commission` line）出现；这才是该 commission 进入此 payslip 的证据。

显示规则：

- label 左、金额右；长 label 允许两行。
- earning amount 使用正常正值，不用绿色 badge 表示“好”。
- 不显示 internal `sourceId`、`lineKey`、revision、digest。

---

## 11. DEDUCTIONS

Canonical sources 分为：

- non-statutory `PayrollEntryComponent.type = DEDUCTION` 且 `sourceType !== STATUTORY`；
- EPF、SOCSO、EIS、LINDUNG24、PCB、CP38 的 finalized snapshot/entry values。

当前没有 Staff-ready `totalDeductions` 字段。PDF server code 会从 canonical snapshot values 求和；Pay page 却使用 `grossPay - netPay`，这在 reimbursement 存在时不成立。

V2 contract：

1. 删除 `Gross - Net` 推导。
2. total deductions 必须由 publication-bound read model 明确返回，或由同一 canonical server formatter产生。
3. row classification 使用 component `type` / statutory scheme，不根据名字猜测。
4. deduction line 可显示 `−RM 330.00`，但 underlying amount 不被前端改写。
5. statutory item 可以显示员工熟悉的 EPF/SOCSO/EIS/PCB；不显示 rule version、submission/human sign-off status。

---

## 12. REIMBURSEMENTS

Payroll-linked claim 的 canonical pay evidence 是 `PayrollClaimReimbursementSnapshot`：

- snapshot 绑定 `businessId + membershipId + payrollRunId + payrollEntryId`；
- frozen `claimNumberSnapshot`、approved claim revision、amount、currency；
-只有 `READY` / `SETTLED` snapshot 被 payroll aggregate 与 payslip PDF 使用；
- reimbursement 被加到 Net，但不增加 Gross salary。

当前 PDF 会显示：`REIMBURSEMENTS (NON-WAGE)` + `Claim {claimNumber}` + amount。当前 Staff list/Hub loader 不返回这些 lines。

V2 contract：

- Payslip detail 可显示 frozen claim number与 amount。
- 不自行查询 current Claim total 并加入 Net。
- 不称 reimbursement 为 earning/salary。
- 想显示更友善的 claim purpose/description 时，需要在 publication snapshot 冻结该安全 label；不能读取后来可变的 live purpose 替代历史证据。
- Pay Hub 初版不显示 reimbursement amount，直到 publication summary reader 明确提供。

---

## 13. PAYSLIP VIEW / DOWNLOAD

当前只有一个能力：**authenticated PDF download**。

当前 response：

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="{employeeCode}-{YYYY-MM}-payslip.pdf"`
- `Content-Length`
- `Cache-Control: private, no-store`

因此当前 UI 文案应从 `View payslip` 改为 `Download PDF`。不要同时显示 `View` 与 `Download` 两个等价按钮。

若未来增加 HTML view：

- 保留 `/staff/payslips/[publicationId]` 为现有 download URL，避免破坏历史链接。
- 新增 `/staff/payslips/[publicationId]/details` 作为 HTML detail。
- detail 内只保留一个 secondary `Download PDF` action。
- 两条 route 使用相同 employee ownership predicate。

禁止 public/signed-but-shareable payslip URL，禁止把 PDF 放进 public storage 或 service-worker cache。

---

## 14. PAYSLIP PRIVACY / SECURITY

### 14.1 UX recommendation

最终推荐：**KEEP VISIBLE inside Pay only**。

理由：

- 用户已经主动进入经 OTP/device/session 保护的个人 Pay tab。
- 强制 hide/reveal 会增加一个状态与屏幕阅读器风险，却不能阻止截图或肩窥。
- amount 不应出现在 Home、notification preview 或 manager surface；在 Pay 内直接可读更简单。

可以在 header 下加入轻量说明：`Your pay information is private to this employee account.` 不使用 modal 或 giant warning。

若 owner 未来选择 optional toggle：必须 session-local、默认行为明确、隐藏值不可被屏幕阅读器继续朗读、不得用 localStorage 长期保存薪资偏好；本 Phase 不实施。

### 14.2 Security expectations

- 所有 summary/detail/download 都要求 active employee session + device `canView`。
- query 必须同时绑定 publication ID、business ID、membership ID。
- unauthorized/not found 使用同一 404，避免 ID existence oracle。
- salary responses 使用 `private, no-store`；HTML page 也应 force-dynamic/no-store。
- workplace switch、logout、session revoke 后旧 token 不得继续取 PDF。
- filename 继续 sanitize employeeCode。
- service worker 只 cache manifest/PWA icons，不能 cache payslip route。

---

## 15. COMMISSION V2

Commission V2 回答四件事：period、final statement amount、review/payroll-link state、组成 lines。

当前可用 canonical fields：

- statement：eligible sales、calculated commission、adjustment、final commission、status、calculation revision；
- period：earned start/end、approvedAt、currentRevision；
- accrual：eligible amount、commission amount、status；
- source event：source type、business date、gross amount、net amount；
- adjustments：amount、type、reason、payrollStatus；
- payroll link：`payrollVariablePayId` / statement `APPLIED_TO_PAYROLL`。

当前缺口：

1. employee query 没有 `calculationRevision = period.currentRevision` 条件，旧 calculated statement 可能重复显示。
2. 没有 employee-safe source/item/service/product name、invoice reference 或 branch label。
3. 没有 Commission detail route、loading/error boundary、period navigator。
4. raw `ruleSnapshot` / `calculationTrace` 不适合直接暴露给员工。

V2 先以 canonical latest revision statement 为单位，再做 period navigation。Hub 只显示 `Commission / View statements`，直到 reader 能可靠返回 latest canonical total。

---

## 16. COMMISSION PERIOD

Current model 支持历史 period，不只 current month；`getEmployeeCommissionStatements` 会按 statement `createdAt DESC` 读取全部三种状态，但未分页、未去除旧 revision。

V2 period contract：

- 使用 shared Staff V2 period navigator；label 由 `earnedPeriodStart – earnedPeriodEnd` 产生。
- 月期间可显示 `August 2026`；非整月期间必须显示完整日期范围，不强行月化。
- previous/next 只能在 reader 返回的可用 canonical periods 内移动。
- current canonical statement 必须满足 `statement.calculationRevision === period.currentRevision`。
- `period.status = LOCKED` 与 statement approval evidence 一致后才可称 Approved。
- 不把 `createdAt` 当 earning period。

在 query 修正前，Commission history 状态为 **PARTIAL / READ MODEL ENRICHMENT REQUIRED**。

---

## 17. COMMISSION DETAIL

### 可安全显示

| Field | Employee presentation |
|---|---|
| `finalCommissionCents` | Total commission |
| `eligibleSalesCents` | Eligible sales（secondary） |
| `calculatedCommissionCents` | Calculated commission |
| `adjustmentCents` | Adjustments（只有非零时） |
| `sourceEvent.businessDate` | Earning date |
| `sourceEvent.sourceType` | Service / Product / Package purchase / Package redemption |
| `sourceEvent.grossAmountCents` / `netAmountCents` | Source amount（明确 gross/net wording） |
| `accrual.eligibleAmountCents` | Eligible amount |
| `accrual.commissionAmountCents` | Commission amount |
| statement status | Awaiting review / Approved / Added to payroll |

### 当前不可安全显示

- “Hair colouring”等真实 item title：reader 没有返回。
- invoice number / customer：reader 没有返回，也需要 privacy review。
- commission rate：可能藏在 JSON trace/rule snapshot，但未形成 typed employee-safe field。
- `Paid`：model 不支持。

Detail row 初版只能用 date + source type + commission amount。若产品要求 item name/rate，先建立 employee-safe enrichment；不要把 raw JSON 或 internal calculation IDs输出到 UI。

---

## 18. CLAIM / PAYROLL REIMBURSEMENT

Claims V2 已拥有 employee reimbursement lifecycle：

- `Approved — awaiting payment`
- `Payment processing`
- `Paid`（outside payroll）
- `Added to payroll`
- `Included in finalized payroll`

Pay V2 的责任更窄：

- Hub：默认不重复 Claims archive。
- Payslip detail：只展示 publication snapshot 中实际包含的 non-wage reimbursement lines。
- 可选 Hub info row：只有 employee-safe reader 明确返回 `PAYROLL_LINKED` 时显示 `Claims / Added to payroll`，且点击回 `/staff/claims`；不显示为工资已付。
- `PAYROLL_SETTLED` 的 presentation 已存在，但当前 source audit 没找到负责把 READY/PAYROLL_LINKED 自动推进到 SETTLED/PAYROLL_SETTLED 的明确 application write path。实施前必须确认 lifecycle closure；本轮不更改。

---

## 19. APPROVED CLAIM VS PAYROLL RESULT

| Evidence | 正确语义 | Pay/Payslip presentation |
|---|---|---|
| Claim APPROVED / PARTIALLY_APPROVED | reimbursement obligation 已批准 | Claims 拥有；Pay 不加总 |
| Reimbursement AWAITING_CHANNEL | 尚未选择/完成付款路径 | 不进入 Pay summary |
| PAYROLL_LINKED | 已绑定某个 payroll run/entry | 可说 `Added to payroll`，不可说已包含在已发布 payslip |
| Snapshot READY | canonical payroll calculation 会把它加入 Net | admin/process evidence；员工 Hub 不单独曝光 |
| Published PDF 包含 reimbursement line | 已进入该 finalized published pay result | Payslip detail 显示 under `Reimbursements` |
| Snapshot SETTLED / reimbursement PAYROLL_SETTLED | product 文案为 `Included in finalized payroll` | 不等于 salary bank payment completed |
| OUTSIDE_PAYROLL_PAID | 已通过 payroll 外方式支付 | Claims 展示；不混进 Payslip Net |

严禁：从 approved Claims 列表求和，然后把金额加到 Pay Hub Net。

---

## 20. PAYMENT STATUS

当前 Payroll payment architecture 有：

- Batch：DRAFT、AWAITING_APPROVAL、APPROVED、INSTRUCTION_READY、CANCELLED、SUPERSEDED。
- Instruction：BLOCKED、READY、INCLUDED、EXCLUDED。

这些状态描述 payment instruction 准备与 batch workflow，没有 `SENT`、`BANK_ACCEPTED`、`SETTLED` 或 `PAID` 的 employee-level execution evidence；Staff 也没有 employee payment reader。

结论：

- `Paid`：**UNSUPPORTED**。
- `Payment pending/processing`：也不能从 publication 推断。
- Pay V2 只能说 `Payslip available`。
- 若未来接入 bank execution/settlement，必须新增 canonical employee payment result，绑定 business + membership + payroll entry，并区分失败/退回/settled。

正式 gap code：`PAYMENT_STATUS_READ_MODEL_REQUIRED`。

---

## 21. MULTI-EMPLOYER

1. Pay scope 使用当前 employee session 的 `businessId + membershipId`，不是 phone number 全局查询。
2. Business A 的 publication 不会在 Business B session 中被 list 或 download。
3. workplace switch 撤销旧 session、建立新 session，并重新加载 module entitlements与 Pay 数据。
4. Pay Hub 不聚合不同 employer 的 salary、commission 或 claims。
5. page header 应显示当前 employer name；branch 可作为 workplace context，但 salary ownership 仍是 business membership。
6. employee 同时是 manager/owner 时，Staff Pay 仍只读取自己的 membership；team payroll 只能在独立 admin surface、独立 capability 下访问。

---

## 22. EMPTY STATES

| 场景 | V2 copy | 规则 |
|---|---|---|
| Pay 无 publication、Commission enabled | `Payslip not available yet.` / `Your payslip will appear here when your employer makes it available.` | Commission row仍显示 |
| Pay 无 PAYROLL、Commission enabled | 不显示 payslip summary；直接显示 Commission destination | 不说 payroll error |
| Pay 无 PAYROLL、无 COMMISSION | 继续 module-not-enabled flow | 不显示空 Hub |
| Payslips 无记录 | `No payslips available yet.` | compact Empty State，无 illustration |
| Commission 无 canonical statement | `No commission statement yet.` | 不说没有 commission entitlement |
| Commission selected period 无 lines | `No commission lines for this period.` | 只有在 period 本身存在时使用 |
| Payslip无 reimbursements | 整个 Reimbursements section 不渲染 | 不显示 `RM 0.00` 巨型区块 |

无法区别 payroll not run / preparing / finalized awaiting publication 时，一律使用 neutral `Not available yet`。

---

## 23. LOADING

- Pay Hub：Page Header skeleton + compact current-pay summary skeleton + 2 rows。
- Payslips：3 个固定高度 month-row skeleton。
- Payslip detail：Net summary + 两个 detail-section skeleton；不先展示旧金额。
- Commission：period control + amount summary + 3 rows。
- skeleton 高度与完成态一致，避免 bottom nav 附近 layout jump。
- 使用 `aria-busy="true"` 和一个可读 loading label；不逐个 skeleton 宣读。
- 不使用 giant hero skeleton。

当前只有 `/staff/payslips/loading.tsx`，且只显示 heading；Pay/Commission 需在实施时补 segment-level loading。

---

## 24. ERROR

通用文案：

- Pay：`Pay couldn't load.` / `Try again.`
- Payslips：保留 fail-closed 语义：`No stale or unpublished payslip is shown.`
- Commission：`Commission couldn't load.` / `No amount has been changed.`
- Download 失败：`Payslip not found.` 或统一 404，不暴露 ownership原因。

错误 UI：compact alert + 44px Retry；不显示 Prisma、run ID、publication ID、digest、calculation engine、statutory状态或数据库错误。

---

## 25. STATUS SYSTEM

| Canonical source evidence | Employee copy | Tone | 层级 | Actionability |
|---|---|---|---|---|
| Payslip publication exists | `Available` | success | Primary on latest payslip | View/download |
| No publication evidence | `Not available yet` | neutral | Secondary | None |
| Commission `CALCULATED` + current revision | `Awaiting review` | warning | Primary statement status | None for employee |
| Commission `APPROVED` | `Approved` | success | Primary statement status | None |
| Commission `APPLIED_TO_PAYROLL` | `Added to payroll` | info | Primary statement status | View payslip only when a later publication proves inclusion |
| Claim reimbursement `AWAITING_CHANNEL` | `Approved — awaiting payment` | warning | Claims-owned | View Claim |
| Claim reimbursement `PAYROLL_LINKED` | `Added to payroll` | info | Claims-owned | View Claim |
| Published payslip reimbursement line | `Included in this payslip` | neutral/info | Secondary fact | None |
| Claim `OUTSIDE_PAYROLL_PAID` | `Paid separately` | success | Claims-owned | None |
| Claim `PAYROLL_SETTLED` | `Included in finalized payroll` | success | Claims-owned | View Claim/Payslip |
| Payroll finalized only | **No Staff label** | — | — | — |
| Payment batch approved/instruction ready | **No Staff label** | — | — | — |
| Actual salary payment | **Unsupported** | — | — | — |

`Published` 可作为系统词，但员工主要 label 统一为 `Available`。`Final` 只描述 payroll calculation，不用作 salary payment status。

---

## 26. READ MODEL READINESS MATRIX

| Desired Pay V2 feature | Readiness | Current evidence / gap |
|---|---|---|
| Latest published period | **READY** | publication → payrollRun.periodStart |
| Latest published Net pay | **READY** | publication → payrollEntry.netPay |
| Latest published Gross pay | **READY** | publication → payrollEntry.grossPay |
| Current calendar-period pay | **PARTIAL** | reader只知道 latest publication，不知道 current cycle state |
| Canonical total deductions | **READ MODEL ENRICHMENT REQUIRED** | 无字段；`gross-net` 被 reimbursements破坏 |
| Payslip availability | **READY** for published / **PARTIAL** for unpublished reason | publication existence可靠；无 publication 原因不明 |
| Payslip history | **READY** | employee-scoped publication list |
| Payslip PDF download | **READY** with guard caveat | protected bytes route；attendance auth coupling需修正 |
| Payslip HTML detail | **READ MODEL ENRICHMENT REQUIRED** | 没有 publication-bound structured detail reader |
| Earnings lines | **PARTIAL** | canonical components存在；Staff reader未返回 |
| Deduction lines | **PARTIAL** | components/statutory snapshot存在；Staff reader未返回 |
| Reimbursement lines | **PARTIAL** | frozen snapshot进入 PDF；Staff structured reader未返回 |
| Published PDF integrity | **READY** | bytes + SHA-256 + immutable DB trigger |
| Commission total | **PARTIAL** | final amount存在；employee reader未限定 current revision |
| Commission history | **PARTIAL** | periods/history存在；旧 revision 去重缺口、无 pagination |
| Commission status | **PARTIAL** |三种 canonical status可映射；current-revision问题 |
| Commission detail amounts/date/type | **PARTIAL** | accrual/source fields存在 |
| Commission source title/item | **READ MODEL ENRICHMENT REQUIRED** | reader没有 human-safe item/service/product name |
| Commission rate explanation | **READ MODEL ENRICHMENT REQUIRED** |只有 raw JSON snapshot/trace，不应直出 |
| Commission included in payroll | **PARTIAL** | APPLIED_TO_PAYROLL 证明 linked，不证明 finalized publication included |
| Payroll-linked Claim Hub summary | **READ MODEL ENRICHMENT REQUIRED** | Claims reader有 lifecycle；Pay没有 publication summary |
| Claim reimbursement in Payslip PDF | **READY** | PDF使用 READY/SETTLED frozen snapshots |
| Claim purpose in historical payslip | **UNSUPPORTED** | publication snapshot只冻结 claim number/amount |
| Salary payment status | **UNSUPPORTED** | no actual execution settlement state；`PAYMENT_STATUS_READ_MODEL_REQUIRED` |
| Salary payment date | **UNSUPPORTED** | publishedAt/finalizedAt不是 payment date |
| Bank destination in Staff | **UNSUPPORTED** | payment instruction有 last4，但无 Staff-owned reader；不应复用 admin reader |
| Privacy toggle | **UI-READY but NOT RECOMMENDED** | 产品可做，不是 canonical data requirement |

---

## 27. PAY HUB WIREFRAME

### Published state（仅使用当前已证明字段）

```text
[PH] Pay
     Royal Salon · Your personal pay records

CURRENT PAY
August 2026                              [Available]

Net pay
RM {publication.payrollEntry.netPay}

Gross pay
RM {publication.payrollEntry.grossPay}

[AR] Download PDF                              >

EARNINGS
[LR] Commission
     View statements                           >

HISTORY
[LR] Payslips
     View all published payslips               >
```

`Deductions` 与 `Claims included` 在对应 read-model enrichment 完成前不出现在 Hub。

### No-publication state

```text
[PH] Pay
     Royal Salon · Your personal pay records

[ES] Payslip not available yet.
     Your payslip will appear here when your employer
     makes it available.

EARNINGS
[LR] Commission
     View statements                           >
```

---

## 28. PAYSLIP LIST WIREFRAME

```text
[PH] Payslips
     Your published pay records.

[LR] August 2026                 RM {netPay}
     Available since 29 Aug 2026              >

[LR] July 2026                   RM {netPay}
     Available                                  >

[LR] June 2026                   RM {netPay}
     Available                                  >
```

若 row 点击直接返回 attachment，accessible label：`Download August 2026 payslip PDF, net pay RM …`。若未来有 HTML detail，row 点击 detail，download action 移进 detail。

---

## 29. PAYSLIP DETAIL WIREFRAME

此 wireframe 是 **structured publication read model 完成后的目标**；当前不能直接实施为 live-data reconstruction。

```text
[PH] August 2026 payslip
     Royal Salon · Available since {publishedAt}

[CS] NET PAY
     RM {snapshot.netPay}

     Gross pay                 RM {snapshot.grossPay}
     Total deductions          RM {snapshot.totalDeductions}

EARNINGS
{for each frozen EARNING component}
{component.name}               RM {component.amount}

DEDUCTIONS
{for each frozen DEDUCTION/statutory line}
{line.name}                   − RM {line.amount}

REIMBURSEMENTS (NON-WAGE)
{for each frozen reimbursement snapshot}
Claim {claimNumberSnapshot}     RM {amount}

PAY PERIOD
{period label}
{employer snapshot / employee code snapshot}

[AR] Download PDF                              >
```

不在员工 HTML detail 显示 statutory rule version、snapshot digest、official export eligibility 或 employer contribution，除非另行产品批准。PDF 仍可保留依法/业务需要的完整文档字段。

---

## 30. COMMISSION WIREFRAME

仅使用当前模型已证明的 date/type/amount；不虚构 item title。

```text
[PH] Commission
     Earnings statements separate from payslips.

[PN] <  01 Aug – 31 Aug 2026  >

[CS] TOTAL COMMISSION
     RM {statement.finalCommissionCents / 100}
     {Awaiting review | Approved | Added to payroll}

BREAKDOWN
[LR] 25 Aug · Service
     Eligible RM {eligibleAmount}     RM {commissionAmount}

[LR] 27 Aug · Product
     Eligible RM {eligibleAmount}     RM {commissionAmount}

ADJUSTMENTS                  (only when non-zero)
[LR] {employee-safe type/reason}
     RM {adjustmentAmount}
```

V2 不显示 “Hair colouring”、customer、invoice 或 rate，除非 enrichment 明确返回经过 privacy review 的 employee-safe fields。

---

## 31. CURRENT → V2 MAPPING

| CURRENT | V2 action | TARGET |
|---|---|---|
| legacy `staff-hub-heading` | **REPLACE** | `StaffV2PageHeader` |
| latest payslip large card | **SIMPLIFY** | current-pay compact summary |
| `Available` chip | **KEEP / NORMALIZE** | canonical V2 Status Badge |
| Gross mini-card | **MERGE** | secondary compact fact |
| Deductions mini-card (`gross-net`) | **REMOVE** | canonical total only after enrichment |
| Net mini-card | **KEEP / PROMOTE** | strongest amount |
| `View payslip` | **RENAME** | `Download PDF` until HTML detail exists |
| Payslips giant hub card | **REPLACE** | History List Row |
| Commission giant hub card | **REPLACE** | Earnings List Row |
| Pay empty illustration/icon block | **SIMPLIFY** | compact Empty State |
| Payslip month article | **REPLACE** | compact List Row |
| Payslip Gross/Deductions/Net sentence | **REMOVE / MERGE** | Net on row; detail owns breakdown |
| Payslip full-width button per row | **MERGE** | whole-row action/chevron |
| Heading-only loading | **REPLACE** | stable row skeletons |
| fail-closed payslip error behavior | **KEEP** | V2 alert + Retry |
| PDF immutable route | **KEEP** | protected download |
| HTML payslip detail | **ADD LATER** | publication-bound detail route/read model |
| Commission whole-page outer card | **REMOVE** | flat V2 page canvas |
| Commission period article | **REPLACE** | period navigator + summary + rows |
| accrual count | **SIMPLIFY** | secondary count；lines show actual detail |
| raw status labels | **MERGE** | V2 employee status map |
| Commission empty nested card | **SIMPLIFY** | one compact Empty State |
| Commission old revisions | **REMOVE FROM READER** | period.currentRevision only |
| privacy toggle | **DO NOT ADD** | amount visible only inside Pay |

---

## 32. MOBILE 360

Target：360 × 800。

- content width 使用 `minmax(0, 1fr)`；金额不可强制单行撑宽。
- Net amount 建议 26–32px responsive typography，不小于可读 V2 minimum。
- `RM 123,456.78` 可在 summary 内完整显示；极端值允许 amount 独占一行。
- grouped rows 以两行布局：title/meta 左，amount/badge 右；空间不足时 amount 移到第二行右侧。
- detail 不使用横向 financial table；使用 definition rows。
- 所有 row/action ≥44px。
- page scroll end 保留 fixed bottom nav + safe-area clearance。
- `scrollWidth === innerWidth`。

---

## 33. MOBILE 390

Target：390 × 844。

Pay Hub 首屏目标：

1. Pay header。
2. month + available state。
3. Net + Gross。
4. Download action。
5. Commission 与 Payslips rows 至少开始出现。

不以空 illustration、大 Commission card 或重复 Payslip card 推走主要金额。Payslip detail 首屏应出现 Net、Gross/Total deductions 与 Earnings 标题。

---

## 34. MOBILE 412

Target：412 × 915。

- 与 390 使用完全相同 IA、font scale、row height、card radius。
- 不因为多 22px 宽度而恢复两列 financial cards。
- 额外高度用于显示更多 detail rows。
- bottom nav、safe area、long employer name 与 PDF action 仍须完整可达。

---

## 35. LARGE AMOUNTS / LONG TEXT

必须覆盖：

- `RM 1.00`
- `RM 1,234.56`
- `RM 12,345.67`
- `RM 123,456.78`
- negative correction / deduction
- 32+ 字符 earning/deduction component name
- long commission source type/未来 item label
- long claim number/未来 description
- long employer、employee、branch names

Layout contract：

- 金额使用 tabular numerals；currency 与 amount 不被拆成含义不清的两段。
- label 可两行，amount 不与 chevron 重叠。
- detail row 在 360 下可从 two-column 退为 stacked，但 reading order 仍是 label → amount。
- 不把字缩到 10px 以下来解决 overflow。
- 不使用 horizontal scroll financial table。

---

## 36. ACCESSIBILITY

1. 每页一个 `h1`；section headings 按顺序使用 `h2`。
2. currency 值应有完整 accessible text，例如 `Malaysian ringgit 3,245.60`，视觉可保留 `RM`。
3. status 同时有文字，不依赖颜色。
4. List Row 若可点击，应由单一 link 包住并有清楚 accessible name。
5. `Download PDF` 明确文件类型与月份；不要只写 `Open`。
6. 44px touch target、focus-visible outline、键盘顺序遵循视觉顺序。
7. period navigator previous/next 有 accessible labels，并在不存在相邻 period 时 disabled。
8. definition rows 用 `dl/dt/dd` 或语义等价结构；不要用视觉表格假装 table。
9. loading 使用 `aria-busy`；error 用 `role=alert`；empty 用 `role=status` 但避免重复朗读。
10. 若未来做 privacy toggle，隐藏状态不能让真实 amount 仍存在于 accessible name/aria-label。
11. large text mode 下 badge/amount 可换行，不能 clip。

---

## 37. SECURITY AUDIT

| Control | Current result | Evidence / action |
|---|---|---|
| Employee sees own list only | **PASS** | `businessId + membershipId` on publication list |
| Own PDF only | **PASS** | `publicationId + businessId + membershipId` predicate |
| Guessed foreign UUID | **PASS / fail closed** | returns uniform 404 |
| Logged-out access | **PASS** | no token → 404 on PDF；pages redirect login |
| Revoked/expired session | **PASS at shared auth layer** | session/device/membership/business/assignment validated |
| Multi-employer isolation | **PASS** | session-scoped business + membership；switch revokes old session |
| Manager salary isolation | **PASS** | Staff reader never accepts target membership input from UI |
| Module entitlement | **PASS** | PAYROLL/COMMISSION gates |
| PDF cache | **PASS** | `private, no-store`; service worker does not cache route |
| Public URL | **PASS** | dynamic authenticated route；no public object URL |
| Immutable document | **PASS** | DB trigger forbids publication update/delete；bytes + SHA-256 |
| Historical structured detail | **NOT PRESENT** | do not reconstruct from live data |
| PDF auth guard choice | **PARTIAL** | route uses `getEmployeeAuthContext()` default attendance requirement；should use self-service guard during implementation |
| Direct response disposition | **PASS security / UX mismatch** | attachment only；UI must call it download |
| Commission ownership | **PASS scope / PARTIAL canonical revision** | business + membership正确；缺 period.currentRevision filter |
| Salary payment claim | **PASS by omission** | Staff 当前不显示 Paid；继续禁止推断 |

没有发现需立即停止蓝图工作的 cross-tenant/other-employee payslip exposure。上述 PARTIAL 项必须进入实施前 security/regression checklist。

---

## 38. IMPLEMENTATION RISK

| Risk | Level | Why | Mitigation |
|---|---|---|---|
| `Gross - Net` 被当 Deductions | **HIGH** | reimbursement 进入 Net、不进入 Gross，当前数字会错 | 删除推导；read model返回 canonical total |
| Commission 旧 revision 混入 | **HIGH** | recalculation append 新 statement，reader未限定 currentRevision | query 绑定 `period.currentRevision`，加 regression |
| 把 APPLIED_TO_PAYROLL 说成 Paid | **HIGH** | linked 不等于 finalized、更不等于 bank settled | 使用 status map；禁止 Paid |
| HTML payslip从 live data重建 | **HIGH** | 可能与 immutable PDF 历史不一致 | publication-bound structured snapshot/read model |
| Claim approved amount重复加到 Net | **HIGH** | creates duplicate money and wrong pay | only use payroll reimbursement snapshot/publication |
| Actual salary payment status | **HIGH** | current model没有 execution settlement | omit；`PAYMENT_STATUS_READ_MODEL_REQUIRED` |
| Claim PAYROLL_SETTLED lifecycle closure | **MEDIUM/HIGH** | schema/copy存在，未找到明确 automatic writer | 实施前完成 backend ownership audit；Pay不提前承诺 |
| Payslip sensitive data | **MEDIUM** | salary/PDF exposure impact高 | own-scope guard、no-store、route tests、no Home preview |
| PDF route attendance coupling | **MEDIUM** |合法 pay user可能被 attendance setting拦住 |改 self-service auth guard，验证 revoked session仍拒绝 |
| Multi-employer switch | **MEDIUM** | stale navigation/cache可能显示前 employer | force dynamic、no-store、switch integration test |
| Commission human-safe detail | **MEDIUM** | current source title/rate不足 | targeted typed enrichment；不暴露 raw JSON |
| Legacy CSS | **MEDIUM** | Pay/Payslip/Commission 仍用 hub/page-card/payslip classes | scoped V2 module；迁移后删除对应旧规则 |
| Mobile financial alignment | **MEDIUM** | 长 label/金额可能 overflow | definition rows、stack breakpoint、360 test |
| Empty-state ambiguity | **MEDIUM** | no publication 的原因不可知 | neutral copy；不说 Preparing |
| Large amounts | **LOW/MEDIUM** | mini-card布局会压缩 | amount独占行、tabular numerals、no tiny font |
| Privacy toggle complexity | **LOW** | state/a11y risk大于当前收益 | Phase 4 不实施 |

---

## 39. RECOMMENDED IMPLEMENTATION SEQUENCE

1. Owner 批准本 Phase 4 blueprint 与 status wording。
2. 先写 focused regression，锁住当前 self-ownership、business isolation、publication-only、private/no-store。
3. 关闭 read-only correctness prerequisites：
   - canonical deductions/reimbursement summary；
   - Commission current-revision filter；
   - PDF route改用 self-service auth guard；
   -确认 Claim payroll settlement lifecycle owner。
4. 实施 **Pay Hub V2 only**；缺失字段直接省略，不虚构。
5. Owner 390/412 + physical-device review。
6. 实施 **Payslips V2 list + protected PDF download UX**。
7. Owner review；决定是否值得新增 HTML payslip detail。
8. 只有 publication-bound structured reader ready 后，再实施 **Payslip detail V2**。
9. 修正 employee-safe Commission reader后，实施 **Commission V2**。
10. 执行 Pay full regression：normal employee、manager-as-employee、multi-employer、revoked session、foreign publication UUID、long amounts、360/390/412。
11. Railway Testing only deployment与 physical-device UAT。
12. 停止；Profile V2 必须另开阶段。

不要一次重写 Pay、Payslips、Commission；不要为了视觉进度跳过 money correctness/read-model gating。

---

## 40. NO BACKEND CHANGE CONFIRMATION

本任务只创建：

- `TETAMU_STAFF_UIUX_V2_BLUEPRINT_PHASE4_PAY.md`

本轮没有修改：

- Pay Hub / Payslips / Commission UI code
- Payroll / Payslip publication / locking
- Compensation
- Commission calculation / approval / payroll link
- Claims reimbursement
- Attendance / Timesheet
- Statutory calculation
- Bank/payment
- RBAC
- employee session/device
- API
- Prisma schema
- migrations

NO NEW MIGRATION。

所有缺失数据都记录为 readiness gap，没有用假数据、前端推导或新 workflow 绕过。

---

## 41. PRODUCTION STATUS

BLUEPRINT ONLY。未实施 Pay Hub V2、Payslips V2、Payslip Detail V2、Commission V2 或 Profile V2；等待 owner review。

LOCAL / TESTING ONLY  
PRODUCTION NOT ACCESSED  
PRODUCTION NOT MODIFIED

