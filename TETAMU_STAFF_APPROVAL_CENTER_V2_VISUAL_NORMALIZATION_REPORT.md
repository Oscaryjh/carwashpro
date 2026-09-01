# TETAMU STAFF APPROVAL CENTER V2 VISUAL NORMALIZATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Approval Center V2 的视觉标准化已完成并部署至 Railway Testing。产品 IA、审批 ownership、canonical workflow、权限、数据模型与 API 均未改变。

## 2. PAGE HEADER

- `/staff/approvals` 使用共享 `StaffV2PageHeader`。
- 标题为 `Approvals`，说明为 `Review requests that need your decision.`。
- 未增加 hero、dashboard card 或巨型 pending count。

## 3. PENDING / MY HISTORY TABS

- 保留且仅保留 `Pending` / `My History`。
- 改为紧凑 segmented tabs，active state 同时有文字、背景和边框表达。
- 触控高度为 44px；未改 route 或 tab semantics。

## 4. PENDING FILTERS

- `All / Leave / Claims / Attendance / OT` 保持原有 server-filtered URL 行为。
- 改为单行横向 chips，不使用 filter card、不增加 Apply。
- P2 仍归入 Attendance，没有新增 P2 tab/domain。

## 5. HISTORY FILTERS

- 保留 month、domain、employee filter 与 server pagination 20。
- month/search/Apply 使用紧凑 control；domain 继续使用 chips。
- 360px 长搜索值可 reflow，0 result empty state 保持可见。

## 6. PENDING ROWS

- Pending 使用一个 grouped surface + dividers，不再每项一张大卡。
- row 只突出 domain、employee、branch、request summary 与日期/金额/时长。
- canonical oldest-actionable-first ordering 未改。

## 7. DETAIL HIERARCHY

- detail 使用 flat `StaffV2DetailSection`。
- 顺序按 Who / What / When / amount-or-duration / Why / Evidence / Decision 呈现。
- UI 不显示 request ID、source ID 或内部 enum。

## 8. LEAVE DETAIL

- Leave request facts、duration、reason、balance 与 supporting documents 分区呈现。
- 明确保留 `Leave approval != document verification`。
- protected leave-document route 未改。

## 9. CLAIM DETAIL

- Claim amount、purpose、line items 与 receipt 使用紧凑详情/attachment row。
- 明确保留 `Approved != Paid`，没有暗示付款或 Payroll posting。
- protected claim-attachment route 未改。

## 10. ATTENDANCE DETAIL

- Manager 可读到 employee、branch、work date、recorded time、requested time 和 employee reason。
- ResolutionCase、standalone AttendanceException、P2 AttendanceCorrectionRequest 三类 canonical source 均保留。
- 决策仍委托原有 Attendance actions/services。

## 11. P2 DETAIL

- P2 保持 Attendance 子来源、parent/child count reconciliation 与 canonical write path。
- UI 只显示 `Missing clock out`、记录时间、请求时间与原因；不显示 `P2`、model 或 FinalResult 术语。
- 本地 browser fixture 使用真实 `submitAttendanceCorrectionRequest` 创建可行动项。

## 12. OT DETAIL

- 保留 Approve / Adjust / Reject。
- primary copy 使用 `1 hr 30 min` 等人类可读时长，不把 raw minutes 当主要文案。
- detail 仍从 final Attendance result 与 canonical OT reader 读取。

## 13. STICKY ACTION BAR

- Pending Leave/Claims/OT detail 使用共享 Staff V2 sticky action pattern。
- action bar 位于 64px global bottom navigation 之上，并包含 safe-area clearance。
- content bottom padding 可让最后内容完整滚到 action bar 上方。

## 14. APPROVE

- Approve 保持 direct action，没有增加确认 modal。
- primary action 视觉权重最高，原 canonical server action、revision guard 与 permission check 未变。

## 15. REJECT SHEET

- Reject 使用 compact bottom sheet；reason 继续要求 3–500 characters。
- 有 44px close/destructive controls、focus trap、Escape、body scroll lock、focus restore 与 safe-area padding。
- sheet portal 到 `document.body`，并通过独立 `portalScope` 带入 Staff V2 semantic tokens，避免透明背景和 bottom-nav 视觉穿透。
- 390×844 实测最终 `Reject request` CTA 完整可见。

## 16. OT ADJUST SHEET

- Adjust sheet 使用 Hours / Minutes / Reason，UI 不暴露 canonical minute integer。
- 仍由现有 action 转换为 minutes；reason、range、stale revision、self-review 与 Timesheet lock guards 未改。
- 390×844 实测 sheet 高 370px，无内部溢出，最终 CTA 可见。

## 17. HISTORY LIST

- My History 使用与 Pending 同一 grouped row family，但只呈现决定事实。
- 每行仅一个 primary status：Approved / Rejected / Adjusted。
- 没有 Approve、Reject、Adjust affordance。

## 18. HISTORY DETAIL

- History detail 是 read-only：`main` 内 0 form、0 button、无 sticky action bar。
- `Your decision`、decided time、reason 与 request facts 分开呈现。
- 仍只读取当前 manager 自己的 actor-owned decision history。

## 19. EMPTY STATES

- Pending：`No approvals waiting`，保持安静、紧凑。
- History：`No approval history for this period`。
- 长 employee search 的 0-result 状态已在 360×800 实测，无横向溢出。

## 20. LOADING

- Pending/History loading 使用 Header、tabs、filters 与 3 grouped row skeletons。
- Attendance/OT loading 同步为 V2 compact geometry，没有 giant loading card。

## 21. ERROR

- Approval/Attendance/OT 均有 manager-safe error boundary 和 Try again。
- 不输出 Prisma、SQL、stack、raw enum 或 actor IDs。

## 22. MOBILE 360

- Pending 360×800：`innerWidth 361 / scrollWidth 361`，PASS。
- History 360×800 长搜索/0 result：`innerWidth 361 / scrollWidth 361`，PASS。
- tabs、chips、rows、44px controls 和 bottom navigation 可用。

## 23. MOBILE 390

- Pending、Leave detail、Attendance/P2、Reject sheet、OT detail/Adjust、History list/detail 均完成浏览器实测与截图。
- `innerWidth 391 / scrollWidth 391`，PASS。
- first actionable row、Who/What/When 与 action zone 均在合理首屏层级。

## 24. MOBILE 412

- Pending 412×915：`innerWidth 412 / scrollWidth 412`，PASS。
- History 412×915：`innerWidth 412 / scrollWidth 412`，最后一行 bottom 445px、bottom nav top 850px，PASS。
- 412 保持与 390 相同 IA，没有放大 card。
- Pending 截图已保存；History 412 geometry 已通过真实浏览器 metrics 验证。最终补截图时浏览器已在 dev-server restart 后进入受策略保护的 error URL，因此未绕过浏览器安全策略重复抓取。

## 25. ACCESSIBILITY

- 每页一个 h1；tabs/filter/list/listitem/labels/role=status 保留。
- status 不只靠颜色；interactive controls 最少 44px。
- focus-visible、sheet focus trap、Shift+Tab/Tab wrap、Escape close 与 trigger focus restore 已验证。
- History detail 没有隐藏 mutation controls。

## 26. REQUESTS HUB REGRESSION

- PASS。Requests 仍为 Approvals / Leave / Claims / Attendance corrections。
- manager capability 存在时 Approvals 永久可见；Home reminder 仍只在 pending > 0 时出现。
- bottom nav 仍为 Home / Time / Requests / Pay / Profile。

## 27. LEAVE / CLAIMS REGRESSION

- PASS。Leave/Claims routes、canonical action、status semantics、attachment authorization、Leave evidence separation 与 Claim payment boundary 均未改。

## 28. ATTENDANCE CORRECTIONS REGRESSION

- PASS。Employee corrections 与 manager Attendance route 仍分离。
- ResolutionCase / standalone / P2 source projection、requested time、Return/Approve/Reject paths 保留。

## 29. MANAGER P2 REGRESSION

- PASS。P2 parent/child count、oldest ordering、branch/business scope、self-review、canonical write、locked Timesheet 与 history evidence 均由现有 tests 覆盖。
- Embedded PostgreSQL `Staff manager projection closes the canonical P2 correction lifecycle without count or scope drift` PASS。

## 30. HOME / TIME REGRESSION

- PASS。未修改 Home、Time Hub、Schedule、Attendance History、Attendance Corrections、Timesheet presentation 或 logic。
- Home 没有增加 History shortcut 或复制 Approval queue。

## 31. FILES CHANGED

主要实现：

- `src/app/staff/approvals/page.tsx`
- `src/app/staff/approvals/loading.tsx`
- `src/app/staff/approvals/error.tsx`
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`
- `src/app/staff/approvals/history/[domain]/[sourceId]/page.tsx`
- `src/app/staff/requests/attendance-corrections/{page,loading,error}.tsx`
- `src/app/staff/requests/overtime/{page,loading,error}.tsx`
- `src/app/staff/requests/overtime/[finalResultId]/page.tsx`
- `src/components/staff-pwa/staff-approval-center-v2.module.css`
- `src/components/staff-pwa/staff-approval-sheet.tsx`
- `src/components/staff-pwa/mobile-approval-form.tsx`
- `src/components/staff-pwa/mobile-overtime-approval-form.tsx`
- `src/components/staff-pwa/staff-v2-primitives.tsx`
- `src/components/staff-pwa/staff-v2.module.css`
- `scripts/prepare-approval-center-v2-browser-fixture.ts`（LOCAL-only guard）
- focused unit tests 与 `evidence/staff-approval-center-v2/*.png`

## 32. TEST RESULTS

- Focused Approval visual/canonical tests：PASS。
- Embedded PostgreSQL approval lifecycle integration：9/9 PASS。
- TypeScript `tsc --noEmit`：PASS。
- ESLint：0 errors；3 个既有、无关 warnings。
- `git diff --check`：PASS。
- Production build `next build --webpack`：PASS，145 routes generated。
- Browser widths：360 / 390 / 412 无横向溢出。
- Testing post-deploy smoke：`/api/health`、Requests、Approvals、My History、pending/history detail route、corrections route 全部 HTTP 200。

## 33. FULL UNIT STATUS

**1362 / 1362 PASS**，0 failed，0 skipped。

## 34. CSS DEBT STATUS

- 没有建立第三层 giant override file。
- 新增一个 narrow scoped CSS module，并复用 Staff V2 primitives/tokens。
- portal token scope 独立于 layout scope，避免复制整套变量或影响 body layout。

## 35. NO BACKEND CHANGE

**CONFIRMED — NO BACKEND CHANGE.**

未改变 workflow、projection、history ownership、P2 services、Attendance、Leave、Claims、OT、Timesheet、Payroll、RBAC、session/device、API 或 server filtering semantics。新增脚本仅能连接 localhost，用于 LOCAL browser fixture。

## 36. NO NEW MIGRATION

**CONFIRMED — NO NEW MIGRATION.** Prisma schema 与 migrations 均未修改。

## 37. TESTING DEPLOYMENT

- Commit: `22c6b9fe4666b32623a96e8ad62502572dc6ccb3`
- Deployment ID: `576d3ed5-8a71-4ab1-aeea-239198d2d935`
- Project / Environment / Service: `Tetamu-POS / testing / tetamu-staff-app`
- Region: Southeast Asia
- Status: **SUCCESS**
- URL: `https://tetamu-staff-app-testing.up.railway.app`

## 38. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

---

Approval Center V2 Visual Normalization 到此停止。没有继续 Pay V2 或 Profile V2，等待 owner physical-device review。
