# Member Wallet — Modules & Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WALLET 接入现有 Modules & Access，成为唯一正式 Wallet availability source，保持资金、权限及租户合同不变。

**Architecture:** BusinessModuleKey additive enum extension + 现有 registry/dependency/entitlement save/audit + 异步 Wallet module gate。正式 dependency 为 WALLET → POS。Testing 先行，Production 同 exact SHA；首次新 enum 数据写入前升级所有 entitlement readers。

**Tech Stack:** Next.js / TypeScript / Prisma / PostgreSQL，现有 tsx unit tests、disposable integration runner、Git-source Railway deploy。

**Spec:** `../specs/2026-10-01-wallet-modules-access-design.md`。源码基线 `d772436b1362823f7273d507f7b3c307e65fb87f`。

设计状态：`DESIGN_APPROVED_FOR_IMPLEMENTATION_PLAN`。本计划：`IMPLEMENTATION_PLAN_APPROVED`。2026-10-01 获准从 Task 0 开始；步骤完成以执行 ledger 和实际证据为准。

## Global Constraints

- 计划已获准实施；严格按 Task 0–6 与各 rollout gate 执行，所有完成标记以实际验证证据为准。
- 后续只扩展 WALLET enum；不新增 config table、walletEnabled、另一套 toggle。资金服务、Paid/Bonus、Ledger、Loyalty、Performance、Reports、Closing、History 算法不变。
- 保留 tenant、permission、Owner-only history、Staff 隐私、foreign customer、幂等及 replay/recovery 检查。取消 env availability 决策不等于取消 authentication。
- 保护 canonical 七个既有 dirty files，实施前后 SHA-256 比较；不能 stage/reset/覆盖它们。特别 registry 和 entitlement tests 有重叠，必须在干净隔离 worktree 从批准基线实施。
- 正式修改、测试及必要文档进入一个 scoped commit；完整 Local + 独立 Review 前不得提前提交。日志、截图、临时 Prisma Client、DB、报告、generated next-env.d.ts 不入 commit。
- 所有线上验证 no-money；不制造 Customer、Offer、Top-up、Sale、Refund、Reversal、Void，不 replay 资金请求。不用报表代替数据库事实。

## 源码依据与依赖决定

`src/lib/modules/registry.ts` 的 `modulesForCapability` 将 VIEW_CRM、PROCESS_CASHIER_PAYMENT、PROCESS_REFUND 映射到 POS。`src/lib/wallet/authorization.ts` 的 READ/TOP_UP 与 `refund-authorization.ts` 已通过上述能力检查 POS；CRM 和 Cashier 入口也要求 POS。Offers 的 Owner 管理入口与客户/收款入口存在不同入口检查，若仅依赖 CORE，会出现 Offers 可用但 Wallet 客户/付款不可用。

因此 registry 注册 **WALLET dependencies = [POS]**；沿用 POS → CORE，不新增自定义依赖引擎。不支持 WALLET ON + POS OFF。`modules/service.ts` 已验证依赖有效期、关闭父模块时的 dependents 和 revision；`modules/entitlements.ts` 已计算实际有效模块。复用它们，并测试异常数据库组合仍统一 DENY。模块不自动加入行业默认或商业计划；启用 WALLET 不自动为商家开其他模块。

## Review Focus

| 风险 | 必须对应的证据 |
|---|---|
| 半可用状态、依赖时间窗 | Task 1：保存拒绝与读取 fail-closed，POS 关闭/过期测试 |
| Promise truthy / 漏 await / replay bypass | Task 2：所有调用点审计、authenticated action 与 completed replay 负测 |
| 权限与资金边界扩张 | Task 2–4：Owner/Staff/foreign tenant 测试、原资金与普通 POS 回归 |
| enum reader 崩溃与非法 rollback | Task 5–6：逐 runtime 兼容清单、首次写入 gate、point-of-no-return 记录 |
| 夹带 dirty files / 线上数据改变 | Task 0、4–6：SHA-256、scoped diff、schema/checksum、financial fingerprints |

## Task 0 — 隔离、清单与基线（审核后）

- [ ] 只读记录 HEAD、remote SHA、status；若已有等价 commit，先核对而不重复开发/提交。使用干净 worktree，不复制 canonical dirty files。
- [ ] 保存七文件 SHA-256：next-env.d.ts；admin-business-workspace.module.css / .tsx；catalog-form-modal.tsx；lib/modules/registry.ts；integration/unit business-module-entitlement.test.ts。
- [ ] 保存 1–225 migration SQL checksum、schema、Wallet financial files 与旧 gate 文件基线。审计现有调用：`rg -n 'isWalletAccessAllowed|assertWalletAccessAllowed|isWalletLocalTestEnabled|assertWalletLocalTestEnabled' src tests`。
- [ ] 形成正式改动 allowlist，新增文件只有 migration、必要测试及文档；发现实际文件偏离本计划先解释 scope，不夹带原工作区更改。

## Task 1 — Enum、registry 与 module dependency（TDD）

**Files:** prisma/schema.prisma；prisma/migrations/项目下一时间戳_wallet_module_entitlement/migration.sql（实际第226条）；src/lib/modules/registry.ts；tests/unit/business-module-entitlement.test.ts；tests/unit/module-access-state.test.ts；tests/integration/business-module-entitlement.test.ts；新增 tests/unit/wallet-module-contract.test.ts。

- [ ] RED：先补 registry WALLET label/category/operational/dependency 测试、新商家默认 OFF、无 POS 不能有效开启、父模块有效期覆盖要求。运行 `npx tsx --test tests/unit/wallet-module-contract.test.ts tests/unit/business-module-entitlement.test.ts tests/unit/module-access-state.test.ts`，保存失败断言。
- [ ] 最小实现：enum 增 WALLET；registry label `Member Wallet`，operational、依赖 POS。保持现有默认模块列表，不给旧/新 Business backfill。
- [ ] migration 226 只含 `ALTER TYPE "BusinessModuleKey" ADD VALUE 'WALLET';`；不使用 IF NOT EXISTS 掩盖异常，不更改 1–225，不写 entitlement 数据。
- [ ] `npx prisma generate`、`npx prisma validate`；再跑上述 unit GREEN。
- [ ] Integration RED→GREEN：通过现有正式 save flow 测试 WALLET ON/POS OFF 拒绝；同批合法 POS+WALLET 成功；POS 关闭被 enabled WALLET 阻止；未来/过期/依赖不覆盖 DENY；异常 fixture WALLET ON/POS OFF 读取仍 DENY。不得放宽现有 save contract。
- [ ] 运行 `npm run test:integration:disposable -- tests/integration/business-module-entitlement.test.ts`；fixture 每 Business 独立、时间确定。UI 依赖提示复用现有行为，不建立 Wallet 特例。

## Task 2 — 唯一异步 server gate 与安全边界（TDD）

**Files:** src/lib/wallet/release-policy.ts、authorization.ts、refund-authorization.ts、ui-adapter.ts、top-up.ts、redemption.ts；src/app/(business)/cashier/actions.ts、page.tsx；src/app/(business)/crm/wallet/actions.ts、offers/page.tsx；必要的现有 refund/reversal/void gate 调用文件（以 Task 0 清单为准，只替换授权调用）。

**接口约束:** 保留 assertion/predicate 的现有公开名称，返回 Promise；输入 businessId 必须来自 authenticated context。第二参数接收 `{ database, now? }`，database 类型复用现有 module reader，兼容 Prisma TransactionClient。predicate 通过现有 `isBusinessModuleEnabled(..., "WALLET", ...)` 评估 WALLET 与 POS；assertion 继续使用稳定 WALLET_UNAVAILABLE code/文案。数据库错误不能降级 ALLOW。

- [ ] RED：tests/unit/wallet-release-policy.test.ts、新增 tests/integration/wallet-module-entitlement.test.ts：有效 ON ALLOW；缺行/DISABLED/future/expired/invalid UUID/依赖无效 DENY。所有旧 Pilot env 组合均不能覆盖 module OFF；module ON 不依赖 env allowlist。
- [ ] 最小实现仅 availability policy 与 await/reader plumbing。调用处明确 `await`；事务内传原 tx，禁止通过全局 client 取代。不移动金额计算、Ledger 或 FinancialOperation 流程。
- [ ] RED→GREEN：每条 Top-up、Checkout、Refund、Reversal、Wallet Void、sensitive read、Offers、completed replay/recovery 在 OFF 时拒绝且 DB 无资金写入；ON 恢复原权限合同。
- [ ] runner replay 返回之前的 gate 和新执行 tx 内 gate 均保留；OFF 后的新 recovery/replay DENY，原 operationKey/payload 不改。不开跨操作新锁，不声称撤销已经进入事务的请求。
- [ ] authenticated integration：foreign business 注入、foreign customer、Staff full history、Owner branch scope、未授权角色仍拒绝；不能只测纯 policy predicate。
- [ ] 运行 `npx tsx --test tests/unit/wallet-release-policy.test.ts tests/unit/wallet-entry-points.test.ts`，再运行 `npm run test:integration:disposable -- tests/integration/wallet-module-entitlement.test.ts tests/integration/wallet-authenticated-actions.test.ts tests/integration/wallet-checkout-actions.test.ts tests/integration/wallet-checkout-boundaries.test.ts`。
- [ ] 旧 testing/production pilot tests 改为 module 权威及 env 无效回归，不删除安全负测。fixture 通过测试授权数据库设置明确模块，不保留 Local env bypass。检查所有 predicate 使用没有 Promise truthy、旧 env fallback 或漏 await。

## Task 3 — Modules & Access/UI、fixtures 与迁移证据（TDD）

**Files:** src/components/module-access-manager.tsx（仅必要描述/展示）；src/app/admin/businesses/[businessId]/page.tsx（仅必要 registry integration）；src/app/(business)/crm/page.tsx；Wallet/Cashier page gate；tests/unit/wallet-ui.test.ts、wallet-checkout-ui.test.ts；tests/integration/wallet-ui-adapter.test.ts；tests/helpers/wallet-fixture.ts、wallet-checkout-fixture.ts；必要 Wallet fixture 调用 tests。

- [ ] RED：模块列表含 Member Wallet 文案；draft 未保存不生效；正式 Save audit/revision 保持；OFF 正常入口隐藏、直接路由 DENY，ON 对原允许角色显示。POS OFF 的异常 fixture UI 和 server 同为 DENY。
- [ ] 最小实现复用现有 toggle/save/event/audit；不新增 Wallet toggle、不改 auto-save 或权限。OFF 不清 pending intent、不删余额或历史；再次 ON 保留原事实。
- [ ] 原 Wallet history/read model 与 reversal 入口不改，仅 gate；Staff 隐私不变。ordinary Cash/Card/non-Wallet 仍正常，不依赖 WALLET。
- [ ] migration integrity 文件按仓库实际 manifest 合同扩展226：tests/unit/canonical-migration-history.test.ts、canonical-migration-manifest.test.ts、migration-integrity.test.ts；scripts/lib/canonical-migration-history.mjs 及必要对应类型；tests/helpers/migration-integrity.ts（只有合同实际需要时）。禁止覆盖历史 checksum。
- [ ] scripts/verify-wallet-upgrade-disposable.mjs 只更新当前 migration 期望225→226并增加225→226阶段证据；保留原222升级、Attendance FK、历史 row/hash、Wallet空数据断言。增加已有 WALLET之前的有效 entitlement reader 回归，确认只增加 enum 不生成模块数据。
- [ ] disposable 验证 fresh→226、222→226、225→226，1–225 checksums 不变，旧 synthetic 数据不变，新 enum 可用、entitlement无自动记录，schema diff exit0/No difference detected。
- [ ] 针对性 UI/adapter/ordinary POS GREEN 后，再进入完整门槛；不以源码字符串断言代替行为测试。

## Task 4 — 完整 Local、独立 Review、Git 收尾

- [ ] 依次执行并保留最终版本证据：`npx prisma generate`、`npx prisma validate`、`npx tsc --noEmit`、`npm test`、`npm run test:integration:disposable`、`npm run build`、`node scripts/verify-wallet-upgrade-disposable.mjs`、`node scripts/verify-fresh-migrations.mjs --schema-diff`、`git diff --check`。
- [ ] 单独核对 migration integrity 与 schema drift CLEAN；build 后再核对 generated artifacts。测试计数以实际输出为准，不引用历史 PASS 替代。失败不得 skip、弱化断言或无依据增 timeout；无关故障留证据并停止，不扩展 scope。
- [ ] 独立只读 Review 覆盖 Review Focus，资金写入/计算文件差异只能是必要 gate wiring；Critical/Important finding 清零并重跑受影响与完整 gates。
- [ ] 最后检查七 dirty hashes不变、正式文件清单、schema唯一 WALLET增值、SQL唯一enum扩展、无秘密/日志/临时数据；单一 scoped commit，normal push canonical branch，实际 ls-remote 证明 Local == Remote。不 force、merge unrelated 或 dirty snapshot deploy。
- [ ] 此阶段输出 Local gate报告和 rollout exact SHA。未经后续硬门槛，不得线上保存 WALLET。

## Task 5 — Testing rollout：enum point-of-no-return 硬门槛

### Gate T0：现有环境与数据

- [ ] 只读核对 Testing migration225、health/identity、已验证可恢复备份及financial fingerprints；核对 Runtime inventory，不把 Web health metadata 当 Prisma兼容证据。
- [ ] fingerprint 至少覆盖 WalletAccount/Transaction/TopUpOffer/TopUp/Reversal、Payment/Refund/Invoice/FinancialOperation、LoyaltyTransaction/CustomerMembership、PerformanceReceipt/Contribution、CashierShift/DailyClosingSnapshot。按 Business 稳定排序/hash，排除秘密。entitlement/event/audit是本轮预期授权变化，独立记录，不混入“资金 unchanged”。
- [ ] 仅项目标准 migrate deploy 执行226；225→226、checksum、schema diff核对。此时 enum扩展本身不写WALLET数据，旧reader尚无新值可读；不得先配置 module。

### Gate T1：ENUM_READER_COMPATIBILITY_VERIFIED

- [ ] 部署 Testing Web 和 Staff 同 scoped exact SHA；其余服务先按实际运行 entrypoint/import/query reachability 确认是否 entitlement reader。升级必要消费者，不盲目部署全部服务。
- [ ] 源码已确认：Web的 module/business context、Admin/commercial/Wallet读；Staff的 staff/layout.tsx、modules/employee-access.ts 读。必须盘点其他实际 worker/cron/replica与运行中的运维脚本。
- [ ] 核查 candidates：analytics-refresh-worker、whatsapp-worker、notification-queue-worker、appointment-reminders 调度及 commercial相关任务。这里只是检查清单，不能仅因使用 Prisma 就断言它读取此enum，也不能未追踪就排除。独立 connector 无相关读取可凭依赖证据标 N/A。
- [ ] 每个实际 reader 留表：environment/service/deployment ID、start command、实际 Git/source digest、实际运行 Prisma Client版本与 BusinessModuleKey.WALLET存在证明、health、所有active replicas兼容；无旧进程/旧scheduled job继续读表。本地生成客户端或 APP_RELEASE_SHA alone 均不算实际runtime证明。
- [ ] 涉及 BusinessModuleEntitlement、EntitlementEvent 或 CommercialPlanVersionModule 的新 WALLET enum写入都必须在门槛后；unknown runtime、无法验证client、旧replica、无授权升级依赖服务 → **STOP，零 WALLET写入**。额外消费者升级影响先报告。
- [ ] 在写入前以新客户端正常只读读取现有entitlements，确认无解析问题；Local用226 disposable client完成新enum round-trip兼容测试。线上禁止为兼容测试提前写dummy WALLET。

### Gate T2：首次写入与授权验证

- [ ] T1签字证据齐全后，正常 Platform Admin save：WALLET_UAT_20261001 (`17279100-edf2-468d-8b9a-8e219744ee0c`) ON；Royal Salon先只读解析Testing实际ID再ON，不能使用Production ID或同名猜测。其他Business缺WALLET/有效OFF，不批量补DISABLED行。
- [ ] 首条 WALLET entitlement成功写入时记录 **ENUM_POINT_OF_NO_RETURN_REACHED**，包含 timestamp、environment、Business、revision、event/audit、exact SHA。DISABLED行也包含新enum；OFF不能恢复旧客户端兼容。
- [ ] 此后禁止任何 entitlement reader rollback到不认识WALLET的PrismaClient。失败时保留enum与记录、暂停放量，使用兼容版本修复；不得删新值记录、手工DDL、resolve或旧binary回退。只有已证明认识WALLET的版本才可作为回退候选。
- [ ] Testing只读ON/OFF：approved两家入口/Owner读取 ALLOW；其余 DENY；正常POS可加载；financial14类fingerprints不变。无Customer则Summary/History DEFERRED，不造数据。不执行资金动作/replay。
- [ ] T0/T1/T2全部通过，才允许进入Production；记录模块已成为唯一source，旧pilot env不再影响结果但暂未清理。

## Task 6 — Production 同 SHA、模块配置及最后清理

- [ ] Production preflight：migration225、backup restore记录有效、健康身份、financial基线。若baseline变化/新drift先停。执行同一226正式migration，不改历史、不重复已applied迁移。
- [ ] 同 Testing exact SHA Git-source部署 Web、Staff和实际必要readers；按T1逐项证明每个active runtime/client兼容。226可先执行，但此gate未满足前禁止任何WALLET entitlement/event/plan行写入。
- [ ] 门槛齐全后，正式save仅 `royal salon damai / c83b4140-d13d-4b7c-848f-aa3497c5259f` WALLET ON。OSCAR CAR WASH与其他Business有效OFF，不改其他module/客户/交易。
- [ ] 记录Production首条新enum写入point-of-no-return与兼容rollback限制。no-money验证approved ALLOW、OSCAR及其他DENY；Offers正常；有真实Customer才只读Summary/History，无则DEFERRED。
- [ ] 确认migration226、checksums、schema CLEAN、健康sameSHA、金融fingerprints unchanged、模块唯一availability source。financial数据原本为空必须仍为空；有既有数据则必须hash一致，不能假设全部0。
- [ ] 只有两环境模块授权与fingerprints都通过，再移除四个旧env：TETAMU_WALLET_TESTING_PILOT、TETAMU_WALLET_TESTING_BUSINESS_IDS、TETAMU_WALLET_PRODUCTION_PILOT、TETAMU_WALLET_PRODUCTION_BUSINESS_IDS。准确key已与release-policy源码核对；不改其他env，更新必要.env.example/docs说明，不删除别的Local测试变量。仓库文档清理应已包含在Task 4同一个scoped commit中，此处只执行环境清理，不临时制造第二个代码版本。
- [ ] env cleanup若触发restart/redeploy，必须保持同exactSHA和compatible PrismaClient；重新只读核对health/gates/fingerprints。发现任何资金写入立即FAIL并停，不自动清理数据。
- [ ] 输出 `WALLET_MODULES_AND_ACCESS_READY` 仅在全部证据齐全时；附commit/SHA、各runtime部署、首次写入记录、226、hash、ON/OFF、deferred、旧env清理结果、剩余风险。完成即停止，不开始真钱使用或扩展第二家Production Business。

## 最终停止条件摘要

任何需要资金算法/新schema超出单enum、未知enum consumer、旧reader不能升级、历史migration变化、Local/Review失败、DB drift、financial fingerprint变化 → STOP/BLOCKED，保留已通过成果与证据，不自动扩大范围。首次WALLET写入后不能旧客户端回退；模块OFF不是兼容回退方案。

实施方式：主代理按任务逐项TDD执行（executing-plans），最终安排独立只读Review。已批准 Task 0–6；遇停止条件立即报告，不自动扩大范围。
