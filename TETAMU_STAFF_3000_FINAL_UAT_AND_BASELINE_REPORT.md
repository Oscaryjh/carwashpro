# TETAMU STAFF 3000 — FINAL UAT AND BASELINE REPORT

日期：2026-08-29  
范围：`C:\CodexTetamuP0`，Local / Testing only  
Canonical Staff App：3000 only

## 1. FINAL VERDICT

**REVIEW REQUIRED**

3000 已是唯一 canonical Staff App，3100 已停止且 active runtime 没有 3100 dependency。Canonical 3000 的 212 个 migrations 已在 disposable fresh database 完整通过，当前 3000 HTTPS runtime 也可正常响应。

本轮不能标记 READY，原因如下：

1. 当前旧本地数据库包含大量 Employee、Attendance、Roster、Leave、Claims、Payroll、Payslip 与 UAT 数据，不能在未取得 data owner 分类前丢弃或重建。
2. 旧本地数据库的 `_prisma_migrations` 仍含 3100-only records，并缺少新的 canonical appearance migration；本轮没有手工修改 migration history。
3. 登录后的 390px employee browser UAT 需要把现有 local UAT session token 传给仅本机的 session helper；在用户明确确认前未执行。
4. 没有可用的 manager Staff browser session，因此 manager workflow 由 disposable integration tests、unit tests 与 source/capability audit 验证，不冒充 manual browser PASS。
5. Real Android 与 Real iPhone UAT 本轮不可用，明确记录为未执行。

结论：**代码与 disposable canonical database baseline 已通过；旧 local database reconciliation、authenticated browser UAT 与 real-device UAT 仍需关闭。**

## 2. CANONICAL RUNTIME

### 3000

- 状态：**CANONICAL / RUNNING**
- Workspace：`C:\CodexTetamuP0`
- Local URL：`https://localhost:3000/staff`
- Port check：3000 正在监听。
- Runtime check：`https://localhost:3000/staff/login` 返回 HTTP 200。
- Normal development command：`npm run dev`，不需要 3100。
- Staff UI、employee flows、manager approval flows 与 canonical backend services 均由此 workspace 提供。

### 3100

- 状态：**REFERENCE ONLY**
- Port check：3100 未监听。
- Active application paths 未发现 `STAFF_APP_ORIGIN`、`localhost:3100`、`127.0.0.1:3100` runtime references。
- `package.json` normal development scripts 不启动或依赖 3100。
- 3100 migration ownership 未重新引入 canonical 3000。
- `C:\CodexTetamuP0-staff-ui` 本轮没有新增代码修改；worktree 只保留既有 `next-env.d.ts` modified 状态。
- 本轮没有删除 reference worktree。

## 3. LOCAL DATABASE

### Old DB

- Database：`car_wash_crm_pos` on `localhost:5432`
- 状态：**PRESERVE / DO NOT RESET**
- 纯读取盘点：

| Domain | Records |
| --- | ---: |
| Businesses | 4,634 |
| Employee accounts | 1,770 |
| Employee memberships | 1,771 |
| Attendance sessions | 6 |
| Attendance punches | 18 |
| Roster periods | 15 |
| Published roster assignments | 73 |
| Leave requests | 738 |
| Employee claims | 747 |
| Payroll runs | 811 |
| Payslip publications | 71 |
| Appointments | 9 |
| OT reviews | 4 |
| Attendance resolution cases | 6 |

这些 records 包含命名明确的 UAT businesses、员工身份、Leave、Claims、Payroll 与 Payslip evidence。无法合理判断为 disposable data，因此触发 brief 的 STOP condition。

### New canonical DB

- 状态：**NOT CREATED / NOT SWITCHED**
- 原因：重要旧 local data 需要 data owner 分类与 reconciliation plan。
- 本轮没有修改 `DATABASE_URL`，没有删除、重置或覆盖旧 DB。
- 已另行提供 `TETAMU_STAFF_3000_LOCAL_DATABASE_RECONCILIATION_PLAN.md`。

### Migration count

- Canonical migration directory：**212**
- Fresh disposable database：**212 / 212 PASS**

### Migration result

- Fresh canonical apply：PASS
- Disposable integration database：PASS，执行后由测试脚本清理。
- Current old local database：migration status 不 clean。

### Drift status

Current old DB 与 canonical migration directory 的 last common migration：

- `20260827170000_effective_dated_statutory_participation`

Canonical 尚未在旧 DB apply：

- `20260829110000_canonical_staff_app_appearance`

旧 DB 存在、canonical directory 不拥有：

- `20260822010000_staff_app_appearance`
- `20260822023000_development_concurrent_otp_challenges`
- `20260824130000_staff_app_sms123_otp`（DB history 中出现两次）

处理状态：**RECONCILIATION REQUIRED**。本轮没有手工修改 `_prisma_migrations`，没有复制 3100 migration folders。

## 4. EMPLOYEE UAT

说明：以下区分 automated integration evidence、source/route verification 与 manual authenticated browser execution，避免把未执行的操作写成 PASS。

### Login

- OTP request / verification / session guard：**PASS — disposable integration**
- Mock OTP path where allowed：**PASS — automated test**
- Membership selection/session binding：**PASS — automated test**
- Mobile login page anonymous runtime：**PASS — HTTPS 200 and prior viewport browser check**
- Authenticated browser login/UAT：**NOT EXECUTED — local token transmission awaiting explicit confirmation**

### Multi-employer

- Active membership binding：**PASS — automated integration**
- Business A / Business B tenant separation：**PASS — negative guard tests**
- Manual browser switch A → B：**NOT EXECUTED in this closure round**

### Home

- Today attendance/schedule/quick access：**PASS — source and route verification; prior viewport browser check**
- Next appointment conditional display：**PASS — unit/integration coverage**
- Normal employee approval card absent：**PASS — permission/navigation tests**

### Attendance

- Clock In / Break Start / Break End / Clock Out：**PASS — disposable integration**
- GPS/location handling and exception path：**PASS — integration**
- History：**PASS — route/service tests**
- Missing Punch / Attendance Correction：**PASS — integration and targeted route-flow test**
- Branch scope：**PASS — negative integration guards**
- Manual device geolocation prompt：**NOT EXECUTED on a physical device**

### Roster

- Published shift：**PASS — integration**
- Rest day / leave / holiday presentation states：**PASS — route/service and unit coverage**
- Multiple shifts where supported：**PASS — canonical roster service coverage**

### Timesheet

- Monthly records：**PASS — integration**
- Potential / approved / locked OT and finalized results：**PASS — integration and OT approval tests**

### Leave

- Balance / history：**PASS — integration**
- `/staff/leave/new`：**PRESENT / source verified**
- Submit request：**PASS — integration**
- Evidence/document authorization：**PASS — negative guard coverage**
- Withdrawal where permitted：**PASS — canonical domain tests**
- Manual camera/file picker flow：**NOT EXECUTED on a physical device**

### Claims

- General and mileage claim domain paths：**PASS — integration**
- Required fields / amount / receipt rules：**PASS — tests**
- Submit / history / permitted withdrawal：**PASS — canonical service tests**
- Manual camera/file picker flow：**NOT EXECUTED on a physical device**

### Pay

- Commission：**PASS — integration**
- Pay summary / payslip list：**PASS — integration**
- Protected payslip download authorization：**PASS — negative security tests**

### Profile

- Identity / workplace / logout：**PASS — source/session tests**
- Avatar local/testing flow：**LOCAL/TESTING READY — source and API authorization covered**
- Manual browser avatar upload：**NOT EXECUTED in this closure round**

### Appointments

- Exact membership-linked assignment mapping：**PASS — unit/integration**
- Cross-employee/tenant isolation：**PASS — negative tests**
- Customer phone and appointment notes are not leaked to employee list/detail payloads：**PASS — privacy tests**

## 5. MANAGER UAT

Manager visibility is capability-driven. No result below relies only on a role name.

### Leave Approval

- `APPROVE_LEAVE` capability required：**PASS — automated tests**
- Missing capability blocked：**PASS**
- Self-review blocked：**PASS**
- Decision writes use canonical Leave service/records：**PASS — architecture and integration verification**

### Claim Approval

- `REVIEW_CLAIM` capability required：**PASS — automated tests**
- Missing capability blocked：**PASS**
- Self-review blocked：**PASS**
- Decision writes use canonical Claim service/records：**PASS**

### Attendance Approval

- Required attendance capability：**PASS — automated tests**
- Branch scope：**PASS**
- Stale resolution/concurrency protection：**PASS**
- Self-review blocked：**PASS**
- Decision writes use canonical Attendance Resolution service/records：**PASS**

### OT Approval

- Approve / adjust / reject：**PASS — automated tests**
- Branch scope：**PASS**
- Concurrency guard：**PASS**
- Locked timesheet guard：**PASS**
- Self-review blocked：**PASS**
- Decision writes use canonical OT review/timesheet records：**PASS**

### Approval Center browser status

- `/staff/approvals` and All / Leave / Claims / Attendance / OT filters：**source and unit verified**
- Authenticated manager browser walkthrough：**NOT EXECUTED — no manager Staff session artifact available**
- Duplicate approval records/tables introduced：**NO**

## 6. SECURITY NEGATIVE TESTS

### Tenant isolation

- Business A cannot read Business B Leave：**PASS**
- Business A cannot read Business B Claims：**PASS**
- Business A cannot read Business B Payslip：**PASS**
- Business A cannot read Business B Commission：**PASS**
- Business A cannot read Business B Attendance：**PASS**
- Business A cannot read Business B Appointments：**PASS**
- Client-supplied `businessId` cannot override session tenant：**PASS**
- Client-supplied `membershipId` cannot override active membership：**PASS**

### Branch isolation

- Manager cannot review an unauthorized branch：**PASS**

### Self review

- Leave / Claim / Attendance / OT self-review blocked：**PASS**

### Payslip privacy

- Employee cannot download another employee's payslip：**PASS**

### Leave evidence

- Employee cannot fetch another employee's Leave evidence：**PASS**

### Claim attachment

- Employee cannot fetch another employee's Claim attachment：**PASS**

### Appointment privacy

- Employee only receives exact membership-linked appointments：**PASS**
- Customer phone and private appointment notes are not exposed：**PASS**

Evidence source：current disposable integration suite、Staff-focused unit tests、tenant/branch DB guards and canonical service authorization tests。

## 7. MOBILE

### 390px

- Prior automated browser viewport `390 × 844`：**PASS — no horizontal overflow**
- Login/anonymous shell：**PASS**
- Authenticated page-by-page browser rerun：**NOT EXECUTED — awaiting local token-use confirmation**

### Android-class

- Automated viewport `412 × 915`：**PASS — no horizontal overflow**
- CSS safe-area/bottom navigation implementation：**source verified**
- Physical Android keyboard、camera、file picker and geolocation：**NOT EXECUTED**

### iPhone-class

- Automated viewport `390 × 844`：**PASS — no horizontal overflow**
- Safe-area and bottom-navigation CSS：**source verified**
- Physical iPhone Add-to-Home、keyboard、native date picker、camera/file entry and geolocation：**NOT EXECUTED**

### Interaction and content states

- Date picker component：**source/unit verified; physical native interaction not executed**
- File upload/camera entry：**source/API verified; physical picker not executed**
- Long content handling：**responsive CSS/source verified; authenticated browser rerun pending**
- Loading/error/empty states：**route components/source verified**
- Sticky/fixed controls and task navigation：**prior automated viewport check PASS; authenticated rerun pending**

### Real Android

**REAL DEVICE UAT NOT EXECUTED**

### Real iPhone

**REAL DEVICE UAT NOT EXECUTED**

## 8. STORAGE

### Avatar

**LOCAL/TESTING READY**  
**PRODUCTION STORAGE REVIEW REQUIRED**

### Staff Logo

**LOCAL/TESTING READY**  
**PRODUCTION STORAGE REVIEW REQUIRED**

Object storage redesign is intentionally outside this consolidation closure.

## 9. TESTS

### Unit

- Staff-focused unit suite：**83 / 83 PASS**
- Additional attendance-scope / unified approval suite：**22 / 22 PASS**

### Integration

- Full protected disposable integration suite：**199 / 199 PASS**
- Isolated Attendance route-flow：**1 / 1 PASS**
- Fresh disposable DB created, migrated and cleaned by the test runner。

### TypeScript

- `npx tsc --noEmit`：**PASS**

### ESLint

- `npm run lint`：**PASS — 0 errors**
- 3 pre-existing unrelated warnings remain; no Staff consolidation lint error。

### Prisma

- `prisma validate`：**PASS**
- Fresh canonical migration：**212 / 212 PASS**
- Current old local DB migration status：**DRIFT / RECONCILIATION REQUIRED**

### Build

- Production build on current source tree：**PASS**
- 144 static pages generated。

### Runtime

- 3000 listen check：**PASS**
- `https://localhost:3000/staff/login`：**HTTP 200**
- 3100 listen check：**PASS — not listening**

## 10. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE AFTER FINAL DATA AND UAT CLOSURE**

- Not running.
- Not required by normal development scripts.
- No active runtime origin/redirect dependency.
- No 3100 migration folders restored into canonical lineage.
- No new code change made in the 3100 reference worktree during this round.
- Worktree intentionally retained for reference; not deleted yet.

## 11. PRODUCTION STATUS

**LOCAL / TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

No production database、deployment、secrets、object storage or migration history was accessed or changed in this task.

## Closure actions required before READY

1. Data owner classifies old local records as retain、recreate、archive-only or disposable。
2. Execute the approved backup、fresh canonical DB、allowlisted transfer and reconciliation plan。
3. Confirm authenticated employee session-token use, then complete read-only 390px browser walkthrough。
4. Prepare a manager Staff session with explicit capabilities and complete `/staff/approvals` browser walkthrough。
5. Execute and record Real Android and Real iPhone UAT where available。
6. Re-run final migration status、tests and runtime checks after local DB cutover。

Until these actions close, final status remains **REVIEW REQUIRED**.
