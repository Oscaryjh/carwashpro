# TETAMU HR/Payroll Canonical RC Completion Phase 2 Report

报告日期：2026-09-16

审计 source commit：`58890fda9141a9d0569b796e981eae9056a8ee54`

Clean root：`71f4786c828239d4270d93afa9253e8400a8b6ad`

## 1. Executive Summary

Phase 2 已在原隔离 branch/worktree 上完成 current-first engineering closure：代表性 213→214 forward migration、Leave、Exception/Correction、Payroll/Staff、定向 Next/Sharp 安全升级和除浏览器外的最终工程验证均通过。旧 592-file overlay 没有批量重放，原 13 个 audited source commits 未改写、squash、rebase 或删除。

八角色本地 SSR smoke 发现并通过 TDD 修复一个真实 Group Manager Team shell 缺口；但 Mac 始终锁屏，受控浏览器无法启动。Desktop/Staff browser smoke 与 1440/834/390/360 视觉/交互 gate 因此外部阻塞。最终 verdict 必须是 `PARTIAL_RC_BLOCKED`，不是 `READY_FOR_HUMAN_UAT`。

本轮没有 push、merge、PR、部署、Railway 变更或 Testing/Production 数据变更。

## 2. Continuation State Proof

- Branch：`codex/hr-payroll-canonical-rc-20260916`。
- Phase 1 audited source head `5d0e24b48f5356d7ad2ce09e92b9e779ad61f15b` 是最终 source commit 的 ancestor。
- 指定 clean root `71f4786c828239d4270d93afa9253e8400a8b6ad` 仍为 ancestry root。
- 最终 source tree：`30c847713abe1ea6b57f366997d357c229203f42`。
- 最终 deterministic `git archive` SHA-256：`e965a879165c073032229473e1e18ca6d5d203c8714631e350668d8ead3b40de`。
- 开发只在既有隔离 worktree 进行；原 detached workspace 未 reset、stage、清理或删除。
- Desktop Testing、Staff Testing、Production 与 Railway 均未改变。

## 3. Preserved Phase 1 Commits

13 个原 audited source commits 从 `c872e913` 至 `5d0e24b` 均按原 SHA、顺序和内容保留。其后既有 evidence commit `cc255eee` 也未改写。完整有序 SHA 列表写入 Manifest V2。

## 4. New Phase 2 Commits

| SHA | Commit |
|---|---|
| `3b8b3d49d405e6779424252acb82f82be14d3921` | `docs(plan): define HR payroll RC completion phase 2` |
| `5f20ecfe9a2b7dfd1bf31f52bf87341526a443ac` | `test(hr): verify people classification forward migration` |
| `2f7e782234f6359fba010777ec92bebae2fc1e57` | `fix(leave): distinguish projected and recorded balances` |
| `9a7aad32ee8b29e22ae1f6e6979f57f0f6ee4d4b` | `feat(attendance): restore exception and correction lifecycle` |
| `2c4f96af92ca448465d4c5d899f52aa2879cdb4b` | `feat(staff): complete eight-role self-service UAT fixture` |
| `f3b8210ea7189c8a2745e82ece979deb5daa72cd` | `test(security): cover safe AVIF image paths` |
| `c9a033bb8ca3cb214adcc38f0153e514e2b2a190` | `fix(security): upgrade Next and Sharp runtimes` |
| `d5bd0cd3b7a35bacbf69715d035d455940415640` | `fix(uat): reuse active staff device in eight-role fixture` |
| `58890fda9141a9d0569b796e981eae9056a8ee54` | `fix(auth): preserve scoped group manager workspace access` |

安全升级保持为 dependency-only 独立 commit。所有行为修复均有先失败、后通过的 focused test 或 integration/SSR 证据。

## 5. Forward Migration Evidence

在唯一命名的 localhost disposable PostgreSQL 上应用前 213 migrations，插入合成的 human/staff/service/test、multi-business、multi-branch、locked timesheet/payroll、合法重复 email/phone 边界数据，再单独应用 migration 214。

结果 1/1 PASS：row counts 不变；旧 User backfill 为 `HUMAN`，旧 membership 为非 test；新默认值正确；两列为 not-null；两个 index 存在；显式 SERVICE/test 分类可写；代表性 People/Payroll tenant-scoped join 正确；临时数据库在 `finally` 删除且 leftover 为 0。没有连接任何共享数据库。

## 6. Leave Completion

Leave focused regression 88/88 PASS，并在 full unit/integration 中复核。覆盖 type、bucket/carry-forward/half-day/reversal/custom type、审批链与 self-approval denial、document evidence status、locked Timesheet frozen evidence、Payroll 只读 frozen input、scope 和 Staff visibility。

本轮修复了“无 balance record”被错误呈现为 recorded zero 的真实缺口。Sabah rule-pack 未自动 Production activation；Maternity Allowance Eligibility 仍为 review-required，没有把工程 readiness 表述为法律批准。

## 7. Exception/Correction Completion

Exception/Correction focused regression 42/42 PASS，相关 disposable integration PASS。当前 canonical reader 聚合 attendance/OT/Leave facts，保持 bounded queries、tenant/branch/group scope、安全 DTO 与 denied zero-query。Correction 保留 reason/revision/actor/request context、maker-checker、自批禁止、stale input 和 locked fail-closed；approved correction 只影响 effective projection，raw record 不被覆盖，locked snapshot 不回读 live data。

旧 `readiness-runtime`、official statutory setup、bank execution 与 government submission 未纳入。

## 8. Payroll Desktop Completion

Payroll focused regression 119/119 PASS，production build PASS。覆盖 month/run、locked eligibility、recurring/variable/correction、component/gross/net reconciliation、OT/rest day/public holiday/cross-midnight/Sabah engineering、payslip、approve/finalize/reopen、snapshot/audit 与 restricted states。

八角色 SSR smoke 首轮暴露 Group Manager shell 先于 capability 判断被拒绝。修复后 Team shell 只选择第一个实际获准能力；每个 Payroll 页面/动作仍执行自己的精确 capability 和 module 检查，没有把 VIEW 扩成 MODIFY/EXPORT/SUBMIT。

## 9. Staff HR/Payroll Completion

Staff focused regression 308/308 PASS；Staff 的 7 条 SSR route 全部 200。覆盖 SMS123 架构、session refresh/expiry/revocation、attendance、roster、Leave、correction/OT status、timesheet、payslip、current/historical date picker、navigation 与 own-only data。

本地 fixture 重复运行时会复用 active device，不创建第二个 active device。Staff 仍不能查看他人工资、bank/statutory admin 数据或修改 locked Payroll。

## 10. RBAC Matrix

| Role | 允许范围 | 关键拒绝边界 |
|---|---|---|
| Business Owner | 全 business HR/Payroll read/write，受精确敏感权限约束 | 真实 bank/government/PCB Production 禁用 |
| Payroll Admin | 配置的 Payroll 能力 | 无 whole-business scope 时 workspace/run/payment 显式 restricted |
| HR Manager | HR、attendance、Leave、Payroll read | 不因 read 获得 export/submit |
| Branch Manager | 授权 branch HR/Leave/Attendance | Payroll deep link fail closed |
| Supervisor | 最小 Attendance/Leave read/approve | Payroll 与敏感资料拒绝 |
| Group Owner | group member business owner-equivalent read scope | restricted feature 仍禁用 |
| Group Manager | selected business 的允许 read capability | 默认无 bank/statutory/mutation；scope 外拒绝 |
| Staff | 自己的 Staff surface | 他人 payroll/bank/admin/deep-link 拒绝 |

RBAC focused 44/44（Group Manager 修复后相关 suite 16/16）与 full integration 全部通过。

## 11. UI/UX and Responsive Evidence

源码与 rendered regression 覆盖 loading、empty、filtered-empty、error、restricted、stale、source-unavailable、blocked、ready、finalized/locked、CTA 与高风险提示。SSR smoke 覆盖八角色 39 请求，但它不是浏览器证据。

Mac 两次均返回 locked，浏览器无法取得控制；因此 overflow、table/card、modal bounds、sticky action、tap target、keyboard/focus、contrast 和 1440/834/390/360 仍为 `NOT_RUN_BLOCKED_HOST_LOCKED`。详情见 `TETAMU_HR_PAYROLL_BROWSER_MATRIX_VIEWPORT_SUMMARY.md`。

## 12. Dependency Security Review

Next、`@next/env`、`eslint-config-next` 已同步到 16.3.5，Sharp 到 0.35.4。`npm ls`/`explain`/lockfile 证明无 nested `sharp < 0.35.4`、无 Next runtime `<16.3.3`，package/lock/installed 一致。安全 AVIF 2/2 与 production build 通过；Windows-only advisory 也已随升级消除。

Audit 从 1 critical + 6 high 降为 0 critical + 5 high。剩余 ESLint/js-yaml 为 dev-only；Prisma/@prisma/config/deepmerge-ts 是 build/migration CLI 链，虽可因 optional peer 出现在安装树，但没有 request-reachable import。不能仅凭 audit 数量称其 runtime blocker。完整分类见 `TETAMU_HR_PAYROLL_SECURITY_UPGRADE_SUMMARY.md`。

## 13. Full Verification

| Gate | 最终结果 |
|---|---|
| Git ancestry/log/source digest | PASS |
| Prisma validate/generate | PASS |
| Fresh migrations | PASS，214/214 |
| Representative forward migration | PASS，1/1，cleanup verified |
| TypeScript | PASS |
| Lint | PASS，0 errors、13 baseline warnings |
| Full unit | PASS，1,657/1,657，0 skip/todo |
| Disposable integration | PASS，208/208 + isolated Attendance 1/1 |
| Production build | PASS，Next 16.3.5，146 pages |
| Leave / Exception / Payroll / RBAC / Staff / restricted | PASS；分别 88、42、119、44、308、219 focused results，且由 final full suite 覆盖 |
| Safe avatar + Next AVIF | PASS，2/2 |
| Dependency tree/audit disposition | PASS for Human UAT security gate |
| Secret/absolute-path/generated/migration/assertion scans | PASS |
| Desktop browser smoke | BLOCKED_HOST_LOCKED |
| Staff browser smoke | BLOCKED_HOST_LOCKED |
| Responsive 1440/834/390/360 | BLOCKED_HOST_LOCKED |
| Disposable DB/token cleanup | PASS |
| Final RC worktree clean | PASS after evidence commit |

初次 Prisma final command 因未传 `DATABASE_URL` 失败，显式指向 localhost disposable DB 后 validate/generate PASS；初次 integration harness 与已运行的浏览器 DB 共用 `postmaster.pid`，安全停机后由原生 disposable harness 完整重跑 PASS。这两项是命令环境问题，失败证据保留，未隐瞒或计为产品通过。

## 14. Restricted Features

- PCB Production：disabled；human/legal approval pending。
- Bank payment execution：disabled；没有发送、paid 标记或真实银行 adapter 调用。
- Official statutory export：ineligible。
- Government submission：disabled；readiness 不等于 submission。
- Sabah/Maternity 法规内容：未擅自激活或宣称正式合规批准。

## 15. Manifest V2

`release-manifests/hr-payroll-canonical-rc-20260916.json` 已升级为 schema V2，记录 clean root、23 个 Phase 1/source/evidence 与 Phase 2 ordered commits、最终 source SHA/tree/archive digest、included file hashes、migration/forward migration、test、安全、browser/viewport、restricted scope 与未完成 gate。

保持：`humanUatStatus=PENDING`、`deploymentStatus=NOT_DEPLOYED`、`productionEligible=false`、`officialExportEligible=false`、PCB/bank/government disabled。

## 16. Remaining Risks

1. Desktop 与 Staff 真实浏览器 smoke 未执行。
2. 1440/834/390/360 的视觉、交互、keyboard/focus 与 overflow 仍未检查。
3. npm audit 仍报告 5 个工具链 high；当前未证明 request runtime 路径，但 Production 前仍应正式升级或批准风险接受。
4. Human UAT 尚未开始；本报告不代表 Production ready。

## 17. Human UAT Plan

先解锁 Mac，只重建本地 disposable DB/八角色 fixture，然后补 Desktop/Staff browser 与四 viewport；所有截图/trace 留在 worktree 外。发现问题必须 focused RED → 最小修复 → 对应角色/viewport 重跑 → full impacted regression。全部通过后更新 Manifest V2，才可把 verdict 改为 `READY_FOR_HUMAN_UAT` 并交人工验收。

## 18. Deployment Recommendation

继续保持 `NOT_DEPLOYED`。不要 push、merge、创建 PR、部署或修改 Railway。当前 source commits 可保留作可审计 candidate，但在浏览器与响应式 gate 完成、人工审核前不得进入 Testing/Production，也不得执行真实付款、官方导出或政府提交。

## 19. Final Verdict

`PARTIAL_RC_BLOCKED`

唯一未关闭的工程类别是受主机锁屏阻塞的 browser/responsive gate。所有非浏览器 Phase 2 gate 已完成，但强制规则禁止用 SSR、自动化 unit/integration 或“运行正常”替代真实浏览器证据。
