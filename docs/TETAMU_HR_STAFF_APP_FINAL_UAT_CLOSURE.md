# TETAMU HR & STAFF APP — FINAL UAT CLOSURE

**Closure date:** 27 Aug 2026  
**Environment:** TESTING  
**Final classification:** **COMPLETE**  
**Production touched:** **NO**

## 1. Executive Summary

Tetamu HR & Staff App 的 Testing 开发、浏览器 UAT 与真实设备核心 UAT 已完成。最终闭环覆盖 OTP 登录、Business 选择、Roster、真实 Clock In/Out、Leave、Claims、Attendance Correction、OT、员工 Timesheet、Pay/Payslip、Manager Mobile Approval，以及 tenant/business/branch/self-approval 安全边界。

本次 closure 只汇总既有证据并执行只读核对，没有创建或清理 UAT 数据，没有重跑 Payroll，没有发送 OTP，没有执行付款或法定提交。2026-08-27 的 Testing 健康检查显示 Desktop 与 Staff App 的 health/login 入口均返回 HTTP 200。

最终真实设备 OT 链路已经闭环：`UAT-PAYROLL-001` 实际 Clock In/Out 后形成 P2 `PRESENT` 结果与 15 分钟 Potential OT，`EMP-005` 在 Android Staff App 审批 15 分钟，员工端随后显示 Approved、Potential 15 min、Approved 15 min。

PCB 2026 HASiL certification、外部 monitoring receiver 及 Production operations 是独立工作流，不构成本次核心 Staff App UAT blocker。

## 2. Scope

本报告包含：

- Testing Desktop HR/Payroll：`https://tetamu-pos-web-testing.up.railway.app`
- Testing Staff App：`https://tetamu-staff-app-testing.up.railway.app`
- Staff App canonical navigation：Home、Time、Requests、Pay、Profile
- Employee、Supervisor、Branch Manager、HR、Business Owner 五角色浏览器覆盖
- iPhone/Android 真实设备核心交易与审批链
- 交易最终状态、跨模块 projection、Payroll/Payslip 可见性
- tenant、business、branch、self-approval 与员工自有文件边界

不包含：Production 上线、真实付款、bank export、statutory submission、PCB 2026 HASiL certification、外部告警接收器上线。

## 3. Environment Boundary

| Boundary | Result |
| --- | --- |
| Railway Testing Desktop | PASS |
| Railway Testing Staff App | PASS |
| Testing database read-only verification | PASS |
| Production database touched | NO |
| Production deployment | NO |
| Real payment/bank export | NO |
| Statutory submission | NO |

本次只读健康检查：

| Endpoint | HTTP |
| --- | ---: |
| Staff App `/api/health` | 200 |
| Staff App `/staff/login` | 200 |
| Desktop `/api/health` | 200 |
| Desktop `/login` | 200 |

## 4. Testing Architecture

- Desktop HR/Payroll 与独立 Staff App 使用各自 Testing Railway service。
- Staff App 使用 canonical employee identity、business membership、branch assignment 与 employee session。
- 员工可拥有多个 Business membership；session 固定当前 membership、business 与 primary branch。
- Attendance 经 Punch → EmployeeAttendance → Resolution/P2 Final Result → Timesheet/Payroll 投影。
- Leave、Claims、Attendance Correction 与 OT 使用各自 canonical transaction，审批后同步到员工端结果。
- Payroll Finalize 后产生 immutable payroll record，再发布 employee-scoped Payslip。
- `/staff` on Desktop 不是 canonical Staff App；真实 Testing Staff App 只使用独立 Staff App URL。

## 5. Authentication UAT

**Result: PASS**

- Testing Staff App OTP 登录已在真实手机验证。
- 已确认手机号显示、验证码输入、自动校验、重发与更换号码界面。
- SMS provider/OTP secret 不记录在本报告。
- 多 membership 登录后按当前 Business context 建立 session，不把不同 Business 的员工资料混合。
- 本次 closure 未发送任何 OTP。

## 6. Attendance UAT

**Result: PASS**

- 真实设备 GPS Clock In 与 Clock Out 已完成。
- 2026-08-27 `UAT-PAYROLL-001` 实际记录：
  - Clock In：16:44:41 MYT
  - Clock Out：17:30:13 MYT
  - Worked：45 min
  - Break：0 min
- Clock Out 后 canonical bridge materialized P2 Final Result：
  - Final Result ID：`9320eecc-15d9-46fa-8efb-0c7ac8779bd7`
  - Disposition：`PRESENT`
  - Worked：45 min
- 原始 punch/session timestamp 保持不变，bridge 没有伪造 punch 或改写真实交易。

## 7. Roster UAT

**Result: PASS**

- Same-day roster 的 retrospective classification 会比较当前时间与 shift start，而不是把所有 same-day roster change 自动视为 retrospective。
- 在 shift start 之前，same-day future shift 仍可 materialise 为 `CURRENT WORKDAY` Expected Day。
- 到达或超过 shift start 后，则适用既有 retrospective rules。
- 真实 OT UAT roster：2026-08-27，16:50–17:20 MYT，break 0，WORKDAY。
- Roster 使用 canonical publish workflow 发布。
- Clock Out 发生于 roster end 后，系统正确产生 15 分钟 Potential OT。

## 8. Leave UAT

**Result: PASS**

真实设备提交、Manager approval、员工端同步已完成。只读 Testing 证据：

- Leave ID：`3adf4414-36e9-44cb-8c35-cc5e9cf67d0a`
- Employee：`TWILIO-OTP-QA`
- Period：27–28 Aug 2026
- Days：2
- Final status：`APPROVED`
- Reviewed：26 Aug 2026

Attachment/storage 与错误文案问题已闭环，最终业务资料保留用于审计。

## 9. Claims UAT

**Result: PASS**

真实设备提交、receipt attachment、Manager approval 与员工端结果同步已完成。只读 Testing 证据：

- Claim ID：`c10c4671-4b1e-43c4-afe3-e7a6d58130b6`
- Final status：`APPROVED`
- Submitted/approved amount：RM 12.30
- Attachment ID：`1d5fe272-922e-40c4-9e7e-90a8b0cc5f95`
- MIME：`image/png`
- Stored byte length：24,932
- SHA-256 evidence present：YES

Claim UI 已不再把 Claims 请求错误误显示为 Attendance network error；错误归属改为 claim-specific/neutral wording。

## 10. Attendance Correction UAT

**Result: PASS**

真实设备 missing clock-out correction、审批、最终 Attendance 投影与员工端显示已闭环。只读 Testing 证据：

- Employee：`TWILIO-OTP-QA`
- Work date：26 Aug 2026
- Exception ID：`1103e43b-335b-4b45-95ca-b2026eb1fa05`
- Type：`FORGOT_CLOCK_OUT`
- Final status：`APPROVED`
- Requested/adjusted Clock Out：15:37 MYT
- Adjustment ID：`9c9d31fc-ab1a-4f9a-b37d-bedf004eef86`
- Resolution Case：`eb1c4fbd-4671-413d-b838-fe14209771a6` (`RESOLVED`)
- Final Result：`82b75852-e2c9-436a-9a0a-abc9d71ad9ec`
- Source：`MANAGER_ADJUSTMENT`
- Final worked minutes：146

Mobile correction sheet 已改为可滚动、safe-area-aware 的结构，不再被底部导航遮挡。

## 11. OT UAT

**Result: PASS**

完整真实设备链：

1. `UAT-PAYROLL-001` 使用真实设备 Clock In/Out。
2. P2 生成 `PRESENT` Final Result。
3. OT review 生成 Potential 15 min。
4. `EMP-005` 在 Android `/staff/requests/overtime` 审批全部 15 min。
5. 员工 `/staff/timesheet` 显示 Approved、Potential 15 min、Approved 15 min。

只读 Testing 证据：

- OT Review ID：`0df5d5c7-0f7a-4298-aff7-3e197abc46cd`
- Status：`APPROVED`
- Potential：15 min
- Approved：15 min
- Reviewer user：`5840c06f-fd53-4d8f-8983-e70d0011f876`
- Reviewer matches `EMP-005` Staff User：YES
- Same Business：YES
- Same Branch (`salon online`)：YES

## 12. Timesheet UAT

**Result: PASS**

- 员工可以在 Staff App 查看 canonical Attendance/Timesheet 结果。
- Attendance final result、OT review 与 employee result projection 一致。
- Fresh E2E 已验证 Timesheet P2 readiness、lock 与 post-lock protection。
- 本次 closure 没有重新 lock 或修改任何 Timesheet。

## 13. Pay/Payslip UAT

**Result: PASS**

- Dedicated Testing membership：`UAT-PAYROLL-001` in `Payroll UAT Business`。
- August 2026 Payroll entry 已 Finalized。
- Basic/Gross/Net：RM 3,000.00 / RM 3,000.00 / RM 3,000.00。
- Payslip publication ID：`34993730-8dfb-4754-a32a-9594123f11a3`
- Published document bytes：2,458
- Document SHA evidence present：YES
- 员工真实设备 Pay → Payslip → View/Open 链路已作为本次 closure 的 human evidence 验收。
- Royal Salon membership 不可读取 Payroll UAT Business 的 Payslip；正确 membership 才能读取。
- 本次没有重新运行 Payroll、重新发布 Payslip、付款或提交 statutory file。

## 14. Manager Mobile Approvals

**Result: PASS**

Manager Mobile 已覆盖：

- Leave approval
- Claims approval
- Attendance Correction handling/continuity
- OT approve/adjust/reject surface

OT route：`/staff/requests/overtime`。审批动作委托 canonical service，保留 capability、Business、Branch、self-approval、lock、stale revision 与 idempotency protections。

## 15. Security / Scope

**Result: PASS**

| Control | Evidence | Result |
| --- | --- | --- |
| Tenant/business isolation | Cross-business claim and Payslip access denied | PASS |
| Branch scope | EMP-005 与 OT employee 同属 Royal Salon / salon online | PASS |
| Manager approval scope | Reviewer ID 与 EMP-005 Staff User 精确一致 | PASS |
| Self approval | Fresh E2E direct self-target returned Not Found/no action | PASS |
| Employee own-document access | Payslip publication scoped to current membership | PASS |
| Payroll immutability | Finalize and post-lock protections verified | PASS |
| Duplicate/idempotency | Fresh E2E duplicate protection verified | PASS |

## 16. Mobile UX

**Result: PASS**

- Canonical five-entry navigation：Home、Time、Requests、Pay、Profile。
- iPhone/Android 实际使用的登录、请求、审批、Timesheet 与 Pay surfaces 已验收。
- 375px、390px、430px mobile widths 的 correction form 与底部导航已回归。
- Leave/Claims/Attendance errors 使用正确 domain wording，不再显示误导性的 Attendance network error。
- OT Manager surface 提供明确的 Potential、Approved、状态和决策动作。

## 17. UAT Defects Found and Closed

| Defect | Root cause | Closure evidence | Status |
| --- | --- | --- | --- |
| Leave attachment/Testing submission failure | Testing private storage/config and generic error mapping | Controlled retest + final APPROVED leave | CLOSED |
| Claims UI displayed Attendance network error | Shared low-level fetch/error wording | Claim-specific handling + approved claim/attachment | CLOSED |
| Attendance Correction form hidden by bottom nav | Fixed navigation overlapped mobile sheet | Scrollable sheet, sticky footer, safe-area regression | CLOSED |
| Manager mobile OT action missing | No dedicated OT approval surface | `/staff/requests/overtime` + canonical approve/adjust/reject | CLOSED |
| Same-day future roster misclassified | Expected-day logic compared calendar day too early | Shift-end classification fix + real roster UAT | CLOSED |
| Clock Out did not materialize P2 result | Raw Attendance close lacked canonical P2 bridge | Bridge deployed, P2 replay, final human OT approval | CLOSED |
| Legacy/ambiguous employee result projection | Result screens did not expose final approval consistently | Employee Timesheet shows Potential/Approved 15 min | CLOSED |

**Known core UAT defects remaining: None.**

## 18. Regression Evidence

No broad suite was blindly rerun for this document-only closure. The final deployed code paths retain these latest green gates:

- Staff App final sync: Main unit 1160/1160; Staff unit 1160/1160; disposable integration 184/184 in both workspaces; TypeScript/changed-file ESLint/build PASS.
- Fresh E2E: Main unit 1130/1130; Staff unit 1160/1160; Main integration 185/185; Staff integration 184/184; TypeScript/ESLint/diff checks PASS.
- Manager OT mobile surface: targeted 16/16; Main unit 1165/1165; disposable integration 185/185; TypeScript, ESLint and production build PASS.
- Clock Out → P2 bridge: target Attendance integration 5/5; relevant Attendance/OT integration 9/9; relevant unit 19/19; full Main unit, TypeScript, ESLint, build and diff checks PASS.
- Five-role browser UAT: Employee, Supervisor, Branch Manager, HR and Business Owner all PASS.

Latest Testing Staff App deployment containing the OT surface and P2 bridge:

- Railway service：`tetamu-staff-app`
- Deployment：`85a2a023-f8df-4378-b575-3061dc8bdd56`
- Status：`SUCCESS`

本 closure 本身只新增文档；未把本地其他独立工作流的未部署修改纳入本次 UAT verdict。

## 19. Final UAT Matrix

| Domain | Browser | Real Device | Manager Approval | Employee Sync | Final |
| --- | --- | --- | --- | --- | --- |
| OTP/Login | PASS | PASS | N/A | N/A | PASS |
| Attendance | PASS | PASS | N/A | PASS | PASS |
| Roster | PASS | PASS | N/A | PASS | PASS |
| Leave | PASS | PASS | PASS | PASS | PASS |
| Claims | PASS | PASS | PASS | PASS | PASS |
| Attendance Correction | PASS | PASS | PASS | PASS | PASS |
| OT | PASS | PASS | PASS | PASS | PASS |
| Timesheet | PASS | PASS | N/A | PASS | PASS |
| Pay/Payslip | PASS | PASS | N/A | PASS | PASS |
| Business/Branch scope | PASS | PASS | PASS | PASS | PASS |

## 20. Open Separate Workstreams

这些项目与本次核心 HR/Staff App UAT 分开管理，不改变 `COMPLETE` verdict：

1. **PCB 2026 / HASiL certification** — official certification and evidence closure remains separate.
2. **External monitoring alert receiver** — operational receiver activation/delivery is a separate handover item.
3. **Production operations** — production deployment, backup/restore execution, payment, bank export and statutory submission remain out of scope.

EPF/SOCSO/EIS/LINDUNG 24 的既有 Testing statutory work不等于本次执行了真实法定提交。

## 21. Handover Boundary

| Area | Status |
| --- | --- |
| Development | COMPLETE |
| Testing | COMPLETE |
| Browser UAT | COMPLETE |
| Core Staff App real-device UAT | COMPLETE |
| Testing deployment | COMPLETE |
| Ready for handover | YES |
| Production | OUT OF SCOPE |

交接后可以进入受控 release/handover 流程；不得把本报告解读为 Production deployment approval，也不得自动启动真实 payment、bank export 或 statutory submission。

## 22. Final Verdict

```text
TETAMU HR & STAFF APP FINAL UAT
→ COMPLETE

Development
→ COMPLETE

Testing
→ COMPLETE

Core Staff App Real-Device UAT
→ COMPLETE

Testing Deployment
→ COMPLETE

Ready for Handover
→ YES

Production
→ OUT OF SCOPE
```

**Exact next step:** hand over this closure report and manifest to the release owner; continue PCB 2026, monitoring receiver and Production operations only in their separate governed workstreams.
