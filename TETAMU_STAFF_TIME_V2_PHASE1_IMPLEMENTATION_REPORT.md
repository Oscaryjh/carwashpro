# TETAMU STAFF 3000 — TIME V2 PHASE 1 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Staff 3000 的共享 V2 视觉范围与轻量 Time Hub 已完成，并已从干净、受控的 Staff 3000 来源部署到 Railway **Testing**。本阶段严格停在 Time Hub；Schedule V2、Attendance History V2、Timesheet V2 尚未开始。

## 2. SHARED V2 TOKEN EXTRACTION

- 将 Home 专属的 V2 primitives 与 CSS scope 提升为中性的 `staff-v2-primitives.tsx` / `staff-v2.module.css`。
- 保留 Home V2 的既有视觉数值，并增加 canvas、surface、text、border、brand、success、warning、danger、info、spacing、radius、type、safe-area 与 bottom-clearance 语义 token。
- 共用 primitives 包含 Page Header、Hero Status、Compact Summary、List Row、Action Row、Row Group、Section Label、Status Badge、Empty State、Inline Error 与 Skeleton。
- 没有建立第三层全局 CSS override；V2 样式仍限制在 Staff V2 scope 内。

## 3. HOME REGRESSION

- Home 只更换为共享 V2 import 与中性 scope class；Attendance、GPS、确认流程、exception path 与 manager priority 逻辑未改。
- 390 × 844 与 412 × 915 实测均无横向溢出，Home / Time / Requests / Pay / Profile 底部导航保持不变。
- Home V2 截图：
  - `artifacts/staff-time-v2-phase1/home-regression-390x844.png`
  - `artifacts/staff-time-v2-phase1/home-regression-412x915.png`

## 4. TIME HUB V2

`/staff/history` 现在是轻量 personal Time map：

1. Page Header
2. Today read-only summary
3. 最多一个 employee-actionable Attendance attention row
4. `My time` grouped rows：Schedule、Attendance history、Timesheet & overtime

Hub 不渲染完整 archive、filter form、Clock In/Out、Break、GPS、manager queue 或 Approval Center。

## 5. TODAY SUMMARY

- 使用既有 `getEmployeeAttendanceToday` canonical reader。
- 支持 Ready to clock in、Clocked in、On break、Shift completed 与已工作时长的 progressive disclosure。
- Today row 只导航回 Home，不复制 Attendance mutation controls。
- Today reader 失败时仅显示该区域的 inline error；其他 Time destinations 仍可进入。

## 6. ATTENTION ROW

- 只使用 canonical `getMissingClockOutCorrectionState` 判断 employee-actionable Missing Clock Out。
- 每次最多显示一个摘要 row；多个 actionable items 折叠成单一入口与计数。
- 已 pending / waiting for manager 的项目不会显示重复 Fix CTA。
- CTA 进入 `/staff/history/records` 的对应 Attendance record；没有建立新 correction state。

## 7. SCHEDULE SUMMARY

- 使用既有 `getEmployeePublishedRoster`、leave day、branch holiday 与 `buildStaffScheduleDay` projector。
- 支持 Shift、Rest Day、Approved Leave、Public Holiday、Not Scheduled。
- 没有把 “No schedule” 猜成 Rest Day。
- 目标 route 保持 `/staff/roster`。

## 8. ATTENDANCE HISTORY ENTRY

- Hub 只显示 compact destination row，不加载 archive UI。
- 完整 Attendance archive、filter 与 correction workflow 已保存在 `/staff/history/records`。
- archive 页面名称统一为 `Attendance history`。

## 9. TIMESHEET SUMMARY

- 使用既有 `getEmployeeTimesheetOverview` read model。
- 显示当月状态，以及需要处理 / waiting / final / up-to-date 的个人摘要；pending OT 计入需要处理的数量。
- 没有加入 Payroll 或 OT mutation，也没有改变 projection 规则。
- 目标 route 保持 `/staff/timesheet`。

## 10. ROUTING

| Entry | Canonical route |
|---|---|
| Bottom Time tab | `/staff/history` |
| Today | `/staff` |
| Schedule | `/staff/roster` |
| Attendance history | `/staff/history/records` |
| Timesheet & overtime | `/staff/timesheet` |

旧 `/staff/history#attendance-correction` 由 client compatibility redirect 转到 `/staff/history/records#attendance-correction`。Requests 与 Home 的 archive deep links 也已指向 child route。

## 11. LEGACY HUB CONTENT REMOVED

- 从 `/staff/history` 移除 full filters、archive cards、pagination 与 correction form。
- 这些能力没有删除，全部保存在 `/staff/history/records`。
- archive 内旧的重复 Time navigation tile 已移除，避免 Hub → archive → Hub 的重复入口。

## 12. MOBILE 360

- Viewport：360 × 800 class（browser effective width 361）。
- `scrollWidth === innerWidth`，无横向溢出。
- 四个主要 row 均为 64px 高；最后一行完全位于 fixed nav 上方。
- 截图：`artifacts/staff-time-v2-phase1/time-hub-360x800.png`

## 13. MOBILE 390

- Viewport：390 × 844（browser effective width 391）。
- `scrollWidth === innerWidth`，无横向溢出。
- Bottom nav top 约 779px，最后一行 bottom 约 372px，无遮挡。
- 截图：`artifacts/staff-time-v2-phase1/time-hub-390x844.png`

## 14. MOBILE 412

- Viewport：412 × 915。
- `scrollWidth === innerWidth`，无横向溢出。
- Bottom nav top 约 850px，最后一行 bottom 约 374px，无遮挡。
- 截图：`artifacts/staff-time-v2-phase1/time-hub-412x915.png`

## 15. ACCESSIBILITY

- 页面只有一个 `h1`。
- Today 与 grouped destinations 使用 region / list / listitem 语义及明确 aria-label。
- 状态同时提供文字，不依赖颜色。
- row 与 action focus-visible 样式已加入。
- 主要触控行实测 64px，高于 44px 最低目标。
- meaningful inline error 使用 `role=alert`；loading route 使用 `aria-busy`。
- `prefers-reduced-motion` 会关闭 skeleton 动画与 smooth scrolling。

## 16. FILES CHANGED

- `src/app/staff/history/page.tsx`
- `src/app/staff/history/loading.tsx`
- `src/app/staff/history/records/page.tsx`
- `src/app/staff/requests/page.tsx`
- `src/components/staff-pwa/staff-history.tsx`
- `src/components/staff-pwa/staff-home-overview.tsx`
- `src/components/staff-pwa/staff-today.tsx`
- `src/components/staff-pwa/staff-time-hub.tsx`
- `src/components/staff-pwa/staff-time-hub-legacy-redirect.tsx`
- `src/components/staff-pwa/staff-v2-primitives.tsx`
- `src/components/staff-pwa/staff-v2.module.css`
- `src/lib/staff-pwa/time-hub.ts`
- `tests/unit/staff-time-hub-v2.test.ts`
- `tests/unit/staff-home-v2.test.ts`
- `tests/unit/staff-android-home-manager-ux.test.ts`
- `tests/unit/staff-pwa.test.ts`

旧 `staff-home-v2-primitives.tsx` 与 `staff-home-v2.module.css` 以 Git rename 方式提升为共享 Staff V2 文件。

## 17. TEST RESULTS

- `npx tsc --noEmit` — PASS。
- Focused ESLint — PASS，0 error / 0 warning。
- Full workspace ESLint — PASS，0 error；5 个与本阶段无关的既有 warning。
- Focused Time/Home/Staff PWA/Attendance correction tests — **64 pass / 0 fail**。
- `npm run build` — PASS（dirty development workspace 验证）。
- `npm run build` — PASS（clean controlled deployment source 再验证）。
- 360 / 390 / 412 browser mobile checks — PASS：无 horizontal overflow、无 bottom-nav overlap、触控目标合格。
- Browser console — 0 error / 0 warning。

## 18. NO BACKEND CHANGE

**CONFIRMED.**

没有修改 Attendance、Clock In/Out、Break、GPS/geofence、Leave、Claims、Payroll、OT、RBAC、session/device 或 Approval Center 行为。新增的 `time-hub.ts` 只是组合既有 canonical readers/projectors 的 read-only presentation adapter；没有新增 API endpoint、mutation、duplicate state 或 provider side effect。

## 19. NO NEW MIGRATION

**NO NEW MIGRATION.**

Prisma schema 与 migrations 均未因本阶段改变。

## 20. TESTING DEPLOYMENT

- Environment：`testing`
- Service：`tetamu-staff-app`
- Region：Southeast Asia
- Controlled source branch：`codex/staff-time-v2-phase1`
- Implementation commit：`5dacfc1`
- Deployment ID：`b525fc32-dd48-4042-9128-35a287732032`
- Status：**Online / health OK / database ready**
- Testing URL：`https://tetamu-staff-app-testing.up.railway.app/staff`
- Unauthenticated `/staff/history` smoke：正确导向 `/staff/login`。

## 21. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

---

STOP RULE：本轮已停在 Time Hub V2。Schedule V2、Attendance History V2、Timesheet V2 必须等 owner 完成实体手机 review 后再开始。
