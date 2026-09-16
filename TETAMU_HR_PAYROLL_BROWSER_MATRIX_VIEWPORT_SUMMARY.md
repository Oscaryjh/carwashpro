# TETAMU HR/Payroll Final Browser Matrix and Viewport Summary

报告日期：2026-09-17

Canonical source commit：`f2553d3fcf5965b50151a52a374112ccac430417`

原 audited source ancestry：`58890fda9141a9d0569b796e981eae9056a8ee54`

Browser/responsive gate：`PASS`

## 1. 结论

Mac 解锁后，Desktop 与 Staff App 的真实浏览器 smoke、八角色权限矩阵和 1440/834/390/360 viewport 检查已完成。所有在浏览器中发现的真实缺口均按“失败证据 → focused RED → 最小修复 → focused GREEN → 受影响角色/页面/viewport 重跑 → regression”关闭。

最终结果：

- Desktop browser smoke：`PASS`
- Staff browser smoke：`PASS`
- Responsive/interaction 1440/834/390/360：`PASS`
- Permission/deep-link boundary：`PASS`
- Payment/Statutory/PCB：保持 `FAIL_CLOSED`
- 未完成 browser gates：无

本轮未连接或修改 Desktop Testing、Staff Testing、Production 或 Railway；没有 push、merge、PR 或部署。

## 2. 本地隔离环境

- 原隔离 worktree 与 branch `codex/hr-payroll-canonical-rc-20260916`。
- Next 16.3.5 production build。
- 命名 disposable PostgreSQL；214/214 migrations。
- 八个 synthetic persona：Business Owner、Payroll Admin、HR Manager、Branch Manager、Supervisor、Group Owner、Group Manager、Staff。
- SMS123 使用本地安全拦截 harness；没有真实短信或 exploit payload。
- 截图、日志和测试证据全部位于 worktree 外；session token、数据库凭据和 OTP capture 未进入 Git，结束时已移入废纸篓。
- 浏览器数据库已删除并验证同名数据库剩余数为 0。

## 3. 八角色浏览器矩阵

每个列出的有效页面均在 1440×900、834×1112、390×844、360×800 检查。修复前样本保留用于审计；以下状态以对应修复后的最终 rerun 为准。

| Persona | 浏览器覆盖 | 权限重点 | 最终结果 |
|---|---|---|---|
| Business Owner | People、Employee Profile、Attendance、Timesheet、Roster、Leave、Approvals/Corrections/OT、Payroll Exceptions/detail、Payroll Overview/Workspace/Runs/Run detail/Components、Payments/Readiness、Statutory restricted | 全 business scope；高风险动作仍有状态、原因和影响说明 | PASS |
| Payroll Admin | Payroll home/workspace/run/components；payments denial；People deep-link denial | fixture 明确 `ALL_BRANCHES`；Payroll 权限不扩张为 People 或 payment execution | PASS |
| HR Manager | People/Profile/Attendance/Timesheet/Roster/Leave evidence/Payroll read-only；payments denial | Payroll Read 不等于 Modify/Export/Submit | PASS |
| Branch Manager | 授权 branch People/Profile/Attendance/Roster/Leave；Payroll deep-link denial | 仅见 `Acceptance Main Branch`，不能扩大到 scope 外 branch | PASS |
| Supervisor | People、Attendance read、Roster、Leave；Payroll deep-link denial | 无 Payroll 数据或动作 | PASS |
| Group Owner | selected business People、Payroll run、payment blocked | business owner-equivalent read scope；restricted feature 不放宽 | PASS |
| Group Manager | selected business landing；Payroll mutation、bank payment、statutory 深链分别以 fresh login 测试 | 默认无 bank/statutory/mutation；三类深链均 fail-closed 到 `business-access-denied` | PASS |
| Staff | SMS123 login、Home/GPS/clock、history、current/final timesheet、approved OT、Roster、Leave/evidence/new request、correction status、Pay/components、Payslips、Profile、mobile nav、sign-out、expiry | 仅本人资料；他人工资单 404；admin/payroll deep link 不可绕过 | PASS |

Group Owner 的一次 `/groups/<id>/overview` 探测返回 404；该 URL 不属于本轮定义的 HR/Payroll canonical surface，未作为成功证据，也不影响上述有效 Team/Payroll 页面结果。

## 4. Desktop Browser Smoke

| 检查项 | 证据结果 |
|---|---|
| Login/session/sign-out | PASS；密码输入 accessible name 与 Show password 分离 |
| People / Employee Profile | PASS；table 在窄屏转换为 card，头像 file input 有明确 accessible name |
| Attendance / Timesheet / Roster | PASS；loading、empty、locked 与 action-required 状态可区分 |
| Leave / evidence | PASS；evidence 与审批边界保持清晰 |
| Exceptions / Corrections / OT | PASS；列表、detail、stale/locked 与 reason 呈现正确 |
| Payroll workspace / month / run | PASS；August 2026 finalized snapshot 可见 |
| Components / reconciliation / payslip | PASS；component 与 gross/net 状态可读；PDF route 返回 attachment |
| Finalize / Reopen | PASS；published payslip 后显示受控 Reopen 不可用原因，没有绕过 immutable boundary |
| Payment / Statutory / PCB | PASS（fail-closed）；`Finalized is not paid`、`Draft creation blocked`、bank execution unavailable、statutory module restricted |
| Permission / deep link | PASS；Payroll Admin、HR、Branch、Supervisor、Group Manager 的拒绝边界均由服务端 route gate 执行 |

## 5. Staff Browser Smoke

| 检查项 | 证据结果 |
|---|---|
| SMS123 OTP | 浏览器请求 OTP、进入六位验证码页并提交安全 fixture，最终进入 `/staff`；无真实短信 |
| Session refresh | 连续跨 Home/Time/Requests/Pay/Profile 导航保持同一有效会话 |
| Session sign-out | UI sign-out 返回 `/staff/login?reason=logged-out` 与安全退出提示 |
| Session expiry | disposable DB 中使当前 synthetic session 过期后，复用 token 返回 `/staff/login?reason=session-expired` |
| Attendance / GPS / clock | `Ready to start your day`、schedule unavailable、Clock In 状态正确；未执行真实打卡 |
| Roster | 当前周 empty state 正确，术语为 Schedule |
| Leave / evidence / date picker | list、new request、document type、camera/upload、submit CTA 可见；未提交测试请假 |
| Exception/correction | employee correction archive 为 own-only read projection；空状态明确 |
| Approved OT / locked summary | August 2026 显示 Final、1 workday、`OT · 3 hr approved` |
| Pay / components / periods | current August 2026、gross/net、Commission、historical payslip 均可见 |
| Payslip own-only | CORE-B publication 返回 200 `application/pdf`；CORE-A publication 返回 404 |
| Mobile navigation | Home、Time、Requests、Pay、Profile 在 390/360 保持可达且不遮挡内容 |
| Deep link denial | Staff 无 manager attendance/OT review、admin payroll/bank/statutory 权限 |

## 6. Viewport 与交互结果

| Gate | 1440 | 834 | 390 | 360 |
|---|---|---|---|---|
| 全局横向溢出 | PASS | PASS | PASS | PASS |
| 重要内容截断 | PASS | PASS | PASS | PASS |
| Desktop table → mobile card | PASS | PASS | PASS | PASS |
| Modal/drawer viewport containment | PASS | PASS | PASS | PASS |
| Sticky action / bottom navigation | PASS | PASS | PASS | PASS |
| Tap target | PASS | PASS | PASS | PASS |
| Keyboard navigation / focus visible | PASS | PASS | PASS | PASS |
| Label/input association | PASS | PASS | PASS | PASS |
| Loading/empty/error/restricted/stale/blocked/finalized | PASS | PASS | PASS | PASS |

说明：窄屏 HR/Payroll 导航使用有界水平滚动，未造成 document-level overflow；这不是内容丢失。Payroll run 在 834 的 document width 为 834；People 的 readiness detail 链接最终高度为 36px。Staff 日期 sheet 在 390 与 360 均完整落于 viewport 内；打开后焦点进入 `Cancel`，Tab 到 `Today` 时显示 2px outline，Escape 后焦点回到原日期按钮并显示 3px focus ring。

## 7. 浏览器发现与独立修复

| Commit | 发现 | RED / GREEN |
|---|---|---|
| `becd9f0280998ea87f7a203adb7ca4d57d2d4c79` | Login password accessible name 与 Show password 混合 | `05` / `06` |
| `a239a5b36a4bebb4420fe21fbae5257ab87f10d7` | Employee avatar file input 无明确名称 | `07` / `08` |
| `b6f5cba39633a9c476fd6fc87e8ab66c3f615146` | Payroll run 在 834px document overflow | `09` / `10` |
| `05c6dd49e187959df494a6443f1928612756be9a` | Payment recovery link 触控高度不足 | `11` / `12` |
| `15bbbd572e752ddca3e3a141077a06949400d88d` | Payroll Admin fixture 缺 whole-business scope | `13` / `14` |
| `fe15cf276ceeae1ddaf30083dd575a80151dd485` | Staff full name 把 `OT` 误改成 `Ot` | `19` / `20` |
| `44d4aa440af864a02accb061a39a92526885aada` | Staff date sheet 未把键盘焦点移入 modal | `22` / `23` |
| `f2553d3fcf5965b50151a52a374112ccac430417` | People `2 more items` 移动触控高度仅约 15px | `27` / `28` |

所有修复均为 focused change；没有顺带重构 HR/Payroll 功能，也没有重放旧 overlay。

## 8. 最终视觉证据

证据目录位于 worktree 外。关键截图及 SHA-256：

| Artifact | SHA-256 |
|---|---|
| `30-final-people-360.png` | `f2a741687a426b2315bbdeaad72ceb5ad167828d19755340cc1579a140ace3a3` |
| `31-final-payroll-run-834.png` | `cd14c6a02c58cc99589b99b4ff6bca2a091c869d2e3025d9cbd8ed06ab969389` |
| `32-final-payment-blocked-390.png` | `81706474d8176fec634831e601785c6e2f40c39106352a1ed139dd45f499c803` |
| `33-final-staff-home-390.png` | `39cce945962efaa1cb4e27cd99677e6a11ca8c16bc195e36fa618efca8b321e4` |
| `34-final-staff-payslips-390.png` | `71759af00cc2d569fbf6fbba55cd0766414af0afa8a14aeae656e1073eb64f28` |
| `35-final-date-picker-focus-360.png` | `2ade63a587790a73993926d9d4d45b951e3ba06782e9ac15ccba9a6428690853` |
| `53-evidence-sha256.txt` | `e67b7b3fb78e15794adbc4cd41c008ccf1e25b4418fed0134ca41647ddf4b6bd` |

## 9. Final Browser Verdict

`PASS_READY_FOR_HUMAN_UAT`

Browser/responsive gate 已关闭；这不代表已经部署或完成 Human UAT。`humanUatStatus=PENDING`、`deploymentStatus=NOT_DEPLOYED`、`productionEligible=false`。
