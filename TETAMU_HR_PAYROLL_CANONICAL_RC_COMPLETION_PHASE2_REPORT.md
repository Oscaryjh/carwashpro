# TETAMU HR/Payroll Canonical RC Completion Phase 2 Report

报告日期：2026-09-17

Branch：`codex/hr-payroll-canonical-rc-20260916`

Clean root：`71f4786c828239d4270d93afa9253e8400a8b6ad`

原 audited source：`58890fda9141a9d0569b796e981eae9056a8ee54`

最终 canonical source：`f2553d3fcf5965b50151a52a374112ccac430417`

## 1. Executive Summary

Phase 2 current-first canonical closure 已完成。Mac 解锁后，唯一剩余的 Desktop browser、Staff browser 与 1440/834/390/360 responsive/interaction gates 已以真实浏览器关闭；浏览器发现的八个缺口全部以 focused RED/GREEN、最小独立修复和受影响 viewport rerun 完成。

最终 verdict：`READY_FOR_HUMAN_UAT`。

状态边界保持不变：

- `humanUatStatus=PENDING`
- `deploymentStatus=NOT_DEPLOYED`
- `productionEligible=false`
- PCB Production、真实银行付款、官方法定 export、政府提交继续 fail-closed

本轮未 push、merge、创建 PR、部署或修改 Railway、Testing、Production。旧 592-file overlay 没有批量重放；原 13 个 audited source commits 没有 rewrite、squash、rebase 或删除。

## 2. Continuation State and Immutability

开始执行前确认：Mac 已解锁；处于原隔离 worktree；branch 正确；`58890fda9141a9d0569b796e981eae9056a8ee54` 存在且是当前 ancestry；git status clean；Phase 1/2 commits 未改写；Railway、Testing 与 Production 没有变化。

最终 source identity：

- SHA：`f2553d3fcf5965b50151a52a374112ccac430417`
- Tree：`8d8f7cc821aaf1490c746d72be418b1211302549`
- Deterministic `git archive --format=tar` SHA-256：`1963e5a46bec9630a0b3be7f60674b6f7bfeff060a9eb8440af1c726ed1e2c82`

后续报告/Manifest evidence commit 不属于上述 source identity，不改变该 immutable SHA、tree 或 digest。

## 3. Browser Closure Commits

`58890fd` 之后保留原 evidence commit，并新增以下 focused commits：

| SHA | Subject |
|---|---|
| `b4d9076fd63b4e77df3b888dded76d030e89d621` | `docs(release): record HR payroll phase 2 evidence` |
| `becd9f0280998ea87f7a203adb7ca4d57d2d4c79` | `fix(auth): isolate password input accessible name` |
| `a239a5b36a4bebb4420fe21fbae5257ab87f10d7` | `fix(people): label avatar file input` |
| `b6f5cba39633a9c476fd6fc87e8ab66c3f615146` | `fix(payroll): contain run table at responsive widths` |
| `05c6dd49e187959df494a6443f1928612756be9a` | `fix(payroll): enlarge payment recovery link targets` |
| `15bbbd572e752ddca3e3a141077a06949400d88d` | `fix(uat): give payroll admin whole-business scope` |
| `fe15cf276ceeae1ddaf30083dd575a80151dd485` | `fix(staff): preserve employee name capitalization` |
| `44d4aa440af864a02accb061a39a92526885aada` | `fix(staff): contain date picker keyboard focus` |
| `f2553d3fcf5965b50151a52a374112ccac430417` | `fix(people): enlarge readiness detail tap targets` |

每个行为修复都有独立 commit；未混入无关 refactor。

## 4. Desktop Browser Closure

Business Owner 覆盖 People/Profile、Attendance、Timesheet、Roster、Leave/evidence、Approvals/Corrections/OT、Payroll workspace/month/run/components/reconciliation/payslip、Finalize/Reopen restricted state、Payments、Statutory 与 permission denial。

关键结论：

- Login/session/sign-out 与 field labeling 通过。
- People desktop table 在 834/390/360 转为 card；无 document-level overflow。
- Payroll run 在 834 修复前宽度 989，修复后为 834；390/360 与 viewport 等宽。
- Published payslip 后 Reopen 呈现明确 immutable/restricted 原因。
- `Finalized is not paid`、`Draft creation blocked`、bank execution unavailable。
- Statutory/PCB readiness 没有变成 export、submission 或 Production activation。
- Payroll Read 不等于 Modify/Export/Submit；URL deep link 未绕过服务端权限。

Payroll Admin、HR Manager、Branch Manager、Supervisor、Group Owner、Group Manager 均以四档 viewport 检查。Group Manager 的 payroll mutation、bank payment 与 statutory 深链每次均以 fresh login 验证，全部 fail-closed 到 `business-access-denied`。Branch Manager 只看到授权 branch；Supervisor 无 Payroll。

## 5. Staff Browser Closure

SMS123 流程通过浏览器 UI 完成：请求 code、六位 OTP 表单、验证、进入 `/staff`。SMS gateway 被本地 harness 截获，没有真实短信。使用的是安全 synthetic fixture；OTP capture 已在清理阶段删除。

Staff 通过项：

- session refresh、UI sign-out 与 session expiry；
- Attendance、GPS/clock state UI、Roster；
- Leave request/status/evidence 与 date picker；
- exception/correction status；
- August 2026 Final timesheet 与 `OT · 3 hr approved`；
- own-only Pay/Payslip、components、current/historical period；
- mobile navigation 与 deep-link denial。

Payslip own-only 使用当前 disposable session 验证：CORE-B publication 返回 200 `application/pdf`、8565 bytes；CORE-A publication 返回 404。浏览器对 attachment 新 tab 的限制没有被当成失败，也没有用 SSR 取代页面 gate；列表中的真实 Download PDF control 已通过浏览器检查，response boundary 另以同 session 验证。

## 6. Responsive and Interaction Closure

1440×900、834×1112、390×844、360×800 全部通过：

- 无 document-level 横向溢出；
- 无重要资料被不可达地截断；
- table/card 转换正确；
- modal/drawer 不超出 viewport；
- sticky action 与 bottom navigation 不遮挡内容；
- 触控目标满足本轮门槛；
- keyboard navigation、focus visible、label/input association 通过；
- loading、empty、filtered-empty、error、restricted、stale、blocked、finalized/locked 状态可区分；
- primary CTA、高风险操作原因/确认/影响说明与术语一致。

Staff date sheet 在 390/360 打开后焦点进入 `Cancel`，Tab 到 `Today` 显示 2px outline，Escape 回到触发按钮并显示 3px ring。People `2 more items` 最终为 36px 高。完整矩阵与截图 hash 见 `TETAMU_HR_PAYROLL_BROWSER_MATRIX_VIEWPORT_SUMMARY.md`。

## 7. Final Engineering Verification

| Gate | Final result |
|---|---|
| Git ancestry / source identity | PASS |
| TypeScript | PASS |
| Lint | PASS，0 errors、13 existing warnings |
| Full unit | PASS，1665/1665，0 skip/todo |
| Disposable integration | PASS，208/208 + isolated Attendance 1/1 |
| Focused HR/Payroll/Staff/security | PASS，188/188 |
| Production build | PASS，Next 16.3.5，146 routes/pages |
| Fresh migrations | PASS，214/214 |
| Safe direct avatar + Next AVIF | PASS，2/2 |
| Secret/absolute-path/generated scan | PASS；增量均为 0 |
| New skip/todo | PASS；0 |
| Weakened assertions | PASS；0 deleted、22 added |
| Desktop browser | PASS |
| Staff browser | PASS |
| 1440/834/390/360 | PASS |
| Disposable DB cleanup | PASS；同名 DB remaining=0 |
| Ephemeral token/OTP artifacts | PASS；moved to Trash |

首次 disposable integration 命令在测试开始前因浏览器 DB 占用同一 `postmaster.pid` 停止。关闭浏览器 DB 后，原命令完整重跑并通过 208/208 + 1/1；这是本地 harness 生命周期冲突，不是产品测试失败。最终日志保留了完整成功运行与数据库 shutdown。

## 8. Dependency and Security Revalidation

- `next@16.3.5`，唯一 runtime copy。
- `sharp@0.35.4`，顶层与 Next 共用唯一 copy。
- package.json、package-lock root、installed tree 完全一致。
- `sharp < 0.35.4`：0。
- Next runtime `<16.3.3`：0。
- Safe in-memory direct avatar AVIF 与 Next Image Optimization AVIF：2/2 PASS。
- Windows-only Sharp advisory 已由版本升级消除；Railway Linux 也不存在可利用的 Windows 条件。

`npm audit --json` 仍为 0 critical、5 high：

- `@eslint/eslintrc -> js-yaml`：lockfile 标记 `dev=true`，仅 lint tooling。
- `prisma -> @prisma/config -> deepmerge-ts`：lockfile 标记 `devOptional=true`，属于 Prisma build/migration CLI；Next production `.nft.json` traces 中引用数为 0。

`npm audit --omit=dev` 仍列 Prisma 三项，是 optional peer/lockfile 分类行为；实际 dependency provenance 与 production trace 均保留，不以 audit 数量代替 runtime 风险判断。Production 前仍需正式升级或风险接受，但不阻塞 Human UAT。

## 9. Restricted Features

- PCB Production：disabled；human/legal approval pending。
- Bank payment execution：disabled；没有生成真实银行付款或标记 paid。
- Official statutory export：ineligible。
- Government submission：disabled。
- Sabah/Maternity 法规内容：没有擅自激活或宣称正式合规批准。

## 10. Environment and Cleanup

- 未访问或修改 Railway deployment、variables、services 或 domains。
- 未修改 Testing/Production 数据。
- 未 push、merge、创建 PR 或部署。
- 未执行真实银行付款、官方法定提交或 PCB Production activation。
- 浏览器证据保存在 worktree 外，未加入 runtime commits。
- Browser DB 已删除；Next server 与 embedded PostgreSQL 已停止。
- local session artifact 与 OTP capture 已移入废纸篓。

## 11. Manifest V2

`release-manifests/hr-payroll-canonical-rc-20260916.json` 已更新：

- finalRcSha/tree/digest；
- 32 个有序 commits；
- 新增/变更 source file hashes；
- Desktop/Staff browser evidence；
- responsive 1440/834/390/360 evidence；
- completed/blocked verification items；
- `incompleteRequiredGates=[]`；
- `verdict=READY_FOR_HUMAN_UAT`。

Manifest 保持 `humanUatStatus=PENDING`、`deploymentStatus=NOT_DEPLOYED`、`productionEligible=false`。

## 12. Final Verdict

`READY_FOR_HUMAN_UAT`

这表示工程、安全、浏览器与响应式 gate 已通过，可以交由人工 UAT 审核；不表示已部署、已获法定批准或具备 Production eligibility。
