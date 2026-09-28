# One Outlet = One Business Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新店独立 Business/Owner；弱化单店技术 Branch UI，保留 legacy 和租户安全。
**Architecture:** 沿用现有 createBusinessAction 事务与 Branch 数据。只降级 Admin Add Branch 入口；单分店输入由服务器验证，不建立新产品模式字段。
**Tech Stack:** Next.js / React / Prisma / node:test。
**Spec:** C:/Users/oscar/.codex/attachments/eb198da9-d0df-48d1-b9ca-083b52f1f0c5/已粘贴的文本.txt

## Global Constraints

- 不修改 Prisma schema、222 migrations、geofence、Attendance/GPS 或 Group 授权逻辑。
- 不新增第二次默认 Branch 创建；不复用 Owner，不自动授予 Group access。
- 不改变遗留 tenant/branch 数据。只发布本轮修改；Production 不部署。
- 工作区原有未提交变更保留，不夹带发布；所有门槛通过后才提交和部署 Testing。

## Review Focus

- 零 active branch 不得生成无 scope 的交易。
- 单 branch 的伪造跨 Business ID 必须被服务端拒绝。
- 多 branch 没有选择不能自动使用首项。
- 历史 business-wide catalog/report 记录不可因隐藏筛选消失。
- 同属 Group 但没有明确 grant 的普通账号仍不得切店。

### Task 1: 新店 onboarding 与兼容入口

Files: src/app/admin/businesses/new/page.tsx; src/components/business-form.tsx; src/app/admin/businesses/actions.ts; src/lib/validation/business.ts; src/components/admin-business-workspace.tsx; tests/unit/business-validation.test.ts; tests/integration/one-outlet-provisioning.test.ts。
Interfaces: 继续使用 createBusinessSchema/createBusinessAction；可选 address 只写 Business.address。
- [x] 先补 optional address、表单和 exactly-one Branch/Owner/audit 集成测试，确认新增契约 RED。
- [x] 更新 New Business/store 文案和独立 Owner 说明；增加地址，不自动 geocode。
- [x] 将 Add Branch 放入默认折叠的 Advanced / legacy 区，不删除原 route/action。
- [x] 运行相关测试 GREEN；不改变已有模块 provisioning。

### Task 2: 统一零/单/多合法分店解析和 UI

Files: src/lib/branches.ts; src/components/branch-select.tsx; tests/unit/one-outlet-branch.test.ts; src/components/cashier-unified-sale-form.tsx; src/app/(business)/closing/page.tsx; src/app/(business)/inventory/stock-counts/new/page.tsx。
Interfaces: resolveBranchId/resolveOperationalBranchId 的已认证业务 scope 保持；BranchSelect 可复用。
- [x] 测试 zero DENY、single 自动解析、foreign ID DENY、multi 显式选择、staff scope、单项无 select/多项有 select。
- [x] 确认 RED 后实现最小解析修正；替换 Cashier/Closing/stock count 多余单项选择。
- [x] 运行相关测试 GREEN；核对 Work Order/Appointment 已使用 shared component。

### Task 3: 各模块兼容性检查及必要的单店展示收敛

Files: src/app/(business)/services/page.tsx; src/app/(business)/dashboard/page.tsx; src/app/(business)/team/performance/page.tsx; Reports/HR/Leave 现有页面；对应测试。
Interfaces: 仅消费既有授权 branch 列表；catalog 的 business-wide null scope 保留。
- [x] 检查 Inventory/Services/Reports/Dashboard/HR/Leave/Performance 零单多状态。
- [x] 为实际改动补 RED 测试；单店只读 Store 展示或隐藏额外 selector，legacy selector 保留。
- [x] Group/Business isolation 现有测试加双 Owner 负测，无自动 grant。

### Task 4: 完整验证、审查与 Testing

- [x] npm ci；prisma generate/validate；tsc；npm test；disposable integration；build；git diff --check。
- [x] 本地截图、最终改动审查、逐路径核对 schema/migration 未变。
- [ ] 仅本轮变更 clean commit + push；核对 Remote SHA；Testing exact Git SHA 部署，不使用 CLI snapshot。
- [ ] 核对 Testing 来源和页面，交付修改清单/测试/截图并停止；不部署 Production。

## Execution notes

- 基线 HEAD 729dbbe1d406f5b0725e4e0e68610da2d637ce02；已在 canonical linked worktree。
- Add Branch 对所有 Admin Workspace 都降级到高级兼容入口，不按 branch 数量猜测产品模式；这是 UI policy，不是 server enforcement。
- 现有未提交 Modules 默认全开/Logout/Workspace 样式等不属于本轮新增实现；发布前必须单独隔离。
- 独立发布验证目录：D:/Dev/TetamuPOS-OneOutlet-Phase1-Verify。仅复制本轮差异，避免未审核改动进入发布。
- 审查修正：Performance 保留 inactive 历史读取；Inventory 缺省 branchId 由真实 resolver 解析；Closing 不再选择首项 fallback。复核无新的 Important。
- 最终测试与部署证据记录在 D:/Dev/TETAMU_POS_ONE_OUTLET_PHASE1_20260928.md；这里不提前勾选尚未完成的发布步骤。
- 隔离最终门槛：1730/1730 unit、276/276 disposable integration、0 skip；Prisma generate/validate、TypeScript、build PASS；222 migrations 未改。最初混合工作区的资源竞争失败已在独立串行验证中关闭，未弱化测试。
