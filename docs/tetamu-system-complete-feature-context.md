# Tetamu 系统完整功能与 ChatGPT 上下文

> 审计基线：2026-08-15 当前 Local workspace。
> 用途：把本文件直接提供给 ChatGPT、Codex 或新的开发人员，作为 Tetamu 的系统全貌、业务边界和当前状态说明。
> 重要：本文件描述的是当前 repository 的功能与 Development / Testing 证据，不代表 Production 已部署或验证。

## 1. 一句话说明 Tetamu

Tetamu 是一个面向马来西亚服务行业的多租户 SaaS，整合：

- POS、预约、顾客、服务、产品、配套和电子发票；
- Salon / Wellness 与 Auto Detailing 两类营运流程；
- WhatsApp 客户沟通与自动通知；
- 员工、排班、考勤、请假、报销、佣金、工资单和 Payroll；
- 库存、供应商、采购、收货、Supplier Bill、Accounts Payable；
- Business Expense、Business Spending、现金钱箱和 Daily Closing；
- Business / Group Dashboard、Read-only AI Business Analysis；
- 商业方案、模块授权、Subscription Billing 和 Platform Admin 管理。

Tetamu 不是单一 POS 页面，而是一套以 `Business → Branch → User / Employee` 为权限和数据边界的营运平台。

## 2. 当前结论

当前 Local / Testing master acceptance 已覆盖核心商业流程、财务 reconciliation、租户隔离、分店隔离、Staff privacy、responsive、console 和 hydration。最新 Master UAT 的结论是：

```text
TETAMU MASTER UAT / COMMERCIAL LAUNCH ACCEPTANCE
→ READY

READY FOR PRODUCTION READINESS AUDIT
→ YES
```

这句话的正确含义是：Development / Testing 已达到交给 Production Owner 做下一轮 Production Readiness Audit 的条件。

它不代表：

- Production 已经部署；
- Production database 已迁移；
- Production secrets 已配置；
- Production provider 已验收；
- Production 已经可以营业。

## 3. 环境硬边界

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

开发、QA account、migration、browser E2E、2-day simulation、provider 测试和 build 都只允许在 Local / Testing。

`npm run build` 是 Local / Testing 的 production-mode build，不代表 Production deployment。

Production database、backup/PITR、domain/TLS、secrets、monitoring、SMS123、WhatsApp、OpenAI 和部署都属于 Production Owner 的独立责任。

## 4. 技术基础

- Next.js 16.3、React 19、TypeScript；
- Prisma 6 + PostgreSQL；
- Zod 输入验证；
- bcrypt password hashing、JWT/session cookie；
- True MFA / TOTP、sensitive-action step-up；
- OpenAI Responses API provider abstraction；
- SMS123 delivery provider abstraction + Tetamu-owned hashed OTP verification；
- 独立 WhatsApp connector + queue worker；
- Analytics、Notification、WhatsApp 分离 worker；
- S3-compatible private attachment storage foundation；
- 全部金额以 MYR / integer sen 为主要财务计算单位；
- 日期时间按 Business / Branch 的 IANA timezone 和 business-day cutoff 处理。

## 5. 系统角色

### 5.1 Platform Admin

平台级管理员可管理：

- Business 与 Branch；
- Business Group；
- Business module entitlement；
- Commercial plan、pricing、subscription billing；
- Platform statutory RuleSet、Human Review 和 controlled activation；
- Platform WhatsApp templates；
- Vehicle size defaults；
- Sensitive-action security audit。

Platform Admin 不等于 Merchant Owner，也不应自动成为 Statutory Reviewer 或 Activator。

### 5.2 Business Owner / Business Admin

管理自己的 Business、Branch、员工、权限、营运、报表和已购买模块。

Business Owner 不能越过 Business tenant boundary，也不能因为是 Owner 就越过 Platform statutory governance。

### 5.3 Manager / HR / Payroll / Inventory / Finance User

通过 capability 和 branch scope 获得最小权限，例如：

- Team、Roster、Attendance、Leave、Claims；
- Payroll、Payslip、Payment Batch；
- Inventory、PO、Goods Receipt、Supplier Bill、AP；
- Expense、Daily Closing、Reports；
- Commission review；
- Read-only AI analysis。

### 5.4 Cashier / Operational Staff

只操作被授权的 Branch 和功能，例如预约、POS、付款、顾客、Shift Closing。

### 5.5 Employee / Staff App User

员工通过独立 Staff OTP/session 登录，只能查看和操作自己的：

- Home；
- Clock In / Clock Out / Break；
- Roster；
- Attendance；
- Leave；
- Claims；
- Commission；
- Timesheet；
- Payslip；
- Profile / Device / Workplace。

Staff App 不使用后台 password session，也不是另一套 HR Backend。

### 5.6 Business Group User

按授权 Business 集合查看 Group overview、reports、commercial 信息、closing 和 Ask Tetamu Group。不能读取未授权 Business。

## 6. 三层访问控制

Tetamu 的访问控制不是单一 Role：

1. **Module Entitlement**：客户是否购买/启用该产品模块；
2. **Capability / Permission**：当前用户是否能执行该动作；
3. **Tenant / Branch / Group Scope**：动作可作用在哪些 Business / Branch。

必须三层同时通过。

```text
Module enabled
≠ User has permission

User has permission
≠ User can access every branch
```

UI 隐藏不是安全控制；route、server action 和 domain service 必须再次验证。

## 7. Business Module Entitlement

当前 canonical module keys：

| Module | 说明 | 主要 dependency |
| --- | --- | --- |
| CORE | Business、Branch、Auth、Team、基础平台 | 必须存在 |
| POS | Cashier、Payments、Invoices、CRM 基础营运 | 无 |
| INVENTORY | Stock、Supplier、PO、GR、Bill、AP | POS |
| SALON | Salon / Wellness appointments | 无 |
| AUTO | Auto Detailing work orders、vehicle flow | 无 |
| WHATSAPP | Inbox、templates、automations | 无 |
| BUSINESS_GROUP | Multi-business group view | 无 |
| HR | People、Roster、Attendance、Leave | 无 |
| PAYROLL | Payroll、Payslip、Payroll Payment | HR |
| STATUTORY | EPF、SOCSO、EIS、LINDUNG24、PCB | PAYROLL |
| CLAIMS | Employee claims / reimbursements | HR |
| COMMISSION | Service / product commission | CORE |
| EXPENSE | Business Expense / Spending | CORE |
| AI | Read-only Business Analysis | 无 |
| LOYALTY | Loyalty capability | 当前 registry 标为 FUTURE |

Module entitlement 可以来自 system、manual、migration、plan 或 trial，并有审计和 dependency validation。

## 8. Authentication 与 Security

### 8.1 后台登录

- Email + password；
- password hash；
- identifier / IP / combination rate limit；
- idle 和 absolute session expiry；
- active user、membership 和 business context revalidation；
- logout 和 session recovery。

### 8.2 True MFA / TOTP

后台高风险动作使用 Authenticator TOTP：

- enrollment；
- QR；
- recovery codes；
- one-time verification；
- rate limit；
- sensitive-action step-up cookie；
- audit。

Password、TOTP secret、TOTP code 和 recovery code 不应进入 chat、source、日志或文档。

### 8.3 Sensitive actions

Payroll、supplier payment、statutory sign-off/activation 等高风险动作需要 capability、scope 和新鲜的 step-up 状态。

### 8.4 Staff OTP

Staff App 使用独立 phone OTP architecture：

```text
Phone challenge
→ SMS123 delivery
→ Tetamu OTP verify
→ employee/business membership selection
→ device/session binding
→ Staff App
```

支持 challenge expiry、one-time use、replay protection、attempt/resend limit、unknown-phone anti-enumeration 和 revoked membership denial。

Local mock OTP 只属于 Local QA，不等于真实 SMS。SMS123 adapter 已实现，但真实 Testing SMS 接收仍需要外部凭证与指定测试号码。

### 8.5 多工作地点员工

同一手机号可对应多个 Business membership。成功验证手机号后，员工先选择 workplace，再建立绑定该 Business / membership / primary branch 的 Staff Session。

## 9. Business、Branch 与 Settings

### 9.1 Business

- Company profile；
- company / registration information；
- contact；
- industry type；
- timezone；
- business-day cutoff；
- tax / invoice settings；
- module entitlement；
- payment methods；
- commercial/subscription state。

### 9.2 Branch

- Branch profile、地址、电话；
- timezone / business day；
- staff assignment；
- inventory scope；
- attendance geofence/settings；
- POS and closing scope。

Branch 是营运和数据隔离单位，不只是一个显示标签。

### 9.3 Payment Methods

Business 可管理 checkout button：

- Cash、Card 等系统方法；
- DuitNow、E-wallet、Bank Transfer 等 merchant-specific button；
- Training / Complimentary 等 `No payment collected` 方法；
- Foreign cash，可记录 currency code、received amount 和 MYR rate；
- Crypto，可记录 asset symbol、asset quantity、MYR rate 和 transaction reference；
- checkout visibility / hide；
- button display name。

Reporting category 是稳定财务分类，不应随意改写。外国货币和 crypto 的 Business reports 仍以 MYR 为 canonical reporting currency。

`Training / Complimentary` 可以让订单金额为 RM0 collected，但仍保留服务完成和佣金事实；不能伪装成 Cash payment。

## 10. CRM

### 10.1 Customers

- Create / edit / view customer；
- name、phone、email、notes；
- customer search；
- business-scoped duplicate handling；
- customer detail；
- appointments、work orders、invoices、packages、loyalty、vehicles 历史聚合；
- WhatsApp contact link。

### 10.2 Vehicles

Auto industry 支持：

- vehicle profile；
- plate number；
- brand/model/type/size；
- owner / contact relation；
- ownership/contact handling；
- vehicle-based work history。

### 10.3 Membership / Packages / Loyalty

- Customer packages；
- package balance / redemption；
- package purchase and refund boundary；
- expiry and usage history；
- loyalty members、points、activity、settings；
- catalog discount rules。

## 11. Catalog

### 11.1 Services

- categories；
- duration；
- price；
- branch availability；
- industry-specific use；
- staff/service assignment；
- commission eligibility。

### 11.2 Products

- categories；
- selling price / cost context；
- stock item identity；
- checkout sale；
- product commission attribution；
- inventory movement linkage。

### 11.3 Packages

- package categories；
- services/products/uses；
- selling price；
- customer package purchase；
- redemption；
- refund-safe restoration；
- pending balance and usage history。

## 12. Appointments

- New appointment；
- Walk-in 和 Booking；
- date/time；
- customer；
- branch；
- staff；
- service/product/package items；
- appointment detail；
- checkout integration；
- reminder scheduling、rescheduling 和 cancellation；
- reminder dedupe；
- WhatsApp notification queue。

Appointment 是预约事实，不自动等于已完成服务、已开 invoice 或已付款。

## 13. Auto Work Orders

Auto Detailing 使用 Work Order：

```text
WAITING
→ IN_PROGRESS
→ READY_FOR_PICKUP
→ COMPLETED
```

另有 cancellation boundary。

功能包括：

- customer + vehicle；
- service/product items；
- staff attribution；
- payment status；
- invoice linkage；
- Ready for Pickup WhatsApp intent；
- audit/history。

## 14. Cashier / POS

主要流程：

```text
Appointment / Walk-in / Work Order
→ Add service, product or package
→ Staff attribution
→ Discount / tax / rounding
→ One or more payments
→ Invoice
→ Refund / Void when required
→ Shift Closing
```

功能包括：

- cart；
- customer selection；
- staff selection；
- services、products、packages；
- quantity；
- discounts；
- taxes / charges；
- cash、card、e-wallet、bank transfer、自定义 tender；
- partial / split payment；
- payment reference；
- training/complimentary zero-collection flow；
- foreign cash and crypto metadata；
- invoice creation；
- duplicate-submit protection；
- transaction reconciliation。

所有 canonical financial write 使用 durable command/idempotency architecture；server transaction 内重读 canonical state，不能相信 browser 旧值。

## 15. Invoice、Payment、Refund 与 Void

### 15.1 Invoice

- Invoice number；
- customer/business/branch snapshot；
- item lines；
- subtotal、discount、tax、rounding、total；
- payment summary；
- printable/simple electronic invoice layout；
- PDF / WhatsApp delivery foundation。

### 15.2 Payment

- partial payment；
- multiple methods；
- financial operation identity；
- transaction-safe outstanding；
- payment-specific metadata；
- reporting category。

### 15.3 Refund / Void

- full / partial refund；
- credit-note history；
- stock/package/loyalty restoration rules；
- idempotent retry；
- audit；
- delete-free financial history。

完成的付款不应被直接 edit/delete；错误通过 reversal/refund/void 等正式事实修正。

## 16. Cashier Shift 与 Daily Closing

### 16.1 Shift

- opening float；
- cashier + branch；
- shift start/end；
- gross collected；
- refunds；
- net collected；
- cash sales；
- POS drawer expense payouts；
- expected cash；
- counted cash；
- variance + reason。

### 16.2 Expense 与钱箱

只有明确选择 `POS drawer cash`，并成功关联当前有效 open shift 的 Expense payment，才减少 Shift Closing expected cash。

```text
Expected drawer cash
= Opening float
+ Net cash sales
- Valid POS drawer expense payouts
```

Bank、owner funds、company bank、credit card 等付款来源不会减少 POS drawer expected cash。

钱箱余额不足时，Expense 本身可以仍然成立或保持 unpaid，但不能成功记录为 `POS drawer cash paid`。

### 16.3 Daily Closing

- final open shift check；
- frozen branch/day snapshot；
- payments、refunds、packages、cash movement summary；
- WhatsApp closing report queue；
- retry/dedupe；
- closing history。

## 17. WhatsApp

### 17.1 功能

- Business-specific connection/session；
- QR reconnect；
- connection status；
- inbox / conversations；
- contact sync / CRM link；
- text、image、audio、document；
- appointment reminder；
- service confirmation；
- ready-for-pickup；
- invoice；
- daily closing report；
- templates；
- message queue；
- attempts、retry、lease recovery；
- sent/delivered/read status；
- inbound/history/receipt webhook；
- diagnostics、logs、contact diagnostics。

### 17.2 安全与运行条件

- connector authentication；
- webhook authentication；
- replay protection；
- monotonic delivery state；
- business/session isolation；
- idempotent notification identity。

WhatsApp engineering hardening 是 READY，但实际收发依赖 connector process、session storage、URL/token/secret、worker 和手机 Linked Device。页面显示 Connected 不足以证明 inbound/outbound worker 全部健康。

## 18. People / Team

- Employee Account；
- Business membership；
- primary branch / multi-branch assignment；
- employee code；
- role / level；
- POS access；
- Staff App access；
- attendance access；
- active / employment status；
- service assignment；
- compensation profile；
- payroll bank profile；
- statutory/tax profile；
- permission templates and overrides；
- audit/activity。

Employee code 可自动建议下一个编号，避免管理员记住上一个号码。

## 19. Roster / Shift Scheduling

### 19.1 功能

- Shift Template；
- weekly roster period；
- Draft / Published / revision；
- Monthly、Shift、Staff views；
- start/end time；
- cross-midnight；
- break minutes；
- branch/business scope；
- staff assignment；
- leave conflict；
- public holiday context；
- publish/amend/retrospective controls；
- audit。

### 19.2 Canonical rule

只有 Published Roster 才生成 versioned `AttendanceExpectedDay` evidence。

```text
Draft Roster
≠ Expected attendance

Published Roster
→ Expected attendance evidence
```

没有 published roster/evidence 时，Staff App 必须显示 `No published schedule available`，不能猜为 Off Day。

### 19.3 Work/break priority

```text
1. Published Roster for the day
2. Employee personal override
3. Branch fallback defaults
```

Roster 有明确时间和 break 时优先；Employee/Branch values 只是没有更高优先 evidence 时的 fallback。

## 20. Attendance

### 20.1 Staff actions

- Clock In；
- Start Break；
- End Break；
- Clock Out；
- GPS/geofence check；
- device authorization；
- outside-geofence / unavailable-location exception request。

### 20.2 Raw fact rule

Punch、device/server timestamp 和 GPS 是 raw fact，不被 correction 覆盖。

Correction 只追加：

- request；
- resolution；
- final-result version。

### 20.3 Expected attendance 与 exception

- Workday；
- Not Scheduled；
- Rest Day；
- Public Holiday；
- expected start/end；
- grace；
- timezone；
- missing clock in/out；
- late arrival；
- early departure；
- no attendance recorded；
- suspected no-show；
- leave conflict；
- repeated correction warning。

只有明确 `WORKDAY` evidence 才能判断 suspected no-show。没有 evidence 不能推断旷工、迟到或 off day。

### 20.4 Manager resolution

- Authorised；
- Unauthorised；
- Correction；
- Schedule Error；
- Not Scheduled；
- Approved Leave；
- Excluded；
- reason、revision、serializable transaction、audit。

### 20.5 Timesheet

```text
DRAFT
→ APPROVED
→ LOCKED
```

支持 readiness blocker、whole-business approval、immutable revision、reopen with reason 和历史保留。

## 21. Leave

- Leave types；
- policy versioning；
- entitlement；
- balance ledger；
- employee application；
- full / partial day；
- manager approval；
- paid/unpaid treatment snapshot；
- cancellation；
- balance restore exactly once；
- overlap/concurrency protection；
- leave/attendance/timesheet/payroll integration；
- employee self-service；
- tenant/branch scope；
- audit。

Leave 不会伪造 Punch。Approved Leave 作为独立 evidence 被 Attendance 和 Payroll 读取。

马来西亚法定 leave dataset 未被授权验证时，系统 fail closed，不硬编码未知法定天数。Carry-forward 的完整政策仍属 deferred。

## 22. Claims / Reimbursements

- claim category；
- policy versioning；
- application + lines；
- private receipt/evidence；
- duplicate detection；
- approval / partial approval；
- cancellation；
- outside-payroll reimbursement；
- payroll bridge foundation；
- employee self-service；
- manager/HR workflow；
- audit、idempotency、concurrency。

Claim reimbursement 与 wage/gross pay 分离。只有 verified non-wage treatment 才能安全进入 net-pay reimbursement section；statutory classification 不完整时 fail closed。

因此：Claims Core 可用，但 Claims Payroll/Statutory treatment 仍是 controlled partial boundary。

## 23. Unified HR Approval Center

一个统一 manager queue 聚合：

- Attendance exception；
- Leave；
- Claims；
- Commission；
- Payroll review。

中心只做 projection、filter、count 和 navigation；真正 approve/reject 仍委托各 domain service，避免复制业务规则。

支持 module entitlement、capability、branch/whole-business scope、stale-state protection 和 self-approval prevention。

## 24. Commission Engine

- service commission；
- product commission；
- fixed amount；
- percentage；
- tiered rules；
- discount handling；
- explicit staff attribution；
- package safety；
- rule versioning；
- calculation period；
- review/approval/freeze；
- adjustment；
- refund/reversal；
- Payroll bridge；
- staff statement；
- tenant/RBAC；
- idempotency/concurrency。

Product commission 没有明确 staff attribution 时 fail closed。

Statutory classification 与 commission calculation 分离；佣金金额存在不代表系统可以猜 EPF/SOCSO/EIS/PCB treatment。

## 25. Payroll

### 25.1 Employee payroll setup

- compensation profile；
- pay basis；
- salary/rate；
- effective-dated version；
- recurring earnings/deductions；
- bank account workflow；
- statutory/tax profile。

### 25.2 Payroll components

- Basic pay；
- recurring pay；
- allowances/deductions components；
- variable pay；
- adjustment / correction；
- commission bridge；
- claims reimbursement boundary；
- attendance-to-payroll input；
- unpaid absence / overtime policy foundation；
- statutory deductions/employer contributions；
- gross / net reconciliation。

### 25.3 Payroll workflow

- Payroll workspace；
- create run；
- employee entries；
- draft/review/readiness blockers；
- approval；
- lock/finalize；
- reopen/correction；
- immutable snapshots；
- audit；
- CSV/XLSX export。

### 25.4 Payslip

- finalized payroll facts；
- published / own-only staff access；
- PDF；
- wage、deductions、statutory、reimbursement 分区；
- historical integrity。

### 25.5 Payroll high-risk security

Approve/reopen/export/payment actions按策略要求 capability、whole-business scope、separation of duties 和 True MFA step-up。

## 26. Malaysia Statutory

### 26.1 Engineering foundation

- EPF / KWSP；
- SOCSO / PERKESO；
- EIS；
- LINDUNG24；
- PCB / MTD 2026 foundation；
- official artifact ingestion；
- dataset/version/digest；
- golden fixture verification；
- encrypted immutable export artifacts；
- employee statutory/tax profile snapshots；
- submission/correction history。

### 26.2 Human governance

```text
Engineering
→ Official Evidence
→ Canonical RuleSet registration
→ UNKNOWN classification review
→ Human sign-off
→ MFA step-up
→ Controlled activation
```

Reviewer 与 Activator 必须分离：

```text
Authorised Reviewer
≠ Statutory Activator
```

Codex/ChatGPT 不能替人选择 INCLUDED / EXCLUDED / KEEP UNKNOWN，不能代勾 checklist，不能代 Human Sign-off，不能 activate RuleSet。

### 26.3 当前状态

- EPF / SOCSO / EIS / LINDUNG24 engineering：READY；
- authorised human review/sign-off：仍需人类执行；
- controlled activation：NOT ACTIVE；
- PCB / MTD：PARTIAL；
- 没有 government submission 被自动执行。

## 27. Payroll Payment / Public Bank

当前已有 provider-neutral Payment Batch foundation：

- employee bank readiness；
- draft batch；
- frozen instructions；
- submit/review/approve/cancel；
- corrections/events/audit；
- artifact registry boundary；
- high-risk MFA integration。

但 Public Bank adapter 仍 fail closed：

```text
PUBLIC_BANK_SPEC_NOT_READY
```

在官方 file specification、field mapping、golden fixture、portal validation 和 result import 完成前：

- 不生成假的 bank file；
- 不声称可以付款；
- 不执行银行传输；
- Payment Batch 不等于钱已到员工账户。

## 28. Inventory Core

- product stock per branch；
- canonical stock movement ledger；
- stock in/out；
- manual adjustment；
- branch transfer；
- guarded decrement；
- sale/refund linkage；
- movement history；
- reconciliation；
- reorder level；
- projected stock；
- suggested purchase quantity；
- tenant/branch/RBAC；
- idempotency/concurrency。

Inventory quantity 只能来自 canonical movements，不应让用户直接改 materialized balance。

## 29. Supplier、Purchase Order 与 Goods Receipt

### 29.1 Supplier

- supplier profile；
- business scope；
- contact/invoice identity；
- PO / Bill history。

### 29.2 Purchase Order

- Draft；
- Approved；
- Partially Received；
- Received / Closed / Cancelled；
- lines、quantity、price；
- ordered quantity；
- branch scope；
- audit。

### 29.3 Goods Receipt

- receive against PO；
- partial receipt；
- goods receipt line；
- inventory movement；
- receipt reversal；
- net received calculation。

```text
Net Received
= Goods Receipt
- Goods Receipt Reversal
```

## 30. Supplier Bill 与 Accounts Payable

### 30.1 Canonical boundaries

```text
PO
≠ Supplier Bill

Goods Receive
≠ Supplier Bill

Supplier Bill
≠ Supplier Payment
```

- PO = 订货事实；
- Goods Receipt = 收货与库存事实；
- Confirmed Supplier Bill = 欠供应商多少钱；
- Supplier Payment = 已经付了多少钱。

### 30.2 Supplier Bill

- Draft / Confirmed / Void；
- bill lines；
- supplier invoice number duplicate protection；
- invoice attachment；
- PO/GR matching；
- Ordered / Received / Billed trace；
- partial billing；
- over-bill protection；
- price variance review；
- concurrent confirm protection。

Draft Bill 不进入 AP。Supplier Bill 不修改 inventory。

### 30.3 AP

```text
Outstanding AP
= Confirmed Bill Amount
- Valid Completed Supplier Payments
```

- Unpaid / Partially Paid / Paid；
- Due Soon；
- Overdue；
- Supplier outstanding balance；
- AP reconciliation；
- branch/business scope。

### 30.4 Supplier Payment

- partial/full payment；
- overpayment protection；
- True MFA；
- idempotency/concurrency；
- reversal；
- immutable completed-payment history。

Supplier Payment 和 reversal 都不修改 inventory，也不会再产生第二笔 Expense。

## 31. Stock Take / Physical Count / Reorder

- stock count session；
- Draft / Counting / Submitted / Approved；
- expected snapshot；
- physical count；
- variance；
- recount / reopen；
- stale-count protection；
- approved adjustment movement；
- operational movement awareness；
- reorder level；
- target stock；
- on-order quantity；
- projected stock；
- suggested purchase quantity；
- PO shortcut。

Delivery Order fulfillment contract、FIFO/COGS 和 valuation 不属于当前完成范围。

## 32. Business Expenses

### 32.1 Expense lifecycle

- Draft；
- Confirmed；
- Void；
- Unpaid / Partially Paid / Paid derived state；
- revision/correction；
- audit；
- duplicate receipt review。

用户不能直接修改 canonical outstanding。

### 32.2 Expense Categories

- category code/name/group；
- active/inactive；
- display order；
- search/filter；
- historical usage protection；
- ordering/reordering UX。

### 32.3 Receipt / Document Auto Fill

- take photo / webcam；
- upload receipt；
- attachment validation；
- OCR / AI document parsing；
- payee、date、amount、receipt no、description suggestion；
- category suggestion；
- payment evidence suggestion；
- confidence/review items；
- duplicate detection；
- human review before save；
- manual entry fallback。

AI suggestion 不是自动 posting。扫描不会自己 create/confirm/pay Expense。

附件 malware scanner 尚未接入时，文件保持 quarantine，不可对外 release。

### 32.4 Payment 与 funding source

- payment method；
- funding source；
- payment date/reference；
- company bank/owner funds/POS drawer 等；
- partial settlements；
- POS drawer linkage；
- reversal/audit。

Receipt 通常表示已付款，但系统仍根据 document evidence、用户确认和实际资金来源保存，不把 Supplier Invoice 错当普通 Expense。

### 32.5 Recurring Expense

- monthly template；
- start/end date；
- branch；
- category；
- payee；
- monthly amount；
- description/notes；
- active/inactive；
- search/filter/pagination；
- generate selected month Draft Expense；
- duplicate-month protection。

Recurring template 不自动表示已经付款。它生成当月 Draft，之后仍需 review、confirm 和 settlement。

## 33. Business Spending

Recorded Business Spending 聚合 canonical sources：

```text
Manual Business Expense
+ Claims
+ Payroll employee cost
+ Confirmed Supplier Bill inventory purchase adapter
= Recorded Business Spending
```

关键边界：

```text
PO
≠ Expense

Goods Receipt
≠ Expense

Supplier Payment
≠ Expense recognition

Confirmed Supplier Bill
→ Inventory Purchase Business Spending
```

Expense recognition 与 cash settlement 是两个事实。今天确认 RM200 Expense 不代表今天的钱箱一定少 RM200。

## 34. Reports 与 Business Performance

### 34.1 Operational reports

- sales；
- payments/payment mix；
- refunds；
- invoices；
- services/products；
- packages；
- staff/commission；
- inventory；
- expense/spending；
- closing；
- attendance/payroll exports。

### 34.2 Business Performance Dashboard

- date/scope/timezone；
- sales KPI；
- recorded business spending；
- income vs spending；
- trend；
- previous-period comparison；
- branch performance；
- product/service ranking；
- inventory signal；
- Accounts Payable signal；
- optional workforce metrics；
- data coverage；
- reconciliation health；
- cache/read model。

### 34.3 Group Dashboard

- authorised businesses；
- all-stores comparison；
- group KPI；
- store ranking；
- trends；
- closing/report navigation；
- group commercial view。

Dashboard 不能把 Expense 当 cash movement，也不能把 AP payment 重复算作 spending。

## 35. Ask Tetamu / AI Business Analysis

### 35.1 Phase 1 能力

- Business Ask Tetamu；
- Group Ask Tetamu；
- sales questions；
- profit-safety wording；
- inventory questions；
- AP questions；
- missing-data answer；
- reconciliation-aware answer；
- structured output；
- conversation/follow-up；
- tenant/branch/group RBAC；
- sensitive-data exclusion；
- prompt-injection defence；
- mock provider；
- real OpenAI provider；
- request quota / token telemetry / immutable usage ledger；
- owner usage UI。

### 35.2 Read-only hard rule

```text
AI Business Analysis Phase 1
= READ ONLY
```

AI 不能：

- create/edit/delete business records；
- approve Leave/Claim/Payroll；
- pay supplier/employee；
- adjust stock；
- activate statutory RuleSet；
- invent missing data；
- call web for unapproved business facts。

Phase 2 agent/actions/web remain deferred。

### 35.3 Provider boundary

OpenAI key 只存在 server-side ignored environment。Testing 与未来 Production 必须使用独立 Project/key。Quota/credit/provider error 不应 fallback 为伪造的 real AI answer。

## 36. Commercial Pricing

- canonical Plan；
- immutable plan versions；
- base + add-ons；
- monthly / annual pricing；
- setup fee metadata；
- promotions；
- customer-specific typed override；
- effective dates / expiry；
- branch allowance；
- employee allowance；
- AI allowance projection；
- module entitlement projection；
- legacy/grandfathering review；
- group/business scope；
- reconciliation/audit。

Plan price 和 entitlement 分开建模，但有效 subscription 可以 projection entitlement。

## 37. Subscription Billing

- Business / Group subscription；
- invoice generation；
- billing period；
- frozen price snapshot；
- promotion/override/setup/add-on/unit charges；
- Draft / Issued / Void；
- outstanding/overdue；
- partial/full payment；
- payment reversal；
- renewal；
- upgrade/downgrade boundary；
- idempotency/concurrency；
- reconciliation；
- Platform Admin + MFA。

Subscription Payment 与 Supplier Payment、Payroll Payment、POS Payment 完全分开。

在线 payment gateway、automatic settlement、SST/tax commercial decision 和完整 proration 仍属 deferred/external scope。

## 38. Platform Statutory Review UI

Platform Admin routes 支持：

- Canonical RuleSet list/detail；
- scheme review packs；
- evidence/artifact/SHA-256；
- dataset/calculator/fixtures；
- UNKNOWN inventory；
- reviewer decisions；
- sign-off workflow；
- activation controls；
- audit。

第一个法律/法定分类 decision 必须停下来让 authorised human 选择。

## 39. 主要页面路线

### 39.1 Business app

```text
/cashier
/appointments
/crm/customers
/crm/vehicles
/services
/products
/packages
/invoices
/closing
/whatsapp/inbox
/team
/team/roster
/team/attendance
/team/leave
/team/claims
/team/commission
/team/payroll
/inventory
/inventory/purchase-orders
/inventory/supplier-bills
/inventory/accounts-payable
/inventory/stock-counts
/expenses
/expenses/new
/expenses/history
/expenses/categories
/expenses/recurring
/reports
/ai
/business/settings
/business/settings/payment-methods
```

### 39.2 Staff App

```text
/staff/login
/staff/verify
/staff/select-workplace
/staff
/staff/roster
/staff/history
/staff/leave
/staff/claims
/staff/commission
/staff/timesheet
/staff/payslips
/staff/profile
/staff/device
```

### 39.3 Group

```text
/groups/[groupId]/overview
/groups/[groupId]/reports
/groups/[groupId]/closing
/groups/[groupId]/commercial
/groups/[groupId]/ai
```

### 39.4 Platform Admin

```text
/admin/businesses
/admin/business-groups
/admin/commercial
/admin/commercial/billing
/admin/statutory/rulesets
/admin/statutory/review/[scheme]
/admin/security/sensitive-actions
/admin/whatsapp-templates
```

## 40. Canonical End-to-End Flows

### 40.1 Salon day

```text
Customer / Walk-in
→ Appointment
→ Staff + service
→ Checkout
→ Payment / Complimentary training
→ Invoice
→ Commission event
→ Shift Closing
→ Reports / Dashboard
```

### 40.2 Auto day

```text
Customer + Vehicle
→ Work Order
→ WAITING / IN_PROGRESS / READY_FOR_PICKUP
→ WhatsApp
→ Checkout
→ Invoice
→ COMPLETED
→ Closing / Reports
```

### 40.3 Procurement

```text
Supplier
→ Purchase Order
→ Goods Receipt
→ Stock Movement
→ Supplier Bill Confirmed
→ AP Outstanding
→ Supplier Payment
→ AP Reconciliation
```

### 40.4 Expense

```text
Receipt / Manual / Recurring Draft
→ Human Review
→ Confirm Expense
→ Business Spending
→ Payment from Company Bank / Owner / POS Drawer
→ Outstanding / Settlement
→ Cash Flow / Closing effect only when applicable
```

### 40.5 Employee workday

```text
Published Roster
→ Expected Attendance
→ Clock In / Break / Clock Out
→ Raw Punches
→ Exceptions / Resolution
→ Final Attendance Result
→ Monthly Timesheet
→ Payroll Attendance Input
```

### 40.6 Payroll

```text
Employee Profile
+ Recurring Pay
+ Variable Pay / Adjustments
+ Commission
+ Attendance
+ Approved safe Claims reimbursement
→ Payroll Run
→ Review / Readiness
→ Approval / Lock
→ Payslip Publication
→ Payment Batch readiness
→ Public Bank adapter only after official specification
```

## 41. Financial facts that ChatGPT must never mix

| Fact | Meaning | Does not mean |
| --- | --- | --- |
| Sale / Invoice | Customer owes or paid Business | Cash definitely entered drawer |
| POS Payment | Customer tender recorded | External gateway settled |
| Expense | Business cost recognised | Paid from today’s drawer |
| Expense Payment | Cost settlement | New Expense recognition |
| Supplier Bill | AP liability recognised | Goods received today |
| Goods Receipt | Stock received | Supplier already invoiced |
| Supplier Payment | AP reduced | Inventory or Expense increases |
| Payroll Run | Payroll calculated/approved | Bank has paid employees |
| Payment Batch | Frozen payment instruction | Money transferred |
| Subscription Invoice | Tetamu receivable | Online gateway settled |

## 42. Important derived formulas

```text
Supplier AP Outstanding
= Confirmed Supplier Bills
- Valid Completed Supplier Payments
```

```text
Expense Outstanding
= Confirmed Expense Amount
- Valid Applied Expense Payment Events
```

```text
POS Drawer Expected Cash
= Opening Float
+ Net Cash Sales
- Valid POS Drawer Expense Payouts
```

```text
Recorded Business Spending
= Manual Expenses
+ Claims
+ Payroll Employee Cost
+ Confirmed Supplier Bill Inventory Purchase Adapter
```

所有 derived state 都必须从 canonical facts 计算/核对，不能让用户随意覆盖。

## 43. Idempotency、Concurrency、Audit 原则

- 金融 command 使用 durable idempotency key；
- transaction 内重读 canonical state；
- concurrent payment 防 overpayment；
- concurrent bill confirm 防 over-billing；
- duplicate invoice/receipt/notification 防重复；
- completed financial fact 不直接删除；
- correction、refund、void、reversal 追加历史；
- sensitive actions 写 audit；
- tenant/business/branch composite constraints；
- immutable snapshot/digest 用于 Payroll、Statutory、Closing、Commercial。

## 44. 当前明确限制与 Deferred

### 44.1 外部 / Human actions

- Real SMS123 Staff SMS 接收验收仍受 Testing provider/account/phone delivery 条件限制；
- WhatsApp live acceptance 依赖真实 connector、session、worker 和 provider状态；
- OpenAI live provider 依赖 Testing key、Project credit/quota；
- Statutory human review/sign-off 尚需 authorised reviewer；
- EPF/SOCSO/EIS/LINDUNG24 activation 仍关闭；
- Production provider credentials 必须与 Testing 分开。

### 44.2 Deferred product scope

- PCB / MTD 完整 closure；
- Public Bank payroll adapter/artifact/result import；
- supplier credit note；
- return to supplier；
- full General Ledger；
- complete accounting；
- FIFO / COGS / inventory valuation；
- online subscription payment gateway；
- final SST/commercial tax policy；
- AI Phase 2 actions/agents/web；
- attachment malware scanner integration；
- complete leave statutory dataset / carry-forward engine。

## 45. ChatGPT / Codex 工作规则

当 ChatGPT 或 Codex 处理 Tetamu 任务时，必须：

1. 先检查当前 repository，不把旧聊天摘要当最新事实；
2. 只在 Local / Testing 工作，除非 Production Owner 明确提供新授权；
3. 保留 dirty worktree，不 reset、不 destructive checkout；
4. 未经明确要求不 commit、不 push、不 deploy；
5. 不创建第二套重复 domain logic；
6. Staff App 必须调用现有 Attendance/Leave/Claims/Commission/Timesheet/Payslip services；
7. 不把 UI hide 当权限；server 必须 deny；
8. 不从浏览器旧值决定高风险金额；transaction 内重读；
9. 不猜 Roster、Off Day、Leave、statutory treatment 或 missing business data；
10. 不替人做 statutory/legal classification；
11. 不读取或输出 password、API key、TOTP secret/code、recovery code；
12. 不把 Payment Batch、Connected、Sent to server 等中间状态声称为最终 settlement/delivery；
13. 任何 READY 结论必须有 tests、build、migration、browser 或 reconciliation evidence；
14. 清楚区分 Engineering READY、Testing PASS、Human action、External provider 和 Production validation。

## 46. 给 ChatGPT 的短版开场提示

如果不想每次贴完整文件，可以先贴下面这段，再附上本文件：

```text
你正在协助开发 Tetamu：一个面向马来西亚服务行业的多租户 SaaS，包含 POS、预约、CRM、WhatsApp、HR、Roster、Attendance、Leave、Claims、Commission、Payroll、Statutory、Inventory、Supplier/PO/GR、Supplier Bill/AP、Expenses、Business Performance、Read-only AI、Commercial Pricing 和 Subscription Billing。

请把当前 repository 和 docs/tetamu-system-complete-feature-context.md 当 canonical context。所有操作只允许 Local / Testing；Production 不在范围。保留 dirty worktree，不 reset、不 destructive checkout，未授权不 commit/push/deploy。

永远保持 domain boundary：Goods Receipt 影响库存；Confirmed Supplier Bill 影响 AP/Business Spending；Supplier Payment 只减少 AP；Expense recognition 与 payment/cash flow 分开；Published Roster 才产生 expected attendance；raw punch 不可覆盖；Payroll Payment Batch 不等于银行已付款；AI Phase 1 只读；Statutory legal decisions/sign-off/activation 必须由 authorised human 执行。

开始任务前先 audit 当前 code/schema/routes/tests/docs，不要根据旧对话猜系统现状。
```

## 47. Canonical evidence index

本说明主要由以下当前 repository 证据综合：

- `prisma/schema.prisma`；
- `src/app` 当前 routes；
- `src/lib/modules/registry.ts`；
- `docs/master-uat-launch-acceptance.md`；
- `docs/known-limitations-and-deferred-scope.md`；
- `docs/pos-financial-idempotency-production-hardening.md`；
- `docs/business-module-feature-entitlement-foundation.md`；
- `docs/employee-self-service-staff-app-final-closure.md`；
- `docs/staff-app-real-otp-authentication-phase1.md`；
- `docs/roster-shift-scheduling-phase1.md`；
- `docs/attendance-p2-resolution-workflow.md`；
- `docs/hr-leave-management-final-closure.md`；
- `docs/hr-claims-reimbursements-final-closure.md`；
- `docs/commission-engine-final-closure.md`；
- `docs/unified-hr-approval-center-final-closure.md`；
- `docs/payroll-p4a-recurring-pay-foundation.md`；
- `docs/payroll-p4b-component-calculation-foundation.md`；
- `docs/payroll-p4c-variable-pay-adjustment-correction-foundation.md`；
- `docs/payroll-p4d-unified-workflow-ux.md`；
- `docs/payroll-p5-attendance-integration.md`；
- `docs/statutory-human-governance-closure.md`；
- `docs/statutory-pcb-2026-closure.md`；
- `docs/payroll-payment-p3-public-bank-readiness.md`；
- `docs/inventory-phase1-core-stock-foundation.md`；
- `docs/inventory-phase2-supplier-purchase-order-goods-receive.md`；
- `docs/inventory-phase3-stock-take-reorder-foundation.md`；
- `docs/supplier-bill-accounts-payable-phase1.md`；
- `docs/expense-phase1-business-expense-foundation.md`；
- `docs/expense-phase2a-claims-payroll-business-spending-integration.md`；
- `docs/expense-phase2b-inventory-purchase-business-spending.md`；
- `docs/expense-receipt-document-autofill.md`；
- `docs/expense-reporting-cash-flow-optimization.md`；
- `docs/business-performance-dashboard-phase1.md`；
- `docs/ai-business-analysis-phase1.md`；
- `docs/ai-usage-quota-commercial-foundation-phase1.md`；
- `docs/commercial-pricing-foundation-phase1.md`；
- `docs/subscription-billing-payment-foundation-phase1.md`；
- `docs/whatsapp-testing-hardening.md`。

## 48. 最终环境声明

```text
TETAMU SYSTEM FEATURE CONTEXT
→ DOCUMENTED FROM CURRENT REPOSITORY

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
