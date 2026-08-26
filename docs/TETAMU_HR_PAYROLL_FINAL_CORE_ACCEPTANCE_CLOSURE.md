# TETAMU HR & PAYROLL — FINAL CORE ACCEPTANCE CLOSURE

> 验收日期：2026-08-26
> 环境：LOCAL / TESTING ONLY
> 验收月份：August 2026
> 时区：Asia/Kuching
> 结论：**核心 Desktop HR → Payroll 月结链路通过；完整发布仍为 CONDITIONAL PASS，因为独立 Staff App 3100 的运行版本落后于当前 workspace。**

## Readiness summary

| 能力 | 结果 | 证据 / 备注 |
| --- | --- | --- |
| Employee setup | PASS | 6 个 disposable employees，全部为整月 Active |
| Roster | PASS | August 2026 roster `PUBLISHED`，revision 1 |
| Attendance / OT / Leave facts | PASS | Monthly Timesheet 已冻结，OT、Paid Leave、Unpaid Leave 均进入 frozen input |
| Claims | PASS WITH GAP | RM120 non-wage reimbursement 进入 Payroll；`PAYROLL_SETTLED` 尚无 canonical writer |
| Commission | PASS | RM200 approved commission 只出现一次 |
| Payroll calculation | PASS | 6 个员工逐项 reconciliation 一致 |
| Payroll review / finalize | PASS | Canonical current run 已 locked/finalized |
| Payslips | PASS | 6/6 published，finalized snapshot 不可被 Draft refresh 改写 |
| Staff employee login | PASS | 3100 可用 mock OTP 登录本地 disposable employee |
| Staff frozen IA | **BLOCKED** | 3100 是旧 checkout；`Requests` / `Pay` 404，底部仍是旧导航 |
| Payment / bank settlement | NOT EXECUTED | Finalized 不代表 Paid；没有执行真实银行付款 |
| Statutory external submission | NOT EXECUTED | 没有执行 PCB/HASiL、CP39 或任何外部 statutory submission |
| Production | NOT ACCESSED | 没有部署、没有 push、没有触碰 Production |

## 1. Executive result

Desktop 的正常月结主链已经能由 HR 完成：员工资料、Roster、Attendance、OT、Leave、Claims、Commission、Timesheet lock、Payroll calculation、Review、Finalize 与 Payslip publication 均有真实 local fixture 和自动化证据。最终结论不是无条件 PASS，因为 standalone Staff App 的发布源与当前 workspace 不同步。

## 2. Workspace / environment

- Workspace：`C:\CodexTetamuP0`
- Database：local embedded PostgreSQL；fixture 脚本拒绝非 localhost database。
- Business：`Tetamu HR Acceptance Test`
- Business ID：`d917554b-9cff-4fff-8d81-898397f05cda`
- Business slug：`tetamu-hr-acceptance-test-c2ecb04e`
- Branch：Acceptance Main Branch
- 所有账号、员工、Roster、Timesheet、Payroll Run 均为 disposable local test data。
- 没有 Production access、外部 SMS、真实付款或 statutory submission。

## 3. Disposable acceptance dataset

Fixture 由 `scripts/prepare-hr-payroll-core-acceptance.ts` 建立，并写出已移除密码及 session token 的 `.tmp/hr-payroll-core-acceptance.json`。保留单一 business ID 作为清理边界；验收证据留存后可以整体 archive/delete。

## 4. Employee scenario matrix

| Employee | Scenario | Frozen result |
| --- | --- | --- |
| CORE-A | Normal monthly | Gross RM3,000.00；Net RM3,000.00 |
| CORE-B | 3 hours approved OT | OT 180 minutes；OT RM64.90；Net RM3,064.90 |
| CORE-C | 1 day approved Paid Leave | Monthly salary remains RM3,000.00；无 duplicate leave pay |
| CORE-D | 1 day approved Unpaid Leave | Deduction RM115.38；Net RM2,884.62 |
| CORE-E | Approved Claim through Payroll | Gross RM3,000.00；Net RM3,120.00；non-wage RM120 |
| CORE-F | Approved Commission | Commission RM200.00；Gross/Net RM3,200.00 |

## 5. Full supported monthly workflow

`Employee setup → Roster publish → Attendance resolution / OT approval → Leave approval → Claim approval and reimbursement channel → Commission approval → Monthly Timesheet lock → Payroll Prepare / Calculate → Review → Finalize → Frozen payroll snapshot → Payslip publication` 已完成。Payment settlement 与 external statutory submission 明确留在月结之后，不被 Finalize 冒充。

## 6. Employee setup result

6 位员工均有 business membership、primary branch assignment、monthly compensation RM3,000、26 working days、8 paid hours/day，并自 2026-01-01 起 Active。Fixture 同时创建 local employee identity/device/session 供 Staff QA 使用。

## 7. Roster result

August 2026 roster period 状态为 `PUBLISHED`，published revision 为 1。Roster 是 Attendance expected-work evidence，不直接产生工资。

## 8. Attendance result

月度 Attendance 已物化为 canonical P2 days/segments，并在 Timesheet revision 中冻结。正常出勤不会重复产生 monthly base salary；未打卡也不会被自动猜成 unpaid leave。

## 9. Attendance resolution result

Attendance resolution、branch readiness、revision invalidation 与 locked revision immutability 均由 focused integration tests 覆盖。后续修正必须产生新 revision，旧 revision 保留审计记录。

## 10. OT result

CORE-B 的 approved OT 为 180 minutes。按当前公司规则计算 RM64.90；未批准 potential OT 不会漏回 ordinary time，也不会进入 Payroll。

## 11. Leave result

CORE-C Paid Leave 保持 monthly base salary，不额外重复加薪；CORE-D Unpaid Leave 按 `RM3,000 / 26 × 1 day` 扣 RM115.38。Leave approval 与 cancellation ledger 有 immutable/idempotent integration coverage。

## 12. Claims result

CORE-E 的 RM120 claim 经 approval 后选择 Payroll reimbursement channel，并以 `VERIFIED_NON_WAGE` snapshot 进入 Payroll：不提高 gross salary，只提高 payable net amount。Claim receipt 与 tenant/employee authorization 有自动化覆盖。

## 13. Claim PAYROLL_SETTLED finding

`ClaimReimbursementStatus.PAYROLL_SETTLED` 已存在于 schema、presentation 和 cancellation guard，但当前仓库只找到读取/显示，没有找到在 Payroll Finalize 或 bank settlement 后写入该状态的 canonical transition。因此 Claim 可以进入 finalized payroll，但 UI 的最终 reimbursement lifecycle 仍不完整，不能把它误报为 bank paid。

## 14. Commission result

CORE-F 的 RM200 approved commission 通过 variable-pay bridge 进入 Payroll 一次。Commission lifecycle 测试覆盖 tenant scope、immutable approval、approved-only 和 Payroll idempotency。

## 15. Monthly Timesheet result

Timesheet ID `0037179f-b267-437d-aeba-f22a76950572`，状态 `LOCKED`。Payroll freezes exact locked revision；若有较新 locked revision，旧 Draft 会被要求 refresh，不能静默沿用 stale source。

## 16. Payroll Prepare result

Prepare 阶段成功读取 6 个 active memberships、frozen Attendance、Leave facts、approved OT、Claim snapshot 与 Commission variable pay。Desktop Payroll readiness 能把 calculation、payment 和 statutory gate 分开显示。

## 17. Payroll Calculate result

当前浏览器验证的 canonical run ID 为 `de6dd79c-576e-45af-a5dc-be8895243eca`。页面显示 August 2026、6 employees、Gross RM18,264.90、Net RM18,269.52，并标记 calculations locked。

## 18. Employee reconciliation results

6 个员工的 entry totals 与 frozen source 一致：Base RM18,000.00 + OT RM64.90 + Commission RM200.00；Claim RM120 只影响 payable net；Unpaid Leave RM115.38 只作 deduction。没有 paid-leave double count、OT double count 或 commission duplicate。

## 19. Payroll Review result

Review 页面能看到每位 employee entry、calculation snapshot、component breakdown、payslip state 与 readiness。Focused tests 验证 aggregate mismatch fail-closed、manual line preservation 与 stale Timesheet detection。

## 20. Payroll Finalize result

Payroll 已 finalized/locked。Finalize 创建 frozen statutory/calculation boundaries，但**不表示银行已经付款，也不表示外部 statutory submission 已完成**。

## 21. Payslip result

6/6 payslips 已 published，浏览器可见每位员工的 Published payslip PDF link。Published documents 使用 finalized snapshot；后续 Draft regeneration 不应重写历史 payslip。

## 22. Authenticated Employee Staff App result

在本地 3100 standalone Staff App，以 disposable CORE-A 身份和 local mock OTP 登录成功。Home 能显示 employee、business、branch、status、schedule empty state 及 Schedule/Leave/Timesheets/Claims/Commission/Payslips 快捷入口。没有发送真实 SMS。

## 23. Authenticated Manager Staff App result

`/staff/approvals` 可打开 Team Approvals，并按 Leave / Claims 分类；当前 fixture 显示 0 waiting。权限模型是 capability-based，并保留 tenant、branch、self-approval 和 stale decision guards。

## 24. 390px mobile result

已在实际 390×844 viewport 验证 login、Home、Profile 与 Team Approvals。布局可读且关键触控目标可用；但运行中的 3100 版本仍只有旧 `Home / Attendance / Profile` bottom navigation，`/staff/requests` 与 `/staff/pay` 为 404，故冻结 Staff IA 未通过。

## 25. Payment Operations result

Payment Workspace 能区分 calculation status 与 payment readiness；本轮没有建立或执行真实 bank batch。Payment P0/P2 tests 验证其为独立 payment domain，不复用 POS Payment，也没有伪造 bank adapter 或 generic CSV execution。

## 26. Bank settlement semantics

`Payroll Finalized`、`Payslip Published` 与 `Bank Paid` 是三个不同事实。目前 6 个 employee bank profiles 仍需完成，系统没有证据证明 money movement，因此结果必须保持 unpaid/not settled 语义。

## 27. Statutory internal workflow result

Fixture 的 statutory calculation 被控制为不执行真实扣缴；Payroll UI 将 statutory profile readiness 独立列出。内部 rule governance、snapshot 与 readiness architecture 可复用，但本轮没有把 external compliance 状态改成成功。

## 28. PCB / HASiL status

PCB/HASiL 不是本次 production certification。没有执行 CP39、HASiL software verification 或 LHDN submission tracking。Payroll entries 的 PCB 为 RM0.00 只能解释为 fixture 未启用 statutory calculation，不能解释为员工法定应扣为零。

## 29. Mid-period proration controlled case

Monthly employee mid-period join/termination 当前明确 fail-closed，错误为 `MID_PERIOD_PRORATION_NOT_READY` / `PRORATION_NOT_SUPPORTED`；系统不会猜测 proration。对应 unit test 已通过。

## 30. Hourly Paid Leave controlled case

Hourly Paid Leave 在没有 approved hourly leave-unit policy 时产生 `HOURLY_PAID_LEAVE_UNIT_POLICY_NOT_READY`，Payroll 不物化金额。新增 focused test 确认该路径 fail-closed；Daily Paid Leave 则已有明确 rate 并可正常计算。

## 31. Action Center / deep-link regression

Desktop `/team/approvals` 显示 Overview / Action Center 和 all-caught-up empty state。自动化验证 Action Center 只作为 read model，所有 mutation 委派到 canonical domain service；employee profile、Leave balance、Timesheet 和 Payroll links 保留目标上下文。

## 32. Browser validation

实际 browser 已检查 `/team`、`/team/time`、`/team/leave`、`/team/claims`、`/team/approvals`、current Payroll Run、3100 Staff login/Home/Profile/Approvals，以及 390×844 mobile viewport。验收结束后已恢复 browser viewport。

## 33. Automated tests

- Focused unit suite：116/116 passed。
- Broader Attendance / HR UI regression suite：104/104 passed。
- Additional controlled Payroll tests：18/18 passed（包含 mid-period proration 与 hourly paid leave fail-closed）。
- Focused integration suite：23/23 passed。
- 集成覆盖 Attendance lock/revision、Claims、Commission、Leave、P5 bridge、P6A OT 和 8-scenario HR/Payroll pilot。

## 34. TypeScript

`npm exec -- tsc --noEmit --pretty false`：PASS，0 errors。

## 35. ESLint

对 acceptance fixture、Next redirect、Staff redirect test、P5 integration test 执行 focused ESLint：PASS，0 errors / 0 warnings。

## 36. git diff --check

`git diff --check`：PASS，无 whitespace error。

## 37. Files changed

本轮验收直接新增/调整：

- `scripts/prepare-hr-payroll-core-acceptance.ts`
- `tests/integration/payroll-p5-attendance-integration.test.ts`
- `tests/unit/payroll-p5-attendance-integration.test.ts`
- `next.config.mjs`
- `.env.example`
- `tests/unit/staff-pwa.test.ts`
- `src/app/(business)/team/attendance/page.tsx`
- `tests/unit/attendance-operations-completion.test.ts`
- `docs/TETAMU_HR_PAYROLL_FINAL_CORE_ACCEPTANCE_CLOSURE.md`

Workspace 在本轮开始前已有大量 HR/Payroll 与 Staff UI 未提交改动；本报告不把那些现存改动冒充为本轮独占变更，也未覆盖或清理它们。

## 38. Remaining real gaps

1. Standalone 3100 Staff checkout (`C:\CodexTetamuP0-staff-ui`, commit `09a286b`) 落后于 current workspace (`C:\CodexTetamuP0`)；必须同步并重新验证 frozen Staff IA。
2. Claim `PAYROLL_SETTLED` 缺少 canonical writer/transition。
3. Bank profiles、payment batch 与 actual settlement 尚未完成。
4. Statutory employee profiles 与 external PCB/HASiL/CP39 lifecycle 尚未完成 production certification。
5. Hourly Paid Leave 与 monthly mid-period proration 仍为受控 fail-closed，不是已支持计算。

## 39. Deferred items

Production deploy、real bank transfer、payment provider integration、external statutory submission、真实 SMS OTP、PCB/HASiL certification、CP39、自动化 tax filing 均明确 deferred。本轮没有创建第二套生产数据，也没有删除现有用户数据。

## 40. Production status

**NOT PRODUCTION READY / NOT DEPLOYED / NOT APPROVED FOR PRODUCTION.** Desktop 核心月结可以在当前 local/testing 范围由正常 HR 完成；若把“完整支持”定义为同时包含冻结的 standalone Staff App IA、银行结算和 statutory external completion，则当前答案仍是 **NO**。完成 Staff 3100 source synchronization 后应重跑第 22–24 节 browser acceptance；完成真实 payment/statutory work 后才能重新评估 Production readiness。
