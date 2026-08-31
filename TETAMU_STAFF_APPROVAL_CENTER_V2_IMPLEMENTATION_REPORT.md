# TETAMU STAFF APPROVAL CENTER V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**REVIEW REQUIRED**

Approval Center V2 已完成实现、自动化测试、Production build 与 Railway Testing 部署。历史记录使用现有 canonical immutable decision evidence，没有新增审批或历史数据表。

尚未判定为最终 READY 的原因：目前浏览器没有已认证经理 session，因此 0 / >0 Pending、跨月份 History、四个 domain detail、rejection bottom sheet 与真实附件权限仍需 owner 在真实 iPhone / Android 上完成 authenticated UAT。完整 disposable integration suite 另发现一个与本改动无关的既有断言差异，详见测试结果。

## 2. FINAL PRODUCT STRUCTURE

- Bottom navigation 保持：Home / Time / Requests / Pay / Profile。
- Home：只在 pending > 0 时显示 `Needs My Approval` 提醒。
- Requests：员工自助入口优先；有任一 canonical approval capability 的员工永久看到 Manager → Approvals。
- Approval Center：单一路由 `/staff/approvals`，以 `view=pending|history` 切换 Pending 与 My History。
- History detail：`/staff/approvals/history/[domain]/[sourceId]`，只读。

## 3. REQUESTS PERMANENT MANAGER ENTRY

**0 pending：**显示 Approvals、`You're all caught up` 与 `View approval history`，入口不会消失。

**> 0 pending：**显示 Approvals、canonical pending 总数与 review copy。

**Normal Staff：**没有受支持 approval capability 时，不渲染 Manager section。

入口由实际 capability mapping 控制，没有使用 `roleName === "Manager"`。

## 4. HOME REMINDER

现有 Home contract 保持不变：pending > 0 才显示 `Needs My Approval`；pending = 0 时不显示。Home 仍是 reminder surface，不是永久入口。

## 5. PENDING

**Sources：**现有 unified approval summary / Leave / Claims / Attendance correction / OT canonical query。

**Counts：**Home、Requests、Pending tab 与 All 使用同一 actor/business scope 的现有 summary，不建立第二套 pending state。

**Sort：**沿用 canonical review-ready/submission ordering；没有以金额或 domain 人为提权。

**Security：**保留 tenant、allowed branch、capability、self-review、stale state、Timesheet/finalization 与 direct-route guards。已完成或不可操作记录不进入 Pending。

## 6. HISTORY

**Definition：**只显示当前 manager 本人作出的 immutable decisions，不是全公司审计列表。

**Reviewer identity：**以当前 authenticated Staff user 的 canonical user ID 与各 domain actor ID 比较，不按姓名、电话或 display string 比较。

**Default range：**最近 12 个月内，默认选择 Malaysia 时区的当前月份；不会删除更旧证据。

**Filters：**All / Leave / Claims / Attendance / OT、月份、employee display name search，均在 server projection 应用。

**Pagination：**server-side aggregation/pagination，page size 20；不会把 12 个月记录全部载入浏览器。

## 7. HISTORY DOMAIN SOURCES

**Leave：**canonical Leave request + immutable `HrApprovalDecision`；reviewer key 为 `actorUserId`。

**Claims：**canonical Claim request + immutable `HrApprovalDecision`；reviewer key 为 `actorUserId`。Approved 与 payment status 分开展示。

**Attendance：**canonical Attendance correction/resolution + immutable `AttendanceResolutionEvent.actorUserId`；legacy `AttendanceException` 仅在存在 immutable `AuditLog.actorUserId` 与 decision payload 时投影，不从当前 status 猜历史。

**OT：**canonical Attendance overtime result/candidate + immutable `AttendanceOvertimeReviewEvent.actorId`；分钟在 UI 无损转换为 `hr / min`。

## 8. HISTORY IMMUTABILITY

History 以当时的 decision event 为事实来源。请求后来 reopened、returned 或被其他 actor 改成不同 current status，不会覆写当前 manager 当时的 decision、note 与 reviewedAt。最新状态如可安全取得，只作为独立的 `Current status` 展示。

## 9. HISTORY DETAIL

History detail 为只读页面，显示 employee、branch、request type、original facts、当前 actor 的 decision/note/reviewed time，以及可安全取得的 current status。页面没有 Approve / Reject / Adjust / Return actions。附件继续走现有 protected route 与当前访问控制，不能因为曾经审批过就绕过权限。

## 10. LEAVE DETAIL UX

Pending Leave 继续使用 canonical review action；列表与详情移除内部 policy/version jargon，突出员工、日期、时长、原因与受保护证据。Approve 直接提交；Reject 使用统一 bottom sheet 并要求原因。

## 11. CLAIM DETAIL UX

Claims 突出 employee、amount、category/date/purpose 与 receipt；审批与付款状态明确分离。`Approved` 不会显示或暗示为 `Paid`。

## 12. ATTENDANCE DETAIL UX

Attendance 使用现有 canonical correction/resolution workflow；detail 聚焦日期、issue、recorded/requested time、reason 与 evidence，保留 direct-route、self-review、stale 与 finalization guards。

## 13. OT DETAIL UX

**Approved overtime：**以 `x hr y min` 显示，不向 manager 暴露 `Approved OT minutes`。

**Adjust：**manager 输入 hours + minutes；server action 严格标准化回 canonical minutes，转换无损。调整时保留 canonical reason requirement。

**Reject：**统一 rejection bottom sheet，reason 至少 3 个非空字符；不把大型 rejection textarea 永久铺在主表单。

## 14. EMPTY STATES

- Pending 0：`You're all caught up` / `No requests need your review` / `View History`。
- History 0：`No approval history yet`，说明今后本人的 approved/rejected/adjusted decisions 会显示在这里。
- 任何空状态都不会让 Approval Center 或永久 manager entry 消失。

## 15. COUNT RECONCILIATION

**Home：**现有 unified summary，只有 N > 0 才显示。

**Requests：**同一 scope 的 summary；N = 0 仍保留入口。

**Pending：**同一 summary total 与 canonical domain queries。

**All：**不维护独立 duplicate count/state；domain filter 只是 presentation/query scope。

## 16. SECURITY

**Tenant：**所有 Pending 与 History 查询绑定当前 Business context。

**Branch：**使用当前 actor 的 allowed branch scope；无权 branch 不进入列表或详情。

**Reviewer：**History 必须匹配 canonical actor user ID；其他 manager/HR/owner 的 decision 排除。

**Self-review：**现有 Leave/Claims/Attendance/OT pending self-review protections 保持。

**Attachments：**继续使用受保护附件读取路径；当前权限不足时 fail closed。

**Workplace switch：**Business context 是 server query 输入；切换 workplace 后不会复用另一 Business 的 history result。

## 17. DATA MODEL

确认：

- **NO DUPLICATE APPROVAL TABLE**
- **NO DUPLICATE HISTORY TABLE**
- **NO DUPLICATE DOMAIN STATE**

新增内容仅为 read projection/service 与 UI route；canonical Leave / Claim / Attendance / OT records 仍是唯一事实来源。

## 18. MIGRATION

**NO NEW MIGRATION**

现有 immutable audit/decision evidence 足以实现四个 domain 的 truthful personal manager history。

## 19. MOBILE 390

Railway Testing 公开页面以 390 × 844 capability 验证：实际 `innerWidth=391`，`document/body scrollWidth=391`，无横向溢出。登录卡片、输入框、CTA 与 copy 均在 viewport 内完整显示。

Authenticated manager Approval Center 的 mixed pending/history/detail/sticky actions 仍列为真实设备 UAT，不以未认证 smoke 冒充通过。

## 20. MOBILE 412

Railway Testing 公开页面以 412 × 915 验证：`innerWidth=412`，`document/body scrollWidth=412`，无横向溢出。登录页面 touch targets、card 与 CTA 完整显示。

Authenticated manager 的 rejection sheet、键盘、安全区、长文本与附件仍需 owner 在真实设备确认。

## 21. TEST RESULTS

**Focused：**Approval Center V2、permanent manager entry、history projection contract、read-only detail、reject reason、OT duration conversion 通过。

**Unit：**1228 / 1228 PASS。

**Staff/security：**相关 Staff route/capability/self-review regression 通过。

**Attendance/Approval：**focused integration 通过。

**OT：**focused canonical OT approval integration 通过。

**Leave：**focused integration 通过。

**Claims：**focused claims/payroll integration 通过。

**Integration：**本次选定的 16 / 16 protected/canonical integration tests 通过。完整 disposable integration suite 另有 1 个既有失败：`attendance-monthly-timesheet.test.ts` 预期旧 error message，实际 canonical service 正确拒绝 unresolved Attendance blockers；本改动未放宽该规则。

**TypeScript：**PASS。

**ESLint：**changed files PASS。

**Prisma：**fresh disposable migration rebuild PASS；schema 未变。

**Migration：**PASS；NO NEW MIGRATION。

**Build：**Next production build PASS。为避免干扰用户现有 3000 dev server，仅在 build guard 中临时使用 `PORT=3999`，没有停止或修改用户 server。

**Runtime：**`/api/health`、`/staff/login`、`/staff/requests`、`/staff/approvals` 均 HTTP 200；未认证受保护 route server-render 登录界面，未泄漏 manager data。

## 22. TESTING DEPLOYMENT

**Commit：**`d67b24b feat(staff): add manager approval history workspace`

**Deployment ID：**`d2f70f13-0fe7-4bf1-b410-9321a6732505`

**Status：**SUCCESS

**Runtime：**Railway Testing，Singapore replica (`asia-southeast1-eqsg3a`)。

部署来自 clean controlled Staff 3000 worktree，而不是 dirty main workspace。

## 23. DEFERRED ITEMS

- Owner 使用有 approval capability 的真实经理账号完成 390/412 authenticated UAT。
- 逐项验证 pending=0、mixed pending、跨月 history、employee search、长姓名/branch/note、四类 history detail。
- 真实设备验证 rejection bottom sheet、键盘、safe area、protected receipt/document。
- 验证 Testing 现有数据是否覆盖所有 requested deterministic history fixture combinations；本轮没有伪造或预先审批 owner 应亲自操作的记录。
- 单独修正既有 `attendance-monthly-timesheet.test.ts` error-message expectation，不应削弱 canonical blocker rule。

## 24. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

本实现没有使用、恢复或重新引入 3100 runtime。

## 25. PRODUCTION STATUS

**LOCAL / TESTING ONLY**

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

**NO NEW MIGRATION**

