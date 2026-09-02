# TETAMU STAFF APPROVAL ATTENDANCE CONSISTENCY REPORT

日期：2026-08-29  
Canonical workspace：`C:\CodexTetamuP0`  
Canonical Staff App：port 3000 only  

## 1. FINAL VERDICT

**PASS**

本轮已修复 Staff App manager-facing Approval Center 的 Attendance 父级计数与子级任务中心不一致问题。最终规则是：如果 manager 看到 `Attendance — N pending`，进入 Attendance 后会在相同 Business、授权 Branch、capability、self-review exclusion 与 actionable status 下得到同一个 server total `N`。

本结论覆盖 Local / Testing code、自动化测试、production build 与 browser viewport UAT。实体 iPhone/Android UAT 仍沿用现有项目状态 `DEVICE UAT PENDING`，不是本轮一致性逻辑的失败项。

## 2. ROOT CAUSE

旧 Approval Center 的 Attendance 数字来自较宽的 unified Approval reader。`src/lib/approvals/service.ts` 的 Attendance projection 会聚合：

- `AttendanceP2Exception` 的多种未完成状态；
- `AttendanceResolutionCase` 的多种未完成状态；
- actionable OT review candidates；
- `AttendanceMonthlyTimesheet` manager tasks。

但点击后的 `/staff/requests/attendance-corrections` 只读取 manager 当前真正可处理的两个集合：

- 待处理、且未被 Resolution Case 接管的 Attendance exception；
- `UNDER_REVIEW` 的 Attendance resolution case。

因此父级数字可能包含子页不展示、也无法在子页处理的 P2、Timesheet、OT 或非当前 actionable status；同时 Approval Center 又另外展示 OT 数字，造成 OT 有重复计数风险。另一个差异是旧宽 projection 没有完整复用 Staff 子页的 actor membership self-review exclusion。

修复方式不是把不同 canonical states 塞进假 queue，而是让 Staff Attendance 父级数字和子页共同调用一个只读 projection。

## 3. CURRENT CANONICAL SOURCES

### 修复前真实 audit matrix

| Task type | Canonical source / service | 旧 Attendance count | Manager 在 Staff 可行动 | Branch / capability / self-review | 旧 destination | 最终类别 |
|---|---|---:|---:|---|---|---|
| P2 Attendance exception | `AttendanceP2Exception`; unified `loadAttendance()` | 是，多个 open-like statuses | 否，Staff 没有对应 decision route | Business/branch 与 capability 来自 unified context；self exclusion 与 Staff queue 不完全一致 | 无等价 Staff action path | 不计入 Staff Attendance；保留 desktop/business canonical reader |
| Pending missing punch / exception | `AttendanceException`; `loadPendingAttendanceExceptionQueue()` | 间接/口径较宽 | 是，`reviewAttendanceException()` | current Business、server-authorized branches、`MODIFY_ATTENDANCE_EMPLOYEES`、exclude actor membership | `/staff/requests/attendance-corrections` | **Attendance / Missing punch** |
| Attendance correction | `AttendanceResolutionCase`; `loadAttendanceResolutionQueue()` | 是，多个 open-like statuses | 仅 `UNDER_REVIEW` 可由当前 Staff workflow 处理 | current Business、server-authorized branches、同 capability、exclude actor membership | `/staff/requests/attendance-corrections` | **Attendance / Attendance correction** |
| OT review | `AttendanceOvertimeReview`; `listAttendanceOvertimeCandidates()` | 是 | 是，但已有独立 OT workflow | current Business、authorized branches、Attendance capability、exclude actor membership | `/staff/requests/overtime` | **OT only** |
| Monthly Timesheet task | `AttendanceMonthlyTimesheet`; unified `loadAttendance()` | 是 | Staff Attendance route 不提供该 business-only action | unified business/branch/capability scope | desktop/business task center | 不计入 Staff Attendance；保留 canonical business task |

### 最终 Staff Attendance projection

`src/lib/staff-pwa/team-approvals.ts::loadStaffAttendanceTaskProjection()` 同时读取：

1. `loadPendingAttendanceExceptionQueue()`：pending、尚未 linked resolution case 的 missing-punch/exception；
2. `loadAttendanceResolutionQueue(status: "UNDER_REVIEW")`：已提交给 manager 的 Attendance correction。

两者继续使用既有 canonical readers 与 canonical write services；projection 本身不写数据。

## 4. OT SEPARATION

**修复前存在 double-count risk。** unified Attendance projection 会纳入 OT candidates，而 Staff Approval Center 又通过 `getStaffOvertimeSummary()` 显示独立 OT。

最终规则：

- Attendance：只统计非 OT、且能在 Staff Attendance task center 立即采取 canonical action 的 missing punch 与 Attendance correction；
- OT：只由 `getStaffOvertimeSummary()` 与 `/staff/requests/overtime` 表示；
- Attendance summary 对 unified count 的查询明确限制为 `LEAVE`、`CLAIMS`，不会再从宽 Attendance reader带入 OT 或 Timesheet task；
- 未修改任何 OT canonical record、Payroll calculation 或 employee OT submission policy。

## 5. FINAL ATTENDANCE TASK TAXONOMY

| User-facing type | Canonical source | Manager action | Destination |
|---|---|---|---|
| **Missing punch** | Pending `AttendanceException` not linked to a Resolution Case | Approve or reject through `reviewAttendanceException()` | `/staff/requests/attendance-corrections` |
| **Attendance correction** | `AttendanceResolutionCase` with `UNDER_REVIEW` | Approve correction or return to employee through `applyManagerAttendanceResolution()` | `/staff/requests/attendance-corrections` |

UI 不再显示 `P2`、`Resolution Case`、`Final Result`、`Materialization` 或 `Canonical Task` 等内部术语。每个 task 显示员工、日期与 Branch，并提供可到达的 review CTA。

## 6. COUNT CONTRACT

### Contract

对一名已授权 manager：

```text
Approval Center Attendance pending
=
Attendance task page totalActionable
=
pendingExceptions.pagination.total
+ corrections.pagination.total
```

该 total 是 server pagination total，不是当前页 array length。

### Scope

- Tenant：current employee session `businessId`；
- Branch：server-resolved `allowedBranchIds`；不信任 client branchId；
- Capability：HR enabled + `MODIFY_ATTENDANCE_EMPLOYEES`；
- Self review：两种 readers 都传入 `excludedMembershipId = actorMembershipId`；
- Time：**all currently actionable pending items**，无隐藏 month filter；
- Status：pending unresolved exception + `UNDER_REVIEW` correction only。

### Reconciliation result

- Home `Needs my approval`：Leave + Claims + Attendance + OT；
- Approval Center total：同一四个 domains；
- Approval Center Attendance：shared Attendance projection total；
- Attendance child route：同一 shared projection total；
- OT 仍为独立 current-month domain，OT page 本身显示 month scope，不进入 Attendance。

本地 manager fixture 实测：Home/Approval Center Attendance 为 `1`，进入 Attendance 后为 `1 need attention`，且是相同员工、Branch 与 task。

## 7. ROUTING

- Old route：`/staff/requests/attendance-corrections`
- Final route：继续复用 `/staff/requests/attendance-corrections`
- User-facing page name：`Attendance`
- Compatibility handling：保留旧 URL，避免破坏既有 links/bookmarks；不为改名新增重复 page。

Approval Center Attendance card 现在直接进入该 canonical Staff task center。该页面是 projection/read-model + canonical action forms，不复制 write logic。

## 8. EMPTY STATE

Attendance filter 或 Attendance task center 为零时统一显示：

> No attendance items need your review

不再使用会与父级 `pending` 口径冲突的 `0 waiting`。Approval Center 的 All/Leave/Claims/OT 仍使用其适合的通用 empty wording。

## 9. BRANCH / TENANT / SELF REVIEW

- Business scope 来自 employee auth session，所有 queries 都带 current `businessId`；
- Branch scope 由 `resolveStaffTeamApprovalAccess()` 在 server 端通过 permissions/capabilities 解析；
- Branch-only manager 只能看到其授权 Branch；`ALL_BRANCHES` 仍只限 current Business；
- projection 和 action services 都继续执行 canonical branch guards；
- actor membership 传给两个 readers 的 `excludedMembershipId`，自己的 Attendance task 不计数、不展示、不可审批；
- direct route 缺少 access 或授权 Branch 时不返回 manager queue。

## 10. CAPABILITY

没有新增 `roleName === "Manager"` 判断。

Attendance manager visibility/actionability 的最终条件为：

- current Business 已启用 HR module；
- Business Owner，或 Staff 拥有 canonical `MODIFY_ATTENDANCE_EMPLOYEES` capability；
- 至少一个 server-authorized Branch。

缺少 capability 时：

- Attendance 不贡献 `Needs my approval`；
- Approval Center 不显示 actionable Attendance filter/card；
- direct Attendance manager route 返回 unauthorized state；
- canonical action service仍会再次执行授权与 scope guard。

## 11. MOBILE 390

Browser UAT viewport：`390 × 844`（browser CSS inner width 报告为 391，属于工具 viewport rounding）。

结果：

- Approval Center filters：All、Leave、Claims、Attendance、OT 可见；
- Attendance count 可见；
- task type、员工、日期、Branch 与 CTA 可读；
- cards 使用 compact stacked header 与 wrapping；
- `scrollWidth = innerWidth`，无水平溢出；
- long text 可换行；
- 未改 bottom navigation。

## 12. MOBILE 412

Browser UAT viewport：`412 × 915`。

结果：

- `scrollWidth = body width = 412`；
- long employee/branch names wrapping 验证通过；
- task actions reachable；
- 无 oversized card、internal terminology、duplicate information 或 horizontal overflow；
- empty state 与 loading state保持 compact。

## 13. TEST RESULTS

| Gate | Result |
|---|---|
| Unit | **1328 / 1328 PASS**（原 baseline 1323；新增 5 个 consistency tests） |
| Integration | **199 / 199 protected disposable PASS**；isolated employee-cookie Attendance route **1 / 1 PASS** |
| Staff/security | **96 / 96 PASS**（原 baseline 91；新增 tests 已纳入） |
| Attendance/Approval | **57 / 57 focused PASS**；其中本轮 consistency contract **5 / 5 PASS**，并全部包含在 full unit suite |
| TypeScript | `npx tsc --noEmit` **PASS** |
| ESLint | `npm run lint` **PASS**，0 errors；3 个既有、与本轮无关的 warnings |
| Prisma | embedded canonical local environment 下 schema validate **PASS** |
| Migration | **212 migrations found / database up to date** |
| Build | `npm run build` **PASS**；Next.js 16.3.0 webpack production build；144 static pages generated；canonical Staff routes编译成功 |
| Runtime | `https://localhost:3000/staff/login` **HTTP 200**；`/staff/manifest.webmanifest` **HTTP 200**；port 3100 **not listening** |

### Focused contract coverage

1. Parent Attendance count = child actionable total：PASS；
2. Attendance excludes OT：PASS；
3. Self-review exclusion：PASS；
4. Business scope：PASS；
5. Branch scope：PASS；
6. Missing capability hides/denies Attendance：PASS；
7. Aggregate page renders every type included by final count：PASS（Missing punch + Attendance correction）；
8. Zero tasks clean empty state：PASS；
9. Parent/child share compatible scope and projection：PASS；
10. No duplicate write model/workflow：PASS。

构建前只短暂停止了已确认属于本 workspace 的 local dev supervisor 与子进程；构建完成后 local 3000 已恢复。Prisma CLI 的 package.json config deprecation 与 Next middleware deprecation 是既有提示，不是本轮 regression。

## 14. DATA MODEL

**NO DUPLICATE APPROVAL TABLE**  
**NO DUPLICATE ATTENDANCE STATE**  
**NO NEW MIGRATION FOR THIS TASK**

本轮仅修改 Staff read projection、route presentation、mobile CSS 与 tests。所有 writes 仍委派至：

- `reviewAttendanceException()`；
- `applyManagerAttendanceResolution()`。

没有复制 `AttendanceException`、`AttendanceResolutionCase`、`AttendanceOvertimeReview`、`AttendanceMonthlyTimesheet`，也没有改变 Payroll、legal/statutory rules 或 OT canonical records。

## 15. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

本轮没有访问、启动、修改或重新引入 3100。Runtime smoke 确认 port 3100 未监听；canonical Staff App 保持在 3000。

## 16. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮未部署、未访问 Production database、未修改 Production environment variables 或 Production Staff runtime。

---

最终产品规则已经落实：

> One number. One task universe. One understandable manager experience.

Manager 看到 `Attendance — N pending` 时，点击 Attendance 会在相同授权与数据范围下看到 `N` 个可处理的 Attendance items；不会再出现数字进入后无解释地变成空 queue。
