# TETAMU POS — Reports 当前功能与操作说明

## 1. 文档目的

这份文档记录当前 Tetamu POS `Reports` 页面已经存在的功能、数据口径、权限范围、用户操作流程和已知边界，供后续 Codex 继续开发或优化时使用。

本文件描述的是当前实现，不代表未来规划，也不授权修改财务公式、数据库、权限或 Production 数据。

## 2. 页面入口

```text
Desktop route:
/reports

常用例子：
/reports?range=today
/reports?range=7days
/reports?range=month
/reports?from=2026-08-01&to=2026-08-31
```

Reports 是 Desktop Business 后台页面。它不是 Staff App 页面。

## 3. 页面目标

Reports 让获授权的用户在一个页面查看：

- 指定期间的销售总览；
- 每日销售表现；
- 收款方式及净收款；
- 单日发票明细；
- 美容行业的预约、服务和员工活动；
- 非美容行业的 Jobs、Invoices、Packages、Customers、Payments 和 Refunds；
- 启用 Expenses 模块后的经营表现和费用结算摘要。

## 4. 权限与门店范围

### 4.1 页面权限

进入页面需要：

```text
Business capability:
VIEW_REPORTS
```

直接 Business Staff 访问时，还需要：

```text
Staff permission:
REPORTS
```

### 4.2 Branch 范围

系统不会单纯相信 URL 里的 `branchId`。

- 拥有 `ALL_BRANCHES` 权限的员工可以选择所有 Active Branches 或单一 Branch；
- Group Access 可以查看其已授权业务范围内的所有 Branches；
- 普通 Branch Staff 只能查看自己被分配的 Active Branch；
- 普通员工即使手动修改 URL 的 `branchId`，系统仍会把范围限制回该员工的 Branch；
- 没有有效 Branch assignment 的普通员工不会获得跨 Branch 数据。

## 5. 报表期间筛选

当前支持四种期间：

```text
Today
7 Days
Month
Custom
```

### 5.1 Today

显示当前 Business Day。

### 5.2 7 Days

显示截至当前 Business Date 的最近 7 个 Business Days。

### 5.3 Month

显示当月 1 日至当前 Business Date。

### 5.4 Custom

显示用户选择的：

```text
From
To
```

如果 From 晚于 To，系统会自动标准化日期顺序，不让查询产生倒置范围。

### 5.5 Business Day 口径

报表内部仍按照 Business 的：

```text
timezone
businessDayCutoffTime
```

划分 Business Day。页面不需要常驻显示 `Asia/Kuching`，但底层日期归属仍会遵守 Business 时区和营业日截止时间。

例如凌晨发生的交易，可能依照营业日截止时间归入前一个或下一个 Business Day，而不是直接按服务器日期归类。

## 6. 页面整体结构

页面从上到下为：

```text
Reports header
→ Period
→ Range / Branch filters
→ Summary
→ Daily Sales
→ Payments Collected
→ Industry-specific operational reports
→ Expense / operating summary（如模块已启用）
→ Daily transaction drawer（选择某一天后）
```

## 7. Header 与 Period

Header 显示：

- 页面标题 `Reports`；
- 当前报表对应的 Business 或 Branch；
- 当前报表期间。

美容行业的说明重点为：

```text
Appointments, service, staff, and revenue performance
```

其他行业的说明重点为：

```text
Sales, jobs, invoices, packages, and service performance
```

## 8. Summary

### 8.1 Sales Summary

所有行业都显示：

| 指标 | 当前含义 |
|---|---|
| Net Sales | 期间内发票销售扣除相关退款后的净销售 |
| Transactions | 期间内有效销售发票数量 |
| Average Sale | Net Sales / Transactions；没有交易时为 RM0.00 |
| Refunds | 依退款发生日期归入期间的货币退款 |
| Discounts | 发票折扣、loyalty discount 和 package voucher 等 canonical discount 口径 |

页面明确区分：

```text
Sales follow invoice date.
Refunds follow refund date.
```

也就是说，旧发票在本期发生退款时，本期可以只有 Refund、没有对应新 Sale。

### 8.2 Appointment Summary（SALON_BEAUTY）

美容行业另外显示：

| 指标 | 当前含义 |
|---|---|
| Appointments | 期间内预约总数 |
| Completed | Completed appointments |
| Cancelled | Cancelled appointments |
| No-show | No-show appointments |
| Repeat customers | 期间内有效预约超过一次的客户数 |

`CONFIRMED`、`ARRIVED` 和 `IN_SERVICE` 在状态汇总中会归为 `SCHEDULED`。

## 9. Daily Sales

Daily Sales 按 Business Day 分行显示：

| 栏位 | 含义 |
|---|---|
| Date | Business Day 日期 |
| Net Sales | 当日净销售 |
| Transactions | 当日有效销售发票数量 |
| Avg Sale | 当日平均销售额 |
| Refunds | 当日发生的退款 |
| Discounts | 当日发票折扣 |
| Payment Mix | 当日净收款的付款方式组合 |

表格底部显示期间 Total。

### 9.1 空白日期

默认隐藏完全没有销售、退款、折扣或收款活动的日期。

用户可以打开：

```text
Show empty days
```

显示完整期间内的所有 Business Days。

### 9.2 选择日期

点击 Daily Sales 任一日期或该行指标，会打开 Daily Transaction Drawer。

Drawer 显示：

- Date；
- Net Sales；
- Transactions；
- Refunds；
- Discounts；
- Invoice time；
- Invoice number；
- Customer；
- Staff；
- Total；
- Payment method；
- Invoice status。

点击 Invoice Number 会进入对应 Invoice 页面。

### 9.3 没有发票但有退款

某一天可能没有新发票，但仍有旧交易的退款。系统会保留该日期的财务活动，并提示：

```text
Sales may be empty even when a later refund was recorded.
```

## 10. Payments Collected

这个区块是 Payment View，不是完整 Cashflow 或会计现金流量表。

页面显示：

- Net collected；
- 每一种付款方式的净收款；
- Payment count；
- 占 Net Collections 的比例；
- Gross collected；
- 该付款方式的 Refunds。

当前支持 canonical/default labels：

```text
Cash
Card
DuitNow
E-wallet
Bank transfer
Foreign currency
Crypto asset
Package use
```

如果 Business 已配置自定义付款方式名称，优先显示 Business Payment Method label。

### 10.1 Split Payment

一张发票可以有多个付款方式：

```text
1 invoice / transaction
→ Cash
→ Card
```

Sales Transactions 仍然是 1，但 Payment Mix 会分别显示两个收款方式。

### 10.2 Package Use

Package Use 不属于货币收款，因此不会计入 Monetary Net Collections 的付款方式占比。

## 11. SALON_BEAUTY 专属区块

当 Business industry 为 `SALON_BEAUTY` 时，页面显示以下区块。

### 11.1 Service Sales

显示期间内 invoice-linked services：

- Service name；
- Quantity；
- Amount。

最多显示按 Amount 排序的前 10 项。

### 11.2 Staff Activity

显示：

- Staff；
- Appointments；
- Attributed Sales。

这里是发票关联到预约员工后的销售归属，不应解释为员工完整绩效、工资或佣金结果。

未分配员工时会显示：

```text
Unassigned
```

### 11.3 Appointments by Status

显示期间内各 Appointment Status 的数量。

## 12. 非 SALON_BEAUTY 专属区块

非美容行业会显示以下 KPI：

- Service Sales；
- SST / Tax；
- Package Sales（数量和净额）；
- Package Uses；
- Jobs；
- Invoices；
- Outstanding；
- Voided Payments（数量和金额）。

并显示以下表格：

### 12.1 Jobs by Status

- Status；
- Jobs；
- Total；
- Balance。

### 12.2 Invoices by Status

- Status；
- Invoices；
- Total；
- Paid；
- Balance。

### 12.3 Top Services

- Rank；
- Service；
- Quantity；
- Amount。

### 12.4 Top Customers

- Rank；
- Customer；
- Jobs；
- Total；
- Balance。

点击 Customer 可进入 CRM Customer Profile。

### 12.5 Recent Payments

- Paid at；
- Customer；
- Related Work Order / Package；
- Method；
- Amount。

### 12.6 Recent Refunds

- Refunded at；
- Customer；
- Reason；
- Related Invoice / Work Order / Package；
- Method；
- Amount 或 restored package uses；
- Processed by。

## 13. Expense 模块整合

只有 Business 已启用 `EXPENSE` 模块时，Reports 才加载费用摘要。

### 13.1 Business Performance

显示：

| 指标 | 含义 |
|---|---|
| Net Sales | 当前报表期间的净销售 |
| Confirmed Expenses | 按 Expense Date 落在期间内的已确认费用 |
| Simple Operating Balance | Net Sales - Confirmed Expenses |
| One-off Expenses | 一次性费用 |
| Recurring Expenses | 经常性费用 |

注意：

```text
Simple Operating Balance is not accounting profit.
```

它不是完整会计利润，不包含所有应计、资产、税务、折旧或其他会计处理。

### 13.2 Expense Settlement

显示：

- Payments in Period；
- Paid against selected expenses；
- Outstanding selected expenses。

费用 Payment 按 Payment Date 进入 settlement view，不会再次确认费用支出。

`Cash` 付款方式也不等于资金一定来自 POS Drawer。

## 14. 用户标准操作流程

### 14.1 查看今天营业表现

```text
1. 打开 Reports
2. 选择 Today
3. 如有权限，选择 Branch
4. 点击 Run report
5. 查看 Summary
6. 查看 Daily Sales
7. 查看 Payments Collected
```

### 14.2 查看本月表现

```text
1. 选择 Month
2. 选择 All branches 或指定 Branch
3. 点击 Run report
4. 查看 Sales Summary
5. 美容行业继续查看 Appointment Summary、Service Sales 和 Staff Activity
6. 启用 Expenses 时查看 Business Performance 和 Expense Settlement
```

### 14.3 查看自定义日期

```text
1. 选择 Custom
2. 输入 From
3. 输入 To
4. 选择 Branch
5. 点击 Run report
```

### 14.4 查看某天交易

```text
1. 在 Daily Sales 找到目标日期
2. 点击日期或该行任一指标
3. 在右侧 Drawer 查看发票明细
4. 点击 Invoice Number 打开发票
5. 点击关闭按钮或遮罩返回报表
```

### 14.5 排查销售与收款不相等

```text
1. 先查看 Net Sales
2. 再查看 Net Collected
3. 检查是否存在未付余额、跨期收款、split payment 或退款
4. 打开目标日期 Drawer 检查发票
5. 不要把 Payments Collected 当作 Net Sales
```

## 15. URL 状态

当前页面通过 query string 保存筛选和交互状态：

| 参数 | 用途 |
|---|---|
| `range` | `today`、`7days`、`month`、`custom` |
| `from` | Custom start date |
| `to` | Custom end date |
| `branchId` | 已获授权的 Branch |
| `day` | 打开的 Daily Transaction Drawer 日期 |
| `showEmpty` | `1` 表示显示空白日期 |

筛选 URL 可刷新、复制或加入书签，但服务器仍会重新检查 Business 和 Branch 权限。

## 16. Responsive 行为

### Desktop

- Daily Sales 使用表格；
- Daily Transactions 使用表格 Drawer；
- Summary 和 Payment Method 使用 responsive grid。

### Mobile

- Daily Sales 改为逐日卡片；
- 每张卡片显示交易数、Net Sales、Average、Refunds、Discounts 和 Payment Mix；
- Daily Transactions 改为移动卡片；
- 筛选和 KPI 会按可用宽度重排。

## 17. 空状态

当前主要空状态包括：

```text
No sales in this period
No payments collected
No service sales in this period
No staff activity in this period
No appointments in this period
No jobs in this period
No invoices in this period
No customer activity in this period
No recent payments in this period
No refunds in this period
```

用户应先尝试更换日期范围或 Branch，而不是假设系统错误。

## 18. 当前财务口径原则

后续 Codex 不应在没有明确授权和回归证据的情况下改变以下规则：

```text
Invoice date recognises Sales.
Refund date recognises Refunds.
Payment date recognises Collections.
Expense date recognises Expenses.
Expense payment date recognises Settlement only.
Package use is not monetary collection.
Simple Operating Balance is not accounting profit.
Branch scope is enforced server-side.
Business Day uses business timezone and cutoff.
```

## 19. 当前没有的功能

在当前 Business Reports 页面中未发现以下功能：

- Reports CSV / Excel export；
- PDF export；
- Print-optimised report；
- period-over-period comparison；
- sales trend chart；
- saved report presets；
- scheduled email report；
- accounting Profit & Loss；
- bank reconciliation；
- general ledger；
- tax submission。

这些缺口只是当前状态说明，不代表本轮需要开发。

## 20. 主要代码位置

```text
Page / server composition:
src/app/(business)/reports/page.tsx

Range and Branch filter UI:
src/components/report-filter-panel.tsx

Daily Sales / Payments / Refunds aggregation:
src/lib/reports/daily-sales.ts

Money, empty-day and payment-share presentation:
src/lib/reports/presentation.ts

Global Reports styles:
src/app/globals.css
```

## 21. 当前测试覆盖

```text
tests/unit/reports-daily-sales.test.ts
tests/unit/reports-final-ux.test.ts
```

已覆盖的关键行为包括：

- Cash sale reconciliation；
- same-day aggregation；
- multi-day aggregation；
- dynamic payment labels；
- split payment；
- refund date behavior；
- canonical discounts；
- selected Branch isolation；
- all-branch aggregation；
- unauthorized Branch fallback；
- Business Day cutoff；
- empty-range zero rows；
- Today / 7 Days / Month / Custom filters；
- custom date controls；
- empty-day visibility；
- payment-share formatting；
- responsive KPI grouping；
- Expense metric wording；
- Payment View wording；
- Staff Activity attribution wording。

## 22. 给 Codex 的继续开发边界

继续开发 Reports 前，Codex 应先：

```text
1. 读取当前 Reports 页面、数据服务和测试。
2. 区分 Sales、Collections、Refunds、Expenses 和 Settlements。
3. 保留 server-side Business / Branch scope。
4. 保留 Business Day timezone / cutoff 逻辑。
5. 区分 SALON_BEAUTY 和其他行业的页面结构。
6. 不把 Simple Operating Balance 改称 Profit。
7. 不把 Payments Collected 改称完整 Cashflow。
8. 修改任何财务口径前，先增加或更新 reconciliation tests。
9. 同时验证 Desktop 和 390px mobile。
10. 未经授权不要部署 Production。
```

## 23. 可直接交给 Codex 的简短上下文

```text
Continue Tetamu POS from the CURRENT workspace.

Read first:
docs/TETAMU_REPORTS_CURRENT_FUNCTIONS_AND_OPERATIONS.md

The current Reports page already supports:
- Today / 7 Days / Month / Custom periods
- server-enforced Branch scope
- Sales Summary
- Daily Sales and daily invoice drawer
- Payments Collected and payment mix
- SALON_BEAUTY appointment/service/staff reporting
- non-salon job/invoice/package/customer reporting
- Expense performance and settlement summary when enabled
- responsive desktop/mobile presentation

Preserve the current financial semantics:
Invoice date = Sales
Refund date = Refunds
Payment date = Collections
Expense date = Expenses
Expense payment date = Settlement

Do not call Payments Collected full cashflow.
Do not call Simple Operating Balance accounting profit.
Do not weaken Business/Branch authorization.

Before changing code, inspect the relevant implementation and tests, state the exact scope, and avoid Production unless explicitly authorised.
```

