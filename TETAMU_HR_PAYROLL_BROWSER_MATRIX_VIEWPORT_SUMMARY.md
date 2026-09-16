# TETAMU HR/Payroll Phase 2 Browser Matrix and Viewport Summary

报告日期：2026-09-16

审计 source commit：`58890fda9141a9d0569b796e981eae9056a8ee54`

## 结论

真实浏览器矩阵未完成，gate 状态为 `BLOCKED_HOST_LOCKED`。两次系统级浏览器连接均返回 Mac 已锁定且自动解锁失败；因此不能把下述 HTTP SSR 冒烟测试当作 Desktop/Staff browser UAT，也不能声称 1440/834/390/360 viewport 通过。

这项未完成 gate 是本轮不能输出 `READY_FOR_HUMAN_UAT` 的直接原因。

## 本地隔离环境

- 最终 Next 16.3.5 production build，localhost 端口 3106。
- 独立、可删除的 PostgreSQL 数据库，214/214 migrations。
- 只使用合成 HR/Payroll 数据与八个精确 persona：Business Owner、Payroll Admin、HR Manager、Branch Manager、Supervisor、Group Owner、Group Manager、Staff。
- 未读取或修改 Desktop Testing、Staff Testing、Production 或 Railway。
- 本地 session token 未加入 Git；结束时数据库与 token artifact 均删除。

## 非浏览器 SSR 补充证据

39 个 authenticated SSR route requests 已执行。这只能证明 server rendering、session、redirect 与明显 restricted state，不能证明 DOM interaction、CSS overflow、keyboard/focus、modal、sticky action、tap target 或视觉对比度。

| Persona | 请求 | HTTP 200 | 预期 redirect | 明确 restricted marker |
|---|---:|---:|---:|---:|
| Business Owner | 6 | 6 | 0 | 0 |
| Payroll Admin | 5 | 5 | 0 | 3 |
| HR Manager | 5 | 4 | 1 | 0 |
| Branch Manager | 4 | 2 | 2 | 0 |
| Supervisor | 4 | 2 | 2 | 0 |
| Group Owner | 4 | 4 | 0 | 0 |
| Group Manager | 4 | 4 | 0 | 0 |
| Staff | 7 | 7 | 0 | 0 |

Payroll Admin 的三个 restricted markers 来自其缺少 whole-business scope 的 workspace/runs/payment 边界；Branch Manager 与 Supervisor 的 Payroll deep link 回到允许的 Team surface。付款创建仍显示 restricted，而不是执行。Group Manager 的第一轮全部被 Team shell 误拒绝；失败证据触发 TDD 修复 `58890fd`，复测 Team、Attendance、Leave、Payroll read surface 均可达，子页面/动作仍保留精确 capability gate。

## Browser 与 viewport 状态

| Gate | 1440 | 834 | 390 | 360 | 状态 |
|---|---|---|---|---|---|
| Desktop People/Profile/Attendance/Timesheet/Leave/Payroll/Exceptions/Payslip | 未执行 | 未执行 | 未执行 | 未执行 | BLOCKED_HOST_LOCKED |
| Staff Login/refresh/Attendance/Roster/Leave/Exception/OT/Timesheet/Payslip/date/sign-out | 未执行 | 未执行 | 未执行 | 未执行 | BLOCKED_HOST_LOCKED |
| overflow/table-card/modal/sticky/tap/focus/contrast/state copy | 未执行 | 未执行 | 未执行 | 未执行 | BLOCKED_HOST_LOCKED |

## 解锁后续跑清单

1. 重新建立 disposable DB 与同一八角色 fixture。
2. 用最终 source SHA 启动 production build。
3. 完成 Desktop 和 Staff 全路由 smoke、sign-out、denied/restricted 状态。
4. 在 1440/834/390/360 检查 overflow、table/card、modal、sticky action、tap target、keyboard/focus、主 CTA、状态区分与术语一致性。
5. 截图与 trace 仅写入 worktree 外证据目录，计算 SHA-256；发现问题必须先写 focused RED test，再最小修复与重跑。
6. 只有全部通过，才能把 Manifest V2 的 browser/responsive gate 改为 PASS 并输出 `READY_FOR_HUMAN_UAT`。
