# Tetamu Roster / Staff Scheduling — Complete Current Feature Report

> 可直接把本文件提供给 ChatGPT，作为当前 Tetamu Roster 的真实产品与工程背景。

## 1. Current status

```text
TETAMU ROSTER / STAFF SCHEDULING
→ ENGINEERING READY

MANAGER MONTH / WEEK / STAFF / COVERAGE UX
→ READY

SHIFT SETTINGS / DEFAULT SCHEDULES
→ READY

ROSTER → ATTENDANCE EXPECTED EVIDENCE
→ READY

STAFF APP MY SCHEDULE
→ READY

ENVIRONMENT
→ LOCAL / TESTING ONLY

PRODUCTION
→ NOT ACCESSED
→ NOT VALIDATED
```

Roster 已经是可工作的排班模块，不只是静态日历。它负责计划员工应该在哪一天、什么时间上班或休息，并把正式发布的排班交给 Attendance 使用。

永久边界：

```text
Roster
→ planned work / expected schedule

Attendance
→ actual clock-in / break / clock-out facts

Timesheet
→ reviewed and locked worked-time outcome

Payroll
→ consumes approved / locked payroll facts
```

Roster 不直接计算薪资、迟到扣款、OT 金额或法定工资。

---

## 2. Canonical architecture

```text
Business / Branch
  ↓
Shift Templates
  ↓
Employee Effective Schedule
  ├─ Default Shift
  ├─ Fixed weekly Rest Days
  └─ Variable weekly Rest Day requirement
  ↓
Resolved Normal Schedule
  ↓
Weekly Roster Exceptions / Draft
  ↓
Publish
  ↓
Immutable Published Assignment Snapshot
  ↓
AttendanceExpectedDay
  ↓
Attendance → Resolution → Timesheet → Payroll
```

Canonical 数据模型包括：

- `RosterShiftTemplate`
- `EmployeeRosterScheduleVersion`
- `RosterPeriod`
- `RosterAssignment`
- `RosterPublication`
- `RosterPublishedAssignment`
- `AttendanceExpectedDay`

---

## 3. Manager Roster workspace

主入口：

```text
/team/roster
```

当前主导航：

```text
Month
Week
Staff
Coverage
Shift settings
```

如果登录用户只可管理一个 Branch，系统直接使用当前授权 Branch，不重复显示无意义的 Branch 选择器。多 Branch 用户仍然可以在有需要的管理页面切换授权 Branch。

### 3.1 Month view

Month 是默认总览：

- 显示真实整月日历。
- 显示每天排班员工。
- 用 Shift Template 颜色帮助辨认班次。
- Rest Day、Leave、Public Holiday 保持不同语义。
- 上月 / 本月 / 下月采用紧凑月份导航。
- 搜索默认收起，需要时才打开。
- 日期使用马来西亚清楚格式，例如 `16 Aug 2026`、`16/08/2026`。
- 不显示没有产品意义的内部记录数量。

点击日期会打开 Day Roster modal/card：

- 背景日历保持原本滚动位置，不会跳到页面顶部。
- `Working` 与 `On Leave` 分页显示。
- 显示员工、班次、时间、休息时间和来源状态。
- Public Holiday 作为日期背景事实显示。
- `Change` 会打开排班修改卡片，不离开当前工作上下文。

### 3.2 Week view

Week 是团队一周排班操作表：

- 员工为行，星期一至星期日为列。
- 默认班次自动显示，不需要逐日建立。
- Rest Day 使用独立颜色显示。
- 今日只显示清楚的 `Today` 标记，不使用干扰阅读的大面积背景。
- 每个日期可以打开 Quick Assign。
- 每位员工显示一周预计 paid hours。
- Leave、Public Holiday、Not Scheduled 与 Rest Day 不会被混成同一种状态。
- 支持上一周 / 本周 / 下一周导航。

### 3.3 Staff view

Staff 是按员工查看的一周时间表：

- 左侧/首列显示员工身份。
- 星期一至星期日横向显示。
- Shift 使用模板颜色块。
- Rest Day、Not Scheduled、Leave 分别显示。
- 可以直接点击某天修改该员工的排班。
- 适合检查同一员工整周是否连续、是否有 Rest Day、每天是什么班次。

### 3.4 Coverage view

Coverage 是按班次检查人手覆盖：

```text
Shift 为行
Monday–Sunday 为列
每格显示该班次当天安排的员工
```

当前功能：

- Working Shift 按 Shift Template 分组。
- 显示员工姓名和 Employee Code。
- 每个 Shift 显示本周总排班人数。
- `No staff` 清楚表示该班次当天没人。
- Rest Day、Not Scheduled、Approved Leave 放在独立状态区。
- iPad / desktop 横屏可一次看完整七天。
- Root、Body 与 Coverage 表格没有横向页面溢出。
- 手机使用按日卡片布局，不强迫缩小桌面表格。

Coverage 是查看和比较工具，不是另一个排班 source-of-truth。

---

## 4. Shift settings

入口：

```text
/team/roster/templates
```

页面默认先显示所有 Shift 列表；右上角 `+` / Add Shift 才打开 Create Shift Template modal。

Shift Template 支持：

- Shift name
- Optional Shift code
- Start time
- End time
- Overnight shift（结束时间早于开始时间时代表次日结束）
- Break duration
- Paid / unpaid break treatment
- Roster display colour
- Active / inactive status
- Business-wide 或 Branch-specific scope（依授权范围）
- Revision versioning

现有颜色包括：

```text
Teal
Blue
Violet
Amber
Rose
Slate
```

系统会根据开始、结束和 unpaid break 计算 planned paid minutes。

重要历史规则：

```text
Edit Shift Template
≠ rewrite existing Roster history
```

Roster Assignment 与 Publication 会 snapshot 当时的：

- Shift name
- Times
- Break
- Paid/unpaid treatment
- Colour
- Timezone

因此以后修改模板不会改变已经发布的历史排班。

---

## 5. Employee default schedules

入口位于 Shift Settings 内的 Default Schedules：

```text
/team/roster/employee-schedules
```

每位员工可设置：

- Default Shift
- Effective From date
- Rest Day policy
- Fixed Rest Day weekdays
- 或每周需要多少个 variable Rest Days

Default Schedule 是 normal baseline：

```text
Normal day
→ automatically uses employee Default Shift

Different day
→ manager creates a weekly exception
```

系统采用 effective-dated immutable versions：

- 新设置从指定日期生效。
- 未来版本不改写过去排班。
- 已发布历史不被新版本重写。
- 同一个人可以在不同 Business 有不同排班，不会跨租户串数据。

Default Shift 可以为空，用于：

- Part-time
- Freelancer
- On-call staff
- 每周完全不同的员工

没有 Default Shift 不等于 Off Day。

---

## 6. Rest Day rules

### 6.1 Fixed Rest Day

例如员工每个星期五固定休息：

```text
Rest policy = Same days every week
Friday = Rest Day
```

之后每个有效星期五都会自动显示 Rest Day，不需要每周重复选择。

Quick Assign 中也有简化开关，可把当前选择的星期设为该员工每周固定 Rest Day，不需要离开当前排班再进入复杂设置。

### 6.2 Variable Rest Day

例如员工每周需要一天 Rest Day，但星期不固定：

```text
Rest policy = Different days each week
Required Rest Days = 1
```

经理必须在该周选择实际 Rest Day。如果数量不足：

- Roster 显示 `requires attention`。
- Publish 被阻止。
- 系统不会偷偷把未决定日期当成工作日或 Off Day。

### 6.3 Separate meanings

以下事实永远不合并：

```text
REST_DAY
≠ NOT_SCHEDULED
≠ APPROVED_LEAVE
≠ PUBLIC_HOLIDAY
≠ UNASSIGNED / NO DEFAULT SCHEDULE
```

Public Holiday 也不自动代表员工一定不能上班。

---

## 7. Quick Assign and editing

Month、Week、Staff 共用同一套 Quick Assign 逻辑，避免不同页面有不同编辑规则。

主要选项：

- Rest Day
- Active Shift Template
- Not Scheduled
- Custom Shift / Custom Time
- Reset to Normal Schedule

### Reset semantics

```text
Reset to Normal Schedule
→ delete weekly override
→ return to inherited employee Default Schedule
```

它不会写入一个重复的 Default Shift assignment。

### Custom Shift

用于一次性的特殊情况：

- 不同开始时间
- 不同结束时间
- 不同 break
- Overnight shift
- Operational note

### Bulk Assign

支持同一天把同一排班安排给多个员工，并复用相同的：

- Tenant / Branch scope
- Leave conflict rules
- Validation
- Historical protection
- Draft revision checks

### Copy Previous Week

只复制上周的 weekly exceptions：

```text
Copy Previous Week
→ copy exceptions only
→ do not copy inherited Default Shift cells
```

---

## 8. Draft and Publish workflow

Roster 修改先进入 Draft：

```text
Edit schedule
→ Save Draft
→ Review changes
→ Publish to Staff App and Attendance
```

Draft 特性：

- Draft 不影响 Staff App 的正式排班。
- Draft 不创建正式 AttendanceExpectedDay。
- Draft count 只计算真实例外，不计算自动继承的 Default Schedule。
- 可以 review before/after changes。

Publish 特性：

- 在 serializable transaction 内重新读取 canonical state。
- 使用 expected revision 防止过期浏览器覆盖新修改。
- 使用 operation key 支持 idempotency。
- 重试不会重复建立 published evidence。
- 创建 immutable publication snapshot。
- 对已经开始或过去的日期修改必须填写 reason。
- Locked Timesheet 对应的历史不能被静默改写。

固定默认排班如果没有例外，可以作为 effective baseline 使用，不要求经理每个星期做无意义 Publish。

---

## 9. Attendance integration

Roster 发布或安全 materialisation 后，为 Attendance 提供：

- Expected workday kind
- Expected start/end time
- Expected break
- Paid/unpaid break snapshot
- Branch
- Timezone snapshot
- Evidence reference

规则：

```text
Draft Roster
→ MUST NOT affect Attendance evidence

Published weekly exception
→ may replace inherited expected schedule

Variable Rest requirement unresolved
→ MUST NOT produce misleading final workday evidence
```

Attendance 继续负责：

- Clock In / Clock Out
- Break Start / End
- GPS / Geofence
- Device authorization
- Exception approval
- Late / missing punch resolution

Roster 不会伪造 actual attendance。

---

## 10. Leave and Public Holiday integration

Approved Leave：

- Leave domain 仍是 source-of-truth。
- Roster 只读取并显示。
- Day Roster 提供独立 `On Leave` tab。
- Staff App 显示 approved leave。
- 不允许用普通排班操作偷偷覆盖 Leave 的法律/HR事实。

Public Holiday：

- Holiday domain 仍是 source-of-truth。
- Roster 显示 `PH · Holiday name`。
- PH 可以与 work shift context 同时存在。
- Roster 不自动做 PH payroll rate 计算。

---

## 11. Staff App — My Schedule

入口：

```text
/staff/roster
```

员工只能查看：

- 自己的 schedule
- 当前选择 workplace/business
- 当前有效 Branch context

功能：

- Today schedule card
- Previous / current / next week
- 每日日期卡片
- Shift name and time
- Branch
- Break duration and paid/unpaid treatment
- Rest Day
- Not Scheduled
- Approved Leave
- Public Holiday context

Draft manager changes不会提前暴露给员工。

如果没有有效排班，系统显示：

```text
No effective schedule available
Unspecified — not an Off Day
```

不会把 `没有记录` 猜成 `Off Day`。

---

## 12. RBAC, tenancy and scope

Roster 使用现有能力边界：

- `VIEW_ROSTER`
- `EDIT_ROSTER`
- `PUBLISH_ROSTER`
- Shift Template management capability

Server-side enforcement 包括：

- Business tenant isolation
- Allowed Branch scope
- Membership binding
- Employment / active status
- Staff own-roster scope
- Cross-business denial
- Cross-branch denial

隐藏 UI 不是唯一保护；Server service 仍会拒绝越权操作。

---

## 13. Responsive and UX status

已经完成的 UX 原则：

- Month 是主入口。
- Branch 在单 Branch 情况下自动使用，不占据主要空间。
- Month / Week / Staff / Coverage 使用统一中间导航。
- Shift Settings 与 Coverage 同级入口。
- Day Roster 与 Quick Assign 使用 modal/card，不把用户带离工作位置。
- 打开/关闭 Day Roster 后保持日历滚动位置。
- Search 只在真正需要的视图显示，并默认收起。
- Desktop / iPad 使用完整 grid。
- Mobile 使用卡片或可操作的 responsive layout。
- 技术词如 materialisation、internal source enum 不暴露给普通经理。
- 日期采用日/月/年或 `10 Aug 2026`，避免美式月/日混淆。

最新 Coverage 浏览器检查：

```text
Monday–Sunday visible
Root overflow = 0
Body overflow = 0
Coverage table overflow = 0
Runtime error overlay = 0
```

---

## 14. Verification evidence

当前本轮最近验证：

```text
Roster targeted unit
→ 11/11 PASS

TypeScript
→ PASS

Targeted ESLint
→ PASS

git diff --check
→ PASS

Local browser Coverage acceptance
→ PASS
```

项目最后一次 Roster full-closure 文档记录：

```text
Roster targeted integration
→ 4/4 PASS

Full unit
→ 921/921 PASS

Full integration
→ 168/168 PASS

Prisma validate / generate
→ PASS

Fresh migration rebuild
→ 184/184 PASS

Local production-mode build
→ PASS

390px browser
→ PASS
```

以上 full-suite 数量是当时完整 closure 的记录；后续增量优化使用 targeted tests、TypeScript、Lint 与真实 Local browser 继续守门。

---

## 15. Explicitly not implemented / deferred

当前不要假设已经存在：

- AI automatic scheduling
- Demand forecasting
- Rotating multi-week pattern engine
- Shift bidding
- Employee shift swap marketplace
- Automatic labour-law decisions
- Automatic WhatsApp / SMS / push roster notification
- Roster direct salary calculation
- Roster direct OT / PH / Rest Day payroll amount calculation
- Payroll deduction based only on planned roster hours

Provider-neutral schedule notification event bus 仍然 deferred。当前不能把 audited Publish 误报成消息已经发送。

---

## 16. Recommended context for future ChatGPT work

未来如果继续优化，请遵守：

```text
1. Do not rebuild a second Roster engine.
2. Preserve Default Schedule + Weekly Exception architecture.
3. Preserve Draft ≠ Published.
4. Preserve Roster ≠ Attendance ≠ Timesheet ≠ Payroll.
5. Preserve Rest Day ≠ Not Scheduled ≠ Leave ≠ Public Holiday.
6. Do not materialise seven duplicate assignments for inherited normal days.
7. Do not rewrite published historical snapshots when editing Shift Templates.
8. Keep server-side tenant, branch and RBAC checks.
9. Keep Local / Testing only unless Production is separately authorised.
10. Preserve all existing dirty worktree changes; no reset, destructive checkout, commit or push unless explicitly requested.
```

## 17. Final summary

```text
Shift Templates
→ READY

Employee Default Schedules
→ READY

Fixed / Variable Rest Day
→ READY

Month / Day Roster
→ READY

Week View
→ READY

Staff View
→ READY

Coverage View
→ READY

Quick Assign / Custom Shift / Bulk Assign
→ READY

Draft / Review / Publish
→ READY

Attendance Evidence Integration
→ READY

Staff App My Schedule
→ READY

Tenant / Branch / RBAC Isolation
→ READY

AI / Shift Swap / Automatic Payroll Decisions
→ DEFERRED
```

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
