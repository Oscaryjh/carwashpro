# TETAMU STAFF APP — PRODUCT UX AUDIT AND OPTIMIZATION REPORT

审计日期：2026-08-29  
审计对象：`C:\CodexTetamuP0`（Staff 3000，唯一 canonical Staff App）  
审计环境：Local / Testing only  
3100：未重新引入、未作为 runtime、未参与本轮实现。

## 1. FINAL PRODUCT VERDICT

**NEEDS OPTIMIZATION**

Staff 3000 已经具备可日常使用的员工端核心、清楚的五入口导航、canonical 数据边界与 capability-based manager workspace。本轮发现的明显 P1/P2 已在安全范围内修复，且完整回归通过。最终 verdict 仍不是 `GOOD`，原因是部分页面仍偏密集、实体 iPhone/Android 与键盘场景未在本轮执行、SALON Appointments 的启用态未取得 authenticated visual fixture，以及 Supervisor / Branch Manager / HR / Owner 未逐一完成独立实体设备旅程。

## 2. EXECUTIVE SUMMARY

- 普通员工的主要问题不是“缺功能”，而是 Home 快捷入口重复、系统内部术语混入员工文案，以及 Requests 与 Approval Center 的职责曾经混杂。
- Manager 的主要问题是 390px 下五个 approval filters 的最后入口不够完整、零待办 domain 仍占空间、`CANONICAL QUEUE` 等内部词不适合作为产品文案。
- Timesheet 存在一个真实读取缺陷：页面称“本月”，但 final results 与 open exceptions 查询缺少月末上界，可能把下月数据混入本月。已修复为 `[monthStart, monthEndExclusive)`。
- Home 已缩减为只保留真正的每日入口；已有底部导航归属的 Timesheets、Claims、Commission、Payslips 不再重复出现在 Home。
- Requests 现在只处理“我提交 / 我需要提交”的 Leave、Claims、Attendance corrections；manager 仅看到一个紧凑的 Team approvals 入口。
- Approval Center 保持 Leave、Claims、Attendance、OT 五域，但在手机上改为完整可见的紧凑 grid，并隐藏零待办 domain cards。
- 后端 canonical workflow、Payroll/Attendance/Leave/Claims 计算、权限、schema 与 migrations 均未被重构或削弱。

## 3. HOME

### Current

- Workplace header：当前 employer / branch 与 switch action。
- Welcome card：头像、姓名、日期、当前 attendance 状态。
- Today’s Attendance：Clock In / Clock Out、Break、shift evidence、今日统计。
- Upcoming schedule；SALON 启用且有真实 assignment 时可显示 Next appointment。
- Quick access；manager 有 capability 时显示紧凑 approval summary。

### Problems

- 旧的 expected-attendance card 使用 `published evidence`、`revision`、`source`、`will not infer` 等内部实现语言。
- Quick access 曾重复底部 Time / Requests / Pay 已拥有的 Timesheets、Claims、Commission、Payslips。
- Workplace/business/branch 在 header 与 welcome card 有轻度重复，长名称时增加视觉密度。
- Manager summary 若做成完整 queue 会污染普通员工的 daily Home；当前只应保留一个短入口。

### Changes made

- 将内部 evidence 文案改为员工可理解的 `Today’s schedule`、`Today’s shift`、`Rest day`、`Public holiday`、`Not scheduled`。
- 隐藏 revision/source 技术字段；没有 schedule 时给出明确下一步：询问 manager，而不是推断休息日。
- Home quick access 只保留 Schedule、Leave；SALON 启用时增加 Appointments。
- 两个 quick actions 使用平衡的两列布局；manager approval 保持单一紧凑入口。

### Remaining

- P2：评估是否在 welcome card 隐藏重复 branch/business，只保留最有行动价值的一层；需先用真实长 employer/branch 名称做视觉 UAT。
- P3：继续压缩 Today card 的非关键解释文字，但不能损失 schedule/attendance 差异或 location recovery。

## 4. TIME / ATTENDANCE

### Current

`Time` 是聚合入口，内部明确连接 Today、Schedule、History、Timesheet & overtime。History 提供日期、branch、status filter；missing punch 进入员工自己的 correction flow。

### Problems

- `History` 单独出现时不一定能表达它是 Attendance history。
- 一些日期使用 ISO，一些使用 `DD/MM/YYYY`，同屏仍可能混用。
- Manager attendance queue 过去可从 Requests tile 替代员工 self-service，容易让 manager 无法查看自己的 correction。

### Changes made

- Requests 的 Attendance corrections 永远指向 employee self-service `/staff/history`。
- Manager queue 仅由 Approval Center 指向 `/staff/requests/attendance-corrections`。
- 保留 Schedule = expected、Attendance = actual、Timesheet = processed/finalized 的页面解释。

### Remaining

- P2：统一所有员工可见日期为 `DD MMM YYYY` 或 `DD/MM/YYYY`，但保持 HTML/native input 的 canonical value 不变。
- P2：History filter 在仅有一个可访问 branch 时可隐藏 branch control；多 branch 员工仍应保留。

## 5. ROSTER / SCHEDULE

### Current

- 员工只读 weekly schedule，Today card、previous/next week、每日 shift/rest/leave/holiday 状态。
- 清楚区分 published schedule 与 actual attendance。
- 支持 branch、shift time、unpaid break、multiple/cross-midnight canonical evidence。

### Problems

- `Roster` 与 `Schedule` 两词在历史实现中混用。
- 每天都重复 branch/break 时会增加密度；空周内容仍可能显得长。

### Changes made

- 用户层统一使用 `Schedule`，`roster` 只保留在 route/backend 概念。
- Home 的 schedule evidence 改为员工语言，未改变 roster source 或 Attendance boundary。

### Remaining

- P2：在具有重复 branch/break 的整周中进一步采用 progressive disclosure；不可改为 HR 排班编辑器。
- 真实 cross-midnight、长 shift name、multiple shifts 的 390px visual fixture 本轮未单独执行，自动化规则仍通过。

## 6. TIMESHEET / OT

### Current

- 显示 monthly final attendance results、unresolved exceptions、Potential OT、Approved OT 与 manager decision。
- OT 是 Attendance-derived、员工只读；不存在误导性的 “Submit OT”。
- Locked monthly snapshot 与 live candidate 分开读取。

### Problems

- **P1 defect**：final results 只使用 `workDate >= monthStart`，缺少 `< monthEndExclusive`；open exceptions 也未限定月份。
- `final attendance results`、`locked` 等状态对普通员工仍偏抽象。
- 当前只有本月视图，缺少非常直观的 month context/header。

### Changes made

- final results 与 exceptions 均改为 `monthStart <= workDate < monthEndExclusive`。
- 新增 unit contract，确保两个查询都维持月份上、下界。
- Requests 的 OT copy 改为：OT 来自 approved attendance，并引导到 Timesheet & overtime 查看状态。

### Remaining

- P2：增加明确的月份标题和 “Action needed / Waiting for manager / Final” 用户层摘要；不新增 OT submission workflow。
- P2：把日期与状态卡压缩为 “结果—原因—下一步” 三层，不显示内部 snapshot/materialization 术语。

## 7. REQUESTS

### Current

- Self-service：Leave、Claims、Attendance corrections。
- Recent activity 合并显示本人 Leave / Claim / Attendance correction 状态。
- Manager 只有 capability-based `Team approvals` compact link。

### Problems

- 旧实现会让 manager 的 Attendance tile 指向 team correction queue，破坏“Requests = 我的请求”。
- OT 说明曾含 `canonical workflow` 技术语言。
- Home 也曾重复 Claims/Timesheet 等入口。

### Changes made

- 固定 self-service 与 manager workspace 边界。
- 移除 technical copy；保留一个 Team approvals 链接，不复制 queue。
- Recent activity 继续区分 Claim approval 与 reimbursement/payment 状态。

### Remaining

- P2：活动超过 12 条时可提供轻量 “View all by domain”，但不应新增总请求后台式页面。

## 8. LEAVE

### Current

- Time off landing：balance、history、status、manager note、withdrawal eligibility。
- `/staff/leave/new` 是 focused flow；leave type、From/To、自定义 iPhone-style date picker、duration、reason、document type、Take photo、Upload files、submit。
- Evidence 接受 JPG/PNG/WebP/PDF、最多 5 个、每个 10 MB，private storage。

### Problems

- 表单仍然较长，supporting evidence 区在小屏会推迟 submit 的可见性。
- Policy snapshot 名称可能偏长；员工未必理解 company policy suffix。
- 错误若来自 roster 未 ready，需要解释是 schedule evidence 未完成，而不是暗示员工无排班。

### Changes made

- 本轮没有削弱 leave rules 或 evidence requirement。
- 390px/412px 验证无横向溢出；date buttons、camera/file inputs、submit 均真实存在。

### Remaining

- P2：按 selected leave type 决定 evidence section 的强调级别；optional 时保持收起/次要。
- P2：用短 display name + “Paid/Unpaid” badge，完整 policy name 放 secondary line。
- 实体 iOS camera picker、Android file picker、软键盘遮挡本轮 **NOT EXECUTED**。

## 9. CLAIMS

### Current

- 三步 wizard：Expense → Details → Review。
- General 与 Mileage 共用 canonical validation；Mileage 显示 rate 和 estimated reimbursement。
- Receipt requirement 来自 category；支持 JPG/PNG/WebP/PDF 10 MB private upload。
- History 保留 Submitted、Approved、Reimbursed/Added to payroll 等不同语义。

### Problems

- Receipt requirement 要进入第二步才完整出现；员工可能在第一步不知道所选 category 是否必须上传。
- `No category limit` 等规则可再更靠近 amount input。
- History detail 对长 description/manager note 仍偏密。

### Changes made

- 未改变 canonical amount、category、receipt、mileage、approval、payment validation。
- 390px 验证 Step 1 与 history 无横向溢出；三步设计避免一次塞满长表单。

### Remaining

- P2：选择 category 后立即在第一步显示 “Receipt required/optional”。
- P2：提交成功后提供清楚的 confirmation summary，而非只依赖 history 刷新。
- 实体 camera/file/keyboard UAT **NOT EXECUTED**。

## 10. PAY / COMMISSION / PAYSLIP

### Current

- Pay hub 显示 latest available payslip 的 Gross、Deductions、Net pay。
- Payslips 与 Commission 是 Pay 的两个二级入口；员工只读 published documents/statements。
- 不暴露 Payroll run、statutory、payment batch、HR administration。

### Problems

- `Published` 是正确边界，但反复出现会偏系统化。
- Commission 与 salary 的关系仍可用更明确的 secondary copy 表达。

### Changes made

- Home 不再重复 Commission/Payslips；统一从 Pay 进入。

### Remaining

- P2：UI 首选 `Available payslip` / `Not available yet`，把 publication boundary 保留在解释文案。
- P2：Commission 明确标为独立 statement，不暗示已进入本月薪资。

## 11. APPROVAL CENTER

### Current

- Capability-based domains：All、Leave、Claims、Attendance、OT。
- Pending count、员工、请求类型、日期/金额/时长、evidence、approve/reject/adjust/reason 均由 canonical domain workflow 提供。
- Branch scope、self-review、stale revision、locked timesheet 与 payment boundary 均保留。

### Problems

- 390px 的五 filters 旧布局让后面的 Attendance/OT 不够完整可见。
- `CANONICAL QUEUE`、`authorized workplace scope` 是内部语言。
- All tab 会为 0-pending domain 生成大 card，降低扫描速度。

### Changes made

- 390px 以下使用三列 compact grid，五 filters 全部可见。
- 标题改为 `Review requests from your team.`；内部 queue label 改为 `TIME RECORDS` / `OVERTIME`。
- 只有 pending count > 0 才显示 Attendance/OT domain cards；正确处理 All/domain empty state。

### Remaining

- P2：在 detail 首屏固定回答 Who / What / When / Amount or duration / Why；长 evidence 再展开。
- 实体设备上的长员工名、长拒绝理由、并发 stale interaction 本轮未做手动 mutation，自动安全测试通过。

## 12. PROFILE / WORKPLACE

### Current

- Profile：avatar、current workplace、employment details、verified device、折叠的 Device activity、Sign out。
- Workplace switch 的主要入口只有全局 header；Profile 不再复制 switcher。
- `/staff/device` 保留 compatibility route，但不作为主导航入口。

### Problems

- Current workplace 与 header 有必要的 context 重复，但不能再增加第三个 switch 入口。
- Device 术语可能让普通员工误以为是安全设置中心。

### Changes made

- 保持一个 primary switch location；device metadata 默认折叠。
- 390px 验证 avatar upload、长 profile card 与 navigation 无横向溢出。

### Remaining

- P2：Device activity 使用 “This phone” / “Signed in” 等用户语言；technical identifiers 继续隐藏。
- 实体 Android/iPhone avatar capture/resize/upload 本轮未执行。

## 13. APPOINTMENTS

### Current

- 仅 SALON entitlement 可进入；普通员工只看到自己 membership-linked assigned appointments。
- 日历支持 selected date、previous/next、week strip；显示 time、customer name、service、duration、status、branch、conflict warning。
- 不显示 phone、private notes 或其他员工 appointments。
- Home 只有当天存在 next appointment 时显示卡；无 appointment 时不展示空卡。

### Problems

- 本轮 authenticated business 未启用 SALON，因此启用态视觉 UAT无法现场执行。
- Appointments 同时属于 Time active prefix 与 Home conditional quick access，需保持 entry consistency。

### Changes made

- 未增加固定 bottom tab；SALON 启用时由 Home quick access 与 next appointment 提供 discoverability。

### Remaining

- P2：用 SALON fixture 补做 390px week/date/long service/conflict visual UAT。
- Privacy、assignment scope、timezone 与 empty state 自动测试通过。

## 14. MOBILE 390PX

### Executed

- In-app browser 设置为 390×844；页面有效宽度约 391 CSS px。
- Authenticated employee：Home、Time/History、Schedule、Timesheet、Requests、Leave、Leave New、Claims、Pay、Commission、Payslips、Profile。
- Authenticated manager：Home、Requests、Approval Center filters/queue。
- 412×915 responsive check：Home、Time、Requests、Pay、Leave New；所有页面 `scrollWidth === innerWidth`。

### Results

- 未发现 document horizontal overflow。
- Bottom nav 五项完整；Approval filters 修复后五项完整可见。
- Leave New date/file/camera controls 与 buttons 均可访问。
- 44px touch target、安全区、bottom-nav padding 有自动化覆盖。

### Not executed

- Physical iPhone/Android、Safari/Chrome PWA standalone、软键盘遮挡、真实 camera/file picker、慢网/离线、旋转与系统超大字体。
- 因此本报告不声称 physical-device PASS。

## 15. INFORMATION ARCHITECTURE

### Accepted primary model

1. Home = 今天要做什么。
2. Time = Schedule、actual Attendance、History、Timesheet/OT。
3. Requests = 我提交或需要补交的事项。
4. Pay = 我的薪资文件与 commission statement。
5. Profile = 我的身份、workplace、device 与 sign out。
6. Approval Center = 仅有 capability 的 manager workspace；不是普通员工第六个 bottom tab。

### Findings

- 五入口结构正确，不建议重新设计 bottom navigation。
- Quick access 应作为条件型 shortcut，不能复制整套导航。
- Manager functionality 通过一个 compact entry 进入独立 workspace，不能嵌入 employee request tiles。
- Compatibility routes 可保留，但不应成为 visible duplicate navigation。

## 16. TERMINOLOGY

| Canonical user term | Meaning | Avoid in employee UI |
|---|---|---|
| Schedule | 预计何时、哪间店上班 | Roster（仅 route/backend） |
| Attendance | 实际打卡与出勤 | Punch pipeline / P2 |
| Timesheet | 已处理的月度工作记录 | Final result / snapshot / materialization |
| Overtime / OT | 加班结果与审批状态 | 自助 Submit OT |
| Leave | 休假申请与余额 | Leave resolution |
| Claims | 报销申请 | Expense engine internals |
| Pay | 员工可见的薪资入口 | Payroll administration |
| Payslip | 可查看的薪资单 | Publication artifact |
| Approvals | 替他人审核的事项 | Canonical queue |
| Attendance correction | 补正缺失打卡 | Resolution case |

页面标题可保留 `Time` 作为 hub，但详细页应明确 `Attendance history`、`Schedule`、`Timesheet & overtime`。

## 17. ROLE-AWARE UX

- **Normal Staff**：只见 self data、daily actions、own requests/pay/profile；不见 approval queue、HR controls、Payroll admin 或 branch-wide employees。
- **Supervisor / Branch Manager**：只有具备相应 capability 且在 allowed branch scope 内，才显示 Team approvals / Approval Center domain。
- **HR**：Staff App 仍以本人体验为主；HR administration 留在 canonical desktop HR surfaces。
- **Payroll Admin / Business Owner**：Staff App 不暴露 payroll run/statutory/payment administration；若同时拥有 review capability，只增加相应 Approval Center domain。
- 实际 visibility 来自 `canDirectStaff(...)`、module entitlement、business/branch scope 与 employee membership；未使用 `roleName === "Manager"` 作为授权。
- 本轮互动浏览覆盖 Employee 与 Manager Employee；其他 persona 的 capability/source/test audit 通过，但未逐一完成独立实体设备旅程。

## 18. P0 ISSUES

**无未解决 P0。**

未发现跨 tenant 数据暴露、普通员工看到 manager/Payroll admin、危险误导的 pay status、无法完成核心 Clock action 或 390px 完全不可用的阻断问题。

## 19. P1 ISSUES

| Issue | Current behavior / impact | Persona | Resolution | Backend impact | Risk |
|---|---|---|---|---|---|
| Monthly Timesheet leaked later-month rows | “本月”可能显示下月 final result / exception | Staff | 已加 month end exclusive boundary | Read filter only | Low |
| Manager queue replaced employee correction entry | Manager 无法从 Requests 明确查看自己的 correction | Manager employee | Requests 固定 self-service；queue 只在 Approval Center | None | Low |
| Approval filters clipped / internal copy | Manager 难找到 Attendance/OT，看到系统词 | Manager | 3-column mobile grid + user copy | None | Low |
| Schedule evidence used technical language | Staff 无法判断今天是否要做什么 | All staff | 改为 Today’s schedule + explicit next action | None | Low |

以上 P1 已全部修复，无剩余 open P1。

## 20. P2 ISSUES

### Fixed

- Home redundant quick actions：已移除 Timesheets、Claims、Commission、Payslips。
- Approval Center zero-pending domain cards：已隐藏。
- OT technical copy：已改为 employee-friendly explanation。

### Remaining

- Home header / welcome workplace 信息轻度重复。
- Timesheet 需要更明确的月份与 “Action needed / Final” 摘要。
- Leave/Claims evidence requirement 可更早、更渐进地显示。
- 单一 branch 时 History branch filter 可条件隐藏。
- Pay 的 `published`、Profile 的 device copy 可继续简化。
- Appointments 启用态、physical devices、keyboard/large text 尚未完成。

这些项目需要真实 fixture/device evidence，不应在没有证据时做 broad redesign。

## 21. CHANGES IMPLEMENTED

- `src/components/staff-pwa/staff-today.tsx`：员工化 schedule copy、隐藏 revision/source、明确无 schedule 下一步。
- `src/lib/staff-pwa/home.ts`：Home quick access 去重。
- `src/components/staff-pwa/staff-home-overview.tsx`：两项 quick access 平衡布局。
- `src/app/staff/staff-consolidation.css`：two-item grid responsive styling。
- `src/app/staff/requests/page.tsx`：self-service / manager approval 分离，OT copy 简化。
- `src/app/staff/approvals/page.tsx`：manager copy、zero-card、empty state 简化。
- `src/app/staff/staff.css`：390px approval filter grid。
- `src/lib/attendance/employee-timesheet.ts`：monthly results/exceptions 上、下界修复。
- `tests/unit/staff-pwa.test.ts`、`tests/unit/staff-mobile-team-approvals.test.ts`、`tests/unit/staff-mobile-attendance-corrections.test.ts`：更新并加强产品/月份/IA contract。

没有新增 migration、model、role、permission、approval state 或 domain workflow。

## 22. CHANGES DEFERRED

- 不重做五入口 navigation。
- 不新增独立 OT request。
- 不删除 compatibility routes（如 `/staff/device`）。
- 不改变 Payroll、Attendance、Leave、Claims 计算或法律规则。
- 不把 Staff App 变成 HR admin。
- 不在缺少 SALON authenticated fixture 时重做 Appointments。
- 不把 remaining P2 通过增加更多页面、菜单或设置来解决。
- 不执行 Production deployment/data mutation。

## 23. TEST RESULTS

| Gate | Result |
|---|---|
| Unit | **1323 / 1323 PASS**（baseline 1322 + 1 monthly boundary contract） |
| Integration | **199 / 199 protected disposable PASS**；isolated Attendance route flow **1 / 1 PASS** |
| Staff/security | **91 / 91 PASS** |
| TypeScript | `npx tsc --noEmit` **PASS** |
| ESLint | **PASS**，0 errors；3 个与本轮无关的既有 warnings |
| Prisma | schema validate **PASS**；canonical local DB **212 / 212 migrations applied** |
| Build | `npm run build` **PASS**；Next 16.3.0 webpack production build，全部 canonical `/staff` routes 编译成功 |
| Runtime | 本地 `https://localhost:3000/staff/login` **HTTP 200**；title `Employee sign in · Tetamu Staff App`；`/staff/manifest.webmanifest` **HTTP 200** |

额外证据：targeted P1 contracts **42 / 42 PASS**；390/412 responsive UAT 无横向 overflow。测试使用 Local embedded/disposable PostgreSQL；没有使用 Production DB。

## 24. FINAL RECOMMENDED STAFF APP STRUCTURE

```text
Staff App
├─ Home
│  ├─ Today / Clock In / Clock Out / Break
│  ├─ Today’s schedule
│  ├─ Next appointment (SALON + only when present)
│  ├─ Upcoming schedule
│  ├─ Quick access: Appointments? / Schedule / Leave
│  └─ Needs my approval (capability only, compact)
├─ Time
│  ├─ Today / current attendance
│  ├─ Schedule
│  ├─ Attendance history
│  ├─ Missing punch / attendance correction (self)
│  └─ Timesheet & overtime
├─ Requests
│  ├─ Leave
│  ├─ Claims
│  ├─ Attendance corrections (self)
│  └─ Recent request status
├─ Pay
│  ├─ Latest pay summary
│  ├─ Payslips
│  └─ Commission statements
├─ Profile
│  ├─ Avatar / employment
│  ├─ Current workplace
│  ├─ Device activity (collapsed)
│  └─ Sign out
└─ Approval Center (capability-only secondary workspace)
   ├─ Leave
   ├─ Claims
   ├─ Attendance
   └─ OT
```

核心规则：bottom navigation 维持 **Home / Time / Requests / Pay / Profile**；Approval Center 不是普通员工 tab；Schedule 与 Leave 可作为 Home 日常 shortcut；不重复 Timesheet/Claims/Commission/Payslips。

## 25. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮未部署、未读取或写入 Production、未修改 Production environment、未执行真实支付/法定提交。所有 browser UAT、fixture、migration status、build 与 runtime smoke 均在本地 canonical Staff 3000 环境完成。

