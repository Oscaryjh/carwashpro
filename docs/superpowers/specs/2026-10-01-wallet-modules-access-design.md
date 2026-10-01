# Member Wallet — Modules & Access 设计

日期：2026-10-01。源码基线：`d772436b1362823f7273d507f7b3c307e65fb87f`。

状态：`IMPLEMENTATION_PLAN_APPROVED`。设计与实施计划均已审核，Local TDD 实施中；尚未提交或部署。

## 1. 产品合同

唯一正式 Wallet availability 来源为当前 Business 有效的 `WALLET` module entitlement。模块解决 Business 是否有该功能；现有 Access、角色、capability、tenant scope 继续解决用户能做什么。

- 使用现有 Platform Admin → Business → Modules & Access，不创建额外开关页面。
- `Member Wallet` 文案：`Enable customer wallet top-ups, payments, refunds and wallet history.`
- 沿用现有 Enabled/Disabled、草稿、Save、revision、entitlement event 和 Audit 流程。切换草稿不等于已保存；保存成功后的新请求立即读取新状态，不需要 restart 或 redeploy。
- 缺少 entitlement、DISABLED、未来生效、已过期均 DENY；不增加永久缓存，不用 session 内模块快照代替数据库事实。
- 新 Business 默认不启用 WALLET。商业计划、行业默认模板及其他模块不会被本次自动开启。
- 注册为 operational module，正式依赖 POS（POS 已沿用现有 CORE 依赖）；现有 capability/module 检查继续执行，不用 WALLET 替代它们。依据 registry 的 VIEW_CRM / PROCESS_CASHIER_PAYMENT / PROCESS_REFUND 映射和 Wallet authorization 的现有 POS 检查，不允许 WALLET ON + POS OFF 的半可用产品状态。
- WALLET OFF 隐藏正常客户 Wallet、Top-up、Cashier Wallet payment 和 Offers 入口；直接访问返回现有 `Member Wallet is not enabled for this business.`
- OFF 不删除余额、流水、Offer、历史或未完成 intent。它撤销访问，不实施资金修复或余额清零。

## 2. 已确认源码事实

- `prisma/schema.prisma`：`BusinessModuleEntitlement.moduleKey`、`BusinessModuleEntitlementEvent.moduleKey`、商业计划模块均使用数据库 enum `BusinessModuleKey`，目前没有 WALLET。
- `src/lib/modules/registry.ts`：现有 moduleKeys、registry、行业默认模块均为代码式定义。
- `src/lib/modules/entitlements.ts`：每次读取 entitlement，评估 enabledFrom/enabledUntil 与依赖；支持指定 Prisma transaction/database reader。
- `src/lib/modules/service.ts`：批量保存、Platform Admin 检查、revision、防重复输入、依赖验证、事件和 Audit 已存在。
- `src/components/module-access-manager.tsx`：现有 toggle 修改 draft，由现有表单保存。
- `src/app/admin/businesses/[businessId]/page.tsx`：从 registry 构造模块行，缺失记录默认 Disabled。
- `src/lib/wallet/release-policy.ts`：目前同步判断 Local test/env/pilot UUID allowlist。
- 当前 gate 调用覆盖 Wallet authorization、refund authorization、ui-adapter、top-up、redemption、Cashier action/page、Wallet recovery action 和 Offers page。
- Staff App 的 `src/lib/modules/employee-access.ts` 复用 entitlement reader；reader 会读取 Business 全部 enum moduleKey。旧 Prisma Client 必须在写入 WALLET entitlement 前排除或升级，不能假设 Staff 与变更无关。

## 3. 唯一数据库变更

Prisma `BusinessModuleKey` 仅新增 `WALLET`。第 226 条正式 migration 按项目时间戳命名，排在 225 后；SQL 只有：

```sql
ALTER TYPE "BusinessModuleKey" ADD VALUE 'WALLET';
```

不新增表、字段、默认 entitlement、数据 backfill、trigger、约束或索引。不修改 1–225 的 SQL/checksum。不执行 db push、reset、resolve 或手工线上 DDL。

Migration 只扩展 enum，不负责给任何 Business 开模块。配置 Business 必须在对应新版本部署后通过现有正式 entitlement 保存机制完成。

## 4. Server authorization

将现有 release-policy 收敛为异步 module assertion/predicate；可以保留调用 API 名称降低改动，也可以提供明确的 `assertWalletModuleEnabled` 内部 primitive。唯一决策读取现有 entitlement，不再读取四个 Pilot env 或 Local bypass 开关。

- 使用 authenticated session 派生的 verified Business，不接受请求提供的身份或模块声明。
- predicate 为 UI capability 服务；assertion 是 server-side 最终授权。
- assertion 缺模块时继续产生稳定 Wallet unavailable 错误；数据库读取失败不能返回 ALLOW。
- 显式传入现有 Prisma database/transaction reader，避免事务内又用全局客户端读不同状态。
- 所有同步旧调用必须变为正确 await；尤其不能把 Promise 当 boolean 使用。
- 在 FinancialOperation runner 返回 completed replay 前检查，在新的 execute 事务内再次检查；refund/reversal/void/recovery 同样保留现有检查边界。
- 每次新的请求读取当前 entitlement。OFF 保存后发起的 replay/recovery 必须 DENY；不宣称能撤销 OFF 前已进入事务的资金操作，也不新增跨操作锁或资金取消机制。
- Owner-only full history/manage、Staff receipt 隐私、foreign customer、foreign Business、Branch scope、原操作 key/payload 与幂等保护不变。

这会需要少量既有业务入口的调用层编辑（例如 top-up 的 gate `await` 和 Cashier capability `await`），但不会改变金额、交易流程、资金写入或 payload。不得以“不能编辑这些文件”为由保留授权绕过；也不得借调用层编辑改资金规则。

## 5. 代码影响边界

预计正式修改范围：

- `prisma/schema.prisma` 和唯一新的 migration 226。
- `src/lib/modules/registry.ts`；必要的 ModuleAccessManager 描述展示和对应 tests。现有 entitlement save/audit service 原则上直接复用。
- `src/lib/wallet/release-policy.ts`、`authorization.ts`、`refund-authorization.ts` 的授权读取。
- `src/lib/wallet/ui-adapter.ts` 只改授权调用，History grouping、pagination、金额展示不变。
- `src/lib/wallet/top-up.ts`、`redemption.ts` 只改 gate 调用；不改业务计算、账本写入及 idempotency runner。
- `src/app/(business)/cashier/actions.ts`、`page.tsx`、`crm/wallet/actions.ts`、`crm/wallet/offers/page.tsx` 的 await 与展示能力。
- CRM 客户 Wallet 展示入口逐项核对：OFF 时不再呈现功能卡片/动作，不用真实余额判定模块。
- 正式 unit/integration fixtures：在隔离 Business 通过已有 entitlement 结构显式启用 WALLET；普通 fixture 默认 OFF。
- 现有 release-policy/entry-point/authenticated Wallet tests 从 Pilot gate 合同迁移为 module 合同；保留资金安全及 tenant assertions。
- Migration integrity/upgrade 正式 tests 必须追加 226 并继续验证历史 checksum，不放宽完整 drift。
- 文档及 `.env.example` 在确认旧 env 不再用于授权后清理；不提交 secrets、日志或本地证据。

不修改 Wallet accounting、Paid/Bonus、Top-up/Checkout/Refund/Reversal 资金规则、Loyalty、Performance、Reports、Closing、History grouping、普通 POS 合同。无关测试失败先分类并记录，不自动修其他模块。

## 6. TDD 与 Local 验证设计

先取得 RED，再最小实现取得 GREEN：

1. module registry 和 schema/migration：WALLET 存在，默认 OFF，226 SQL 仅 enum addition，历史迁移 checksum 不变。
2. entitlement：ON/OFF、缺记录、未来/过期、保存后新请求立即更新；普通 Owner 禁止修改，Platform Admin 可保存，event/Audit 正确。
3. Wallet access：Owner 原批准范围；Staff 不新增权限、不获 full history；foreign Business/customer 拒绝。
4. Wallet OFF：敏感读取、Offers、Top-up、Wallet Checkout、refund/reversal/void、completed replay、pending recovery 全部拒绝，拒绝前后金融数据不变。
5. Wallet ON：现有操作资金回归保留；UI 可见与模块一致；Testing/Production 相同 entitlement 得到相同结果；旧 pilot flag/list/Local bypass 不影响结果。
6. 普通 Cash/Card、非 Wallet POS、已有 Service 预约/员工分配不回归。
7. 225 disposable DB → 226 正式 deploy；enum 正确；旧 synthetic 核心/金融数据 fingerprint 不变；当前 schema diff 完整 CLEAN。
8. Prisma generate/validate、targeted module/Wallet tests、npm test、完整 disposable integration、build、TypeScript、git diff --check 全部真实通过。
9. 独立只读 Review：Critical 0、Important 0；重点找未 await、错误全局客户端、缓存授权、replay 绕过和无意资金修改。

保护 canonical 七个 dirty files：独立隔离本次实现，前后 SHA-256 相同，不 stage、reset、覆盖或夹带。尤其 registry 和既有 entitlement tests 有已知 dirty overlap，不能在 canonical 原始 dirty 文件上直接修改。

## 7. 受控上线与数据保护

Local 全部门槛与独立 Review 通过后才 scoped commit/normal push。部署使用同一 exact Git SHA，禁止 dirty snapshot。release metadata 与真实源码必须匹配。

每个环境执行下列顺序：

1. 只读记录 runtime SHA、migration 225、已验证 backup、Wallet 及关键金融表 count/hash、现有 entitlement。
2. 通过正式 production migration mechanism 部署 226；enum 扩展不得改变现有数据。
3. 新 Web 与会读取相同 entitlement 的 Staff/其他运行消费者先使用认识 WALLET 的客户端；确认实际部署身份和 health 后，才保存 WALLET entitlement。未完成客户端兼容核对则暂停，不写新 enum 记录。
4. 新代码默认缺 entitlement 为 DENY。配置前的短暂 Wallet DENY 是安全切换窗口；不得增加 Pilot fallback 来掩盖窗口，也不把窗口写成业务已可用。
5. Platform Admin 使用既有保存入口，仅开启批准名单。其他 Business 缺记录自然 OFF；不批量重写其他 Business 的模块或制造 FinancialOperation。
6. 只读验证 ALLOW/DENY、可用现有客户的 Summary/History、Offers、普通页面健康；无客户时如实 deferred，不造 synthetic 客户/Offer/充值。
7. 对比金融 count/hash：entitlement/event/Audit 的批准配置变化单独列出；不得把这些管理记录当金融变更，也不得忽略金融表变化。

Testing 先行：

- `WALLET_UAT_20261001`，已知 ID `17279100-edf2-468d-8b9a-8e219744ee0c`，ON。
- `Royal Salon`，ON。实际 ID 必须从 Testing 数据库/Admin workspace 只读确认，不能用 Production ID 或相似名称猜测。
- 所有其他 Business OFF，至少一间真实页面 DENY。

Testing PASS 后，同一 SHA 上线 Production：

- `royal salon damai`，ID `c83b4140-d13d-4b7c-848f-aa3497c5259f`，ON。
- OSCAR CAR WASH 及其他 Business OFF；至少再抽查一间 DENY。
- 不制造金融动作，不修改真实客户；customer-level smoke 没有现有客户时记 deferred。

本次部署包含 Staff 的必要 enum 客户端兼容更新，不开发 Staff 新功能。若发现其他需要同时升级的消费者，必须先列出运行依赖与影响，不能盲目发布全部服务。

## 8. Pilot env 清理与故障停止

只有 Testing 与 Production 都验证新 module source 后，才移除现有的四个旧变量（按各环境实际存在的 key 删除）：

- TETAMU_WALLET_TESTING_PILOT
- TETAMU_WALLET_TESTING_BUSINESS_IDS
- TETAMU_WALLET_PRODUCTION_PILOT
- TETAMU_WALLET_PRODUCTION_BUSINESS_IDS

不改其他 secrets/env。清理若触发 redeploy，仍需验证同一 exact Git SHA、health、ON/OFF、fingerprint 和 schema drift。

清理前代码必须已证明忽略旧 env；不得先删临时 gate 导致旧代码拒绝服务。写入 WALLET 后不能回滚到不认识该 enum 的旧 Prisma Client；不能删除 enum、删除 entitlement 或手工改 DB 来恢复。出现缺陷立即停止扩围，保留证据，由用户批准恢复方案。

## 9. 完成标准与本轮停止点

完成标准：migration 226、schema drift CLEAN、资金逻辑不变、金融 count/hash 不变、Testing 与 Production 已验证、只有批准 Business ON、旧 env 清理已核对、独立 Review 无 Critical/Important，才输出 `WALLET_MODULES_AND_ACCESS_READY`。

设计已审核通过；详细任务、TDD 顺序和 enum reader 上线硬门槛见 `../plans/2026-10-01-wallet-modules-access-implementation-plan.md`。实施计划审核前仅允许文档工作，不创建 migration、不修改产品代码或线上授权；本文不代表测试或部署已经通过。
