# TETAMU STAFF LIVE OT SELF-REVIEW ROOT CAUSE REPORT

## 1. FINAL VERDICT

**REVIEW REQUIRED（服务器修复已验证，等待 Owner 在实体 Android 刷新后作最后确认）**

- Railway Testing 的当前服务器响应已经不再向 `0128793848` 返回自己的 OT。
- OT queue 与 OT summary 均为 `2`，只包含 `Louis stylist` 与 `test`。
- 自己的 OT 详情不可读取，Approve / Adjust / Reject 均被服务端拒绝，且没有写入 review。
- 按本任务的最终规则，实体设备证据优先；Owner 尚未在最终部署后提供实体 Android 复测结果，因此不把最终状态写成 PASS。

## 2. CURRENT PHYSICAL SESSION

- actorAccountId: `7260972a-e431-4ea1-bc69-b604a997ef0a`
- actorMembershipId: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`
- sessionId: `00228f86-4079-4ea0-916e-7175bb7bbb84`
- Business: `Royal Salon` (`611b0c19-ebf7-4548-8a48-a3b6a7af8a81`)
- Branch: `salon online` (`41575966-238f-46ab-a114-22bbee4949c5`)
- attendanceBranchId: `41575966-238f-46ab-a114-22bbee4949c5`
- deviceId: `7fb13239-9037-46fc-9ff2-29badd193265`
- session createdAt: `2026-08-31T03:29:56.256Z`
- session lastActiveAt（审计时）: `2026-08-31T07:39:24.023Z`
- 修复验证部署: `f3cb9e8f-8e12-43da-8d1a-7265d06a0249`

该会话确实选中了 Royal Salon / salon online，不是由页面显示文字推断。

## 3. ANDROID ACCOUNT MEMBERSHIPS

`0128793848` 对应 EmployeeAccount `7260972a-e431-4ea1-bc69-b604a997ef0a`，有两笔 active membership：

1. Royal Salon
   - membershipId: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`
   - employeeCode: `UAT-PAYROLL-001`
   - display name: `Real Device UAT Manager`
   - StaffUser: `c3d2481a-03e4-4da0-8279-5ff3ace7fefe`
   - role: `STAFF`
   - role profile: `Staff 3000 Real Device UAT Manager`
   - capabilities: `APPROVE_LEAVE`, `REVIEW_CLAIM`, `ATTENDANCE_EMPLOYEE_READ`, `ATTENDANCE_EMPLOYEE_MANAGE`, `ROSTER_VIEW`
   - 当前实体 Android actor membership。

2. Payroll UAT Business
   - membershipId: `091ba7be-ced0-418b-8cf9-526921f10866`
   - employeeCode: `UAT-PAYROLL-001`
   - display name: `Real Device Payroll UAT Staff`
   - 没有 linked StaffUser。

另外 Royal Salon 内存在一笔旧 UAT manager identity：

- accountId: `f0db56e5-79a8-4521-b1c5-12cc25c3863c`
- membershipId: `3ed1909b-f624-49cb-9457-efecec9e776a`
- StaffUser: `5840c06f-fd53-4d8f-8983-e70d0011f876`
- display name 同样是 `Real Device UAT Manager`
- 这不是当前 Android account/membership，但旧 OT fixture 绑定到了它。

## 4. LIVE OT ROWS

### Louis

- AttendanceP2FinalResult: `113e3f55-90ec-4be6-a69a-ecd573c5905b`
- membershipId: `1857af15-5228-44df-a9d5-59a616c43d94`
- employeeAccountId: `c048de2b-084f-469c-90c6-054a684cc4f1`
- StaffUser: `9ec11bf3-ded9-4c03-8a20-41a8451c0c91`
- date: `2026-08-22`
- branch: salon online
- status: `PENDING_REVIEW`

### Manager

旧错误 fixture：

- AttendanceP2FinalResult v1: `cd04940c-3179-4dde-9033-4ed55ea47155`
- membershipId: `3ed1909b-f624-49cb-9457-efecec9e776a`
- employeeAccountId: `f0db56e5-79a8-4521-b1c5-12cc25c3863c`
- StaffUser: `5840c06f-fd53-4d8f-8983-e70d0011f876`
- date: `2026-08-21`
- status before reconciliation: `PENDING_REVIEW`

修复后的 canonical current-person fixture：

- AttendanceP2FinalResult: `f80f1efc-5991-4c32-9d80-76cc8454fb1c`
- membershipId: `72f21dad-66d0-45fc-a326-2a8c5f55ffdb`
- employeeAccountId: `7260972a-e431-4ea1-bc69-b604a997ef0a`
- StaffUser: `c3d2481a-03e4-4da0-8279-5ff3ace7fefe`
- date: `2026-08-21`
- candidate 仍存在于 DB，但 actor queue 与 detail 均排除。

旧 duplicate-persona evidence 通过 immutable superseding result `7687407c-4bb6-424d-ab90-6e7c8e2ef389` 退役；旧 v1/v2 均保留作审计证据。

### test

- AttendanceP2FinalResult: `1aa1909b-caf4-4941-9d2d-44acdade3894`
- membershipId: `6ea5dacf-83fa-4e8a-8bf4-9771e80ef1dc`
- employeeAccountId: `803af750-5b22-4fb4-9290-24b650e21514`
- StaffUser: `268b3a99-042a-446f-b6ae-750cd8503463`
- date: `2026-08-20`
- branch: salon online
- status: `PENDING_REVIEW`

## 5. ACTOR VS SUBJECT ID COMPARISON

实体 Android actor membership：

`72f21dad-66d0-45fc-a326-2a8c5f55ffdb`

旧 Manager OT subject membership：

`3ed1909b-f624-49cb-9457-efecec9e776a`

两者不同。旧记录甚至属于另一个 EmployeeAccount，因此部署的 membership self-filter 按数据库事实正确地没有把它当作自己。它们只是共享相同 display name/persona，是 Testing fixture identity collision。

修复后的 Manager OT subject membership：

`72f21dad-66d0-45fc-a326-2a8c5f55ffdb`

现在与 actor membership 相同，因此 canonical membership self-review rule 能正确排除。

## 6. SERVER VS CLIENT RESULT

故障不是 PWA/React stale state。修复前最新服务器 response 本身返回 3 项并包含旧 Manager OT。证据：受保护的 server-side diagnostic 通过真实 active session context 调用同一 OT reader，得到 3 项。

修复后服务器 response：

- queue pending: `2`
- summary pending: `2`
- items: `Louis stylist`, `test`
- own Manager item: 不返回

Staff route 是动态 server render；Staff service worker 不缓存 navigation、Next data/chunks 或 Attendance API，因此 client cache 不是根因。

## 7. DEPLOYED CODE CHECK

- 当前 Staff 3000 OT adapter 把 `auth.membershipId` 作为 `excludedMembershipId` 传入 canonical OT reader。
- queue、detail 与 summary 使用同一 membership-filtered candidate reader。
- Home 与 Approval Center 的 OT contribution 都调用 `getStaffOvertimeSummary`。
- direct write path 把 actor membershipId 传入 canonical `decideAttendanceOvertime`，并在任何写入前执行 self-review guard。
- 先前修复 `92e674b` 没有被后续部署回滚；故障时服务器确实在运行该过滤逻辑。

## 8. ROOT CAUSE

根因由两个独立问题组成：

1. **Testing data defect**：21 Aug 的 `Real Device UAT Manager` OT fixture 绑定到旧 account/membership，而实体 Android 登录的是后来建立的另一 account/membership。相同显示名称掩盖了 identity mismatch。
2. **Code defect**：OT reader 将 final results 按 version 降序查询后交给 `Map`，后续旧版本覆盖前面的新版本，实际保留了最旧 immutable version。这会令规范化 superseding evidence 无法成为 authoritative result。

不是缓存、不是另一条 queue code path，也不是部署回滚。

## 9. DATA DEFECT

Royal Salon 测试数据存在两个不同 EmployeeAccount / EmployeeBusinessMembership，却使用同一个 `Real Device UAT Manager` persona。OT evidence 绑定到旧 identity，实体 Android 则绑定新 identity。

曾尝试直接转移 immutable Expected Attendance / P2 Final Result，数据库 trigger 以 `P0001 Expected Attendance facts are immutable; create a superseding version.` 拒绝。该 transaction 完整 rollback，没有留下 partial mutation，也没有绕过 guard。

最终仅在 Testing 使用新的 immutable evidence：

- 为当前真实 Android membership 建立 canonical 21 Aug expected/final evidence。
- 保留所有旧 evidence。
- 以新的 Expected Day revision 与 P2 Final Result version 退役旧 duplicate-persona fixture。
- 不删除旧审计事实，不预先审批 OT。

## 10. CODE DEFECT

`listAttendanceOvertimeCandidates` 的 oldest-version overwrite 已修正：在 newest-first rows 上使用 first-seen employee/day，保留最高 version，而不是用 `Map` 覆盖成最低 version。

新增 integration regression：同一个 employee/day 有 v1 OT 与 v2 NOT_SCHEDULED 时，只以 v2 为 authoritative result，v1 不得继续出现在 queue/detail。

## 11. FIX

- 保留原 membership-based self-review architecture；没有按 display name 猜 identity。
- 没有把规则随意扩大成跨 Business employeeAccount 比较。
- 修复 Testing fixture identity linkage，并以 immutable superseding facts 退役错误 fixture。
- 修正 immutable latest-version reader。
- 保留 direct write self-approval guard。
- 临时 diagnostic route 与 token 在取证后移除。

## 12. LIVE TESTING RESULT

- OT count: `2`
- Queue count: `2`
- Own OT visible?: `NO`（服务器 queue/detail）
- Visible: `Louis stylist`, `test`
- Own OT DB record exists?: `YES`
- Home / Approval Center / OT 的 OT contribution 均来自同一 summary helper，值为 `2`。
- 实体 Android 最终刷新确认：尚待 Owner 执行。

## 13. DIRECT WRITE SECURITY

使用当前 Android actor membership 与其 own finalResultId `f80f1efc-5991-4c32-9d80-76cc8454fb1c`：

- Approve: `SELF_APPROVAL_NOT_ALLOWED`
- Adjust: `SELF_APPROVAL_NOT_ALLOWED`
- Reject: `SELF_APPROVAL_NOT_ALLOWED`
- persisted AttendanceOvertimeReview: `null`

三个动作均在服务端写入前失败。

## 14. OTHER REVIEWER VISIBILITY

使用同 Business/Branch 的另一合法 reviewer context：

- queue pending: `3`
- current Android actor 的 21 Aug OT: 可见

这证明修复没有删除或全局隐藏该 OT，只对 subject 自己隐藏；其他有权限 reviewer 仍能正常审阅。

## 15. TESTS

- Focused Staff OT / Attendance / Approval unit: `27/27 PASS`
- Full unit suite: `1222/1222 PASS`
- Selected protected integration（Attendance P2、OT queue、latest version、Unified Approval、Auth Security）: `13/13 PASS`
- Latest immutable version regression: `PASS`
- Actor membership queue/detail exclusion: `PASS`
- Other reviewer visibility: `PASS`
- Approve / Adjust / Reject self-write guard: `PASS`
- TypeScript: `PASS`
- ESLint（changed production/test files）: `PASS`
- Prisma validate（embedded PostgreSQL DATABASE_URL）: `PASS`
- Next production build: `PASS`
- No horizontal/UI change was included in this task.

## 16. DEPLOYMENT

- Environment: Railway `testing`
- Service: `tetamu-staff-app`
- Region: Southeast Asia
- Server verification deployment: `f3cb9e8f-8e12-43da-8d1a-7265d06a0249`
- Final deployment without temporary diagnostics: `7c37b8f7-3d91-4fd0-a091-7c33dc1cb434` (`SUCCESS`)
- Relevant commits:
  - `c9c4359` — canonical fixture reconciliation + latest-version regression
  - `ecf1f01` — immutable stale duplicate evidence retirement
  - `3f61718` — remove temporary Testing diagnostic

## 17. NO NEW MIGRATION

**NO NEW MIGRATION.**

既有 immutable schema/trigger 已正确阻止原地修改。本次使用既有 canonical versioning model 与 Testing-only audited data correction。

## 18. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**
