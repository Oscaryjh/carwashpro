# TETAMU STAFF SCHEDULE V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Schedule V2 已在 Staff 3000 的稳定路由 `/staff/roster` 完成。实现只调整员工端展示层；canonical Schedule、Leave、Public Holiday、Roster publication、Attendance 与 Timesheet 规则均未改变。

## 2. PAGE STRUCTURE

最终层级为 Page Header → Week Period Navigator → 单一 grouped week surface → 7 个紧凑日行 → 一行简短说明。已移除独立 Today 大卡和逐日卡片堆叠。

## 3. WEEK NAVIGATION

保留既有 `?week=YYYY-MM-DD` 查询行为。前后周 accessible label 包含目标期间，控制尺寸为 44px；非当前周显示紧凑 Today 返回动作。

## 4. TODAY ROW

Today 只在当前周对应日行内以文字与细微视觉强调表示，不依赖颜色，也没有第二个 Today hero。

## 5. SCHEDULED SHIFT

单一班次默认显示员工友好的 12 小时时间和班次名称；Branch、休息及 expected working time 放入按需展开详情。

## 6. REST DAY

Canonical `REST_DAY` 独立显示为 `Rest day`，保持非交互紧凑行。

## 7. PUBLIC HOLIDAY

Public Holiday 与假日名称保持独立事实；若与班次同时存在，班次仍为主信息，假日作为 secondary evidence 保留在行与详情内。

## 8. APPROVED LEAVE

Approved Leave 使用 canonical Leave label，并显示 `Approved leave`，不重新推断 Leave precedence。

## 9. NO SCHEDULE

`NOT_SCHEDULED` 或没有发布排班显示 `No schedule`，不会转换为 Rest day。

## 10. MULTIPLE SHIFTS

默认行显示班次数量与首末时间范围；展开后逐笔保留各 canonical shift、时间、Branch、休息及 expected working time，不合并成虚假的连续班次。

## 11. CROSS-MIDNIGHT

跨夜班显示 `Ends next day`，展开详情用 assignment `timezoneSnapshot` 显示准确开始与结束日期边界，不使用设备时区推断。

## 12. BRANCH DE-DUPLICATION

全周共同 Branch 不逐行重复；不同 Branch 才显示在相关行；多班次不同 Branch 保留在各 shift 详情中。

## 13. PROGRESSIVE DISCLOSURE

默认只保留日期、时间/状态、班次名和必要例外。只有存在有意义详情的行才有 chevron 与原生 keyboard-safe `<details>`；简单状态行不伪装成可点击项。

## 14. EMPTY WEEK

整周没有 useful facts 时只显示紧凑 Empty State：`No schedule this week`，无插画、无人工最小高度、无 7 条重复空状态。

## 15. MOBILE 360

PASS。配置为 360×800 class；IAB 报告 content viewport 361×801，`scrollWidth === innerWidth`，无水平溢出，7 行均为 56px，期间控制 44px，最后一行位于底部导航上方。

## 16. MOBILE 390

PASS。配置为 390×844；IAB content viewport 为 391×844，`scrollWidth === innerWidth`，期间控制 44px，7 行均完整，底部导航没有遮住内容。

截图：[schedule-v2-390x844.png](C:/CodexTetamuP0-staff-testing-deploy-20260830/artifacts/staff-schedule-v2/schedule-v2-390x844.png)

## 17. MOBILE 412

PASS。412×915 实测 `scrollWidth === innerWidth`，DOM/层级与 390 相同，没有放大卡片或增加多余空白。

截图：[schedule-v2-412x915.png](C:/CodexTetamuP0-staff-testing-deploy-20260830/artifacts/staff-schedule-v2/schedule-v2-412x915.png)

## 18. ACCESSIBILITY

保留单一语义 h1、带目标期间的导航 accessible labels、Today `aria-current="date"`、44px 导航触控、完整 expandable row accessible name、装饰 chevron、focus-visible、reduced motion，以及原生键盘安全详情展开。

## 19. HOME REGRESSION

PASS。Home V2 单元回归通过；390 class 浏览器实测没有水平溢出，底部导航仍为 Home / Time / Requests / Pay / Profile。

## 20. TIME HUB REGRESSION

PASS。Time Hub V2 单元回归通过；390 class 浏览器实测 h1 为 `Time`，没有水平溢出，导航未改变。

## 21. FILES CHANGED

- `src/app/staff/roster/page.tsx`
- `src/app/staff/roster/loading.tsx`
- `src/app/staff/roster/error.tsx`
- `src/components/staff-pwa/staff-schedule-v2.tsx`
- `src/components/staff-pwa/staff-schedule-v2.module.css`
- `src/lib/staff-pwa/schedule-v2.ts`
- `src/components/staff-pwa/staff-v2-primitives.tsx`
- `src/components/staff-pwa/staff-v2.module.css`
- `src/app/staff/staff.css`
- `src/app/staff/staff-consolidation.css`
- `tests/unit/staff-schedule-v2.test.ts`
- `tests/unit/public-holiday-foundation.test.ts`
- `tests/unit/roster-shift-scheduling-phase1.test.ts`
- `artifacts/staff-schedule-v2/schedule-v2-390x844.png`
- `artifacts/staff-schedule-v2/schedule-v2-412x915.png`

## 22. TEST RESULTS

- Focused Schedule + Staff/Home/Time/Navigation unit regression: **86 passed, 0 failed**
- Leave interaction unit regression: **25 passed, 0 failed**
- Local PostgreSQL Roster/Public Holiday integration: **6 passed, 0 failed**
- TypeScript `tsc --noEmit`: **PASS**
- Focused ESLint: **PASS（0 errors, 0 warnings）**
- `git diff --check`: **PASS**
- Next.js 16.3 production build (`next build --webpack`): **PASS**
- Browser console error/warning audit: **0**
- State coverage: one shift, Rest Day, Public Holiday, Approved Leave, No Schedule, multiple shifts, cross-midnight, common/different Branch、shift + holiday coexistence、empty week。

## 23. NO BACKEND CHANGE

确认没有修改 Roster business rules、schedule resolution、Expected Attendance、Attendance、Leave、Public Holiday、Timesheet、OT、Payroll、RBAC、session/device、API mutation 或 canonical data。新增 `schedule-v2.ts` 只把既有 canonical read model 转成员工展示模型。

## 24. NO NEW MIGRATION

**NO NEW MIGRATION。** Prisma schema 与 migrations 未修改。

## 25. TESTING DEPLOYMENT

- Commit: `b06d3fc` (`feat(staff): implement Schedule V2`)
- Deployment ID: `cac198f4-431f-4d49-8fe2-d20891b29033`
- Status: `SUCCESS / Online`
- Target: Railway `testing` / `tetamu-staff-app`
- Health smoke: `/api/health` returned `ok: true`, `database: ready`, `environment: testing`, and the matching Deployment ID.
- Route smoke: `/staff/roster` returned HTTP 200.

## 26. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

本轮到 Schedule V2 为止；没有继续 Attendance History V2、Timesheet V2 或 Requests V2。

