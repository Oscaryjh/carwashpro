# TETAMU STAFF APP — UI/UX POLISH PHASE 1

## 1. Executive Summary

Phase 1 已完成 Requests、Home、Time、Pay 与 Profile 的信息层级和移动端体验整理，并部署至 canonical Testing Staff App。

- Final verdict: `READY FOR HUMAN SMOKE`
- Environment: `LOCAL → TESTING`
- Testing URL: `https://tetamu-staff-app-testing.up.railway.app/staff/login`
- Deployment: `298b483a-975e-4e3e-9159-3d94d797fc54`
- Production touched: `NO`
- Business logic changed: `NO`
- Database changed: `NO`
- API contract changed: `ADDITIVE`（仅内部 payslip 查询读取既有 Gross / Net 字段；没有改变公开 endpoint 或既有 payload）

本阶段的目标是让已通过 UAT 的功能更容易发现和理解；它不重新定义任何 HR、Attendance、OT、Payroll 或 statutory 规则。

## 2. Scope / Business Logic Freeze

以下业务边界保持冻结且未改变：

- Attendance、GPS、Roster、Expected Day、P2、Attendance Correction
- OT derivation、Potential OT、Approve / Adjust / Reject
- Leave、Claims、Timesheet、Payroll、Payslip
- EPF、SOCSO、EIS、LINDUNG24、PCB
- Business / Branch isolation、membership scope、manager permission、self-approval protection
- Authentication、OTP 与服务端 authorization

未新增 Prisma migration、数据库字段、角色、路由体系或 approval workflow。现有 canonical routes 与服务端权限检查均保留。

## 3. Requests Before/After

### Before

- Employee self-service 与 Manager approval 入口混在同一层级。
- Leave、Claims、Attendance correction 与 OT 的发现路径不够清楚。
- OT 容易被误解为员工可以主动提交的 request。

### After

- Employee self-service 清楚显示 `Request Leave`、`Submit Claim`、`Attendance correction`。
- `Recent activity` 集中显示员工自己的近期状态。
- Manager-only 内容独立放在顶部 `Needs your approval` 区域。
- UI 明确保留 “Overtime is calculated from approved attendance”；没有 `Submit OT`。

Reason: 让员工先看到“我可以提交什么”，让 Manager 先看到“有什么等待我处理”。

Business logic impact: `NONE`。

## 4. Manager Approval UX

- Manager-capable 用户可看到合并后的 `Needs your approval` 摘要。
- Leave、Claims 与 Overtime waiting count 在一个 summary 内呈现，并保留 canonical approvals 与 overtime review 路由。
- 没有合并、绕过或重写任何 backend approval workflow。
- 普通 Employee 不会看到 Manager approval summary。
- 既有 self-approval、Business、Branch 与 permission gate 仍在服务端执行。

Business logic impact: `NONE`。

## 5. Home Before/After

### Before

- 多个模块卡片具有近似视觉权重，Clock In / Clock Out 不够突出。
- 重要日常信息与次要入口竞争首屏空间。

### After

- Attendance 主卡与 Clock action 使用更强的尺寸、层级和触控区域。
- 当前 workplace、today state 与下一步动作保持在首要位置。
- Secondary content 收敛为 `Next schedule`、`My requests`、`Latest payslip`。
- Manager approval 以紧凑入口出现，不与 Clock action 竞争。

Reason: 员工打开 Home 后可快速回答“在哪里工作、今天什么状态、现在要按什么”。

Business logic impact: `NONE`。

## 6. Time Before/After

### Before

- Roster、Attendance history、Timesheet、Overtime 与 Correction 的入口分散。
- Timesheet copy 包含 projection / revision 等技术语言。

### After

- Time 明确组织为 `Today`、`Schedule`、`Attendance history`、`Monthly timesheet & OT`。
- Attendance correction 从 Attendance context 可直接发现，并支持 hash 定位。
- Timesheet 使用 `Monthly attendance`、`Overtime`、`Final reviewed results` 等员工语言。
- Potential OT 与 Approved OT 仍分别显示，不合并成模糊数字。

Reason: 强化 Scheduled 与 Actual 的认知差异，同时降低寻找 correction 与 overtime 的成本。

Business logic impact: `NONE`。

## 7. Pay Before/After

### Before

- Latest Payslip 缺少一眼可读的 Gross / Deductions / Net 摘要。
- 员工需要先进入明细才能知道主要金额。

### After

- `/staff/pay` 的最新 payslip 摘要显示 Period、Gross、Deductions、Net Pay 与 View action。
- `/staff/payslips` 列表同样提供 Gross / Deductions / Net 摘要。
- Net Pay 使用最强视觉层级。
- 没有 published payslip 时显示清楚的 employee-facing empty state。

Reason: 首层 Pay 页面只展示员工最需要的工资结果，statutory 细项继续留在 payslip detail。

Business logic impact: `NONE`。内部查询 additive 地选择已存在的 `grossPay` 与 `netPay` 数据。

## 8. Profile Before/After

### Before

- Current workplace、switch workplace 与 session/device 信息权重接近。
- 技术性设备资料对一般员工过于突出。

### After

- `Current workplace` 清楚显示 employer 与 branch。
- `Switch workplace` 与 `Log out` 路径更直接。
- Device/security technical details 收入可展开区域，默认不干扰日常使用。
- 删除面向一般员工的权限枚举噪音，并减少 membership / projection 等技术措辞。

Reason: Profile 优先回答身份、雇主、门店、切换与登出。

Business logic impact: `NONE`。

## 9. Navigation

Canonical bottom navigation 保持五项且顺序不变：

1. Home
2. Time
3. Requests
4. Pay
5. Profile

未新增 More、Manager tab 或独立 Manager app。既有 deep links 继续有效。

## 10. Status / Empty / Error Consistency

- Request UI 使用一致、简洁的 employee-facing 状态语言。
- Requests、approvals、overtime 与 payslip 的 empty state 使用域内文案。
- Leave / Claims / Attendance / Overtime 的错误仍由各自领域呈现；没有回退成不相干的 Attendance network error。
- 本阶段没有改变 backend enum 或成功/错误结果。

## 11. Responsive Validation

Testing deployment 的实际 Staff App 页面已用浏览器渲染检查：

| Viewport | Horizontal overflow | Minimum visible interaction | Primary CTA |
| --- | --- | --- | --- |
| 375 × 844 | No | 44px | 50px |
| 390 × 844 | No | 44px | 50px |
| 430 × 844 | No | 44px | 50px |

检查包含实际部署的 Staff App shell/login、输入区、主要 CTA 与页面宽度。Authenticated Employee / Manager 页面仍列入部署后的真人 Smoke，以避免触发真实 OTP 或伪造会话。

CSS contract 同时覆盖 Phase 1 的 approval summary、clock dominance、Time navigation、Pay summary、Profile details 与 `max-width: 430px` 布局。

## 12. Accessibility Basics

- 主要控制保留清楚文字标签。
- icon-only control 继续使用 aria label。
- 状态不只依赖颜色，同时保留可读文字。
- 主要移动端交互目标达到约 44px 或以上。
- 原有 focus state、safe-area bottom padding 与 scrollable content 行为保留。

完整 accessibility audit、screen-reader flow 与真实 mobile keyboard matrix 不属于本阶段完成声明，列入 human smoke / deferred polish。

## 13. Tests

所有要求的 automated gates 均通过：

- Staff-focused UI contract: `41/41 PASS`
- Relevant Staff / Attendance / Leave / Claims / OT / Timesheet / Pay regression: `77/77 PASS`
- Attendance P2 + OT integration: `4/4 PASS`
- TypeScript (`tsc --noEmit`): `PASS`
- Changed-file ESLint: `PASS`
- `git diff --check`: `PASS`
- Next.js production build: `PASS`（142 routes generated）

新增/更新的 contract 覆盖：

- Employee Requests 不显示 Manager-only summary
- Manager Requests 显示 `Needs your approval`
- Employee 不存在 `Submit OT`
- Home 具有 dominant Clock action
- Time IA 与 correction discoverability
- Pay 显示 Gross / Deductions / Net
- Profile 显示 current workplace 并隐藏 technical details
- Bottom navigation 保持五项

没有削弱或跳过既有 business tests。

## 14. Testing Deployment

- Service: `tetamu-staff-app`
- Environment: `testing`
- Deployment ID: `298b483a-975e-4e3e-9159-3d94d797fc54`
- Deployment status: `SUCCESS`
- Health: HTTP 200, database `ready`
- Login route: HTTP 200
- Production accessed: `NO`

## 15. Human Smoke Required

Final human real-device UI smoke 仍为必要的最后验收，不需要重跑完整业务 UAT：

### Employee

- Home：workplace / shift / Clock action hierarchy
- Time：Today / Schedule / History / Timesheet & OT / Correction
- Requests：self-service / recent activity / no Submit OT
- Pay：latest Gross / Deductions / Net / View
- Profile：current workplace / switch / logout

### Manager

- Requests：`Needs your approval`
- Waiting count 与各 domain count
- 打开一个既有、非变更型 approval surface

本报告不把 automated browser shell inspection 冒充为已完成的真人 Employee / Manager smoke。

### Human Real-Device UI Smoke

- Employee result: `NOT RECORDED`
- Manager result: `NOT RECORDED`
- Mobile layout result: `NOT RECORDED`
- Final acceptance status: `BLOCKED — AWAITING HUMAN DEVICE EVIDENCE`

Testing health 与 Staff App login route 已再次只读确认为 HTTP 200，database 为 `ready`。本次对话尚未提供真实设备、OS/browser、Employee/Manager 页面结果或截图，因此不能将自动化 viewport 检查冒充 human real-device smoke。没有发送 OTP、提交请求、执行 approval、Clock In/Out 或修改任何业务资料。

## 16. Deferred P2 Polish

- 更完整的 shared StatusBadge / EmptyState / SummaryRow consolidation
- 全域 request-card spacing 与 badge 微调
- Screen reader 与 keyboard navigation 深度 audit
- 真实 iOS / Android keyboard-open form matrix
- 低优先级 motion、transition 与 visual token 统一
- 长名字、极大金额与本地化日期的扩展 visual matrix
- Manager Attendance Correction count 的统一 summary，仅在现有 canonical summary source 可安全复用时处理

以上项目未在 Phase 1 自动展开。

## 17. Final Verdict

```text
STAFF APP UI/UX POLISH PHASE 1
→ READY FOR HUMAN SMOKE
```

Phase 1 的 P1 信息层级问题已完成，自动测试、构建、Testing 部署与基础响应式渲染均通过。业务逻辑、数据库、Production 与既有 UAT 结论均未改变。最终 human real-device UI smoke 仍需执行后才可作最终 UI acceptance。
