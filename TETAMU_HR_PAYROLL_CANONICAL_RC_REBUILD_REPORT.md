# TETAMU HR/Payroll Canonical RC Rebuild Report

报告日期：2026-09-16

审计 source commit：`5d0e24b48f5356d7ad2ce09e92b9e779ad61f15b`

Clean root：`71f4786c828239d4270d93afa9253e8400a8b6ad`

## 1. Executive Summary

本轮已从指定、不可变且仍与 `origin/main` 一致的 clean root 建立独立本地 RC branch，并把来源可证明、依赖边界可控制的 HR/Payroll 子集按阶段重放为 13 个小型提交。自动化代码、schema、空库迁移、单元、disposable 集成、TypeScript、lint 与 production build gate 均通过。

本轮没有批量纳入旧部署包、592 个 overlay、308 个候选或 generated/build artifacts；没有启用银行付款、政府提交或 PCB Production；没有 push、merge、PR 或部署。

但这不是完整 RC：代表性现有 schema 的 forward migration、Desktop/Staff 浏览器 smoke、1440/834/390/360 响应式人工检查未完成；Leave、Exception/Correction、Payroll Desktop/Staff 等批准范围只恢复了可独立证明的安全子集。结论因此为 `PARTIAL_RC_BLOCKED`。

## 2. Clean Root Proof

- 指定 root：`71f4786c828239d4270d93afa9253e8400a8b6ad`。
- 最终复核时 `git ls-remote origin refs/heads/main` 仍返回同一完整 SHA。
- `git merge-base --is-ancestor <clean-root> <source-commit>` 成功。
- RC source commit：`5d0e24b48f5356d7ad2ce09e92b9e779ad61f15b`。
- RC source tree：`43bde296c6318452a67a81d450e27ca61ffedc3c`。
- `git archive --format=tar` 的 SHA-256：`6f9b5ee1e8b182b28c721d240b2f76125f39777deb0f28e9deac17cb494c6164`。
- `package-lock.json` 与 clean root 的 SHA-256 均为 `a331748c12e0a2fc901fd73164fb3333ee55f389cffb9e4100149e6f7378a528`。
- `pnpm-lock.yaml` 与 clean root 的 SHA-256 均为 `3cd5d04bcdb43822588a8f4f8279c9dce1bad4c645d9f24b105ded5b3ba42cd9`。

## 3. Worktree and Branch

- Branch：`codex/hr-payroll-canonical-rc-20260916`。
- Worktree：仓库外的指定隔离目录 `worktrees/hr-payroll-canonical-rc-20260916`。
- 原 detached workspace 只作为 read-only 来源；最终复核仍保留 561 条原有 dirty entries，未清理、reset、stage、commit 或删除。
- RC worktree 未包含旧 deployment stage、数据库 dump、credentials、`.next`、`node_modules`、截图或浏览器 trace。

## 4. Baseline Verification

在任何代码重放之前，clean root 完成以下 baseline：

| Gate | 结果 |
|---|---|
| `npm ci` | PASS；保留 7 个 audit findings（6 high、1 critical），未自动改依赖 |
| Prisma validate/generate | PASS |
| TypeScript | PASS |
| Unit | 1,602 passed，0 failed，0 skipped |
| Lint | 0 errors，13 个既有 warnings |
| Build | PASS；既有 deprecation/runtime warnings 已记录 |

## 5. Source-to-RC Mapping

完整逐文件候选、来源 SHA-256、依赖、决定与目标提交见 `docs/hr-payroll-canonical-rc-source-ledger.md`，其 SHA-256 为 `70c6a377bdc38bb9a1a75f3f25bc2dd81319e93c4f1bcd948e5c050be6cc2a33`。

| Domain | 纳入内容 | 状态 |
|---|---|---|
| Schema / People classification | `UserAccountType`、`accountType`、`isTestAccount`、索引、单一 additive migration | 保留 |
| HR / People | employee-only directory、presentation、branch scope、read-only permission、responsive UI | 保留 |
| Attendance / Timesheet | effective correction projection、business filter、locked/approved write guard | 保留 |
| Leave | payroll conflict 的纯 read/projection | 仅安全子集；完整 workflow 被阻塞 |
| Payroll corrections / exceptions | access、safe DTO、纯 projection、stale presentation | 仅安全子集；read aggregation/actions/UI 被阻塞 |
| OT / Sabah work pay | company multipliers 与 fee-only zero-base 修复 | 保留 |
| RBAC | `TEAM_READ`、tenant/branch scope、Payroll route compatibility | 保留 |
| Desktop UI | People directory 与状态/筛选/空态/窄屏布局 | 仅安全子集 |
| Staff compatibility | immutable Git commit `5f9b5b5f350d6ee3670f4d989b203776e6527544` 的 8 个路径 | 完整精确重放 |

Staff 重放前后稳定 patch-id 均为 `675b872c0973dd9f44ff7139f9385fc075c462e4`；8 个目标文件逐一与 source commit blob 相同。后续只增加了独立的 clean-root compatibility 修复。

## 6. Included Files and Domains

审计 source commit 相对 clean root 共 40 个变更文件。具体 path、状态与 SHA-256 已稳定排序写入 release manifest。核心成果包括：

- People 明确区分 HUMAN/SERVICE 与 test account，不再用姓名猜测。
- People directory 只读权限不授予编辑、Payroll、bank 或系统访问变更。
- Directory 保持 business/branch scope、分页、筛选与明确 unavailable/restricted/empty states。
- Attendance 只投影 approved correction；Approved/Locked monthly Timesheet 在任何写入前 fail closed。
- Payroll exception DTO 不暴露内部敏感资料，Leave conflict projection 不回写 canonical records。
- Company work-pay 支持已审核 multiplier，fee-only worker 的 zero base 不制造工资。
- Staff session 支持活动续期、过期/撤销回登录、日期选择器与窄屏布局修复。

## 7. Excluded Files and Domains

明确未纳入：

- payment execution 页面、adapter 与发送流程；
- statutory export、submission orchestration 与 official specifications；
- PCB V4、certification、official activation 与五个未批准 migration；
- Testing-only `readiness-runtime` wrapper；
- deployment/Railway/production endpoint 脚本；
- generated evidence、截图、trace、build output、数据库或凭证；
- 未被 source ledger 接纳的其余 YES/REVIEW 候选。

完整 Leave service/UI、exception read aggregation/actions/UI、correction context 与更广的 Payroll/Staff surface 因依赖上述未批准链或缺少独立可证明来源而未强行纳入。

## 8. Commit List

从 clean root 起的有序提交：

1. `c872e913e67dbbfd37f7d66c04598d540d1ad0d0` — `docs(plan): define canonical HR payroll RC rebuild`
2. `5c00e8329326db42d11baf848936f8b12ee90510` — `docs(reconcile): bound HR payroll source replay`
3. `553156352a3c6b5d47eddb776d9da82f3236b65b` — `feat(hr): add auditable people account classification`
4. `5b36c0763681ef2cd12c8cfaf227a159693fbff1` — `docs(reconcile): admit people directory dependencies`
5. `9adb0f87ad7e8f1f0ab3cc2f7a2fc2a1bf9646c4` — `docs(reconcile): admit People month formatter dependency`
6. `4d7e7e4c1587c6514fba26c2c87350550f7a5611` — `docs(reconcile): resolve People UI dependencies`
7. `08b10f5849d27561054efb66d46ad8c2a2e8d424` — `feat(hr): restore canonical people workflows`
8. `0c1390510230c2741c787b411e3a9382beb22f5d` — `docs(reconcile): admit attendance projection dependency`
9. `aa86e91a1438d94d5ed1cc75ba8c5b0d3a7da4a3` — `feat(attendance): restore reviewed payroll time inputs`
10. `954e1b32efc2417b55d571b074a142c1a7f49803` — `feat(payroll): add controlled correction and exception workflow`
11. `0306a9c9f815fd45884d49bbf3c8fc1ae3eb9f5f` — `fix(payroll): restore reviewed company work pay rules`
12. `bb93609848205dae3e34d1a3d4801d05ceb13cf0` — `fix(staff): refresh sessions and date picker`
13. `5d0e24b48f5356d7ad2ce09e92b9e779ad61f15b` — `fix(hr): preserve payroll route and entitlement contracts`

第 13 个提交来自全量单元回归发现的 3 个 compatibility failures：恢复 `/team/payroll` 的 `PAYROLL_READ` 保护，并在新 directory 已加载时跳过旧 employee query，同时保留 clean-root entitlement contract。修复前 3 fail；修复后的目标回归为 52/52，最终 full unit 为 1,647/1,647。

## 9. Schema and Migration Results

- `prisma/schema.prisma` SHA-256：`074c1e37716709516900e82cd3cf5dfcd190ce93d220136f076084eb00a691db`。
- 新 migration：`20260915090000_people_workbench_account_classification`。
- Migration SHA-256：`15f6e9943b068ab2e8ff71a7231f2f0786ff0957aa2a3a1463e85c808caf134f`。
- Migration 仅含 additive enum/columns/indexes/backfill/default/not-null steps；未修改历史 migration。
- PostgreSQL 18.4 disposable empty database：214/214 migrations 顺序成功。
- Prisma validate 与 Prisma Client 6.19.3 generate：PASS。
- 未完成：从代表性现有 schema/data 状态执行 forward migration；这是 RC blocker。

## 10. Business Invariant Results

自动化证据已覆盖：

- Locked/Approved monthly Timesheet 在 projection/write 前阻断；
- approved correction 是 non-mutating effective projection；
- exception/stale/leave-conflict projection 保持只读与安全 DTO；
- tenant、business、branch、self-service scope 由现有 full unit/integration 回归继续约束；
- work-pay multiplier 与 fee-only zero-base 行为由 focused tests 覆盖；
- full integration 继续覆盖 Payroll/Leave/OT/cross-midnight/statutory fail-closed 的 clean-root invariants。

未建立的新证据：完整 Leave evidence freeze、完整 exception action lifecycle、全部候选 recurring/variable/correction UI 的逐项 replay 验证。

## 11. RBAC and Security Results

- `TEAM_READ` 只允许 directory 与精确 profile route，不授予 mutation。
- 普通 Staff 被拒绝；read-only actor 的 edit 与 cross-business access 被拒绝。
- `/team/payroll` 仍要求 `PAYROLL_READ`；workspace/runs/exceptions 保留各自 server-side denied-state 与 capability gate。
- Secret signature、sensitive filename、Production/network、runtime absolute-path 扫描未发现新增违规；`.env.example` 只增加无 secret 的 Staff session TTL 示例。
- 测试 diff 没有删除 assertion，也没有新增 skip/todo。

## 12. UI/UX Results

People UI 的自动化 render/source tests 覆盖：

- employee-only columns 与 readiness semantics；
- server-supplied summary、filter state 与 bounded pagination；
- test accounts 默认隐藏；
- empty、restricted、unavailable 状态；
- Desktop table 到 compact cards 的窄屏转换；
- Add employee 与 create modal 返回路径的一致性。

未完成浏览器级 1440/834/390/360 screenshot/interaction verification，因此不能把 source/render tests 等同于完整视觉验收。

## 13. Desktop and Staff Results

- Desktop production build：PASS；146/146 static pages generated。
- People directory 页面已进入 canonical team route。
- Staff immutable change 的 unit tests 与 disposable attendance route integration 均通过。
- Staff session 在 app open/foreground refresh，过期或撤销后返回登录。
- 未执行 Desktop browser smoke 或 Staff App browser smoke；没有 fixture 或 Testing 数据变更。

## 14. PCB/Bank/Statutory Restrictions

- `hasilApproval=PENDING`。
- `officialExportEligible=false`。
- `productionEligible=false`。
- Public Bank：`PUBLIC_BANK_SPEC_NOT_READY`。
- 没有真实 bank adapter、artifact submission、付款发送或 paid 标记。
- Statutory readiness 没有被当作 submission；official export 与 government submission 未启用。
- Diff 的 restricted paths、network/Production signatures 与五个未批准 migration 均未出现。

## 15. Full Verification Results

| 验证 | 最终结果 |
|---|---|
| Root/ancestry/lockfiles | PASS |
| Prisma validate/generate | PASS |
| Fresh disposable migration | PASS，214/214 |
| Focused HR/Payroll/Staff unit | PASS，93/93 |
| Compatibility regression | PASS，52/52 |
| Full unit | PASS，1,647/1,647；0 skipped/todo |
| Disposable integration | PASS，205/205 + isolated 1/1 |
| TypeScript | PASS，0 errors |
| Lint | PASS，0 errors；13 baseline warnings |
| Production build | PASS，146/146 static pages |
| Diff/secret/restricted/generated scan | PASS |
| Representative forward migration | NOT RUN — blocker |
| Desktop/Staff browser smoke | NOT RUN — blocker |
| Responsive 1440/834/390/360 | NOT RUN — blocker |

最终 lint warnings 与 clean-root 数量相同。已知 baseline observations 还包括 npm audit 7 findings、Prisma package configuration deprecation 与 Next middleware convention deprecation；本轮未做无关高风险升级。

## 16. Release Manifest

- 文件：`release-manifests/hr-payroll-canonical-rc-20260916.json`。
- Manifest SHA-256：`851ba966ef3af47fd53751eb71b12fd9d72e120fde9579161fa1762c7c124896`。
- 包含 13 个有序 source commits、40 个 included file hashes、214 个 migration names、toolchain、tests、restrictions 与未完成 gates。
- `finalRcSha` 定义为 evidence-only commit 前的审计 source commit，避免 manifest/report 自引用循环。
- Manifest 使用相对路径，不含 secret、数据库 URL 或本机绝对路径。

## 17. Human UAT Checklist

在 blockers 关闭并形成下一版 manifest 后，至少执行：

- 以 Business Owner、Payroll Admin、HR Manager、Branch Manager、Supervisor、Staff、Group Owner、Group Manager 验证 allow/deny matrix；
- 在 People 页面验证员工/测试账号隔离、分店 scope、筛选、分页、空态、错误态与 restricted state；
- 在 Desktop 1440/834 及 Mobile 390/360 检查表格/卡片、modal、焦点、键盘与横向溢出；
- 验证 Locked Timesheet、approved correction、Leave conflict 与 stale Payroll input 的可见性和 fail-closed copy；
- 验证 Staff login/session refresh/date picker/appointment/attendance 流程；
- 确认 bank、statutory、PCB actions 不可触达且不会发出网络请求。

## 18. Remaining Risks

1. 代表性现有 schema/data 的 forward migration 尚无本轮证据。
2. 完整 Leave workflow/evidence freeze 未从候选集中安全重放。
3. Exception/Correction 只有 pure projection；read aggregation、actions 与 UI 未纳入。
4. Payroll Desktop workspace 与 Staff HR/Payroll surface 尚未完成候选集逐项 reconciliation。
5. 浏览器 smoke 与四种 viewport 尚未执行。
6. Baseline dependency audit findings 与 deprecation warnings 仍存在，但未因本轮扩大。

## 19. Deployment Recommendation

保持 `deploymentStatus=NOT_DEPLOYED`。保留当前本地 commits 作为可审计安全子集；不要 push、merge 或部署。下一轮应从同一 branch 继续关闭上述工程 blockers，重新执行全部 gate、生成新的 source digest/manifest，再交人工审核与 UAT。

## 20. Final Verdict

PARTIAL_RC_BLOCKED
