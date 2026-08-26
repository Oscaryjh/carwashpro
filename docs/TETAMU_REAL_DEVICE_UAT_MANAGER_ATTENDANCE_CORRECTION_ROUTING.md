# TETAMU Real Device UAT — Manager Attendance Correction Routing

## 1. Incident Summary

Testing Real Device UAT 发现 Manager 从 Staff App 的 Requests 打开 Attendance correction 时，被带到个人 Attendance History，无法进入员工更正申请的审批队列。

本轮仅修复 Staff App Manager 的 Attendance correction 导航、队列投影与移动端审批入口。没有批准、拒绝或修改任何真实考勤记录，也没有触碰 Production。

## 2. Real Android Observation

- 观察角色：Manager / Supervisor。
- 错误行为：点击 Attendance corrections 后打开 `/staff/history`。
- 实际结果：页面展示 Manager 自己的个人 Attendance History，而不是员工提交的更正申请。
- UAT 影响：Manager 无法在 Android Staff App 完成 Attendance correction 审批步骤。
- 当前状态：修复已部署至 Testing；真实 Android 最终复测仍为必需。

## 3. Current Requests Routing

旧实现位于 `src/app/staff/requests/page.tsx`，Attendance corrections 使用硬编码链接 `/staff/history`，没有区分 Employee 与 Manager。

修复后路由为：

- 有 Attendance 管理权限的 Manager：`/staff/requests/attendance-corrections`
- 普通 Employee：仍使用 `/staff/history` 查看自己的记录

角色判断使用 `canReviewAttendance`，并基于 canonical capability `MODIFY_ATTENDANCE_EMPLOYEES`。

## 4. Existing Canonical Attendance Review Flow

本轮没有创建第二套 Attendance workflow，而是复用现有 canonical 服务：

- Queue read：`loadAttendanceResolutionQueue`，位于 `src/lib/attendance/resolution-read-service.ts`
- Resolution action：`applyManagerAttendanceResolution`，位于 `src/lib/attendance/resolution-workflow-service.ts`
- Staff adapter：`getStaffAttendanceCorrectionQueue` 与 `reviewStaffAttendanceCorrection`，位于 `src/lib/staff-pwa/team-approvals.ts`
- Desktop canonical action：`src/app/(business)/team/attendance/resolutions/actions.ts`

因此 Desktop 与 Staff App 使用相同的审批规则、并发保护、scope 检查和审计流程。

## 5. Pending Request Evidence

部署后通过 Testing Desktop 的 canonical Attendance resolution queue 进行只读检查，未点击任何审批按钮。

- Employee：Twilio OTP QA Staff
- Employee code：`TWILIO-OTP-QA`
- Branch：salon online
- Attendance date：26 Aug 2026
- Issue：Forgot clock out / Attendance incomplete
- Requested clock-in：Not provided
- Requested clock-out：26 Aug 2026, 3:37 PM
- Submitted：26 Aug 2026, 3:39 PM
- Status：Pending review / `UNDER_REVIEW`
- Reason：Employee requested a missing clock-out correction.
- Pending correction / exception ID：`1103e43b-335b-4b45-95ca-b2026eb1fa05`
- Attendance session ID：安全的只读 UI projection 未公开此字段，因此本报告不猜测该值。

## 6. Manager Scope

现有 UAT fixture 关系：

- Business：Royal Salon (`611b0c19-ebf7-4548-8a48-a3b6a7af8a81`)
- Branch：salon online (`41575966-238f-46ab-a114-22bbee4949c5`)
- Employee membership：`8a32ee4a-bdef-451e-8a0d-09fc082190dc`
- Manager membership：`3ed1909b-f624-49cb-9457-efecec9e776a`
- Manager 与 Employee：相同 Business、相同授权 Branch、不同 Staff identity

Scope 结论：PASS。

## 7. Permission Model

Staff App 不以 UI 文案或角色名称决定权限，而使用 canonical capability：

- Capability：`MODIFY_ATTENDANCE_EMPLOYEES`
- Stored permission：`ATTENDANCE_EMPLOYEE_MANAGE`

UAT Manager fixture 同时具备 Attendance read/manage 权限，适合执行该员工的 Attendance correction review。

## 8. Target Route

新增 canonical mobile route：

`/staff/requests/attendance-corrections`

相关文件：

- `src/app/staff/requests/attendance-corrections/page.tsx`
- `src/app/staff/requests/attendance-corrections/actions.ts`
- `src/app/staff/requests/attendance-corrections/loading.tsx`

Leave 与 Claims 继续保留在 `/staff/approvals`，没有把 Attendance correction 强行混入原有 Leave/Claims inbox。

## 9. Queue Projection

`getStaffAttendanceCorrectionQueue` 将 Manager 的 actor context 转换为 canonical queue query：

- 限制当前 Business
- 限制 Manager 授权 Branch
- 仅显示 `UNDER_REVIEW`
- 使用 `excludedStaffUserId` 排除 Manager 自己的申请
- 保留 canonical pagination 与 queue projection

部署后的 Testing canonical queue 仍有上述 Twilio OTP QA Staff pending request。结合相同 Business/Branch 和 Manager capability，Manager queue 应包含该员工记录；真实 Android UI 显示仍需人工复测确认。

## 10. Approval Action

移动页面提供：

- Approve：`APPLY_CORRECTION`
- Return to employee：`RETURN_TO_EMPLOYEE`

提交时调用 `reviewStaffAttendanceCorrection`，再进入 canonical `applyManagerAttendanceResolution`。本轮没有执行任何 action，因此 pending request 保持不变。

## 11. Server-side Security

安全边界在服务器端执行，不依赖隐藏按钮：

- 未授权 capability：DENY
- 跨 Business：DENY
- 未授权 Branch：DENY
- Manager 审批自己的申请：DENY，canonical code 为 `SELF_RESOLUTION_FORBIDDEN`
- 非 pending / stale revision：由 canonical workflow guard 拒绝
- 客户端不能直接更新 Attendance row

## 12. Mobile UX

新增页面提供：

- Pending、empty、loading、error、unauthorized states
- Employee、Branch、日期、原考勤、申请内容、状态与提交时间
- 移动端垂直信息层级和足够触控区域
- safe-area spacing
- 375px、390px、430px 宽度下不产生设计性横向滚动

390px 静态 UI/CSS 与回归检查：PASS。真实 Android 视觉与操作结果仍需人工确认。

## 13. Fix

已完成：

1. 将 Manager Attendance correction 从错误 `/staff/history` 导向专用审批 route。
2. Employee personal history 行为保持不变。
3. 新增 Staff Manager queue/detail 页面和 server actions。
4. 复用 canonical Attendance queue 与 resolution workflow。
5. 增加 server-side self exclusion。
6. 增加 mobile states、safe area 和 responsive layout。
7. 增加 route、scope、security 与 mobile regression tests。

Runtime fix commit：`ab1a0ac fix(staff): route manager attendance corrections`

## 14. Regression

验证结果：

- Main unit suite：1167 / 1167 PASS
- TypeScript：PASS
- Targeted ESLint：PASS
- `git diff --check`：PASS
- Next production build：PASS
- Attendance data mutation：NONE
- Existing Leave/Claims approvals route：UNCHANGED
- Employee personal Attendance history：UNCHANGED

## 15. Testing Deployment

- Environment：Testing
- Service：`tetamu-staff-app`
- URL：https://tetamu-staff-app-testing.up.railway.app
- Deployment ID：`1e8f58f4-4497-4876-86d9-ac751712edba`
- Deployment status：SUCCESS / Online
- Route health check：`/staff/requests/attendance-corrections` returned HTTP 200
- Production touched：NO

## 16. Automated Queue Precheck

只读预检结果：

- Testing canonical queue reachable：YES
- Pending correction remains present：YES
- Employee：Twilio OTP QA Staff
- Branch：salon online
- Status：Pending review
- Manager business/branch relationship：PASS
- Manager canonical permission：PASS
- Staff queue uses the same canonical read service：YES
- Expected Manager queue contains Employee：YES
- Approval action backend available：YES
- Action executed during precheck：NO

限制：本轮没有发送 OTP，也没有建立新的 Manager Staff session。因此“真实 Android 页面已显示该项”不能由自动预检代替，必须由 Manager Android human retest 验证。

## 17. Human Android Retest Steps

1. 在 Android 打开 Testing Staff App：`https://tetamu-staff-app-testing.up.railway.app`。
2. 以现有 Manager / Supervisor UAT 账号登录。
3. 打开 Requests。
4. 点击 Attendance corrections。
5. 确认 URL/页面进入 Attendance corrections queue，而不是个人 Attendance History。
6. 确认列表显示 Twilio OTP QA Staff、salon online、26 Aug 2026、Pending review。
7. 打开记录并核对 requested clock-out 为 3:37 PM、submitted 为 3:39 PM。
8. 本次路由 UAT 如不准备改变数据，不要点击 Approve 或 Return。
9. 检查 390px 左右 Android viewport：无横向滚动、按钮可点击、底部 safe area 正常。

## 18. Final Verdict

**HUMAN RETEST REQUIRED**

代码修复、回归、Testing 部署和 canonical queue 只读预检均已完成。由于真实 Android Manager session 未在自动步骤中建立，也未执行审批动作，最终不能标记 Android PASS。下一步仅需按第 17 节完成人工 Android 路由与显示复测。
