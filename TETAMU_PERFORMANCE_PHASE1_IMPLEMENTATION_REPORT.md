# Tetamu 个人与团队业绩：第一阶段实施报告

日期：2026-09-05。状态：**ENGINEERING_READY（仅第一阶段工程验收；未上线，未正式启用）**。

已实现独立收款业绩账本、销售归属、小费归属、受保护的归属更正、7 个现有收款／核销动作以及退款／作废接入。83 项针对性自动测试通过，另完成真实 Next.js 结账页面的桌面及 390px 交互验证。目标后台、Staff App 业绩页面、奖金和生产历史回填没有实施。

本状态不等于生产发布批准。Paid-VOID 历史规则、生产迁移及启用准备、真实设备检查仍见第 8 节。功能开关默认关闭。

## 1. 仓库、复核范围和工作区保护

- 实际仓库：/Users/innovdia/Development/carwashpro。
- 分支：main；HEAD：5f9b5b5f350d6ee3670f4d989b203776e6527544。没有切换分支、创建提交、推送或部署。
- 遵循仓库 AGENTS.md 及中文沟通要求；按仓库要求读取实际 Next.js 版本的相关指南。使用 Postgres 最佳实践技能，其影响限于外键、索引、事务和约束设计，未连接 Supabase 或生产数据库。
- 参考并复核了[原结构报告](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/TETAMU_PERFORMANCE_POS_STRUCTURE_REVIEW.md)，以当前真实源码为准，没有按重复正文重复执行，也没有从旧 commit 单独取出遗漏工作区依赖的版本。
- 开始时已有 88 个未提交／未跟踪文件。对这些文件保存 SHA-256，实施后的复核结果为 **88 个全部未变**；包括 Staff 首页、Approvals 导航、考勤、佣金、图片及环境配置的原有修改。证据：[工作区基线](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase1-workspace-baseline.json)。
- 本阶段修改原来干净的 13 个文件，并新增业绩模块、迁移、脚本、测试和本报告。没有修改 Staff 导航、Home / Time / Pay / Profile 或 Approvals 入口。
- 浏览器验证使用当前完整工作区的临时运行副本：/Users/innovdia/Documents/Codex/2026-09-03/bang/work/performance-ui.iFIUX6。副本保留用户未提交源码依赖，但不复制 .env、现有数据库目录或构建缓存；连接明确指定的隔离测试库，在 3101 端口运行。没有更改用户的 3000 端口服务。

重新搜索 src/app 与 src/lib 中实际 Payment.create／PaymentRefund.create 调用，仍归属第 3 节的 7 个收款动作及单一退款动作；Appointment、CRM、工单等页面入口最终调用这些写入点。本阶段没有发现需要接入的独立在线钱包充值写入器。没有假设收银员或服务人员就是销售员工。

## 2. 最终金额、销售归属和小费归属契约

### 2.1 金额与时间

| 项目 | 本阶段契约 |
| --- | --- |
| 资金来源 | Payment 的实际 amount、paidAt；退款来源 PaymentRefund 的 amount、refundedAt，并关联原 paymentId |
| 业绩 | 销售实收 + 实收小费 − 销售退款 − 小费退款；税不计入；不减成本、佣金、工资、租金、渠道手续费 |
| 金额表示 | 数据库 BIGINT 分；边界使用 Prisma Decimal 转整数分；拒绝超精度、非有限值和非安全整数；分配乘法用 BigInt |
| 组成守恒 | 每个来源 rawCents = salesCents + taxCents + tipCents + unresolvedCents；已证实的新单 unresolved 为 0 |
| 分次付款 | 消耗尚待收取的销售／税／小费；每笔只计本笔实际收到的组成，不累计发票总额 |
| 精确证据 | 已捕获的原收款组成优先；配套覆盖有匹配服务明细及税额时使用精确组成；内部捕获服务支持可信 exact 参数并严格校验 |
| 缺少精确组成 | REMAINING_COMPONENT_PRO_RATA_V1，按剩余组成采用最大余数法；同余数以稳定键排序；最后一笔自然吃完剩余分币 |
| 非现金优惠 | 折扣、积分抵扣、免单已反映在发票应收中，不加回业绩；零收款不要求业绩员工 |
| 配套 | 出售收款计一次；PACKAGE 核销及 RESTORE 恢复权益业绩为 0；覆盖金额先排除，额外现金只分摊剩余池 |
| 外币等方式 | 沿用既有 Payment.amount 的 MYR 折算结果；本模块不另做汇率或手续费计算 |
| 时区 | 解析门店已有 BranchAttendanceSetting.timezone，未设置则 Business.timezone；校验 IANA 时区；每笔冻结解析时区和 localDate |
| 月／年 | 按实际收款／退款时刻在解析时区内的自然月、自然年，午夜分界；不使用 02:00 营业日边界 |

证据：[金额算法](/Users/innovdia/Development/carwashpro/src/lib/performance/money.ts:7)、[自然期间](/Users/innovdia/Development/carwashpro/src/lib/performance/time.ts:4)、[收款捕获](/Users/innovdia/Development/carwashpro/src/lib/performance/service.ts:95)、[配套精确覆盖](/Users/innovdia/Development/carwashpro/src/lib/performance/service.ts:222)。

现有 PaymentMethod 为 CASH、CARD、DUITNOW、EWALLET、BANK_TRANSFER、FOREIGN_CURRENCY、CRYPTO、PACKAGE。PACKAGE 明确排除；其余实际销售 Payment 按 MYR 收款处理。这里的 EWALLET 是已有支付方式，不据此虚构客户储值充值事件。本次未建立充值／消费双重计入渠道。

### 2.2 人员身份与独立归属

| 语义 | 保存位置及行为 |
| --- | --- |
| 收银操作人 | 原 Payment.cashierId / User，继续保存操作身份 |
| 服务人员 | 原 Appointment.assignedStaffId、服务分配等字段，维持原义 |
| 佣金人员 | 原 InvoiceItem.commissionMembershipId 等佣金字段，不修改、不自动转换 |
| 销售业绩 | PerformanceAttribution，SALE:invoiceId 范围；分配使用 EmployeeBusinessMembership.id；默认一人 100%，多人使用 basisPoints，合计 10000 |
| 小费业绩 | 独立 PerformanceAttribution，TIP:paymentId 范围；一笔收款最多一名小费获得者 100%；可以不在销售名单中 |
| 未分配 | membershipId 为 null、recipientKey 为 UNASSIGNED；销售与小费分别保留，不能静默归给收银员 |

员工名和编号只是显示与快照，不是主键。候选必须满足同 business、有效 branch assignment、有效日期、ACTIVE membership 和 employee account；门店也必须有效。店长可入选，不要求 appointmentBookable、canClockIn 或 attendanceEnabled。跨店支援需已有该门店有效派驻证据，不通过输入任意员工 ID 绕过。证据：[服务端资格](/Users/innovdia/Development/carwashpro/src/lib/performance/scope.ts:17)。

订单补款复用已记录的销售版本；普通下拉框不能更改已付款销售归属。每个新的有小费收款单独确认小费获得者。姓名、编号和份额保留版本快照；调店、离职不搬走原 branch 的收入，不删除历史个人贡献或退款收款关联。

### 2.3 新界面、旧客户端与追加小费

- 新界面提交 version=1 的 performanceAttribution：sales 数组、独立 tipMembershipId、必要时 unassignedReason；服务端再次校验 UUID、人数、重复员工、比例、权限和范围。
- 正常有销售实收要求销售归属；有实收小费要求小费归属。获授权的未分配例外必须写明原因，销售和小费可分别选择例外。
- 未携带新字段的旧客户端保留兼容路径，明确记录 LEGACY_CLIENT_NO_PERFORMANCE_FIELD／LEGACY_CLIENT_NO_TIP_RECIPIENT，不推断员工。服务端 TETAMU_PERFORMANCE_LEGACY_COMPAT=false 可关闭这条兼容路径；默认保留以免突然阻断旧收款。这个开关应在客户端升级完成后收紧，不能把前端字段当成身份认证。
- 老客户端没有新字段时，原财务幂等指纹保持不变；功能开关关闭时不解析新字段、不增加小费、不访问新表。
- 统一 Salon POS 新发票可输入小费金额；原 Salon 开票小费字段继续使用原语义。
- 旧版 Salon 补款新增“Additional tip for this balance payment · 本次新增小费”。此字段只增加本次确认的新小费应收，不编辑旧已收小费。追加金额、Invoice 的 tip/total/balance 变动、收款、业绩及审计在同一财务事务中；新付款的小费必须单独指定员工，旧付款的金额和小费归属不变。部分收取时仍只计算收到的比例。
- 已结清、VOID 或 REFUNDED 发票不会因追加小费而自动重开。已结清后独立收一笔小费不属于现有余额收款动作，本次未新增这种独立资金入口。

证据：[输入与开关](/Users/innovdia/Development/carwashpro/src/lib/performance/input.ts:11)、[追加小费事务服务](/Users/innovdia/Development/carwashpro/src/lib/performance/checkout-tip.ts:9)、[补款接入](/Users/innovdia/Development/carwashpro/src/app/(business)/appointments/actions.ts:1597)。

### 2.4 退款、更正与异常

退款优先关联原收款快照。在原付款剩余可退销售／税／小费中分摊；有可信明确组成时用 exact 校验，不悄悄回退为比例分摊。销售和小费分别使用原收款的有效归属及剩余可退个人金额，退税不计业绩。归属被合法更正过时，使用可追溯的当前归属证据。全退后逐人净贡献精确为 0。

CreditNote 保留原财务逻辑，但不作为第二条业绩退款来源。没有增加退款权限、放宽配套整退条件或取消库存退货要求。历史原付款／旧退款缺组成时，新退款保存为待核对来源，不编造个人扣减，也不因新业绩模块而阻断既有合法退款。证据：[退款捕获](/Users/innovdia/Development/carwashpro/src/lib/performance/service.ts:162)。

correctPerformanceAttribution 是受保护的后端服务，不是开放给客户端任意传 actorUserId 的 HTTP API：调用方必须传入已认证服务器上下文。SALE 更正作用于该发票的已捕获销售付款和退款；TIP 更正必须指定一笔原 paymentId。服务检查权限、expectedRevision、原因和 operationKey，追加版本、零和贡献差额及事务审计，不更新旧证据，不改变团队金额。重放前也检查权限，权限撤销后不能借旧幂等请求重放。完整后台更正界面留待后续。证据：[更正服务](/Users/innovdia/Development/carwashpro/src/lib/performance/corrections.ts:20)。

Paid-VOID 保存 VOID_WITHOUT_REFUND_EVIDENCE 来源异常，不生成 PaymentRefund，不把 VOID 当成现金退还。读取时原来源仍存在，但进入 pending 和对账异常，不继续作为正常已核对进度，也不悄悄消失。证据：[作废捕获](/Users/innovdia/Development/carwashpro/src/lib/performance/service.ts:207)、[账本读服务](/Users/innovdia/Development/carwashpro/src/lib/performance/read.ts:17)。

## 3. 每个资金／核销入口的最终接入状态

以下均把捕获放在原 runFinancialOperation 事务内、提交之前；不是事后异步补记。员工候选 API 为 /api/performance/checkout-context，私有、不缓存，使用实际业务登录能力及对象归属解析门店。

| 入口 | 实际代码与接入 | 真实页面验证 |
| --- | --- | --- |
| 1. 统一 Salon 收银 | [completeCashierSaleAction](/Users/innovdia/Development/carwashpro/src/app/(business)/cashier/actions.ts:80)，捕获该次 PACKAGE 及现金 Payment；新单小费独立金额与归属 | 桌面产品销售；390px RM118 示例；预约服务核销 RM108 + 商品和小费现金 RM118；均实际提交并核对数据库 |
| 2. Salon 预约收款／补款 | [recordSalonAppointmentPaymentAction](/Users/innovdia/Development/carwashpro/src/app/(business)/appointments/actions.ts:1068)，显式收集本次付款 ID，含订金及配套；补款复用销售版本 | 原单 RM59 + RM59，分别指定小费获得者；另单 RM59 后追加 RM10 小费并收 RM69 |
| 3. 工单现金／补款 | [recordPaymentAction](/Users/innovdia/Development/carwashpro/src/app/(business)/pos/actions.ts:31) | /pos/[workOrderId] 实际收 RM54 + RM54，第二笔销售锁定为原人 |
| 4. 工单配套核销 | [usePackagePaymentAction](/Users/innovdia/Development/carwashpro/src/app/(business)/pos/actions.ts:257) | RM108 纯 PACKAGE，无员工选择，次数 5→4，业绩贡献 0；保持原核销覆盖语义 |
| 5. 待付款配套激活 | [recordPackagePurchasePaymentAction](/Users/innovdia/Development/carwashpro/src/app/(business)/pos/actions.ts:518) | /pos/packages/[id] 收 RM108，配套变 ACTIVE，销售业绩 RM100，不把以后核销再当收入 |
| 6. 旧版收银买配套 | [purchasePackageFromCashierAction](/Users/innovdia/Development/carwashpro/src/app/(business)/work-orders/actions.ts:530) | Work Orders → Create job → Buy Package，真实购入 RM108，新增 CustomerPackage 并激活 |
| 7. 旧版商品销售 | [sellProductAction](/Users/innovdia/Development/carwashpro/src/app/(business)/products/actions.ts:318) | Work Orders → Sell Product；验证正常销售、库存不足、过期员工资格拦截和原请求 ID 重试 |
| 退款／配套恢复 | [refundPaymentAction](/Users/innovdia/Development/carwashpro/src/app/(business)/invoices/actions.ts:59) | RM118 商品全退并 RESTOCK；服务收款 RM59 分 RM5.90 + RM53.10 退完；配套次数 4→5，RESTORE 业绩 0 |
| 作废 | [voidInvoiceAction](/Users/innovdia/Development/carwashpro/src/app/(business)/invoices/actions.ts:520) | 已付 RM54 + RM54 工单实际 VOID，2 个来源异常，0 条虚构退款；原财务重开语义不变 |

必要的相邻修复：Salon 老补款不渲染订金方式字段，FormData 返回 null 导致旧 schema 默认值未生效；仅把缺失 depositMethod 规范为 undefined，让既有 CASH 默认值生效。显式非法值仍然被拒绝。没有删除校验来“通过测试”。

未把取消预约、取消未付款工单、作废或恢复权益自动转换成收退款。非上述资金写入动作不会凭订单状态增加业绩。

## 4. 数据模型、迁移与隔离数据库验证

### 4.1 最小数据模型

| 新模型 | 作用 |
| --- | --- |
| PerformanceAttribution | business/branch/invoice 范围，SALE 或 TIP，scopeKey、revision、reason、actor、JSON 证据；TIP 另绑定 paymentId |
| PerformanceShare | EmployeeBusinessMembership 外键、basisPoints、员工姓名／编号快照；不使用 User ID 混充员工 |
| PerformanceReceipt | PAYMENT/PACKAGE/REFUND/RESTORE 来源快照，唯一 sourceKey、原付款／退款 ID、四类组成分币、occurredAt、localDate、timezone、policyVersion、quality、evidence |
| PerformanceContribution | 事件 × 归属版本 × 销售／小费 × 人员或未分配的有符号分币；更正追加差额，不改旧行 |
| PerformanceSourceIssue | 每个付款来源的唯一异常代码、理由和证据；目前用于 paid-VOID |

定义见 [Prisma 模型](/Users/innovdia/Development/carwashpro/prisma/schema.prisma:9098)。还在 FinancialOperationType 中新增独立销售更正／小费更正类型。未新增目标、等级奖金、Payroll 或小费发放模型。

新增迁移：[20260905160000_performance_receipts_phase1](/Users/innovdia/Development/carwashpro/prisma/migrations/20260905160000_performance_receipts_phase1/migration.sql)。

- 外键 RESTRICT 保留历史身份；membership/business 复合外键、scope trigger 防止跨租户／分店关联。
- 来源唯一约束及原付款部分唯一索引防止重复捕获；每个 refundId 只能捕获一次。
- 数据库检查 raw 与组成守恒、金额正负、来源类型与 Payment.method 对应、原收款／退款金额一致。
- 延迟约束在事务末检查 SALE/TIP 分配守恒、份额合计 100%、小费最多一人；捕获失败使原收款一起回滚。
- 五张证据表拒绝 UPDATE/DELETE。旧版本不能补插新 share，必须在创建新归属版本的同一事务内写 share。
- 索引覆盖来源、发票版本、门店时间、localDate、个人 membership 及外键查询。

迁移 SHA-256：073c159e0fe77843ba2944756c049c8ec2e72d477fd383c6dccdb45dac991824；与最终隔离库 _prisma_migrations.checksum 一致。

### 4.2 实际验证环境

- 本机 PostgreSQL 18.4；Prisma 6.19.3；Node v22.23.2；Next.js 16.3.0。
- 仅创建／使用 127.0.0.1:5432 的 tetamu_performance_disposable_phase1_20260905_a、_b、_c、_d；后缀 A/B/C 是开发中的隔离试验库，**最终验收库为 D**。
- D 从空库应用当前全部 214 个迁移。Prisma validate、migrate status 通过，状态 up to date；没有在主本地业务库或生产库执行迁移。
- 中间试验发现“用创建时间判断 share 是否同事务”会被 Prisma 传入的毫秒时间影响；改为数据库事务身份检查后，在全新 D 库重放迁移及验证。没有改写已部署迁移，也没有把中间失败说成全部一次通过。
- 新增创建库脚本拒绝重用已有数据库，只接受专用 disposable 名称；浏览器种子和预览脚本只接受显式 loopback + 专用库名前缀。它们不是生产回填脚本。

本阶段没有生产 schema／PG 版本验证、生产锁影响测试或生产数据质量统计；这些不能由本地测试替代。

## 5. POS UI/UX 和失败恢复

- 在结账汇总区域放独立“业绩归属员工”；单人是默认模式，多人按需展开，提供平均分和逐人比例、总百分比与剩余／超额提示。
- 名单用姓名＋员工编号，支持搜索；使用 54 人、同名 A/B、长姓名及仅收小费的 C 测试。经理即使 canClockIn=false 也能正常出现。
- 小费有独立搜索和选择区域，不能用销售比例或收银员替代。补款销售只读，提示更正须使用受保护流程。
- 受权例外分别控制销售未分配与小费未分配，要求原因；纯核销、零收款隐藏不必要选择。
- API 加载、失败、重试、空搜索和比例错误均有状态；业务对象／门店变化时清空旧范围选择，重试同一对象不会无故丢失选择。
- 统一 POS 的归属区放进真正付款弹窗，避免付款时错误出现在被遮住的背景。390px 下跨父级网格整栏显示，多人比例输入不会挤进半栏。
- 旧版页面的全局 .page-header p 隐藏规则曾影响帮助／错误文字；使用本模块局部样式及独立 alert 容器处理，未修改全局 CSS。
- SafePaymentForm 保留购物车、金额、方式和原 operationId；错误后聚焦并滚动到提示，说明先确认收款状态再使用原请求重试。Salon 的付款参考号、订金参考号也改为受控输入，失败不会被 React 表单重置清空。
- 无权限／无效员工导致捕获失败时，Payment、库存变动及归属均回滚；不是“钱收了再慢慢补业绩”。

真实截图证据（不是模拟预览）：

- [桌面结账归属](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-checkout-desktop.png)。
- [390px 多人销售与独立小费](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-mixed-mobile-attribution.png)。
- [390px 补款追加小费](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-additional-tip-mobile.png)。
- [服务端拒绝后的输入保留与错误提示](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-checkout-error.png)。

验证工具运行真实 Next 页面、实际 Server Actions 和隔离 PostgreSQL，不是静态 HTML 或模拟接口。桌面 1440×1000，手机视口 390×844；实际操作了自定义金额键盘、滚动、多人比例、小费名单及付款按钮。Mac 原生界面处于锁屏，改用安装的 Chrome 进行真实页面自动化；**未声称测试实体 iPhone、Safari 或操作系统软键盘弹出行为**。

## 6. 示例交易与对账结果

以下金额单位 RM；数据库／预览 JSON 金额单位为整数分。

### 6.1 RM118 完整示例与全退

真实统一 POS 发票 1003，invoiceId 2241a83e-9183-4254-9bab-ad4d6a23ed6c。

| 来源 | 原收付额 | 销售 | 税（不计业绩） | 小费 | A 净贡献 | B 净贡献 | 团队业绩 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 收款 | 118.00 | 100.00 | 8.00 | 10.00 | 60.00 | 50.00 | 110.00 |
| 全退 | -118.00 | -100.00 | -8.00 | -10.00 | -60.00 | -50.00 | -110.00 |
| 净额 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

销售 A/B 各 50%，小费 A 独享。真实退款同时选择商品退货 RESTOCK；生成一次财务 CreditNote，但没有第二次业绩扣减。另有数据库测试验证小费给不在销售名单的 C，结果 A50、B50、C10，合计仍 110。

### 6.2 原单分次收款、分次退款

真实 Salon 发票 1002：RM118 分 RM59 + RM59 收取。每笔各拆为销售 50、税 4、小费 5；两笔销售仍 A/B 各半，第一笔小费 C、第二笔小费 A。第一笔退款 5.90 拆为销售 5、税 0.40、小费 0.50；再退 53.10，第一笔 A/B/C 各自对应贡献均为 0，不影响第二笔收款。

### 6.3 补款新增小费

真实新 Salon 预约：原应收 118（销售100、税8、小费10），先收59，销售A50、小费A5。补款时明确新增小费10，发票总额变128、小费应收20，再收69：销售A50、税4、小费C15。旧付款仍为59及原小费A5，只有一条追加小费审计。

数据库另测：第二次只收34.50时仅计销售25、税2、小费7.50，不提前计算尚未收到的另外7.50；最后34.50收完剩余组成。追加后失败使 Invoice tip/total/balance、付款、业绩和审计一同回滚，原请求重试只追加一次；三笔最终全退逐人归零。

### 6.4 配套与现金混合

真实 invoiceId 4b3c829b-a691-449c-9496-b72e03970422：服务100＋商品100＋税16＋小费10，总额226。

| 来源 | 覆盖／实收 | 销售组成 | 税 | 小费 | 新增业绩 |
| --- | ---: | ---: | ---: | ---: | ---: |
| PACKAGE 核销服务 | 108 | 100 | 8 | 0 | 0 |
| 现金补款 | 118 | 100 | 8 | 10 | 110 |

核销使用 EXACT_SOURCE_COMPONENTS；现金仅分摊扣掉核销后的池。此前卖配套收到的100销售业绩不会在核销时再增加100。独立纯核销恢复测试次数4→5，PACKAGE和RESTORE均无个人贡献行。

### 6.5 只读预览对账

执行 scripts/preview-performance-phase1.ts，事务内先 SET TRANSACTION READ ONLY，不进行历史回填。结果文件：

- [Salon 最终预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-browser-salon-performance-preview.json)：已核对业绩485、税36、实收净额521；521 = 485 + 36。另列配套非现金净覆盖108；个人合计等于485，未分配0。
- [Auto 最终预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-browser-auto-performance-preview.json)：实收来源净额756 = 已核对业绩600 + 已核对税48 + paid-VOID 待核对原收款108。作废的原销售业绩100仍在 pending，不冒充已核对业绩。
- [历史缺组成预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-legacy-readonly-preview.json)：发现原收款118，但销售／税／小费／合格业绩为 null，标记 REVIEW_HISTORICAL_COMPONENTS_AND_ATTRIBUTION，不根据员工姓名、收银员或发票日期猜测归属。

一次只读验证前后计数完全一致：Payment121、Refund119、Receipt236、Contribution518、Attribution211、Issue7。后续新增的测试交易／用例会增加测试库总行数，不应把这组中间只读检查计数当成最终全库固定总数。

订金捕获只处理实际新建 Payment，不额外加 Invoice.depositAmount。旧表单录入但无法证明原实际日期的订金来源标记 REVIEW_DEPOSIT_DATE，不伪装成已核对的历史当日收入；没有执行生产订金回填。

## 7. 针对性验证证据

### 7.1 自动测试结果

| 范围 | 结果 | 覆盖重点 |
| --- | --- | --- |
| 新金额单元测试 + 相关现有单元测试 | 55/55 通过 | 11项新用例；整数分、精确／比例组成、分币尾差、单人／多人／未分配、自然月年、开关关闭不访问新表、旧幂等指纹不变；另44项现有财务／退款／库存契约／佣金／Payroll计算／CRM权限／商品目录回归 |
| 新业绩隔离数据库集成测试 | 22/22 通过 | 实际 Prisma事务、跨月跨年退款、多人归零、独立小费与更正、分次付款、核销恢复、VOID、历史缺组成、越权、离职调店、并发重放、回滚、不可变证据、补款追加小费 |
| 现有财务／库存／佣金集成测试 | 6/6 通过 | 既有收款幂等、租户隔离、20笔多门店重试压力、配套最后一次使用竞争、库存并发／退款／转库、佣金审批及 Payroll 幂等链接 |
| TypeScript | 通过 | tsc --noEmit --pretty false --incremental false，完整当前工作区类型检查 |
| ESLint | 通过 | 本阶段新增模块、脚本、测试及所改动作／组件；未跑无关仓库全量 lint |
| Prisma | 通过 | validate；最终D库214迁移；migrate status up to date；迁移文件与DB校验和一致 |
| 本阶段 diff whitespace | 通过 | 原有 next-env.d.ts 的换行／空白问题不属于本阶段，未为“干净检查”修改用户文件 |

合计 **83 项针对性自动测试**，无 fail、skip、todo；没有删除测试、增加跳过项或弱化原断言。约束拒绝、并发冲突和幂等唯一冲突产生的预期错误日志由测试明确断言，不算测试失败。

新测试：[money](/Users/innovdia/Development/carwashpro/tests/unit/performance-money.test.ts)、[phase1 integration](/Users/innovdia/Development/carwashpro/tests/integration/performance-phase1.test.ts)。

现有定向用例：tests/unit/financial-idempotency.test.ts、refunds.test.ts、financial-metrics.test.ts、inventory-phase1-contract.test.ts、commission-engine.test.ts、payroll-calculation.test.ts、cashier-catalog.test.ts、crm-invoice-branch-authorization.test.ts；tests/integration/pos-financial-idempotency.test.ts、inventory-phase1.test.ts、commission-engine.test.ts（均在本仓库）。

### 7.2 权限、事务与 UI 实证

- Salon 已登录会话请求另一个 business 的 checkout-context，HTTP403，未返回员工名单。
- 界面选好员工后，在隔离库模拟其资格失效，再实际提交旧商品销售：付款数7→7，库存47→47，原 operationId 保持；错误在弹窗内可见。恢复测试员工资格，用同一 ID 重试后付款数7→8、库存47→46，仅一笔成功。
- 新集成用例中，错门店员工、跨租户员工、离职员工、比例不满100%、无权销售更正全部拒绝；数据库付款数保持0，原交易没有半套提交。
- 两个相同并发请求只生成一份资金与业绩；相同 key 不同 payload 拒绝。追加小费也进入指纹，失败重试不会重复增加发票小费。
- SALE更正不修改TIP版本；TIP更正只影响指定原Payment。旧版本修改和旧版本补插share被数据库拒绝；权限撤销后连已完成更正的重放也被拒绝。
- 佣金及Payroll相关既有生命周期测试仍通过；本模块没有调用小费发放或工资计算写入。测试文件为了验证现有 Payroll 幂等能力创建的测试数据，不代表业绩功能自动发薪。

没有跑全量测试、没有运行生产 build／部署，也没有连接真实支付通道、外部收款终端或消息发送工作进程。浏览器页面可能沿原流程在隔离库排入通知队列，本次未运行外部通知 worker。

## 8. 未完成、未验证与正式启用前条件

### 8.1 按本阶段范围刻意未实施

- 年度团队门槛后台、个人年度目标分配、差额／修改预览、目标版本审计 UI。
- Staff App 业绩首页卡片、详情页、个人查询认证适配；个人无等级、仅团队三级的要求保留给下一阶段，不建立错误的个人 Level。
- 完整后台销售／小费更正界面、未分配补分配页面、生产历史回填或其回滚执行。
- 等级奖金、小费池、多人小费自动分摊、小费发放、佣金或Payroll计算变更。
- 已结清发票另收小费、在本来没有小费金额录入的旧商品／配套入口新增独立小费收款能力；这类资金入口未被偷偷创建。已存在未收小费的余额支付已支持独立小费归属，Salon余额支付支持明确追加新小费。

### 8.2 正式启用前仍需完成／确认

1. **Paid-VOID 历史最终口径**仍是用户指定的独立业务待确认项。当前实现只保留来源、审计和pending，不推断真的退钱。此规则未确认前，不能将这部分直接发布为正常已核对目标进度。
2. 在获授权发布流程中确认生产PG版本、迁移顺序、角色权限、备份／回退方案及部署一致性；本次没有权限或证据声称生产已迁移。
3. 清点启用门店的 EmployeeBusinessMembership 和有效 branch assignments。没有映射的数据应走有理由的未分配；不能从手机号、姓名或收银员批量猜归属。
4. 明确旧客户端升级完成时间，再决定关闭 LEGACY_COMPAT。默认兼容路径有来源原因及开关控制，但不会证明发请求的一定是“旧版客户端”。
5. 完成实体手机 Safari／系统软键盘、实际目标部署环境、网络中断和实际支付通道的发布验收。本次390px是真实Chrome页面，不等于实体设备全部组合已验证。开发热更新期间日志出现过一条读取 null.removeChild 的浏览器错误，未获得完整堆栈、未在后续稳定页面交易中重现；不能据此认定根因或声称已修复，应在无热更新的发布候选构建中再次排除。
6. 若要把历史待核对来源转为正式业绩，需要另行开发有授权的预览、组成核实、补分配和审计流程；当前只读工具不执行此转换。老数据无可靠组成时显示未知，不显示达标。

新模块默认 TETAMU_PERFORMANCE_PHASE1 未设置／false。关闭开关只停止新的捕获，不删除账本；中途关闭再重开不会自动回填漏捕获期间的付款，须另列待核对。不能为了回退而删除资金或业绩证据。

隔离库及测试运行副本保留作复核证据；它们不是用户业务库。本次3101测试服务、自动化Chrome及数据库客户端已关闭，未停止用户3000服务。没有删除用户文件或用户数据。

## 9. 下一阶段接入契约（本次未执行）

- 目标后台应读取 readPerformanceLedger 的已核对销售、小费、退款、净额及 pending/unassigned；不可使用 Invoice.total 累加或 Commission 金额代替。
- 读服务已返回门店及个人汇总，以及每笔详情的 allocations（销售收入、小费收入、两类退款、合计）；新Staff API必须从认证 Staff session 推导 membership/business/branch，不允许客户端传员工ID就获得全店明细。
- 后台受权人员可使用 correctPerformanceAttribution；未来HTTP入口必须从认证会话构造 actor，分别校验 PERFORMANCE_CORRECT_SALES／PERFORMANCE_CORRECT_TIP，并提交 expectedRevision、reason、operationKey。
- 目前 owner 可执行上述管理能力，额外授权通过既有 User.permissions 的专用能力字符串检查。没有在本次新增权限管理页或迁移 Approvals。
- 年度目标应是独立版本数据：个人只有年度目标；门店团队有600000／800000／1000000三级累计门槛。店长300000、6人各50000的分配示例只作下一阶段目标功能输入，未在本次数据库伪造目标。
- 调整目标不得改动本账本；团队进入更高等级不得自动提高个人目标。当前读服务 target=null、targetState=NOT_IMPLEMENTED，不能显示“已达标”。

## 10. 改动文件与最终交付说明

### 原有文件修改（13个，均不在开始时88个用户改动文件中）

- [prisma/schema.prisma](/Users/innovdia/Development/carwashpro/prisma/schema.prisma)：5个新模型、关系及财务操作类型。
- [cashier/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/cashier/actions.ts)、[appointments/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/appointments/actions.ts)、[pos/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/pos/actions.ts)、[invoices/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/invoices/actions.ts)、[products/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/products/actions.ts)、[work-orders/actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/work-orders/actions.ts)：原事务内接入、独立指纹、小费输入、必要失败恢复。
- [cashier-unified-sale-form.tsx](/Users/innovdia/Development/carwashpro/src/components/cashier-unified-sale-form.tsx)、[salon-appointment-payment-form.tsx](/Users/innovdia/Development/carwashpro/src/components/salon-appointment-payment-form.tsx)、[payment-form.tsx](/Users/innovdia/Development/carwashpro/src/components/payment-form.tsx)、[package-purchase-payment-form.tsx](/Users/innovdia/Development/carwashpro/src/components/package-purchase-payment-form.tsx)、[product-sale-form.tsx](/Users/innovdia/Development/carwashpro/src/components/product-sale-form.tsx)、[work-order-package-purchase.tsx](/Users/innovdia/Development/carwashpro/src/components/work-order-package-purchase.tsx)：独立销售／小费归属、追加小费、输入保留。

### 新增文件

- src/lib/performance：money.ts、time.ts、input.ts、scope.ts、service.ts、corrections.ts、read.ts、checkout-tip.ts，均位于 [/Users/innovdia/Development/carwashpro/src/lib/performance](/Users/innovdia/Development/carwashpro/src/lib/performance)。
- [checkout-context/route.ts](/Users/innovdia/Development/carwashpro/src/app/api/performance/checkout-context/route.ts)。
- [checkout-attribution.tsx](/Users/innovdia/Development/carwashpro/src/components/performance/checkout-attribution.tsx)、[checkout-attribution.module.css](/Users/innovdia/Development/carwashpro/src/components/performance/checkout-attribution.module.css)、[safe-payment-form.tsx](/Users/innovdia/Development/carwashpro/src/components/performance/safe-payment-form.tsx)。
- [migration.sql](/Users/innovdia/Development/carwashpro/prisma/migrations/20260905160000_performance_receipts_phase1/migration.sql)。
- [performance-test-database.mjs](/Users/innovdia/Development/carwashpro/scripts/performance-test-database.mjs)、[seed-performance-browser-test.ts](/Users/innovdia/Development/carwashpro/scripts/seed-performance-browser-test.ts)、[preview-performance-phase1.ts](/Users/innovdia/Development/carwashpro/scripts/preview-performance-phase1.ts)。
- [performance-money.test.ts](/Users/innovdia/Development/carwashpro/tests/unit/performance-money.test.ts)、[performance-phase1.test.ts](/Users/innovdia/Development/carwashpro/tests/integration/performance-phase1.test.ts)；本实施报告。

验证时须显式使用专用隔离库，不能直接执行会读取默认业务库配置的数据库脚本。例如在自行新建的专用隔离库完成迁移后，使用显式 DATABASE_URL、TETAMU_ENVIRONMENT=TESTING 执行 tsx --test --test-concurrency=1 tests/integration/performance-phase1.test.ts。预览命令参数为 businessId branchId actorUserId year [month]，本报告中的示例ID仅属于隔离测试库。

**最终结论：ENGINEERING_READY，限第一阶段代码与针对性本地验收；不是已上线。** 当前改动尚未提交或部署，功能默认关闭，生产数据库与历史数据未操作。完成本报告后停止，不自行进入目标后台、Staff App页面、奖金、生产回填或发布。
