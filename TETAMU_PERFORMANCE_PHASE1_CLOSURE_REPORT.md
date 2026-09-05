# Tetamu Performance Phase 1 定向收尾报告

日期：2026-09-05。状态：**READY_FOR_PHASE2**。

含义：本次三项收尾已实现／验证，可以继续开发后台目标；**不是上线批准**。没有开发目标后台、Staff App 业绩页、奖金或小费发放，没有生产迁移、回填、部署。本报告取代上一份实施报告中“考勤时区优先”和旧预览接口的说明，原报告保留不改。

## 1. 三项结果

| 收尾项 | 实际结果 |
| --- | --- |
| 经营时区 | Branch 无独立经营时区字段；明确继承 Business.timezone。捕获、退款、期间查询、预览使用同一 IANA 解析函数，不再读取 BranchAttendanceSetting。 |
| 覆盖状态 | 原始 Payment／PaymentRefund 与账本在只读 Repeatable Read 快照中核查；返回完整、缺捕获、待核对、未分配、非现金排除及截止时间。不自动回填。 |
| 稳定构建 UI | 完整工作区隔离副本运行 npm run build → npm run start，实际桌面／390px Server Actions 收款通过；无 HMR。**稳定构建中未复现 null.removeChild，原错误根因未确认。** |

## 2. 工作区保护与文件边界

仓库：/Users/innovdia/Development/carwashpro。分支 main，HEAD 5f9b5b5f350d6ee3670f4d989b203776e6527544，前后未变。

读取仓库 AGENTS.md、相关本地 Next.js 构建指南；采用 PostgreSQL 最佳实践检查范围过滤及索引。没有另开仅含 HEAD 的基线。开始时对 **120 个已修改／未跟踪文件**保存 SHA-256，含全部未提交 Phase 1 实现。

本次只改变其中以下 **6 个文件**，其余 **114 个逐字节不变**：

| 文件（均相对上述仓库） | 原因 |
| --- | --- |
| src/lib/performance/time.ts | 单一 Business 经营时区解析、有效时区校验及规范化；移除可误传考勤时区的第二参数。 |
| src/lib/performance/service.ts | 收款及退款统一调用经营时区解析；不查询考勤设置。 |
| src/lib/performance/read.ts | 显式 asOf、只读一致快照、来源覆盖、未知组成、历史时区隔离与原始来源变更检查。 |
| scripts/preview-performance-phase1.ts | 直接复用读服务，不另做不同快照／不同规则的漏捕获查询；强制隔离库与截止时间。 |
| tests/integration/performance-phase1.test.ts | 新增 5 项收尾场景；修正原错误时区预期，原金额／权限断言保留，增加 VOID 和完整覆盖断言。 |
| prisma/schema.prisma | 仅追加 3 个范围索引；不改变原 Phase 1 表或金额、归属字段。 |

新增迁移：prisma/migrations/20260906010000_performance_coverage_indexes/migration.sql；新增本报告及 outputs 验证证据。

原 Phase 1 迁移 SHA-256 仍为 073c159e0fe77843ba2944756c049c8ec2e72d477fd383c6dccdb45dac991824。没有修改旧迁移、不可变账本记录或原 Staff／Approvals／佣金／Payroll 文件；没有提交、切分支、回退或覆盖用户修改。

[工作区哈希基线](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-baseline.json)。

## 3. 最终时区契约

1. 当前 Branch 模型只有地域／地址等属性，没有财务经营时区；不能根据 stateCode 或考勤配置猜测。因此第一版统一继承 Business.timezone，返回 timezoneSource=BUSINESS_INHERITED。
2. performanceTimezone 通过 Intl.DateTimeFormat 验证并规范化 IANA 标识；空值、数值 offset、无效标识拒绝，不默默回退到服务器时区。若将来新增真正的 Branch operating timezone，须显式扩展该单一解析入口，不重新引入 attendance setting。
3. 收款取 Payment.paidAt，退款取 PaymentRefund.refundedAt；新事件冻结 timezone 和 localDate。自然月／年按当地 00:00 分界，不使用 02:00。
4. 旧事件不 UPDATE。查询同时检索“冻结 localDate 属于期间”和“当前经营时区对应 UTC 期间”的相关事件。旧 timezone 与当前政策不一致时标记 OPERATING_TIMEZONE_SNAPSHOT_MISMATCH，进入 pending，不重算其 localDate，也不计入已核对小计。
5. 同一异常可能在旧／新期间查询中都可见，目的在于防止边界上的旧事件消失；它不在任一期间重复计入正常业绩。不得把跨期间 pending 列表直接相加当全年正式金额。
6. 额外校验 LOCAL_DATE_SNAPSHOT_INVALID 和 SOURCE_SNAPSHOT_CHANGED；原付款／退款金额、日期或范围与证据不符时待核对，不假称已对账。
7. 使用独立新 fixture 验证时区变化，未修改此前测试库不可变证据。测试实际改变 Business／考勤设置，再核对原 PerformanceReceipt 整行未变。

已验证：考勤 Honolulu 而经营 Kuching、改变考勤设置后的新付款、UTC 月／年末午夜、退款跨年、截止时刻包含边界、历史时区变化后的双期间隔离及无效 IANA 拒绝。

## 4. 最终查询与覆盖契约

调用：
```ts
readPerformanceLedger(
  { businessId, branchId, actorUserId }, // 必须来自受信任的服务端身份
  { year: 2026, month: 9, asOf: new Date("2026-10-01T00:00:00Z") },
  prismaClient
)
```

month 可省略表示自然年；business、branch、year、asOf 必须明确。Owner／PERFORMANCE_VIEW_TEAM 及原服务端门店权限继续强制执行。

### 4.1 一致视图与期间语义

- 公共服务自行开启 RepeatableRead 事务，并先执行 SET TRANSACTION READ ONLY；权限、时区、事件、原始收款、退款均在同一个快照中读取。
- API 接收 PrismaClient，不接受任意外部 TransactionClient，避免调用方以 Read Committed 破坏一致性；旧预览已迁移到此契约。
- periodStart 包含，periodEnd 不包含；来源还须 occurredAt <= asOf。返回 periodClosed 表示 asOf 已到达期间结束边界。
- asOf 是**实际事件时间统计截止**，不是“还原当时系统知道什么”的双时态查询。归属更正、VOID、补录来源采用本次快照可见的最新证据；迟到录入的过去日期来源会在下次检查中出现。cutoffSemantics=EVENT_TIME_INCLUSIVE_CURRENT_SNAPSHOT。
- COMPLETE 只表示**指定范围截至 asOf**的覆盖，不表示未来全年均已发生／已验证。页面必须展示截止时间；periodClosed=false 不能把本年迄今当作完整全年实绩。
- 当前功能开关不参与“覆盖完整”的推断；不使用第一笔账本时间作为覆盖起点。

### 4.2 分类与字段

| 字段／分类 | 准确语义 |
| --- | --- |
| coverageStatus | COMPLETE 或 INCOMPLETE；缺捕获、捕获待核对、退款原付款证据缺口任一存在即不完整。 |
| periodStart / periodEnd / asOf | ISO 时间；结合 period.timezone 和 timezoneSource 显示范围。 |
| sourceCount | 原始 Payment／Refund 在当前经营时区期间、截止时间内的数量，包含非现金来源。 |
| verifiedCount | 本次返回的已捕获已核对货币事件数量。 |
| uncapturedCount | 原始货币来源尚无可用的本范围捕获证据；不包括明确 PACKAGE／RESTORE 非现金排除。 |
| pendingCount | 已捕获货币事件但组成／日期／时区／VOID 等待核对数量。 |
| basisGapCount | 本期间退款的原付款未捕获；可与 pending／uncaptured 重叠，不能把三个计数相加当不同来源总数。 |
| excludedCount | 当前来源范围中明确 PACKAGE／RESTORE 的非现金来源数。 |
| unassignedAmount / unassigned | 已核对但未分配的净贡献／销售、小费、退款明细，单位分；**仍计团队**。 |
| CAPTURED_VERIFIED | 已捕获、已核对、已分配来源。 |
| CAPTURED_VERIFIED_UNASSIGNED | 已捕获已核对，有未分配贡献；金额已知，不是缺收款。 |
| CAPTURED_PENDING | 保留证据，但不能作为已核对目标进度。 |
| UNCAPTURED | 原收款／退款存在但捕获缺失，或捕获范围／日期异常；来源问题代码保留。 |
| EXCLUDED_NONCASH | PACKAGE 核销／RESTORE 恢复权益；不是新的现金业绩。 |

sourceDetails 返回原始 rawCents、发生时刻、paymentId/refundId、捕获 ID、分类、问题代码及 compositionStatus。

未知组成时 salesCents/taxCents/tipCents/qualifiedCents 为 **null**，rawCents 保留真实含税原金额；不估计“缺失业绩金额”。捕获但待核对的 qualifiedCents 也为 null；details 保留原快照作为证据。pending 的分项数值仅是捕获证据中的组成小计，不代表未知部分已被确认是零。

team、employees、unassigned 保持原 Phase 1 的**已核对小计**契约。totalsAreComplete=false 时不得将 team.total 冒充完整期间总额；必须标“已核对小计／数据待补齐”，不得给出正式达标结论。未设目标仍 target=null、targetState=NOT_IMPLEMENTED。

始终校验：
- team.total = employees 合计 + unassigned.total；
- 已捕获货币 rawNet = 已核对业绩 + 已核对税 + 待核对原金额。

缺失来源的 raw 金额另列 sourceDetails，不混进该已捕获对账式。退款从原 PaymentRefund 检查，不再扣 CreditNote。

### 4.3 范围与索引

查询只涉及授权 business/branch 及一个月／年期间；关联原退款付款按 ID 查找。新增：
- payments(business_id, branch_id, paid_at)
- payment_refunds(business_id, branch_id, refunded_at)
- performance_receipts(business_id, branch_id, local_date)

复用原 receipt 的 business/branch/occurredAt 和来源外键索引；没有扫描全租户全部历史、引入后台任务或写入修复记录。未做生产量级性能基准；未来大门店可在真实数据量证据下优化分页／聚合，不能据此声称已完成生产容量验收。

## 5. 隔离环境与实际验证

### 5.1 环境

- 专用新库：127.0.0.1:5432 / tetamu_performance_disposable_closure_20260905_a。
- 从空库应用当前 **215 个迁移**，migrate status 为 up to date。
- 全工作区运行副本：/Users/innovdia/Documents/Codex/2026-09-03/bang/work/performance-closure.UCuau2。
- 未复制 .env、原数据库目录、.next；复用安装好的 node_modules，Prisma 按当前 schema 生成客户端。源工作区应用代码未在构建中重写。
- NODE_ENV=production 运行优化构建，APP_ENVIRONMENT=testing、TETAMU_ENVIRONMENT=TESTING，显式专用 DATABASE_URL；仅本次进程 TETAMU_PERFORMANCE_PHASE1=true。
- 本地测试 SESSION_SECRET，无真实渠道凭证。只使用现金测试；未启动通知、WhatsApp、analytics worker。没有真实支付、短信、外部通知。
- Node 22.23.2、Prisma 6.19.3、Next 16.3.0、本机 Chrome。Chrome headless 运行实际应用页面，非模拟预览。

### 5.2 实际命令与结果

以下命令均在上述仓库或完整运行副本执行；数据库命令显式设置专用 URL，未运行默认业务库包装脚本：

```sh
node scripts/performance-test-database.mjs tetamu_performance_disposable_closure_20260905_a
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tetamu_performance_disposable_closure_20260905_a TETAMU_ENVIRONMENT=TESTING ./node_modules/.bin/prisma migrate deploy
# 当前全部 215 个迁移成功

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tetamu_performance_disposable_closure_20260905_a TETAMU_ENVIRONMENT=TESTING ./node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/performance-phase1.test.ts tests/unit/performance-money.test.ts tests/unit/financial-idempotency.test.ts tests/unit/financial-metrics.test.ts
# 47 / 47 pass；0 fail / skip / todo

./node_modules/.bin/eslint src/lib/performance/time.ts src/lib/performance/read.ts src/lib/performance/service.ts scripts/preview-performance-phase1.ts tests/integration/performance-phase1.test.ts
# exit 0

./node_modules/.bin/tsc --noEmit --pretty false --incremental false
# 首轮 exit 0；最终源码同时由正式 build 的 TypeScript 检查通过

# 完整隔离副本内，显式测试环境、DATABASE_URL、SESSION_SECRET、PORT=3102：
npm run build
npm run start -- --hostname 127.0.0.1 --port 3102
# prisma generate → guard-next-build → next build --webpack；exit 0
# release environment validation → next start；启动成功
```

正式构建未被无关问题阻断。最初冷构建有既有 middleware 弃用及 Edge process.cwd 依赖警告；最终构建通过，没有重构这些无关模块或弱化检查。

47 项包含 **27 项业绩集成测试（原 22 + 新 5）**、11 项金额测试和9项既有财务幂等／统计测试。没有无目的重跑全仓库或全部7个UI入口。原佣金／Payroll业务源码未变，先前 Phase 1 回归结果不冒充本次重跑结果。

新增测试覆盖：
- 全期间无交易与无账本但确有交易明确区分；
- 已核对未分配保留团队金额；
- 开关关闭期间付款、重新开启后的缺口；
- 收款已捕获但退款缺失、跨年退款原收款未捕获；
- PACKAGE／RESTORE 不误报缺业绩；
- 午夜、asOf 边界、考勤变更无影响及旧时区快照隔离；
- 读取账本后另一个连接提交付款，原快照仍完整为空、下一次查询明确缺捕获；
- 只读查询前后 Payment、Receipt、Contribution、AuditLog 数量相同；SQL READ ONLY 进一步禁止写入；
- VOID 待核对不是正常完整业绩；原金额守恒、退款归零、权限、幂等、回滚及独立小费测试继续通过。

### 5.3 真实 POS 流程与金额

在新种子商家，54名候选（含同名员工、员工编号、店长及独立小费员工）实际验证：

| 交易 | 收款 | 销售／税／小费 | 归属 |
| --- | ---: | --- | --- |
| 手机统一 POS，多人销售 | 118 | 100 / 8 / 10 | 销售 A/B 各50；小费 C10，C不在销售名单 |
| Salon 首笔部分付款 | 59 | 50 / 4 / 5 | 销售 A50；小费 C5 |
| Salon 补款新增10小费 | 69 | 50 / 4 / 15 | 销售锁定 A50；本笔小费 B15；旧小费 C5 不变 |
| 桌面统一 POS | 118 | 100 / 8 / 10 | 销售 A/B 各50；小费 A10 |

4 笔合计：实际收款 **364**，税 **24**，业绩 **340**（销售300＋小费40）；个人 A210＋B115＋C15＝340，未分配0。只读预览 coverageStatus=COMPLETE、sourceCount=4。

手机第一笔付款前，将已选择的测试员工B资格改为 TERMINATED，真实 Server Action 拒绝：
- Payment 0→0，库存50→50；
- 金额118、小费10、A/B各50、C小费及原 operationId 保留，弹窗不消失，错误在手机可见；
- 恢复测试资格 ACTIVE，用原 operationId 重试，仅一笔成功，未重复扣库存；
- 后续两笔产品销售后最终库存48。所有资格改动仅属于专用测试 fixture。

操作了真实搜索、多人比例输入、独立小费选择、现金金额键盘、滚动及付款按钮；390px document.scrollWidth=390，无横向溢出。桌面1440×1000、手机视口390×844。

截图：
- [桌面付款汇总与确认按钮](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/closure-desktop-ready-to-pay.png)
- [390px 多人比例及独立小费](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/closure-checkout-mobile.png)
- [服务端拒绝及保留金额](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/closure-checkout-rejected-mobile.png)
- [真实手机金额键盘](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/closure-mobile-amount-keypad.png)
- [补款锁定销售及独立小费](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/closure-topup-mobile.png)

### 5.4 浏览器与服务端错误结论

- 实际交易及额外开关付款弹窗复查：**pageerror=0，console error=0**。
- **稳定构建中未复现 null.removeChild，原错误根因未确认。** 没有因此修改DOM组件，更没有声称已修复原错误。
- 服务端记录过一条 The destination stream closed early，digest 1972333039。源码位于 Next 内置 ReactDOM server 的 destination.close → createCancelHandler；额外导航复查捕获到多条 RSC 预取 net::ERR_ABORTED。响应流取消是合理解释，但缺少最初事件的请求关联，**不能确认该条日志的完整根因**。
- 上述服务端日志不等于浏览器 null.removeChild；测试付款均事务完成／拒绝回滚，对账通过。没有隐藏日志或以其为由修改无关框架／导航。
- Chrome 手机视口不等于实体 iPhone、Safari 或系统软键盘；这些验收未完成。

## 6. 证据文件

- [47项测试完整输出](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-tests.log)
- [最终正式构建输出](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-build.log)
- [服务端输出（含流关闭日志）](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-server.log)
- [浏览器错误、归属及真实交易证据](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-browser-evidence.json)
- [额外导航请求取消记录](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-network.json)
- [最终只读预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-preview.json)
- [交互会话命令记录](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-closure-browser-session.txt)（含一个错误使用 button 而非 tab 的定位尝试，后更正；不是可盲目重复运行的种子／收款脚本。）

新预览 CLI：
```sh
# 同样须先显式设置隔离 DATABASE_URL 和 TETAMU_ENVIRONMENT=TESTING
./node_modules/.bin/tsx scripts/preview-performance-phase1.ts BUSINESS_ID BRANCH_ID ACTOR_USER_ID 2026 9 2026-10-01T00:00:00Z
# 年度用 all 代替 9；asOf 为必填参数
```

## 7. 下一阶段约束与正式启用前条件

可以基于当前服务开发后台目标，但必须：
- 使用已核对、未分配、待核对、未捕获分类；数据不完整时不显示正式目标达成结论。
- 显示期间／截止时间／覆盖状态，不把截至当前的小计当全年完整实绩。
- 员工只有年度目标；门店团队才有三级累计等级。目标调整不改实际收款。
- 保留独立销售与小费归属，任何目标进度不等于佣金、工资或小费已发放。
- Staff 身份适配仍需下一阶段服务端认证与门店范围校验，当前读接口不直接开放给客户端随意传ID。

正式启用仍独立需要：生产授权迁移与备份验证、历史来源／缺口清点和受控处理、旧时区证据处理方案、Paid-VOID最终历史口径、真实支付渠道与实体手机Safari验收。流取消日志的请求关联以及原 null.removeChild 根因仍未确认；本次检查结果不是覆盖所有浏览器／网络状态的保证。

功能默认关闭，未更改 .env。3102测试服务、自动化Chrome和客户端已停止，未动用户3000服务；保留隔离库和运行副本供复核。完成本收尾后停止，未进入下一阶段或部署。
