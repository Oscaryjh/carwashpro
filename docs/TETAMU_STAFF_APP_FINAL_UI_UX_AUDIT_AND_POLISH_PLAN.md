# TETAMU STAFF APP — FINAL UI/UX AUDIT & POLISH PLAN

**Audit date:** 29 Aug 2026  
**Environment:** Testing only  
**Canonical Staff App:** `https://tetamu-staff-app-testing.up.railway.app/staff/login`  
**Final classification:** **AUDIT COMPLETE — POLISH PLAN READY**  
**Code changed:** NO  
**Testing data changed:** NO  
**Deployment:** NO  
**Production touched:** NO

## 1. Executive Summary

Tetamu Staff App 的核心业务流程已通过 Browser UAT 与真实设备 UAT，本轮审计没有发现会导致错误操作、跨 Business 暴露、审批遗漏或正常流程阻断的 P0 问题。Canonical 五入口导航 `Home / Time / Requests / Pay / Profile` 清楚、移动优先、触控尺寸合格，375px、390px 与 430px 均有防横向溢出和 safe-area 处理。

当前主要问题不是功能缺失，而是信息架构与表达层仍有六个明显摩擦点：Manager 审批入口分散；Requests 同时承载员工申请与部分管理审批但文案仍写成 “My Requests”；Home 的打卡动作与大量证据卡竞争；Time 的 Roster、Attendance、Timesheet、Correction 分散；Pay 缺少可快速扫描的最新工资单摘要；Profile 暴露过多设备和内部能力信息。

建议只做低风险 presentation polish：统一审批入口和组件、压缩 Home、为 Time 提供清楚的入口层级、把技术词汇换成普通员工语言、改善空状态/错误/成功反馈。不要修改 Attendance、Roster、OT、Leave、Claims、Timesheet、Payroll、权限或 tenant/branch isolation。

**Finding count:** P0 = 0、P1 = 6、P2 = 9。

## 2. Scope

### 审计边界

- 页面：Home、Time、Requests、Manager Approvals、Leave、Claims、Attendance Correction、Overtime、Pay、Payslips、Commission、Profile、Business switching、Auth 和 module/error/loading states。
- 角色：Employee、Supervisor/Manager、Branch Manager、Business Owner using Staff App。
- Viewport：375px、390px、430px portrait；同时检查 small Android、iPhone safe area 与较大现代手机布局规则。
- 维度：信息层级、导航、视觉密度、触控、状态语言、空/错/成功状态、响应式、可访问性基础、组件一致性、真实任务完成速度。

### 证据方法

1. 对 Testing Staff App 登录页进行真实浏览器只读检查；375/390/430 均检查 viewport、document width 与交互控件尺寸，没有输入手机号、没有发送 OTP。
2. 审阅 canonical Staff App route、React component、CSS responsive/safe-area contract 与现有测试契约。
3. 复用已完成的真实设备证据 `docs/TETAMU_HR_STAFF_APP_FINAL_UAT_CLOSURE.md`；其中 Login、Roster、Leave、Claims、Correction、OT、Timesheet、Pay/Payslip 与 Manager approval 均为 PASS。
4. 本轮没有重新提交申请、审批、打卡、下载工资单或改变任何 Testing data。

### Route inventory

| Route | Role | Purpose | Main action | Main data | UX status |
|---|---|---|---|---|---|
| `/staff/login` | All | 手机登录 | Request verification code | Phone | PASS |
| `/staff/verify` | All | 验证 OTP | Verify / resend / change number | OTP、masked phone、expiry | PASS |
| `/staff/select-workplace` | Multi-business user | 选择当前雇主 | Select workplace | Business、Branch、employee code | PASS |
| `/staff` | Employee + Manager | Today/Home | Clock In/Out、进入员工/经理任务 | Today、shift、Attendance、pending summary | NEEDS POLISH |
| `/staff/history` | Employee | Attendance history / correction entry | Filter、request correction | Punch/session、approval status | NEEDS POLISH |
| `/staff/roster` | Employee | 查看排班 | Browse week | Workday/rest/PH/leave schedule | PASS WITH COPY POLISH |
| `/staff/timesheet` | Employee | 查看月度结果、OT 与异常 | Review result / correction | Final day result、potential/approved OT | NEEDS POLISH |
| `/staff/requests` | Employee + Manager | Requests hub | Open Leave/Claims/OT review | Domain summary | NEEDS POLISH |
| `/staff/leave` | Employee | 申请及追踪 Leave | Submit / withdraw / evidence | Balance、policy、dates、status | NEEDS POLISH |
| `/staff/claims` | Employee | 申请及追踪 Claims | Submit / withdraw / receipt | Category、amount、receipt、status | NEEDS POLISH |
| `/staff/approvals` | Manager roles | Leave/Claims inbox | Filter / open item | Pending counts、employee、age | NEEDS POLISH |
| `/staff/approvals/[domain]/[requestId]` | Manager roles | Leave/Claims review | Approve / Reject | Facts、balance、receipt/evidence | PASS WITH CONSISTENCY POLISH |
| `/staff/requests/overtime` | Manager roles | OT review queue | Open review | Schedule、actual、potential OT | NEEDS POLISH |
| `/staff/requests/overtime/[finalResultId]` | Manager roles | OT decision | Approve / Adjust / Reject | Potential/approved minutes、reason | NEEDS POLISH |
| `/staff/pay` | Employee | Pay hub | Open payslips / commission | Availability summaries | NEEDS POLISH |
| `/staff/payslips` | Employee | Published payslips | Download PDF | Payroll month、published date | NEEDS POLISH |
| `/staff/commission` | Employee | Commission statements | Read status | Period、amount、status | PASS WITH COPY POLISH |
| `/staff/profile` | All | Identity/workplace/device/logout | Switch workplace / sign out | Identity、employment、device | NEEDS POLISH |
| `/staff/device` | All | Verified-device return surface | Continue in profile | Same profile/device data | NEEDS POLISH |
| `/staff/module-not-enabled` | All | Entitlement boundary | Return Home/Profile | Module availability | NEEDS COPY POLISH |

## 3. Navigation Audit

**Result: NEEDS POLISH**

底部导航固定为 Home、Time、Requests、Pay、Profile，没有 More tab；每项同时有 icon、文字和 `aria-current`，active state 清楚。CSS 提供 54px nav item、safe-area bottom padding、最大 520px 宽度与固定底部 clearance，符合移动端基础要求。

问题在于二级 IA：Time 实际分散为 History、Roster、Timesheet；Manager 的 Leave/Claims 审批在 Home 的 Team Approvals，而 OT review 在 Requests。用户知道“功能存在”，但不一定知道“去哪里找”。建议保留五入口，只在 Requests 内增加 role-aware 的 `My requests / Team approvals` 清楚分组，并让 Time 首屏作为三类记录的统一入口，不新增 tab。

角色建议：

- Employee：Requests 首先显示自己的 Leave、Claims、Correction 状态。
- Supervisor/Manager：同页增加明显的 Team approvals section 与总 badge。
- Branch Manager/Owner：同一结构，但只显示 canonical scope 内的数量与 Business/Branch context。

## 4. Home

**Result: NEEDS POLISH**

Today 状态、Business/Branch、Clock action、break/GPS/exception、expected Attendance evidence、pending request summaries 和 manager approval entry 均可用。Clock In/Out 受 canonical confirmation、location 与 retry states 保护。

但 Home 同时组合 `StaffHomeOverview` 与超过 1,000 行状态组合的 `StaffToday`。员工可能先看到多个同等权重卡片，再找到主打卡动作；Manager 还会多一张 Team Approvals 卡，页面长度继续增加。`Today's published evidence / Revision / Source` 属于审计证据，不应和首要动作同级。

建议将首屏固定为：Today status → dominant Clock action → next shift / current shift → urgent action。证据、GPS detail、revision/source 放入 `View attendance details` progressive disclosure。Manager approval card 放在员工核心卡之后，但在普通 shortcut 之前。

## 5. Time

**Result: NEEDS POLISH**

Roster 与 actual Attendance 已有正确区分；Timesheet 能显示 Potential OT 与 Approved OT；Correction 不会直接改 raw punch。业务含义正确。

主要摩擦是入口与术语：History 提供通用 correction 表单，Timesheet 也在异常结果内提供 correction；员工需要理解 Roster、History、Timesheet 三个独立页面。首页又包含 Today Attendance，信息层级重复。建议 Time hub 首屏使用三个紧凑入口：`Today's attendance`、`Schedule`、`Monthly record`，Correction 作为有异常时的 contextual CTA，同时保留 History 的备用入口。

默认首屏不要展开大量历史记录；先显示今日结果与本月摘要，再由用户打开完整记录。

## 6. Requests

**Result: NEEDS POLISH**

Leave 与 Claims 对 Employee 合理；OT 明确是 Attendance-derived manager review，没有错误地提供 Employee OT request。

当前 heading 是 `MY REQUESTS` 和 “Start a request…”，但 Manager 同页会看到 Overtime review card。Leave/Claims team approvals 却在独立 `/staff/approvals`，造成“Manager approvals 有两个入口、但只一个入口叫 Requests”的割裂。建议 Requests 页用角色感知分组：

1. `My requests`：Leave、Claims、Attendance correction。
2. `Team approvals`：Leave、Claims、Attendance correction、Overtime，显示总数和分域数量。

这只是导航和 presentation 组合，不改变审批 service 或 permission scope。

## 7. Manager Approvals

**Result: NEEDS POLISH**

Leave/Claims inbox 的 tab、count、request age、详情、Approve/Reject 结构清楚；OT 详情也能显示 scheduled/actual/potential，Approve/Adjust/Reject 可达。Self-approval、Business/Branch scope、stale revision 和 lock protections 均由 backend 保持。

不一致点：Leave/Claims 使用 shared approval row/detail/form；OT 使用另一套 header、facts、action disclosure；Attendance Correction 又使用 resolution case pattern。审批者会看到不同的卡片 anatomy、返回方式、status chips 和 reason interaction。

建议复用一个视觉 contract：employee + request type + submitted/derived time + key amount/minutes + status + primary action；详情页统一 back link、facts、evidence、decision footer。OT 保留 Adjust 的独特业务动作，但外壳一致。

## 8. Leave

**Result: NEEDS POLISH**

Balance、entitlement、pending/approved usage、policy、日期、half day、reason、supporting evidence、withdraw 和 status 均存在。Manager 详情也显示决定后余额，业务资料足够。

问题是 balance card 的多个相近数字容易让普通员工误读；`entitlement / pending / remaining / after decision` 应建立清楚主次。申请表一次呈现 policy、date、duration、reason、evidence 时偏长。建议突出 `Available now`，其他数字作为 breakdown；在 date/duration 选择后即时显示 `This request uses X day(s); balance after approval Y`。保留所有 policy gate，不自动猜 paid/unpaid。

## 9. Claims

**Result: NEEDS POLISH**

三步提交（details → receipt → review）、category limit、mileage estimate、10MB upload guidance、review card 与历史详情已提供良好提交信心；Claim-specific errors 已取代过去误导性的 Attendance network error。

仍可改善：file input 是浏览器原生控件，选择后只有文件名，图片/PDF 缺少统一 preview affordance；历史 status 与 reimbursement status 被压成单一 label，员工不一定知道 “Approved” 后还在等 payroll/direct payment。建议显示 `Approval` 与 `Payment` 两阶段，不改变 reimbursement state；上传后显示文件类型、名称、remove/replace action 和可用 preview。

## 10. Attendance Correction

**Result: NEEDS POLISH**

当前 correction 支持 requested time、reason、current session context、manager review、final result；既有 scrollable body、safe-area、底部导航/overlay 修复必须保留。

摩擦来自入口重复和上下文不完整：History 顶部可打开通用 correction，而 Timesheet 仅在异常日显示 contextual form。通用表单要求用户选择 session/branch，认知成本较高。建议优先从具体异常日进入，自动带入 date/current punch，只让员工填写 proposed time + reason；通用入口保留为 `Can't find the attendance record?` 后备路径。

成功文案应说 “Sent to your manager” 和预计在哪里查看，而不是强调 “raw punch was not changed”。

## 11. Overtime

**Result: NEEDS POLISH**

Potential ≠ Approved 已被明确说明；scheduled time、actual time、potential minutes、approved minutes、reason 与 status 均可见。Manager 主 Approve 可达，Adjust/Reject 通过 progressive disclosure，不会误导 Employee 发起 OT request。

主要剩余问题是详情暴露 `Review revision`、`Timesheet revision` 与 `final result`；这些是 concurrency/audit implementation detail。建议对普通 Manager 隐藏，仅在 support/debug detail 中保留。主信息顺序固定为 `Why this exists → schedule vs actual → potential → decision`。

## 12. Pay

**Result: NEEDS POLISH**

Pay hub 正确分开 Published Payslips 与 Commission；员工只能读取当前 membership 下已发布的文档，privacy boundary 正确。

Payslip list 目前主要显示 payroll month、published date 和 `Download PDF`。普通员工无法在列表快速确认 gross、deductions、net，也没有强烈突出最新工资单。建议第一张卡显示 `Latest payslip`、period、Net Pay 为主数，Gross/Deductions 为次级摘要，并使用 `View payslip` 主动作、`Download PDF` 次动作。若现有 list query 没有摘要字段，实施阶段先评估是否已有 projection；不要为 UI 直接重新计算 Payroll。

## 13. Profile

**Result: NEEDS POLISH**

Employee identity、phone、employment、current Business/Branch、multi-workplace switch、device verified state 与 Sign out 均可用。

Profile 暴露 employee code、Platform、Browser、First verified、Last active、`Can view`、`Can punch` 和 `Employee Session`。这些技术资料挤占普通员工最常用的 contact/workplace/logout 信息。建议默认只显示 identity、current workplace、contact、employment 与 sign out；device/security 资料放入折叠的 `Device & security`。内部 membership/session/capability 词汇改为 `You can use Staff App` / `Attendance access` 等普通语言。

## 14. Business Switching

**Result: PASS**

Header 始终显示 current Business 和 primary Branch；多 workplace 时才可打开 switcher，单 workplace 时不会假装可切换。选择列表含 Business、Branch、employee code、current state，切换中有 assertive overlay，失败不会静默改变 session。

建议只做轻量 copy polish：切换确认中明确 “You are switching from A to B”；完成后显示短暂成功反馈。不要改变 session security、membership selection 或 current business isolation。

## 15. Status Language

**Result: NEEDS POLISH**

建议建立跨域但不改变 domain meaning 的展示词汇：

| Meaning | Preferred display | Avoid on primary UI |
|---|---|---|
| Waiting for manager | Pending review | Waiting / Pending 混用 |
| Accepted | Approved | Approved · frozen（可放 detail） |
| Declined | Rejected | Raw enum `REJECTED` |
| Employee must act | Action needed | Response needed / Needs attention 混用 |
| Attendance complete | Completed | Shift done / final result 混用 |
| Payroll document available | Published | Locked（除非解释其含义） |
| OT not decided | Potential overtime | Pending OT / OT request |
| Directly changed decision | Adjusted and approved | Adjusted 单独出现 |

Status 必须同时用文字，不只依赖颜色。Technical values 可留在 data/audit layer，不直接展示 raw enum。

## 16. Empty States

**Result: NEEDS POLISH**

| State | Current quality | Recommended copy/action |
|---|---|---|
| No roster | 准确但 “not automatically an Off Day” 偏防御性 | `No shift scheduled for this day. Check with your manager if you expected one.` |
| No attendance | 有 filter explanation | 增加 `Clear filters`；今日无记录时解释是否正常 |
| No requests | 基础可用 | 提供 Leave / Claim 两个 next actions |
| No claims | 清楚 | 保留；若没有 category，直接 `Contact HR` |
| No leave | 基础可用 | 提供 `Apply for leave` 并显示可用余额 |
| No OT waiting | 业务准确 | Manager 显示 `Nothing needs review`; Employee 不显示审批语气 |
| No payslips | 准确 | 增加 `Payslips appear after Payroll publishes them`；无需联系 HR 除非 overdue |
| No approvals | 清楚 | 按 scope 说明 `No Leave or Claim approvals in your current workplace` |

## 17. Error States

**Result: NEEDS POLISH**

优点：global、Payslip、OT、Claims、Leave、Attendance 均有 role=alert；关键 error 通常说明没有数据/决定被改变，并提供 Try again。过去 Claims 误显示 Attendance error 的问题已关闭。

剩余问题：部分 client component 直接显示 backend `Error.message`，可能产生不一致或技术词；`MODULE_NOT_ENABLED` 直接显示内部 code；offline 只依据 `navigator.onLine`，应继续把真实 fetch error 当作 source of truth。建议统一 error mapper：domain heading + safe explanation + next action + support reference（可选），不要显示 Prisma、revision、canonical、module key。

## 18. Success Feedback

**Result: NEEDS POLISH**

Clock actions、Leave、Claims、Correction 和 approvals 均有 success 状态或 redirect message；关键 mutation 不会无反馈。

建议统一规则：

- 原地操作：inline success banner，自动保留到下一次用户操作，避免 toast + banner 重复。
- Redirect 后：目标页顶部显示一次明确结果，例如 `Leave request sent for review`。
- Clock In/Out：confirmation 后让主 status 直接变为 Working/Completed；无需再叠加第二个成功卡。
- Download Payslip：浏览器下载不需要成功 toast；失败才显示可重试提示。
- Approve/Reject/Adjust：返回 queue 后显示 employee + action + amount/minutes，避免只写 generic “recorded”。

## 19. Mobile Layout

**Result: PASS WITH POLISH**

Shell 使用 `100dvh`、独立纵向滚动、safe-area padding、fixed bottom nav clearance 与 `overflow-x: hidden/clip`。Correction/resolution 在 <=420px 变为单列，approval facts 在 <=430px 变为单列，Payslip CTA 在 <=440px stack，Roster week controls 在 <=430px 重排。既有 bottom-sheet/body/footer 修复必须保留。

长页面仍是主要成本：Home、Profile、Leave、Claims history 与 Timesheet 可能需要多屏滚动。建议用 progressive disclosure 和紧凑 summary，不引入 nested scroll。键盘打开时，表单 CTA 不应固定遮住 input；现有 modal/sheet 改动必须继续验证 iOS visual viewport。

## 20. Responsive Widths

**Result: PASS**

| Width | Live/source evidence | Horizontal overflow | Touch size | Result |
|---|---|---|---|---|
| 375px | Testing login 实际 viewport 约 376px；document/client/body width 相同 | None | Link 44px、input 48px、CTA 50px | PASS |
| 390px | Testing login 实际 viewport 391px；document/client/body width 相同 | None | Link 44px、input 48px、CTA 50px | PASS |
| 430px | Testing login 实际 viewport 430px；document/client/body width 相同 | None | Link 44px、input 48px、CTA 50px | PASS |

Protected screens 的 375/390/430 correction form 与 bottom nav 已在 final real-device/browser UAT closure 标记 PASS。Source contracts 对 approval、OT、Roster、Profile、Payslip 分别提供 <=420/430/440px stacking。后续 polish 必须对 card copy wrapping、status pill wrapping 和 keyboard overlap 做截图回归，但当前没有证据支持列为 P0。

## 21. Accessibility Basics

**Result: PASS WITH POLISH**

已具备：导航 label、`aria-current`、dialog `aria-modal`、OTP 每位 input label、alert/status live semantics、loading `aria-busy`、文字化 status、44–54px 主要触控目标、reduced-motion rule。

需改善：CSS 对 form input 有 focus ring，但多数 link/button 未见统一 `:focus-visible`；部分 icon/chevron link 依赖 surrounding card meaning；10–11px metadata 在小屏和低视力环境偏小；低对比 muted copy 尚未做完整 WCAG 量测。本轮不宣称 WCAG certification。建议统一 keyboard focus token、把关键 metadata 提升到至少 12px，并为所有 icon-only action 提供可见 tooltip/`aria-label`。

## 22. Component Consistency

**Result: NEEDS POLISH**

可复用候选（本轮不重构）：

- `StaffStatusChip`：统一 pending/approved/rejected/action-needed/published。
- `StaffRequestCard`：Employee request 与 Manager approval 使用相同 identity/status/meta skeleton。
- `StaffApprovalDetail`：Leave/Claims/Correction/OT 共享 header、facts、evidence、decision footer。
- `StaffEmptyState` / `StaffErrorState` / `StaffSuccessBanner`：统一图标、标题、解释、CTA。
- `StaffMoneySummary`：Claims、Commission、Payslip 使用一致 RM formatting 和主次数字。
- `StaffAttendanceRow`：Roster、History、Timesheet 共享 date/time/status anatomy，但保持 planned vs actual 标签。

视觉 token 已大致统一（teal、19–24px radius、white card、soft background），但 module CSS 与 global Staff CSS 并存，按钮、badge、empty state 和 card radius 仍有不同实现。

## 23. Real-World Task Evaluation

| User task | Rating | Evidence / friction |
|---|---|---|
| Employee Clock In under 5 seconds | ACCEPTABLE | Home 有主动作，但首屏卡片密度可能分散注意力 |
| Find today's roster under 10 seconds | ACCEPTABLE | Time → Roster 可达；Time 子入口层级不够统一 |
| Submit Leave without explanation | ACCEPTABLE | 字段完整；balance/policy 数字偏多 |
| Check Claim status quickly | EASY | History card直接显示 category/date/amount/status |
| See Approved OT clearly | ACCEPTABLE | Potential/Approved 清楚，但 Timesheet/OT 页面术语偏技术 |
| Open latest Payslip quickly | FRICTION | Pay → Payslips 两层，list 不突出 latest/net pay |
| Manager see pending approvals quickly | FRICTION | Home Leave/Claims 与 Requests OT 分散 |
| Manager approve Leave/Claim/OT | ACCEPTABLE | 每项操作可用，但跨 domain anatomy 不一致 |
| Switch Business with confidence | EASY | Header context、current marker、blocking overlay 清楚 |

## 24. P0 Findings

**Count: 0**

没有发现可合理归类为 P0 的问题。核心 UAT 已通过；没有证据显示当前 UI 会导致跨 Business/Branch 操作、self-approval、错误付款、错误 OT 决定或 workflow block。不得为了 redesign 人为制造 P0。

## 25. P1 Findings

**Count: 6**

| ID | Current problem | Why it matters | Recommended change | Risk | Effort | Priority |
|---|---|---|---|---|---|---|
| P1-01 | Manager Leave/Claims approvals 在 Home，OT review 在 Requests | 审批者可能漏看某一 domain，无法一眼知道总待办 | Requests 增加统一 Team approvals section 与总/分域 count；仍调用原 routes/services | Medium：active-state 与权限显示需回归 | M | P1 |
| P1-02 | Requests 标题为 `MY REQUESTS`，但 Manager 同页出现 OT review | 页面职责与文案不一致，Employee 与 Manager 心智模型混合 | 分成 `My requests` 和 role-aware `Team approvals`；不新增 Employee OT submit | Low | S | P1 |
| P1-03 | Home 将 Clock、Attendance evidence、GPS、exception、shortcuts、manager alert 同级堆叠 | 首要动作不够 3 秒可辨，页面过长 | 首屏只保留 Today/Clock/urgent；revision/source/detail 折叠；shortcuts 下移 | Medium：不能隐藏关键 action/evidence | M | P1 |
| P1-04 | Time 分散在 Home Today、History、Roster、Timesheet；Correction 有两个入口 | 员工难区分 planned vs actual 和从哪里修正 | Time hub 统一 `Today / Schedule / Monthly record`；异常日提供 contextual correction | Medium：导航与 deep-link 回归 | M | P1 |
| P1-05 | Payslip list 不突出 latest，也不显示 gross/deductions/net 摘要 | 员工必须打开 PDF 才能确认本月实领，Pay 价值不够直观 | 最新卡突出 Net Pay；Gross/Deductions 次级；View 主、Download 次 | Medium：只能复用已发布 projection，禁止重算 | M | P1 |
| P1-06 | Profile 默认展示 device/session/capability 与内部 employee code | 普通用户被技术信息淹没，重要 workplace/contact 变弱 | Device & security 折叠；默认保留 identity/workplace/contact/employment/logout | Low | S | P1 |

## 26. P2 Findings

**Count: 9**

| ID | Current problem | Why it matters | Recommended change | Risk | Effort | Priority |
|---|---|---|---|---|---|---|
| P2-01 | UI 暴露 Revision、Source、raw punch、final result、MODULE_NOT_ENABLED | 增加训练成本，也可能暴露 implementation vocabulary | 主 UI 改为 Schedule source、Original attendance、Completed result、Feature unavailable；技术值放 support detail | Low | S | P2 |
| P2-02 | 部分 empty state 只说明“没有”，未给 next action | 用户不知道正常与否或下一步 | 统一三段式：what it means / normal? / next action | Low | S | P2 |
| P2-03 | 部分 client error 直接显示 backend message，module page 显示内部 code | 文案不一致，极端情况下可能技术化 | domain error mapper + safe message + retry/contact action | Medium：不能吞掉 actionable domain reason | M | P2 |
| P2-04 | Success feedback 在 inline、redirect query、status change 之间不统一 | 用户可能看到重复信息或不知道是否完成 | 建立 mutation feedback contract；原地 banner、redirect one-shot、status as source of truth | Low | S | P2 |
| P2-05 | Pending/Waiting/Under review/Response needed 与 Shift done/Completed 混用 | 同一含义多种词，降低扫描速度 | 使用 Section 15 vocabulary；保留 domain-specific Potential OT | Low | S | P2 |
| P2-06 | Leave/Claims、Correction、OT 使用不同 approval card/detail/action pattern | Manager 跨 domain 学习成本高 | 统一视觉壳与 CTA hierarchy，保留不同业务字段/Adjust action | Medium：避免错误抽象业务动作 | M | P2 |
| P2-07 | No roster copy 使用 “not automatically an Off Day”等防御性句子 | 正确但不自然，员工仍不知道要做什么 | 用 plain-language empty state + manager contact guidance | Low | XS | P2 |
| P2-08 | Loading pattern 在 global/Payslip/Approval/OT 与 Leave/Claims client fetch 不完全一致 | 弱网时页面可能先空白再跳内容，产生 layout shift | 统一 section skeleton 或 stable loading card；不阻断 cached content | Low | S | P2 |
| P2-09 | Input 有 focus ring，但 button/link 未见统一 focus-visible；部分 metadata 仅 10–11px | 键盘/辅助使用者和低视力用户较难辨认 | 增加全局 focus-visible token；关键 metadata >=12px；icon-only action均有 label | Low | S | P2 |

## 27. Recommended Polish Plan

### Phase A — IA clarity

1. 统一 Requests 内的 My requests 与 Team approvals；保留原 route/service/permission。
2. 将 Home 压缩为 Today + primary Clock + urgent actions；技术证据进入 detail。
3. 为 Time 建立清楚入口结构，并让异常日直接进入 correction。

### Phase B — Employee comprehension

1. Payslip list 提升 latest/net pay 可扫描性，只读取 frozen published data。
2. Profile 将 device/security 放入 disclosure。
3. 应用统一 status vocabulary 和 plain-language terminology。

### Phase C — Consistency polish

1. 对 approval、empty/error/success、money/status 组件建立共享 presentation contract。
2. 统一 loading skeleton、focus-visible、metadata size 和 mobile copy wrapping。
3. 对 375/390/430 做 screenshot regression；重点检查 keyboard、safe area、bottom nav 与 long names。

### Acceptance guardrails

- 不改变任何业务 status、permission、scope、calculation 或 canonical mutation path。
- 不添加 Employee OT request。
- 不添加 More tab 或复杂 dashboard。
- 所有摘要数字必须来自现有 authoritative projection，不能在 UI 重新计算。
- 每个 phase 单独回归 Employee 与 Manager；Business Owner 只能看到授权 scope。

## 28. Suggested Implementation Order

1. **Requests / Manager Approvals IA**：先消除漏审批风险和角色混淆。
2. **Home primary action hierarchy**：让 Clock/Todays status 在 3 秒内可见。
3. **Time hub / Correction discoverability**：统一 planned、actual、monthly result 心智模型。
4. **Pay latest payslip summary**：提升最重要敏感资料的可扫描性，同时保持 frozen data source。
5. **Profile progressive disclosure**：隐藏非必要 technical detail。
6. **Vocabulary + empty/error/success states**：一次建立 copy matrix，避免逐页漂移。
7. **Shared presentation components**：只在页面行为稳定后抽取，避免过早抽象。
8. **375/390/430 visual/accessibility regression**：最后验证 long names、large text、keyboard、safe area、touch targets。

每一步先做 source/UI unit tests，再做 authenticated Testing browser read-only checks；只有确需验证 mutation 时才使用隔离 UAT fixture，不能复用 Production 数据。

## 29. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| 合并审批入口时误改 permission/scope | 高 | 只组合 presentation links/counts；继续调用原 canonical services；增加 role/business/branch tests |
| Home 压缩后隐藏关键 Attendance evidence | 高 | 证据保留在显眼 detail，不删除；异常/action-needed 永远不折叠 |
| Pay summary 在 UI 重算而偏离 finalized Payroll | 高 | 只读取 published immutable projection；缺字段时先扩展安全 read model，不重算 |
| 抽象统一 approval component 抹平 domain 差异 | 中 | 只共享外壳和视觉层；Leave balance、Claim receipt、OT adjust 保持专属 |
| Copy 简化导致法律/政策语义变化 | 中 | 由 domain owner 核对 display label；backend enum 与 audit wording不变 |
| Fixed bottom nav、keyboard、sheet 回归 | 中 | 375/390/430 + iOS/Android visual viewport regression；保留 safe-area rules |
| Offline 状态误判 | 中 | `navigator.onLine` 仅作提示；真实 request failure 才决定 action result |
| 多 Business 用户在 polish 后失去 context | 高 | current Business/Branch 始终留在 header；任何 mutation 前后保持 membership scope |

## 30. Final Verdict

```text
TETAMU STAFF APP FINAL UI/UX AUDIT
→ AUDIT COMPLETE

POLISH PLAN
→ READY

CORE BUSINESS LOGIC
→ CHANGE NOT REQUIRED

P0
→ 0

P1
→ 6

P2
→ 9

375px / 390px / 430px
→ PASS

READY FOR HANDOVER
→ YES

PRODUCTION
→ NOT ACCESSED
```

最终建议是进行有限、分阶段、可回滚的 presentation polish。Tetamu Staff App 不需要重写，也不需要新的业务流程；它需要更清楚的审批入口、更强的首要动作层级、更少的技术词汇和更一致的移动组件。
