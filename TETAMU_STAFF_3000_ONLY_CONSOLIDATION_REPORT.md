# TETAMU STAFF 3000 ONLY CONSOLIDATION REPORT

审计日期：2026-08-29  
Canonical repository：`C:\CodexTetamuP0`  
Reference worktree：`C:\CodexTetamuP0-staff-ui`

## 1. FINAL VERDICT

**REVIEW REQUIRED**

3000 已成为唯一正在运行、唯一承接 `/staff` 路由的本地 Staff App；源代码中已没有 `STAFF_APP_ORIGIN`、`localhost:3100` 或 `127.0.0.1:3100` 运行时依赖。3100 进程已停止，并保留为只读参考来源。

尚不能写成 `READY`，原因如下：

1. 当前本机共享数据库曾被旧 3100 写入 3100-only migration 记录，现有数据库的 migration table 与新的 canonical 3000 migration directory 不一致。
2. 全新 disposable database 已证明 3000 的 212 条 canonical migrations 可以从零完整应用，但现有本机数据库仍需要一次明确、可审计的 baseline/reconciliation 决策；本轮没有重置或篡改本机数据库。
3. 390px 与 412px 浏览器视口已自动验收，但真实 iPhone、真实 Android、员工、经理及 multi-business 全流程仍需人工 UAT。
4. 员工头像与 Staff logo 当前写入 runtime local filesystem，只可标记为 `LOCAL/TESTING READY`，正式部署前需要 durable object storage 方案。

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

## 2. Canonical Runtime

| 项目 | 结果 |
| --- | --- |
| 唯一代码库 | `C:\CodexTetamuP0` |
| 唯一 Staff runtime | `https://localhost:3000/staff` |
| 3000 `/staff/login` | HTTP 200，由 3000 自己渲染 |
| 3100 runtime | 已停止；端口 3100 无监听进程 |
| 3100 worktree | 保留，`REFERENCE ONLY` |
| 第三套 Staff App | 未建立 |

本轮完成后，3000 build 中存在以下 canonical Staff routes：

- `/staff`
- `/staff/login`
- `/staff/verify`
- `/staff/select-workplace`
- `/staff/history`
- `/staff/roster`
- `/staff/timesheet`
- `/staff/leave`
- `/staff/leave/new`
- `/staff/claims`
- `/staff/commission`
- `/staff/pay`
- `/staff/payslips`
- `/staff/payslips/[publicationId]`
- `/staff/requests`
- `/staff/requests/attendance-corrections`
- `/staff/requests/overtime`
- `/staff/requests/overtime/[finalResultId]`
- `/staff/approvals`
- `/staff/approvals/[domain]/[requestId]`
- `/staff/appointments`
- `/staff/profile`
- `/staff/device`（保留兼容 alias，但不在主导航暴露）

## 3. Redirect Status

- 已从 `next.config.mjs` 移除 development `/staff/:path* -> localhost:3100` redirect。
- Staff App 不再依赖 `STAFF_APP_ORIGIN` 才能运行。
- 对 `next.config.mjs`、`package.json`、`src`、`scripts`、`prisma`、`public` 的残留扫描结果：没有运行时 `STAFF_APP_ORIGIN` 或 3100 URL 引用。
- `/api/local-uat/session` 改为返回相对路径 `/staff`，因此会留在当前 3000 origin。

## 4. Features migrated from 3100

### Mobile / iPhone UX

- iPhone-first compact card presentation。
- 390px 和 430px responsive rules。
- `env(safe-area-inset-*)` 底部导航安全区。
- task flow 可隐藏 bottom navigation。
- loading、error、empty states。
- 更紧凑的 workplace/header、Home、Roster、Leave、Approval UI。
- 独立 `staff-consolidation.css` presentation layer，避免覆盖 3000 domain/backend。

### Appointments

- 新增 `/staff/appointments` 与 `/api/employee-appointments`。
- 支持 day/week calendar、assigned appointment、conflict warning、branch timezone。
- 使用 exact membership-linked staff mapping；mapping 缺失时 fail closed。
- 员工端不暴露客户电话或 appointment notes。
- Home 只在存在下一项 appointment 时显示 Next Appointment。

### Attendance correction manager queue

- 新增 `/staff/requests/attendance-corrections`。
- 使用 3000 canonical Attendance resolution queue、management service 与 resolution workflow。
- 保留 branch scope、capability guard、self-review prevention 与 stale-state guard。

### Leave New

- 新增 focused mobile `/staff/leave/new`。
- 没有创建第二套 Leave model/service；提交继续进入 canonical employee Leave API/service。
- 日期选择、拍照/文件入口与 task navigation 已迁入。

### Avatar / Profile

- Profile 展示/上传 employee avatar。
- server-side session、same-origin、membership/business scope、文件大小/type、Sharp normalization、audit log 已保留。
- 状态：`LOCAL/TESTING READY`；`PRODUCTION STORAGE REVIEW REQUIRED`。

### Staff Appearance

- 新增 Business Owner 的 `/business/settings/staff-app`。
- 支持 Staff logo 与 Quick Access icon 配置。
- 使用新的 canonical 3000 schema fields/migration，不复制 3100 migration history。
- logo storage 状态：`LOCAL/TESTING READY`；`PRODUCTION STORAGE REVIEW REQUIRED`。

### Schedule / History / Timesheet presentation

- 迁入更紧凑的 Roster/read-model presentation 与 loading/error states。
- Attendance History 保留 canonical punch/correction 行为。
- Timesheet 保留 3000 的 potential OT、approved OT、locked OT 与 finalized record 语义。

## 5. 3000 features preserved

- Payroll、payslip publication、commission 与 payroll boundary。
- PCB 2026 与 effective-dated statutory work。
- 3000 Attendance punch、P2、resolution 与 overtime canonical services。
- 3000 Leave canonical service。
- 3000 Claims canonical service、required fields、receipt/mileage/general rules与 amount validation。
- Manager OT Approve / Adjust / Reject。
- OT branch scope、self-review block、locked-timesheet guard、concurrency guard。
- Employee Auth/session security 与 server-side identity resolution。
- 当前 SMS123 provider、keyed OTP hash、safe provider error mapping。
- Payslip/claim/leave protected attachment routes。

本轮没有 wholesale copy 3100 folder，没有 wholesale cherry-pick，也没有回退 Payroll/PCB/statutory schema。

## 6. Approval Center

`/staff/approvals` 现在是 mobile projection/read model，不是新的 approval state owner。

| Domain | Projection source | Decision write path | 状态 |
| --- | --- | --- | --- |
| Leave | `LeaveRequest` / unified approval reader | canonical `reviewLeaveRequest` | 已接入 |
| Claims | `EmployeeClaim` / unified approval reader | canonical `reviewEmployeeClaim` | 已接入 |
| Attendance | canonical resolution/pending exception readers | canonical attendance management/resolution workflow | 已接入 |
| OT | `AttendanceOvertimeReview` / final Attendance result | canonical OT decision service | 已接入 |

- Filters：All、Leave、Claims、Attendance、OT。
- Home 显示 `Needs my approval` 与包含四个 domain 的 pending total。
- 没有新增 `StaffApproval` 或 `UnifiedApprovalRecord` table。
- Leave/Claims 没有另建 manager-only duplicate workflow。
- Manager access 使用 capability、module、tenant、branch scope；没有 `roleName === "Manager"` 判断。
- self-review 在 Leave、Claims、Attendance 与 OT 读取/写入路径均 fail closed。

## 7. Prisma Reconciliation

### Canonical schema change

在 3000 `Business` model 新增：

- `staffAppLogoUrl String? @map("staff_app_logo_url")`
- `staffAppAppearance Json? @map("staff_app_appearance")`

### Canonical migration

新增：

`prisma/migrations/20260829110000_canonical_staff_app_appearance/migration.sql`

这是 additive migration，使用 `ADD COLUMN IF NOT EXISTS`；没有复制旧 3100 migration directory，也没有删除/回退 3000 Payroll、PCB 或 statutory migrations。

### Validation results

- `prisma validate`：PASS。
- fresh canonical migration check：PASS，212/212 migrations 可在 disposable database 从零应用。
- 当前本机 database `prisma migrate status`：**REVIEW REQUIRED**。

### Current local database drift

本机数据库 migration table 已含下列旧 3100 记录，但 canonical 3000 directory 不包含它们：

- `20260822010000_staff_app_appearance`
- `20260822023000_development_concurrent_otp_challenges`
- `20260824130000_staff_app_sms123_otp`（本机记录出现重复名称）

同时，新的 canonical `20260829110000_canonical_staff_app_appearance` 尚未标记应用到该现有本机数据库。

安全建议：建立新的 disposable/local canonical database，或先形成明确的 Prisma baselining 方案并审计 `_prisma_migrations`；不要把旧 3100 migrations 直接复制回主线，也不要对 production 执行 resolve/reset。

## 8. Auth / SMS123 status

- 继续使用 3000 Employee Auth/session implementation。
- SMS123 仍为 canonical real SMS provider path。
- SMS123 verification code 只保存 keyed hash；provider response message 不直接暴露给员工。
- `000000` 只在 non-production `mock` mode 自动提供；production 或非 mock mode 配置 mock code 会 fail closed。
- Twilio adapter 仍作为旧兼容实现存在于代码中，但本轮没有用 3100 provider 覆盖 SMS123，也没有将 Twilio 设回 canonical。
- SMS123 unit tests：PASS。
- 本轮没有向 SMS123 发真实短信、没有验证 production credential，也没有访问 production。

## 9. Navigation / terminology

Canonical primary navigation：

1. Home
2. Time
3. Requests
4. Pay
5. Profile

`more` collection 为空，不再暴露 dead More menu。

- **Schedule**：应该何时上班，入口包括 Roster/Schedule。
- **Attendance**：实际打卡和出勤，入口包括 History/Correction。
- **Timesheet**：处理/确认后的工作记录及 OT 状态。
- **Leave**：请假。
- **Claims**：报销。
- **Approvals**：经理要审批的事项。
- **OT**：Overtime。

Workplace switch 的主要入口保留在 Staff shell/header；Profile 不再复制第二个 switch UI。`/staff/device` 仅作兼容 alias，不在主导航暴露。

## 10. Security results

| Control | 结果 | Evidence |
| --- | --- | --- |
| Server-side employee identity | PASS（source/test） | session resolves account、membership、business、branch、device context |
| Tenant isolation | PASS（source/unit） | canonical readers/actions enforce `businessId` from auth |
| Branch isolation | PASS（source/unit） | allowed branch scopes derived server-side |
| Multi-employer switching | PASS（source/unit）；人工 UAT 待做 | hard tenant reset、server-selected membership |
| Capability-based manager UI/actions | PASS（source/unit） | `canDirectStaff` / canonical capabilities；无 role-name Manager check |
| ALL_BRANCHES | PASS（source/unit） | active branches limited to current business |
| Self-review | PASS（source/unit） | Leave/Claims/Attendance/OT all blocked |
| Appointment privacy | PASS（unit） | exact mapping，phone/notes not exposed |
| Claim/Leave documents | PASS（source/unit） | scoped protected routes，private/no-store controls |
| Payslip access | Preserved；人工 end-to-end 待做 | canonical publication/access path unchanged |
| Avatar upload | PASS（source/build） | same-origin、session、membership/business updateMany、audit |

没有把 client 提交的 `businessId`、`membershipId` 当作 authority。

## 11. Test results

### Automated

- Staff-focused unit suite：**83/83 PASS**。
- Additional Attendance scope + unified approval tests：**22/22 PASS**。
- TypeScript `npx tsc --noEmit`：PASS。
- ESLint：PASS，0 errors；3 个与本轮 Staff consolidation 无关的 existing warnings。
- Prisma validate：PASS。
- Fresh migration check：PASS。
- Production build：PASS，144 static pages generated，所有 canonical Staff routes 出现在 route manifest。
- Runtime smoke：`https://localhost:3000/staff/login` HTTP 200；页面来自 3000；没有 3100 redirect。

### Baseline comparison

- Audit baseline 3000 selected Staff tests：52/52。
- 本轮 canonical 3000 Staff-focused suite：83/83。
- 测试数量不作为唯一 parity 证明；本轮新增/保留覆盖包括 Appointments、Attendance Correction、Approval Center、OT、tenant/branch/self-review、SMS123、PWA/navigation。

### Not executed automatically

- 真实 OTP SMS delivery。
- 真实 GPS permission/clock flow。
- 真实 employee/manager data mutation smoke。
- 真实 multi-business A/B data isolation smoke。
- 真实 payslip/claim/leave attachment download。

这些项目必须留在人工 Testing UAT，不得根据 source/unit test 写成 Production Ready。

## 12. Mobile results

| Viewport | 结果 |
| --- | --- |
| 390 × 844 iPhone-class | PASS：3000 login 直接渲染；无 horizontal overflow；touch UI 与 compact card 正常 |
| 412 × 915 Android-class | PASS：无 horizontal overflow；页面宽度与 viewport 一致 |
| Real iPhone | REVIEW REQUIRED：未在本轮自动控制真实设备完成全流程 |
| Real Android | REVIEW REQUIRED：未在本轮自动控制真实设备完成全流程 |

CSS/source checks 已覆盖 safe-area bottom padding、44px touch target、430px breakpoint、task-flow hidden navigation。登录后长姓名、长 branch、键盘、fixed/sticky controls 与真实 safe area 仍需真实设备 UAT。

## 13. Route parity

用户指定的 16 个核心 routes 已全部由 3000 build 输出，并补充：

- Appointments
- Leave New
- Attendance Correction queue
- OT queue/detail
- Payslip detail
- Staff App manifest/module-not-enabled

没有 Staff route 需要 3100 process 才能 resolve。

## 14. 3100 status

**REFERENCE ONLY — NOT READY TO DELETE**

- 3100 端口已停止。
- 3100 不再是 runtime、backend、auth、schema 或 migration owner。
- 不应再在 3100 接受新开发或运行 migrations。
- worktree 暂时保留，用于 parity 对照与未完成的真实设备 UAT。
- 在 migration baseline、真实 iPhone/Android、employee/manager/multi-business UAT 全部关闭前，不建议删除该 worktree。

## 15. Production status

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

没有运行 production migration、没有 production database backfill、没有 production OTP、没有 production deployment。

## 16. Recommended closure sequence

1. 为当前本机 drift 建立书面的 Prisma baseline/reconciliation 决策，优先使用新的 canonical local/testing database 验证，而不是修改 production。
2. 将 employee avatar 与 Staff logo 改为 durable object storage，并保留现有 auth/audit/scope controls。
3. 在 Testing 执行 normal employee smoke：OTP、workplace、clock/break/GPS/history/correction/roster/timesheet/leave/claim/pay/profile/logout。
4. 在 Testing 执行 manager capability matrix：Leave、Claims、Attendance、OT；验证无 capability 与 self-review fail closed。
5. 在 Testing 建立 A/B business memberships，执行 cross-tenant negative tests。
6. 在真实 iPhone 与 Android 完成 safe area、keyboard、long text、loading/error/empty state UAT。
7. 上述全部关闭后，才把 3100 标记为 `READY TO RETIRE` 并规划 archival/delete。

当前整合方向保持正确：**3000 是唯一 canonical base；3100 只保留为临时参考，不建立第三套 Staff App。**
