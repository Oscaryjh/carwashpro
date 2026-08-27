# TETAMU Real Device UAT — Attendance Correction Mobile UX

## 1. Scope

本轮只处理 Testing Staff App 的 Attendance History → Report issue → Report a missing punch 表单在 iPhone 上被固定底部导航遮挡的问题。没有修改 Attendance、Timesheet 或 Payroll 的业务逻辑，也没有提交任何真实 Attendance Correction。

## 2. Final verdict

代码修复及自动化检查已完成。服务器端 Testing 部署完成后仍需真实 iPhone 人工复测，因此最终状态为 **HUMAN RETEST REQUIRED**。

## 3. Reported journey

真实员工路径：Time → Attendance History → Report issue → Report a missing punch。问题在打开原生日期／时间选择器后更明显：表单内容高度增加，Submit for review 位于自然文档流底部，而固定 Staff 导航继续覆盖视口底部。

## 4. Component trace

- Attendance History 与 Correction Sheet：`src/components/staff-pwa/staff-history.tsx`
- Staff Shell 与固定底部导航：`src/components/staff-pwa/staff-pwa-chrome.tsx`
- Staff 移动端样式：`src/app/staff/staff.css`
- 回归检查：`tests/unit/staff-pwa.test.ts`、`tests/unit/staff-attendance-history.test.ts`

## 5. Root cause

Correction Sheet 原本整张卡片使用 `overflow-y: auto`，Submit 按钮是表单最后一项；同时 Staff bottom navigation 使用 fixed positioning 并保持显示。小屏幕和 iOS 原生 date/time picker 改变可用视口后，Submit 会落在导航后面或需要不直观的外层滚动才能触达。卡片没有独立的内容滚动区，也没有固定于卡片内的操作 footer。

## 6. Bottom sheet structure

Correction Sheet 现在是受高度约束的 flex column。表单拆成两个区域：

- `.staff-correction-body`：字段内部滚动区。
- `.staff-correction-footer`：不收缩的操作区，始终保留 Submit for review。

Filter Sheet 仍保留原有行为，避免把 Attendance filter 一并重写。

## 7. Bottom navigation interaction

Staff Shell 新增任务式 overlay 状态。Correction Sheet 或 Attendance Filter 打开时，固定 bottom navigation 会隐藏；关闭或组件卸载时自动恢复。这样避免导航与 modal 同时争夺 iPhone 底部区域。

## 8. Safe area

移动端 footer 使用 `env(safe-area-inset-left/right/bottom)`，底部 padding 为 `calc(14px + env(safe-area-inset-bottom))`，使主要操作避开 iPhone Home Indicator。

## 9. Viewport height

Correction Sheet 继续使用 `max-height: calc(100dvh - 32px)`。`dvh` 会随 iOS 浏览器动态工具栏和原生选择器导致的可用视口变化而调整，不依赖静态 `100vh`。

## 10. Internal scroll

字段区域使用 `overflow-y: auto`、`min-height: 0`、`-webkit-overflow-scrolling: touch` 与 `overscroll-behavior-y: contain`。modal 开启时 Staff 主内容滚动被锁定，避免背景页面与 sheet 发生双重滚动。

## 11. Submit action visibility

Submit 已移到独立 footer，footer 不参与字段滚动且按钮保持 100% 宽度和至少 52px 高度。即使字段区需要滚动，提交操作仍位于 sheet 可见范围内。

## 12. Mobile width matrix

- 375px：使用 `max-width: 640px` 的移动端规则；footer、安全区和内部滚动生效，结构检查 PASS。
- 390px：使用相同移动端规则；Submit 可达结构检查 PASS。
- 430px：使用相同移动端规则；footer、安全区和内部滚动生效，结构检查 PASS。

自动浏览器控制接口在本轮不可用，因此这三项是代码结构与回归断言结果，不冒充真实设备视觉截图；最终仍要求 iPhone 人工复测。

## 13. Date/time picker

`datetime-local` 字段及其值、required 条件和提交 payload 均未改动。修复只改变容器滚动和 footer 布局，因此原生 date/time picker 关闭后 Submit 仍应保留在 sheet 内。真实 iOS picker 行为需人工复测。

## 14. Shift selector audit

25 Aug 的 Resolved 项目不出现在 Attendance shift selector 是预期行为。selector 只列出未锁定、尚无 clock-out、且 punch status 不是 COMPLETED/CANCELLED 的可操作 session。已经 Resolved／完成的记录不会再次成为 Forgot clock out 的目标。

## 15. Regression boundaries

没有修改 correction API、payload、验证、幂等、Attendance canonical records、Timesheet 或 Payroll。Leave、Claims、Requests、Pay、Profile、Time 的页面逻辑未改。Staff navigation 只在本地 overlay 打开期间隐藏，关闭时恢复。

## 16. Verification and tests

- Attendance/Staff 相关单元测试：42/42 PASS。
- 全量 unit tests：1163/1163 PASS。
- TypeScript：PASS。
- ESLint：PASS，0 errors；7 个既有、与本次无关的 warnings。
- `git diff --check`：PASS。
- Next production build：PASS（143/143 routes）。
- 初次 `npm run build` 被本机正在运行服务锁住 Prisma Windows DLL；使用已生成的 Prisma Client 直接执行同一 Next production build 后完整通过。

## 17. Testing deployment and human retest

- Staff branch：`codex/staff-ui-testing-integration`
- Commit：`8f2f22c`
- Target service：Railway Testing `tetamu-staff-app`
- Testing deployment：`4a346cee-31b4-4969-a9e2-62282fe0b4d2`（SUCCESS）
- Target URL：`https://tetamu-staff-app-testing.up.railway.app/staff/login`
- HTTPS checks：`/staff/login` 200；`/api/health` 200。
- Production touched：NO。
- Human retest：REQUIRED。请在真实 iPhone 以 390px 左右视口打开 missing punch sheet，分别测试 Forgot clock in／Forgot clock out、打开及关闭 date/time picker、滚动字段区、确认 Submit 一直可见；不要实际提交。
