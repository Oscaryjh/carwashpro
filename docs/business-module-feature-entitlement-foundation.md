# BUSINESS MODULE / FEATURE ENTITLEMENT — FINAL STATUS

## A. Objective

建立 Business-scoped 的正式产品模块 entitlement，并永久保持 `Business has entitlement AND user has capability AND scope is valid = access allowed`。本阶段只建立 entitlement foundation，不建立 billing、subscription payment 或自动续费。

## B. Existing Audit

审计结论为 `PARTIAL / DUPLICATED`：原系统已有 Business、industry、direct/group membership、RBAC capability、Staff permission、菜单条件和受保护 route，但没有正式 Business-level module source-of-truth。`industryType`、employee `attendanceEnabled`、用户 permission 和零散 UI 条件过去只能描述业务类型、个人权限或员工状态，不能代表客户购买的产品模块。

## C. Module Taxonomy

中央 taxonomy 为 `CORE`、`POS`、`SALON`、`AUTO`、`WHATSAPP`、`BUSINESS_GROUP`、`HR`、`PAYROLL`、`STATUTORY`，并为 `CLAIMS`、`AI`、`LOYALTY` 保留 registry key。Package 继续属于现有 POS domain，没有为 entitlement 重构财务或 catalog domain。

## D. Core

`CORE` 是 system-required implicit entitlement，始终可用且不能建立可关闭的 DB row。Business、Branch、登录、RBAC、Settings foundation、People / Team directory 继续属于 CORE。POS-only Business 可查看 Team，并可在不写 Attendance 或 Payroll profile 的情况下创建基本 team member；HR 与 Payroll 字段仍分别受模块和 capability 保护。

## E. POS

Cashier、catalog、product、service、package、discount、CRM、invoice、refund、inventory、closing 和 reports 的现有产品边界保持不变。关键 route/action/API 通过 POS capability mapping 或 explicit `requireBusinessUserForModule("POS")` 检查；checkout/payment/invoice/closing 的财务算法没有重构。

## F. Salon

SALON 控制 Appointment / Calendar / Salon assignment surface。SALON 不依赖 HR，关闭 SALON 不会关闭 CORE Team。Industry 只用于 onboarding default 与 compatibility migration，不参与 request-time entitlement 判定。

## G. Auto

AUTO 控制 Vehicle / Work Order / ready-for-pickup operational surface；Work Order 仍要求现有 POS + AUTO 产品组合。AUTO 不依赖 HR，Team assignment 仍属于 CORE。

## H. WhatsApp

WhatsApp inbox、settings、queue、diagnostics、send API 及自动 intent 均受 WHATSAPP gate。模块关闭时 checkout、invoice、work order 和 appointment 主交易继续成功，仅跳过新 WhatsApp intent；历史 queue/message 数据不删除。

## I. Business Group

BUSINESS_GROUP entitlement 是 member Business-scoped，而不是 Group 自动传播。Group navigation、overview、reports、closing、exports 和 logo mutation 在完成 user/group scope 验证后检查 active Business entitlement。现有 group membership metadata 不做 destructive change。

## J. HR

HR 控制 Attendance、Leave、Timesheet、HR profile extension、manager workflow 和 employee self-service endpoint。Team directory 继续可用；员工账号不会因 HR disabled 被整体停用。Attendance/Leave API 使用统一 `MODULE_NOT_ENABLED` 403。

## K. Payroll

PAYROLL 是独立 entitlement，declarative dependency 为 `PAYROLL -> HR`。Payroll routes、actions、exports、bank/payment workspace、payslip publication 和 Staff payslip 通过现有 granular capability 加 module gate。关闭只阻断 operational access，不删除历史 Payroll 数据。

## L. Statutory

STATUTORY dependency 为 `STATUTORY -> PAYROLL`。Entitlement enabled 只代表产品可访问，绝不绕过 ruleset readiness、official artifact verification、human sign-off 或 ACTIVE status。

## M. Future Modules

CLAIMS、AI、LOYALTY 保留 registry metadata；本阶段没有开发 Claims、AI、Commission、PCB、Public Bank 或 SAVT 业务功能。现有 Loyalty surface 仅接入 entitlement 边界，没有重构 loyalty domain。

## N. Entitlement Data Model

`BusinessModuleEntitlement` 是 canonical current source，唯一键为 `(businessId, moduleKey)`，包含 status、effective window、source、planCode、revision、creator/updater。`BusinessModuleEntitlementEvent` 保存 immutable revision history、before/after window、actor、reason 和 source。DB checks 阻止 CORE row、无效窗口和非正 revision；identity/revision/event triggers 阻止删除、身份移动、跳 revision 与历史改写。

## O. Module Registry

`src/lib/modules/registry.ts` 是唯一 module key、label、category、dependency、core/operational metadata 与 capability-to-module mapping。Sidebar、API、Settings 和 action 不维护另一套 module enum。

## P. Dependency Model

启用 dependent module 前必须由 dependency entitlement 覆盖相同 effective window，否则 `MODULE_DEPENDENCY_REQUIRED`。关闭 HR 或 Payroll 前检查未到期 dependent，存在时以 `DEPENDENT_MODULE_ENABLED` block；不做 silent paid-module cascade。

## Q. Entitlement Resolution

`loadBusinessModuleContext` 每次 request 从 DB 一次读取 Business 的所有 entitlement，计算 current/future/expired status，并以 fixed-point dependency validation fail closed。`hasBusinessModule`、`requireBusinessModule(s)` 与 `isBusinessModuleEnabled` 共享该 resolver。Session 与 client flag 不缓存授权结论。

## R. RBAC Relationship

Module entitlement 与 RBAC 永久分离：resolver 只回答 Business 是否拥有模块；existing capability 与 tenant/branch/group scope 继续回答 user 是否获授权。Business Owner、Group Owner/Manager、direct Staff 均不能绕过 disabled module。Platform Admin 只在 admin surface 管理 entitlement，不默认进入 Business operational surface。

## S. Navigation Gating

AppShell 单次加载 module context，按 POS/SALON/AUTO/WHATSAPP/BUSINESS_GROUP/HR/PAYROLL/STATUTORY 隐藏 normal operational items；People 始终保留。Staff PWA 分开隐藏 HR navigation 与 Payroll payslip。HR-only login 会 entitlement-aware 地落到 `/team`，不会落到 disabled `/cashier`。

## T. Route / Server Action Gating

菜单隐藏不是安全边界。Business pages/actions 通过 centralized capability mapping 或 explicit module helper；employee Attendance/Leave/Payslip endpoints 使用 employee module guard；cashier APIs、WhatsApp APIs/automations、Group exports/actions 均 server-side 检查。已验证 bookmark/direct URL 返回安全的 `MODULE_NOT_ENABLED`，且只在 tenant identity 成功后显示 module key 和通用说明。

## U. Admin Management

现有 Platform Admin Business detail 增加受控 Modules panel，支持 status、effective dates、source、plan reference、reason 和 optimistic revision。Manual reason mandatory。Business Owner Settings 仅显示 Enabled / Not enabled 与 dependencies，没有 self-enable form，也没有 price、card、renewal 或 billing funnel。

## V. Existing Business Migration

Migration 为 additive。为避免 Local/Testing 现有 Business 突然失去功能，compatibility backfill 安全启用既有共同 surface（POS、WhatsApp、HR、Payroll、Statutory），按现有 industry 确定 SALON/AUTO，按 active group membership 与现有 loyalty program 确定 add-on；source 为 `MIGRATION` 并写初始 event。运行时 `industryType` 不再是 entitlement source。新 Business 由 explicit default-profile provisioning 写正式 entitlement row，不伪造 subscription plan。

## W. Security / Tenant Isolation

所有 lookup 以 trusted `businessId` 为 scope；cross-business test 确认 Business A entitlement 不会赋予 Business B。Mutation 使用 Serializable transaction、per-Business advisory lock、expected revision 与 immutable audit event；并发 enable PAYROLL / disable HR 不会产生 invalid dependency state。Client-supplied enabled flag 不受信任。

## X. Tests / Regression

- Entitlement unit：4/4；full unit：728/728。
- Entitlement integration：5/5；full integration：99/99。
- Browser Local authenticated：POS-only、HR-only、Full Business 通过。
- POS financial、Attendance P2、Leave approval/cancel/balance、Payroll P4/P5、Statutory、WhatsApp、Auth/RBAC 与 tenant regression 通过。
- TypeScript、lint、Local production-mode build、Prisma validate/generate、migration status、145-migration fresh rebuild、canonical guard、changed-content secret scan、`git diff --check` 通过。
- Lint/build 仅保留既有 WhatsApp `<img>` 与 Attendance CSS autoprefixer warnings。

场景矩阵：

| Profile | Result | Key evidence |
| --- | --- | --- |
| POS ONLY | PASS | Cashier/Appointment/People allow；HR/Payroll deny |
| HR ONLY | PASS | People/Attendance/Leave allow；Cashier deny |
| POS + HR | PASS | POS/HR resolve independently；Payroll deny |
| POS + HR + PAYROLL | PASS | dependency-valid Payroll allow；Statutory optional |
| FULL BUSINESS | PASS | POS/Salon/Auto/WhatsApp/HR/Payroll/Statutory resolve |

## Y. Remaining Risks

本 foundation 没有 billing/plan propagation；commercial entitlement 目前必须由 authorized Platform Admin 或 onboarding provisioning 写入。Group-level subscription propagation、trial automation 与 plan lifecycle 留给未来独立阶段。Legacy employee `attendanceEnabled` 仍保留为个人 attendance eligibility，但不再代表 Business HR entitlement。

## Z. Final Status

模块矩阵：

- CORE — READY
- POS — ENTITLEMENT READY
- SALON — ENTITLEMENT READY
- AUTO — ENTITLEMENT READY
- WHATSAPP — ENTITLEMENT READY
- BUSINESS GROUP — ENTITLEMENT READY
- HR — ENTITLEMENT READY
- PAYROLL — ENTITLEMENT READY
- STATUTORY — ENTITLEMENT READY

`BUSINESS MODULE / FEATURE ENTITLEMENT — READY`

`LOCAL / TESTING ONLY`

`PRODUCTION NOT ACCESSED`

`PRODUCTION NOT VALIDATED`
