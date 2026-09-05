# Tetamu Phase 2：后台业绩目标管理实施报告

日期：2026-09-05。工程状态：**READY_FOR_STAFF_APP**。

这表示后台目标、受保护查询与版本服务可供下一阶段开发接入，**不表示已上线或已获准生产启用**。本阶段未开发 Staff App 业绩页面、员工端认证 API、奖金、小费发放或工资功能，未部署、连接生产数据库、执行生产迁移或历史回填。

## 1. 仓库、基线与工作区保护

- 实际仓库：`/Users/innovdia/Development/carwashpro`。
- 分支：`main`；开始与交付 HEAD 均为 `5f9b5b5f350d6ee3670f4d989b203776e6527544`，没有创建提交、切换分支或重置工作区。
- 阅读仓库 AGENTS.md，按其要求阅读当前安装 Next.js 16 文档中的 Server Actions 与数据安全说明；复核当前 Phase 1 源码及 Closure Report，而非仅采用 HEAD。
- 开始时记录 122 个已有修改／未跟踪文件的 SHA-256。117 个保持逐字节不变；5 个必要重叠文件为 `prisma/schema.prisma`、`.env.example`、`docs/environment-variable-contract.md`、`src/lib/performance/read.ts`、`src/lib/performance/scope.ts`。没有删除基线文件。
- [起始文件指纹](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-baseline.json)；[保护核对清单](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-protection-check.json)。指纹是完整性核对证据，不冒称另有起始文件内容备份。
- 原 Staff 首页、导航、Approvals、审批、考勤、佣金、Payroll、图片修复和 Phase 1 收款实现全部保留。既有两份 Phase 1 报告、迁移、捕获及更正代码保持原指纹。
- 正式构建副本来自包含所有未提交依赖的完整工作目录，而非 git HEAD：`/tmp/tetamu-phase2-build.QC9b2C`。排除 `.git`、`.env*`、本地上传和构建缓存等；未复制真实环境密钥，使用显式隔离环境。共享已安装 node_modules，未安装新依赖。

## 2. 实际完成的页面和流程

入口为既有 People / People & HR 内部工作区的 **业绩管理 / Performance**，没有新增顶层菜单。原 Overview / Approvals 等入口保留。只有业绩读取／管理权限时，People 链接可直接落到业绩页，不要求 TEAM、HR 或 Payroll。

统一路由：`/team/performance`，通过查询参数选择三个分页：

| 分页 | 参数 | 已实现 |
| --- | --- | --- |
| 总览 | `tab=overview` | 门店／年份／月份；团队年初至 asOf 实绩、销售／小费／退款、三级累计门槛、当前等级、下一级差额、月度对比、来源覆盖警告、未分配入口；成员搜索、年度目标和本店贡献、展开 12 个月与组成 |
| 目标设置 | `tab=targets` | 店长优先分配、多人平均分配预览及应用、批量套用、逐人调整、差额确认、复制上一年为草稿、发布预览、版本保存、只读视图及不可变历史 |
| 业绩明细 | `tab=details` | 月份／全年至 asOf、员工、来源状态、销售／小费筛选；25 个来源一页；收款与退款独立事件；完整期间汇总不受当前分页影响；订单编号、时间、渠道、原始金额、税／销售／小费、团队计入金额、个人分配、付款关联及归属历史 |

页面说明事件行的大金额是“本事件团队计入业绩”，不是筛选员工独占金额；展开区分别列出每人的销售、小费、退款和合计。未分配单独列示，不创建假员工。

目标操作实际顺序：选择门店／年份 → 三级门槛 → 店长与金额 → 勾选其他参与员工 → 预览平均分配 → 应用到表格 → 手工调整／批量套用 → 核对差额 → 填写原因 → 完整发布预览 → 确认发布。

零员工、未设目标、零个人目标、历史成员、未来月份、加载失败／核查中、并发过期预览均有相应状态。未来经营年度标注尚未开始，仍允许先准备目标。

## 3. 数据模型、迁移与金额契约

新增一个最小模型 `PerformanceTargetVersion`，无复杂规则引擎、独立草稿平台或奖金模型。

关键字段：businessId、branchId、year、revision、requestKey、fingerprint、actorUserId、actorName、reason、snapshot、previousSnapshot、preview、createdAt。

- 唯一版本键：`businessId + branchId + year + revision`。
- 请求幂等键：`businessId + requestKey`，不同内容／操作者不能复用。
- snapshot 保存三个年度累计门槛、manager membership ID、每人 membership ID／姓名／编号／状态快照／年度目标及分配差额。
- previousSnapshot 保存旧版本完整目标；preview 保存本次固定统计时刻、数据状态与旧／新完成率、等级等影响。
- 数据库触发器禁止 UPDATE / DELETE；INSERT 检查租户关系、三级递增门槛、非负个人金额、成员归属商家及重复成员。服务端进一步验证门店和年度任职证据。
- 按商家、门店、年份、创建时间建立限定查询索引。历史员工的名字变化不会重写已发布快照。
- 新迁移：[20260906020000_performance_targets](/Users/innovdia/Development/carwashpro/prisma/migrations/20260906020000_performance_targets/migration.sql)。旧迁移未改。

金额统一为整数分。目标每个金额上限为 1,000,000,000,000 分；个人最多 1,000 行。平均分将剩余分数按稳定 membership ID 排序分配，不用浮点金额，合计精确。

第一级 > 0，三级严格递增；个人允许 0 或无目标，完成率为 null，不除零、不视作达标。店长不得重复作为普通员工计算。店长金额超过第一级、没有其他参与者时拒绝自动平均；表格已经超额时停止自动平均。手工超额或不足可以发布，但必须确认差额。改团队门槛不会改任何个人金额。

已确认的实际业绩仍完全沿用 Phase 1：销售实收 + 实收小费 − 对应退款，排除税。销售多人分摊、小费独立归属；配套销售计收款一次、核销不重复；不扣成本、佣金、工资或支付手续费。目标发布仅写新目标版本及 AuditLog，不写 Payment、PaymentRefund、PerformanceReceipt、PerformanceContribution 或归属表。

## 4. 权限、预览、版本和审计

新增独立权限：

- `PERFORMANCE_VIEW_TEAM`：读取授权门店团队及成员本店业绩与目标。
- `PERFORMANCE_MANAGE_TARGETS`：同范围读取、预览及发布目标；不蕴含工资、银行、佣金或 TEAM 权限。

使用现有权限清单及能力体系，管理员可在原权限设置中授权。店长身份／职称／被选为目标店长／审批权限／打卡资格均不会自动授予新权限。配置店长时仅授予读取权限即可；本阶段没有根据职位字符串批量授予权限。

服务端采用 Phase 1 的直接商家身份边界：在职、可登录、商家有效的实际 User；BUSINESS_OWNER 可读本商家各店，其他获授权 User 限 User.branchId。没有扩大至集团委托身份或跨租户授权。通过直接 URL、员工参数、其他门店、分页、历史都仍经过实际认证和服务端范围检查。

Server Actions 从认证上下文获取 businessId 和 actorUserId，不接受客户端代替。预览和发布入口各自重新验证权限；发布检查实时权限后才接受幂等重试，因此权限已撤销的旧请求也不能重放成功。

预览使用 SESSION_SECRET 签名，绑定操作者／门店／草稿内容、固定 asOf、预览结果及 20 分钟有效期。保存使用 Serializable 事务、年度范围 advisory lock 和有限冲突重试，再验证 expectedRevision、成员、预览结果和差额确认。唯一键防重复，事务内审计失败会回滚目标版本。过期页面保留输入并说明重新加载、复核和预览；不静默覆盖其他管理员修改，也不自动合并冲突。

复制上一年度只填充浏览器待发布草稿：列出本年失效／不适用成员与新增成员，不直接发布，也不自动将旧员工转成新员工。服务端仍重新核验 membership 与年度门店证据。

## 5. 三页统一查询与完整性契约

统一服务：[readPerformanceDashboard](/Users/innovdia/Development/carwashpro/src/lib/performance/dashboard.ts)。目标预览复用同一 Phase 1 verified 投影，不按发票总额另算金额。

输入：可信服务端 PerformanceActor（businessId、branchId、actorUserId），明确 year、month、asOf；可选 employeeId、page、status、component、detailRange。页面年份支持 2001–2200，以保留一月的上年十二月比较边界。

返回的主要契约：

- `annual` / `current` / `previous`：team、employees、unassigned 分项，complete、pendingCount、uncapturedCount、basisGapCount、unassignedCount、from、toExclusive、asOf。
- `annual.started` 区分未来年度与已开始年度；不能把尚未开始称为数据缺失。
- `target`、`revision`、`previousTarget`、`history`：目标及历史；缺目标是 null，不是已达标。
- `progress`、`level`：只有已开始且来源完整时才能正式计算；不依赖 periodClosed。分母一直为完整年度目标。
- `members`：本年度有目标、贡献或任职范围的成员，含离职／调出；只返回姓名、编号、状态等必要显示身份，不返回薪资或银行字段。
- `comparison` 与成员 comparison：金额差、可空百分比、complete、当前月同期／整月标签。
- `details`、page、pageSize、totalRows：页内来源证据和独立完整期间汇总。

严格沿用第一阶段来源核查：

| 来源状态 | 含义与显示 |
| --- | --- |
| CAPTURED_VERIFIED | 已捕获且已核对，计团队及相应个人 |
| CAPTURED_VERIFIED_UNASSIGNED | 金额已知，仍计团队；存在独立未分配提示 |
| CAPTURED_PENDING | 组成、冻结经营日期／时区、VOID 等待核对，不用作正式达标金额 |
| UNCAPTURED | 原付款／退款存在但没有捕获；展示原始金额，未知组成及 qualifiedCents 为 null |
| EXCLUDED_NONCASH | PACKAGE / RESTORE 等非现金来源排除，不报成遗漏销售 |

年度计数直接对年度来源核查，不将 12 个月 pending 相加。无交易且核查完整可以显示 0；加载中、读取失败、未知组成不能伪装成完整零业绩。已核对的未分配不使团队金额“不完整”，但只要存在未明确归属事件，个人只显示已归属金额，并暂不确认个人完成率。即使未分配收款与退款净额相抵为零，也不简单认为个人归属已完整。

全年有缺口时显示“已核对小计／数据待补齐”，无正式等级或完成率。异常入口可查看全年，避免遗漏所选月份以外的缺口。冻结日期与现行经营时区不一致的历史来源保留待核对明细，不静默消失或重解释。

### 时区与比较

经营时区继续显式继承 Business.timezone 并验证 IANA，不读取 BranchAttendanceSetting。收款与退款按真实事件时间、门店自然月／自然年午夜边界；未改 Phase 1 冻结 timezone / localDate。

当月截至 asOf 与上月同一当地日／时／分／秒比较；上月天数不足时截止到上月最后一个有效时刻。已结束月份整月对整月，1 月对比上一年 12 月但不改变本年累计。未来月份显示尚未开始。任一比较期不完整则不确认增长；基期 <= 0 时百分比为 null，仍保留有明确“小计差／待核对”标签的金额差。

### 查询规模与一致性边界

每次仪表盘请求在一个 READ ONLY、RepeatableRead 事务内进行目标、身份与源证据核查。年度源检查一次；只有 1 月额外检查上一年 12 月。没有逐员工 × 12 月数据库查询，没有全租户历史扫描。

Phase 1 原宽泛 include 改为必需字段 select；不再为总览加载整份原始 JSON／审计证据。期间统计与成员月份由同一个限定门店年度轻量投影复用；仅当前 25 行补查订单及归属历史，客户端不接收全年来源数组。

明确限制：当前是服务端对限定年度轻量来源／贡献投影做内存汇总与筛选，然后分页证据，并非全部改成数据库 SUM/GROUP BY 或数据库游标分页。切换请求仍须建立新的完整一致快照，不缓存“完整”状态。已验证固定查询次数和 54 员工体验，但未做真实大店超大年度数据压测；正式启用前应按预计业务规模验收延迟与内存，不能把本次小规模验证称为无限规模优化。

## 6. 目标示例及真实对账

基础分配验证：600,000 / 800,000 / 1,000,000；店长 300,000 + 6 × 50,000 = 600,000，差额 0。104 分目标减店长 3 分，三人确定性得到 34 / 34 / 33 分。倒置门槛、重复成员、零参与人数、店长超额均拒绝相应无效操作。

浏览器隔离 fixture：28 笔收款、1 笔部分退款，共 29 来源，明细分页 25 + 4。其中一笔 RM600,000 销售，其余 27 笔各 RM118（销售 100、税 8、小费 10），并对其中一笔退 RM59（销售 50、税 4、小费 5）。

| 对账项 | RM |
| --- | ---: |
| 销售实收 | 602,700.00 |
| 实收小费 | 270.00 |
| 销售退款 | 50.00 |
| 小费退款 | 5.00 |
| 团队净业绩 | 602,915.00 |
| PERF-001 销售净贡献 | 301,325.00 |
| PERF-002 销售净贡献 | 301,325.00 |
| PERF-003 小费净贡献（不在销售名单） | 265.00 |
| 未分配 | 0.00 |

团队 = 301,325 + 301,325 + 265 + 0 = 602,915。原始净收款 RM603,127，扣净税 RM212，亦为 RM602,915。

浏览器发布第一组目标时，年中已完成率 100.49%，当前第一级。随后只将第一级改为 RM610,000，另两级仍 800,000 / 1,000,000，个人合计仍 600,000；明确确认差额 RM10,000 后发布。完成率变为 98.84%，当前等级降为尚未达第一级；真实贡献、个人金额完全不变。多次 UI 回归保留各自历史版本，没有删除或覆盖旧测试版本；最终版本号和快照以 [完整对账结果](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-final-reconciliation.json) 为准。

## 7. 实际测试、构建和隔离环境

专用数据库仅为 `127.0.0.1:5432/tetamu_performance_disposable_phase2_20260905_a`。所有集成／fixture 脚本检查 localhost 和 disposable 名称；不用默认业务库。全新库成功应用仓库 216 份迁移，含本次 1 份；[迁移状态](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-migration-status.log) 显示 up to date。测试库及副本保留以便复现，未删用户资料。

执行的核心命令（DATABASE_URL 均显式指向上述专用库）：

```sh
node scripts/performance-test-database.mjs tetamu_performance_disposable_phase2_20260905_a
prisma migrate deploy
prisma migrate status
tsx --test --test-concurrency=1 tests/unit/performance-targets.test.ts tests/integration/performance-targets.test.ts tests/unit/performance-money.test.ts tests/integration/performance-phase1.test.ts tests/unit/business-module-entitlement.test.ts tests/unit/business-groups.test.ts
tsc --noEmit --pretty false --incremental false
npm run build
npm run start -- --hostname 127.0.0.1 --port 3103
tsx scripts/seed-performance-browser-test.ts
tsx scripts/seed-performance-targets-browser.ts
node scripts/verify-performance-targets-browser.mjs
```

- **76 / 76** 通过，0 fail / skip / todo：Phase 2 单元 8 + 集成 13；Phase 1 金额单元 11 + 集成 27；能力／模块相关既有回归 17。[完整测试日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-tests.log)。没有删除测试或弱化断言。
- 验证单人／多人／未分配守恒、RM118 独立小费、部分收退款和分币、跨年、核销、VOID、时区、旧事件隔离；目标发布财务记录逐项不变；权限撤销、跨店／跨租户／员工参数拒绝；并发幂等、旧预览、身份变化、审计失败整体回滚；离职调出；0 和负比较基期；数据缺口；全年／月份分页一致；未来年度不正式达标。
- 独立 tsc 通过，最终完整副本 build 的 TypeScript 检查也通过。[类型日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-typecheck.log)；[正式构建日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-build.log)。使用项目原有 webpack build/start，不用 HMR。
- 本次修改范围 ESLint 通过，[lint 输出](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-lint.log)。针对本次 tracked 文件 diff --check 通过；全工作区仍有起始就存在的 next-env.d.ts CRLF / trailing-whitespace 提示，其指纹未变，未顺手修改。
- 保留项目既有 Prisma package.json 配置和 Next middleware 弃用提示；首轮冷构建还显示既有 Next Edge import 提示。没有为消除提示重构无关模块。
- 运行优化构建的进程为 APP_ENVIRONMENT=testing、TETAMU_ENVIRONMENT=TESTING，显式本地测试 SESSION_SECRET、数据库和 flags。env -i 启动，不继承支付／通知密钥，AI 关闭，没有启动通知、WhatsApp 或统计 worker。

## 8. 真实页面、截图和浏览器结果

使用安装的 Chrome + Playwright 操作真实 `/login` 和 `/team/performance` 页面，以及真实 Server Actions／隔离数据库；不是 mock 页面或静态预览。桌面 1440×1000，移动视口 390×844。

实际操作包括：54 人和同名不同编号选择／搜索；店长 + 6 人平均分配并应用；错误门槛被服务端拒绝且输入保留；完整预览及发布；手机修改门槛但个人金额不变；差额确认；两个页面竞争提交，旧版本拒绝且输入保留；成员月度展开／搜索；明细翻页、销售／小费、全年、员工、来源状态筛选；历史展开；复制下一年草稿与批量套用不发布；空门店；仅业绩读取权限且无 Payroll 模块的账号访问。

没有核心内容横向溢出 390px，金额输入使用 decimal inputMode 与 16px 字号，表格转单列、成员可展开。支付／POS 本阶段未改，未重复运行七个收款 UI。

证据：

- [桌面团队总览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/desktop-overview.png)
- [桌面目标发布预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/desktop-target-preview.png)
- [桌面成员月度](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/desktop-member-months.png)
- [390px 总览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-overview-viewport.png)
- [390px 修改预览](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-target-preview.png)
- [并发旧版本拒绝](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/stale-version-rejected.png)
- [390px 小费明细](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-tip-detail.png)
- [全年／员工／来源筛选](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-year-employee-status-filter.png)
- [复制与批量草稿](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-copy-and-bulk-draft.png)
- [无 Payroll 的只读账号](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-ui-final/mobile-readonly-no-payroll-viewport.png)
- [浏览器步骤与错误记录](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-browser.log)；[服务端日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase2-server.log)

最终浏览器套件 PASS；console error = 0，pageerror = 0，稳定构建未出现 null.removeChild。本阶段不声称修复该历史错误的未知根因。Chrome 手机视口不等同实体 iPhone / Safari；原生键盘遮挡、实体设备及真实渠道仍未验收。

收尾修复记录：数据库 advisory-lock 返回 void 与 Prisma queryRaw 不兼容，已改为 executeRaw，重跑并发验证；既有 `/team/*` middleware 路由继承 TEAM 导致独立只读账号被拒绝，已加独立页面检查边界和登录落点，真实账号复测通过。UI 测试中的成员搜索最初在 loading 状态就计数，现等待真实成员返回再执行原有严格断言，未跳过或削弱测试。

## 9. 实際改动文件清单

| 文件 | 原因 |
| --- | --- |
| [schema.prisma](/Users/innovdia/Development/carwashpro/prisma/schema.prisma) | 增加唯一目标版本模型及 Branch 关系，保留 Phase 1 模型 |
| [目标迁移](/Users/innovdia/Development/carwashpro/prisma/migrations/20260906020000_performance_targets/migration.sql) | 目标历史表、索引、租户／数值守卫、不可变触发器 |
| [targets-contract.ts](/Users/innovdia/Development/carwashpro/src/lib/performance/targets-contract.ts) | 共享校验、分币分配、进度、等级、增长率规则 |
| [targets.ts](/Users/innovdia/Development/carwashpro/src/lib/performance/targets.ts) | 候选、签名预览、并发版本、幂等发布及事务审计 |
| [dashboard.ts](/Users/innovdia/Development/carwashpro/src/lib/performance/dashboard.ts) | 三页共用一致快照、期间／月份／身份／覆盖投影及证据分页 |
| [read.ts](/Users/innovdia/Development/carwashpro/src/lib/performance/read.ts) | 导出事务内投影、精简字段、允许独立目标管理权限读取；保持 Phase 1 金额与核查 |
| [scope.ts](/Users/innovdia/Development/carwashpro/src/lib/performance/scope.ts) | 增加目标管理权限标识，不放宽租户／门店边界 |
| [page.tsx](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/page.tsx) | 受保护三分页与目标／明细历史 |
| [target-editor.tsx](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/target-editor.tsx) | 分配、复制、批量、修改预览、保留错误输入 |
| [actions.ts](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/actions.ts) | 从真实认证获取 actor 和 business，不接收伪造身份 |
| [performance.module.css](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/performance.module.css) | 桌面与 390px、可展开成员、长内容及触摸控件 |
| [loading.tsx](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/loading.tsx)、[error.tsx](/Users/innovdia/Development/carwashpro/src/app/(business)/team/performance/error.tsx) | 核查中／读取失败不显示伪零值 |
| [team/layout.tsx](/Users/innovdia/Development/carwashpro/src/app/(business)/team/layout.tsx)、[app-shell.tsx](/Users/innovdia/Development/carwashpro/src/components/app-shell.tsx) | 现有 People 内部入口与独立权限落点，保留审批 |
| [staff-permissions.ts](/Users/innovdia/Development/carwashpro/src/lib/auth/staff-permissions.ts)、[capabilities.ts](/Users/innovdia/Development/carwashpro/src/lib/business-groups/capabilities.ts) | 独立读／管理能力、路由边界与登录路径 |
| [.env.example](/Users/innovdia/Development/carwashpro/.env.example)、[环境契约](/Users/innovdia/Development/carwashpro/docs/environment-variable-contract.md) | Phase 2 默认关闭，独立于捕获开关 |
| [单元测试](/Users/innovdia/Development/carwashpro/tests/unit/performance-targets.test.ts)、[集成测试](/Users/innovdia/Development/carwashpro/tests/integration/performance-targets.test.ts) | 金额、版本、范围、完整性、月份、回滚、分页、默认关闭 |
| [浏览器专用种子](/Users/innovdia/Development/carwashpro/scripts/seed-performance-targets-browser.ts)、[真实 UI 验证](/Users/innovdia/Development/carwashpro/scripts/verify-performance-targets-browser.mjs) | 严格限定本地测试环境的可复现验证 |

## 10. 下一阶段接口与未验证边界

可直接复用：目标版本／门槛／个人金额模型，targetMembers 的年度证据逻辑，经营时区解析、slicePerformance / comparisonWindow / progress / teamLevel 规则，统一只读来源核查及覆盖语义，销售与小费独立的事件明细。

**不能**把后台 PerformanceActor 或 actorUserId 直接开放给 Staff App。下一阶段应先建立员工认证／membership／工作门店的可信适配层，只给普通员工自己的明细和团队汇总；管理员工范围另经服务端授权，避免整个后台成员／订单数据下发员工端。本阶段没有实现这一适配层或相关页面。

保留的独立正式启用条件：

1. 生产迁移、代码审阅、发布审批及显式 flags 启用，均未执行。`TETAMU_PERFORMANCE_PHASE2=false` 是默认；启用不代表 Phase 1 捕获已启用或全年已补齐。
2. 历史缺捕获、未知组成、paid-VOID 最终处理及归属补分配仍需独立流程／确认；本阶段没有自动处理历史。
3. 实体 iPhone / Safari、真实支付、真实退款及通知渠道验收未进行。
4. 数据量压测未进行；目前为限定门店年度轻量投影汇总，不宣传为无限规模查询方案。
5. 集团委托身份、多管理门店的新增授权模型、完整归属更正／补分配后台不在本阶段；现有 Phase 1 更正服务没有新开放按钮或更宽权限。
6. 错误页有实现，加载状态已在真实页面看到；未为了测试故意中断数据库或制造生产故障。没有全仓库无目的测试或七入口全面 UI 重跑。

结论：后台目标管理、独立权限、不可变版本、完整性判定和必要真实页面验证已完成，可开始后续 Staff App 开发。当前功能仍是未提交、未部署的本地实现。完成报告后停止，不自动进入下一阶段。
