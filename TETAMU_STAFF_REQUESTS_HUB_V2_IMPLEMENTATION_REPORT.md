# TETAMU STAFF 3000 — REQUESTS HUB V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**IMPLEMENTATION READY / OWNER PHYSICAL-DEVICE REVIEW PENDING**

Requests Hub V2 已完成、通过自动化与本地 authenticated mobile UAT，并已从 clean controlled Staff 3000 source 部署到 Railway Testing。页面现在是纯 gateway：普通员工只看到个人请求入口；有实际 approval capability 的员工永久看到 Approvals 入口。

本轮没有改变任何 Leave、Claims、Attendance、OT 或 Approval canonical workflow。最终 owner physical-device sign-off 仍由 owner 在 Testing iPhone / Android 上执行。

## 2. APPROVAL CENTER CANONICALIZATION GATE

**PASS**

- 单一 Manager destination：`/staff/approvals`。
- Home 的 pending reminder 行为不变。
- Requests 的 Approvals 是 capability-driven permanent entry。
- 没有新增 approval table、history table、domain status 或另一套 approval workflow。
- OT 只作为 Approval Center 内的 review domain；没有员工 OT request 入口。

## 3. PAGE STRUCTURE

最终层级：

1. Page Header：`Requests`
2. Manager Approvals action row（只有 capability 存在时）
3. `MY REQUESTS` grouped rows
   - Leave
   - Claims
   - Attendance corrections
4. 固定 bottom navigation：Home / Time / Requests / Pay / Profile

旧 card wall、Recent Activity mixed feed、OT explanatory note 与重复 status presentation 已移除。

## 4. NORMAL STAFF

- Header copy：`Manage your leave, claims and attendance corrections.`
- 不显示 Approvals。
- 只显示 entitlement 允许的个人入口。
- 实际本地 authenticated UAT 已确认 Leave、Claims、Attendance corrections 三行完整显示。

## 5. MANAGER PENDING

- Header copy：`Manage your requests and team approvals.`
- Approvals row 显示 canonical aggregate：`N waiting for you`。
- 本地真实 Manager fixture 验证为 `1 waiting for you`。
- Approvals 后仍完整显示 Manager 本人的 Leave、Claims、Attendance corrections。

## 6. MANAGER ZERO PENDING

- capability 仍存在时，Approvals row 不会消失。
- meta 显示 `All clear`。
- 使用 reversible LOCAL fixture 验证：唯一 Attendance pending fixture 临时由 `PENDING` 改为 `CANCELLED`，截图后立即恢复原始 `PENDING`，reviewer、review time、review note 均保持 null；没有生成审批或 audit decision。

## 7. APPROVALS ENTRY

- Destination：`/staff/approvals`
- Label：`Approvals`
- Pending：`N waiting for you`
- Zero：`All clear`
- Partial summary failure + capability known：`Unavailable`
- 不显示 `Team approvals`、内部 canonical jargon 或虚假 all-clear。

## 8. APPROVAL CAPABILITY

入口不依赖 role display name。它复用现有：

- `resolveStaffTeamApprovalAccess`
- `resolveStaffOvertimeAccess`
- `getStaffTeamApprovalSummary`
- `getStaffOvertimeSummary`

capability 仍受 Business、Branch、module entitlement、direct staff permission、self-review 与现有 approval policy 限制。

## 9. LEAVE ENTRY

- Destination：`/staff/leave`
- Copy：`Balances, requests and history`
- 仅在 HR module enabled 时出现。
- 没有改变 balance、submission、document 或 decision workflow。

## 10. CLAIMS ENTRY

- Destination：`/staff/claims`
- Copy：`Expenses you've submitted`
- 仅在 Claims module enabled 时出现。
- 没有改变 receipt、submission、approval、reimbursement 或 payroll boundary。

## 11. ATTENDANCE CORRECTIONS ENTRY

- Employee destination：`/staff/history/records`
- Copy：`Missing or incorrect attendance`
- 明确没有指向 Manager queue `/staff/requests/attendance-corrections`。
- correction eligibility、duplicate prevention、Timesheet lock 与 canonical Attendance workflow 均保持。

## 12. ROUTE SAFETY

- 未认证 Staff session 继续由既有 Staff auth guard 处理。
- Manager direct routes 继续在 server 端验证 tenant、branch、capability 与 self-review。
- Employee correction route 与 Manager attendance queue 仍是两个不同授权 surface。
- Workplace switch 后所有 summary 重新按当前 authenticated business/membership 读取。

## 13. OT REMOVAL

Requests Hub 没有 OT row、Submit OT、Request OT 或 OT explanatory card。Manager OT review 仍只在 canonical Approval Center 中出现，员工 Timesheet 的 read-only OT presentation 不变。

## 14. RECENT ACTIVITY DECISION

旧 mixed Recent Activity feed 已删除。原因：它重复 Leave / Claims / Attendance 各自的 canonical history，又把不同 domain status 混在同一视觉层级。Requests Hub 现在只负责 routing，不再维护第二套 derived activity state。

## 15. COPY

采用简短员工语言：

- Requests
- Manage your leave, claims and attendance corrections.
- Manage your requests and team approvals.
- My requests
- Balances, requests and history
- Expenses you've submitted
- Missing or incorrect attendance
- N waiting for you / All clear / Unavailable

没有 policy revision、snapshot、materialization、canonical workflow 等内部术语。

## 16. LOADING / PARTIAL FAILURE

- 新增 compact loading route，固定三行 skeleton，不使用 giant card。
- Team / OT summaries 以 `Promise.allSettled` 隔离。
- 已知 capability 但 summary 失败：只把 Approvals meta 降级为 `Unavailable`。
- 个人 Leave / Claims / Attendance corrections rows 继续显示。
- capability 本身无法安全确认时 fail closed，不暴露 Manager entry。

## 17. MOBILE 360 RESULT

- Requested viewport：360 × 800；browser effective viewport：361 × 801。
- `scrollWidth === clientWidth === innerWidth === 361`。
- 三个个人 row 均为 64px 高。
- Requests bottom tab 正确 active。
- 无横向 overflow，最后一行完全位于 fixed nav 上方。

## 18. MOBILE 390 RESULT

- Requested viewport：390 × 844；browser effective width：391。
- Normal Staff：`scrollWidth === clientWidth === innerWidth === 391`。
- Manager pending / zero：四个 action/list rows 全部可见，Approvals 68px，个人 rows 64px。
- fixed nav top 为 779px；最后一行 bottom 为 356px，完全不被遮挡。

## 19. MOBILE 412 RESULT

- Viewport：412 × 915。
- `scrollWidth === clientWidth === innerWidth === 412`。
- 三个个人 rows 均为 64px。
- fixed nav top 为 850px；最后一行 bottom 为 276px。
- 无横向 overflow 或 bottom-nav overlap。

## 20. ACCESSIBILITY

- 页面只有一个 `h1`。
- Group 使用可读 section label 与 row-group label。
- 每个 row 有明确 `ariaLabel`，包含 destination 与语义。
- 主要 touch rows 为 64–68px，超过 44px minimum。
- icon 为辅助视觉，title/meta 提供文字语义。
- long meta 可由共享 V2 row layout 收缩/换行，不制造横向滚动。

## 21. APPROVAL CENTER REGRESSION

PASS：permanent capability entry、pending/zero copy、Leave/Claims/Attendance/OT canonical destinations、manager-owned history、rejection UI 与 direct-route guards 的相关 unit tests 全部通过。

## 22. HOME REGRESSION

PASS：Home 仍只在 pending > 0 时显示 `Needs My Approval` reminder；本轮没有改变 Home presentation、Attendance hero 或 action logic。

## 23. TIME REGRESSION

PASS：Time Hub、Schedule、Attendance History、Timesheet & OT 的既有 unit regression 全部通过。Bottom navigation 仍为 Home / Time / Requests / Pay / Profile。

## 24. LEAVE / CLAIMS REGRESSION

PASS：Requests 只更换 gateway presentation；Leave / Claims services、submission、documents、approval、payment/reimbursement boundary 均未修改。

## 25. SECURITY

- Normal Staff 无 capability 时不显示 Approvals。
- Manager capability 来自 server-side canonical access resolvers。
- 没有 client-provided businessId、branchId、membershipId 或 permission 判断。
- Self-review、tenant scope、branch scope、module entitlement、stale revision 与 Timesheet/finalization guard 没有放宽。
- Summary failure 不会误报 `All clear`。

## 26. FILES CHANGED

- `src/app/staff/requests/page.tsx` — Requests Hub V2 gateway。
- `src/app/staff/requests/loading.tsx` — compact V2 loading state。
- `src/lib/staff-pwa/requests-hub.ts` — existing approval readers 的 page-level resilient orchestration。
- `src/app/staff/staff-consolidation.css` — 删除已不再使用的 legacy `.staff-manager-approval-link` rules。
- `tests/unit/staff-requests-hub-v2.test.ts` — V2 structure、copy、capability、failure、navigation tests。
- `tests/unit/staff-pwa.test.ts`
- `tests/unit/staff-approval-center-v2.test.ts`
- `tests/unit/staff-mobile-attendance-corrections.test.ts`
- `tests/unit/staff-manager-overtime-approval.test.ts`

## 27. OLD → NEW MAPPING

| Old | New |
|---|---|
| Separate large request cards | One compact grouped list |
| Legacy Manager approval card CSS | Shared `StaffV2ActionRow` |
| Mixed Recent Activity feed | Domain-owned history pages |
| OT explanatory note | Removed; OT remains in Timesheet / Approval Center |
| Page-owned activity aggregation | No duplicate activity state |
| Summary failure could fail whole page | Manager row degrades to `Unavailable` |

## 28. TESTS

- Focused Requests / Approval / Attendance / OT / Staff regression：**66 / 66 PASS**。
- Full unit suite：**1302 / 1302 PASS**。
- TypeScript：**PASS**。
- ESLint：**0 errors, 3 pre-existing unrelated warnings**。
- `git diff --check`：**PASS**。
- Next 16.3.0 webpack production build：**PASS**。

## 29. CSS DEBT

- 没有创建第三层 giant override stylesheet。
- 复用现有 shared Staff V2 semantic scope 与 primitives。
- 只删除 Requests 已不使用的 6 条 legacy Manager-link selectors。
- 没有修改 global POS shell 或其他 Staff page visual contract。

## 30. NO BACKEND CHANGE CONFIRMATION

**NO DOMAIN / API / WORKFLOW BACKEND CHANGE**

新增 `requests-hub.ts` 只是 server page 的 read orchestration：调用现有 canonical summary/access functions 并隔离 partial failure。没有新增 endpoint、mutation、domain model、state owner 或 business rule。

## 31. NO NEW MIGRATION

**NO NEW MIGRATION**

Prisma schema 与 migrations 未修改。

## 32. SCREENSHOTS

- Normal 360：`artifacts/staff-requests-hub-v2/normal-360x800.png`
- Normal 390：`artifacts/staff-requests-hub-v2/normal-390x844.png`
- Normal 412：`artifacts/staff-requests-hub-v2/normal-412x915.png`
- Manager pending 390：`artifacts/staff-requests-hub-v2/manager-pending-390x844.png`
- Manager zero 390：`artifacts/staff-requests-hub-v2/manager-zero-390x844.png`

## 33. TESTING DEPLOYMENT

- Controlled source branch：`codex/staff-requests-hub-v2`
- Deployed commit：`daae68296e17a5e651509e9fd555aa07d5783563`
- Railway service：`tetamu-staff-app`
- Railway environment：`testing`
- Region：Singapore (`asia-southeast1-eqsg3a`)
- Deployment ID：`8fd65416-1158-479f-a759-b1ae5fe8715a`
- Deployment status：**SUCCESS**
- `/api/health`：`ok: true`, `database: ready`, `environment: testing`, matching deployment ID
- `/staff/login`：HTTP 200
- `/staff/requests`：HTTP 200; unauthenticated smoke did not expose Manager data

## 34. PRODUCTION STATUS

**LOCAL / TESTING ONLY**

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

**NO NEW MIGRATION**

