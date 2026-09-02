# TETAMU STAFF TIMESHEET / ATTENDANCE CONSISTENCY FIX REPORT

## 1. FINAL VERDICT

**REVIEW REQUIRED**

工程修复、真实 Railway Testing 只读数据审计、本地 authenticated mobile render、完整 unit／integration／build quality gates 均已通过。

本轮没有部署 257 项既有 dirty workspace 变更到 Railway Testing，以免把与本缺陷无关的改动一并发布。因此：

- 本地修复：**PASS**
- 使用新 read model 对真实 Testing 数据作只读投影：**PASS**
- Railway Testing 在线 UI：**待安全部署后由实体 iPhone 再确认**

范围边界：**RAILWAY TESTING + LOCAL / STAFF 3000 ONLY**。3100 未使用。Production 未访问、未修改。

---

## 2. REAL DEVICE DEFECT

### Observed

实体 iPhone、员工 `01112212259`、Royal Salon / salon online、2026-08-30：

- Attendance History 显示 Completed；Clock in 04:47 PM、Clock out 04:49 PM、Worked 0h 01m。
- Timesheet 同一天出现多张 `Action needed` 卡。
- 页面错误提示员工 `Send the missing time`，即使 Clock In 与 Clock Out 都已存在。

### Expected

- 一个 canonical employee workday 只显示一张 Timesheet 主卡。
- 只有员工确实可以处理的 Missing Clock In / Missing Clock Out 才显示 `Action needed`。
- 主管处理中的问题显示 `Waiting for manager`。
- 已有 immutable P2 final 或 locked snapshot 的日期显示 `Final`。
- Attendance History 与 Timesheet 可以处于不同处理层级，但 Timesheet 必须清楚说明原因及下一步。

---

## 3. ROOT CAUSE

### 为什么出现多张 30 Aug 卡

旧 `getEmployeeTimesheetOverview()` 分别返回：

- `latest`：P2 final results；
- `exceptions`：所有 active P2 exception rows。

旧 `/staff/timesheet` 随后直接对每条 `exceptions` 做一张卡。真实 30 Aug 同时有：

1. `LATE_ARRIVAL`；
2. `EARLY_DEPARTURE`。

两条记录属于同一个 employee workday，却被错误渲染成两张主卡。旧 final 去重也依赖 `Map` 的覆盖顺序，没有显式保证保留最高 version。

### 为什么 Completed Attendance 仍显示 Action needed

Attendance History 的 Completed 是 raw session 完成语义：Clock In / Break Start / Break End / Clock Out 已闭合。

Timesheet 使用 P2 workday 语义。30 Aug 的 current published roster 是 08:00–23:00 MYT，而实际 16:47–16:49，因此 P2 正确保留：

- Late Arrival：528 分钟；
- Early Departure：371 分钟。

旧页面把所有非 `PENDING_MANAGER` exception 都当成员工可操作，并使用 generic missing-time wording。Late / Early 实际不能由员工 self-correct，所以这是 actionability 与文案错误，不是缺少 punches。

---

## 4. TESTING DATA AUDIT

审计守卫：`RAILWAY_ENVIRONMENT_NAME=testing`、显式 `TETAMU_TESTING_DATABASE_AUDIT=true`、只接受 Testing internal host 或 `*.proxy.rlwy.net`。脚本仅执行读取。

### Attendance

- EmployeeAttendance 数量：**1**
- ID：`82cff42e-e462-474e-ba89-333e0d89ed54`
- 状态：`COMPLETED`
- Work date：`2026-08-30`
- Clock in：`2026-08-30T08:47:49.012Z`（16:47 MYT）
- Clock out：`2026-08-30T08:49:45.311Z`（16:49 MYT）
- Break：0 分钟
- Worked：1 分钟
- Branch：salon online

### Punches

共 **4** 条 immutable punches：

1. `CLOCK_IN`
2. `BREAK_START`
3. `BREAK_END`
4. `CLOCK_OUT`

Clock In 与 Clock Out 均存在；不能显示 missing-time employee CTA。

### Exceptions

- Legacy AttendanceException：**0**
- P2 active exceptions：**2**
  - `LATE_ARRIVAL / OPEN / 528 minutes`
  - `EARLY_DEPARTURE / OPEN / 371 minutes`
- 两者的 expectedDayId、attendanceSessionId、business、branch、membership 与 work date 相同。

### Resolution

- Legacy AttendanceResolutionCase：`RESOLVED / LEGACY_COMPLETED`
- Legacy result：`INCLUDED / RAW_SESSION / version 1`
- P2 resolutions：**0**
- P2 employee correction requests：**0**

### Final result

- Legacy AttendanceFinalResult：存在，表示 raw completed session。
- AttendanceP2FinalResult：**0**。
- 原因：active Late / Early exceptions 仍阻止 P2 day finalization。

### Timesheet

- AttendanceMonthlyTimesheet：**不存在**
- Locked snapshots：**不存在**
- Overtime reviews：**0**

### Expected attendance

- Revision 1–3：`REST_DAY / SUPERSEDED`
- Current revision 4：`WORKDAY / ROSTER / CURRENT`
- Expected start：08:00 MYT
- Expected end：23:00 MYT
- Scheduled break：30 分钟

结论：该日期不是 canonical P2 Final；正确员工状态是 **Waiting for manager**，并保留真实 punches 与清楚的 schedule-difference 原因。

---

## 5. PRECEDENCE RULE

员工 Timesheet 采用以下优先顺序：

1. **LOCKED monthly snapshot**：锁定月只读取 immutable current revision snapshots；不再把 live exceptions 混入。
2. **Active live exception newer than final**：同一 workday 有较新的 active issue 时，显示该日唯一的 issue projection。
3. **Latest immutable P2 final**：没有较新 active issue 时，显示最高 version final。
4. **Stale active exception superseded by newer final**：保留数据库 audit history，但不再作为员工 active task 显示。

不把 raw Attendance session 与 P2 final / exception 各自生成独立卡片。

---

## 6. DEDUPLICATION RULE

Canonical employee workday key：

`businessId : membershipId : YYYY-MM-DD`

规则：

- 一个 key 只生成一个 primary employee Timesheet day。
- 同日多个 exception types 收纳为该日的 supporting issues。
- 同 type 重复记录只保留最高优先且最新的 active issue projection。
- 多个 raw shifts 继续由 canonical P2 materializer 聚合：最早 Clock In、最晚 Clock Out、累计 break / worked；前端不自行猜测或删除 shift。
- Locked snapshot 与 latest final 以 version 明确排序，不以 label text 去重。

---

## 7. ACTIONABILITY RULE

### Action needed

仅当存在员工可执行且状态为 `OPEN` / `PENDING_EMPLOYEE` 的：

- `MISSING_CLOCK_IN`
- `MISSING_CLOCK_OUT`

显示 exactly one correction CTA。

### Waiting for manager

- 任一 issue 已是 `PENDING_MANAGER`；或
- Late Arrival、Early Departure、No Show、Leave conflict 等非员工 self-correction 类型仍 active。

员工不看到无效 missing-time CTA。

### Final

- Latest immutable P2 final；或
- Locked monthly day snapshot。

### Up to date

当本月没有员工 action、没有 manager-waiting issue，且月尚未 locked 时显示。

---

## 8. FIX IMPLEMENTED

### Files changed

- `src/lib/attendance/employee-timesheet.ts`
- `src/app/staff/timesheet/page.tsx`
- `tests/unit/employee-timesheet-projection.test.ts`
- `scripts/audit-testing-timesheet-attendance-consistency.ts`
- `TETAMU_STAFF_TIMESHEET_ATTENDANCE_CONSISTENCY_FIX_REPORT.md`

### Backend / read model

- 新增 canonical `EmployeeTimesheetDay` projection。
- 月份读取同时加入 exclusive next-month boundary。
- Active exception 与 final 按 workday key、version、updatedAt / createdAt 合并。
- Locked monthly snapshot 优先。
- 将同日多个 P2 exception 聚合成一张 day card。
- 只暴露一个真正 actionable missing-punch exception。
- Audit rows 没有删除或改写。

### UI

- `Needs Attention`、`Workdays` 都只消费 canonical `days`。
- `Result / Why / Next Action` 层级明确。
- Late + Early 同日显示一张 `Waiting for manager / Schedule difference` 卡。
- 显示真实 Clock In / Clock Out。
- 只有 `actionableException` 存在时才渲染 correction form。
- Reason / next-action 使用 `overflow-wrap:anywhere`，避免窄屏横向溢出。

---

## 9. 30 AUG 2026 RESULT

### Attendance History

`COMPLETED`，16:47–16:49 MYT，worked 1 minute。

### Timesheet card count

使用修复后的 read model 对真实 Railway Testing 数据投影：**1**。

### Final state

**Waiting for manager**，不是 Final。

原因是 current published roster 08:00–23:00 与实际 16:47–16:49 存在真实 Late / Early exceptions。强行显示 Present / Final 会削弱 Attendance correctness，因此未这样处理。

### CTA

**无员工 correction CTA**。

Next action：`No action — your manager needs to review this day.`

---

## 10. MULTI-SHIFT SAFETY

- 未以日期 label 或前端文本隐藏卡片。
- Canonical P2 workday 本身支持同日多个 raw sessions 的 aggregate。
- Projection 接受 aggregate final / exception facts，不重算 raw punches。
- 同日多个 shift 的 earliest Clock In、latest Clock Out、累计分钟仍由 P2 materializer 负责。
- Focused test 覆盖 multiple raw shifts represented by one canonical daily aggregate。

---

## 11. MOBILE 390

Authenticated Staff 3000 local production build，requested viewport `390 × 844`：

- 浏览器 transport 报告 CSS inner width 391（viewport rounding），`scrollWidth = innerWidth = 391`。
- Workday cards：1。
- 无 horizontal overflow。
- 卡片完整位于 fixed bottom navigation 之上。
- Result / Next Action 清楚换行。
- Reason 容器 `min-width: 0` + `overflow-wrap:anywhere`，长说明不会撑宽页面。
- 实际 screenshot 视觉确认通过。

---

## 12. MOBILE 412

Authenticated Staff 3000 local production build，viewport `412 × 915`：

- `innerWidth = 412`
- `scrollWidth = 412`
- Workday cards：1。
- Fixed nav top：850.20px；最后卡 bottom：512.96px。
- 无 horizontal overflow。
- Bottom navigation 未覆盖卡片或 CTA。

本地五角色 UAT employee session 仅为 authenticated mobile render 而刷新；未用于 Testing 或 Production 写入。

---

## 13. TEST RESULTS

| Gate | Result |
|---|---|
| Focused projection / Staff | **52 / 52 PASS** |
| Full unit | **1347 / 1347 PASS** |
| Staff/security | **105 / 105 PASS** |
| Attendance/Approval | **170 / 170 PASS** |
| Protected integration | **199 / 199 PASS** |
| Isolated employee-cookie Attendance route | **1 / 1 PASS** |
| TypeScript | `npx tsc --noEmit` **PASS** |
| Full ESLint | **PASS / 0 errors / 3 unrelated warnings** |
| Prisma validate | embedded local DB wrapper **PASS** |
| Migration status | **212 migrations / database up to date** |
| Production build | Next.js 16.3 / webpack / 144 pages **PASS** |
| Local Staff 3000 runtime | HTTPS `/staff/login` returned **200**；dev supervisor restored |
| Testing data/read-model smoke | Railway Testing DB read-only projection **PASS**；30 Aug primary card count 1 |
| Testing deployed UI | **REVIEW REQUIRED — not deployed from 257-item dirty workspace** |

第一次 direct `prisma validate` 因 shell 没有 `DATABASE_URL` 而失败；使用项目规定的 embedded DB wrapper 后通过。第一次 build 因正在运行的 Next dev 锁住 Prisma Windows DLL 而出现 `EPERM`；只停止明确的本地 dev PIDs 后重新 build 通过，并已恢复 Staff 3000 dev server。

`git diff --check` 报告 3 个既有 EOF blank-line 警告：

- `src/app/staff/roster/page.tsx`
- `src/components/staff-pwa/staff-pwa-chrome.tsx`
- `src/lib/staff-pwa/client.ts`

这些文件不是本轮改动，未擅自修改用户既有工作。

---

## 14. DATA MODEL

确认：

- **NO DUPLICATE STATE**
- **NO NEW MIGRATION**
- **NO AUDIT HISTORY DELETION**
- 没有新增 frontend-only canonical Attendance state。
- 没有写入 Railway Testing 数据。
- Local 仅刷新现有 UAT session / persona fixture 以执行 authenticated viewport check。

---

## 15. PRODUCTION STATUS

**TESTING / LOCAL ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

Railway Testing 本轮只读审计；未执行 Testing deployment。上线前需从干净、受控的 deployment source 仅发布已审核 Staff 3000 canonical changes，随后由实体 iPhone 对 30 Aug Timesheet 重新确认。
