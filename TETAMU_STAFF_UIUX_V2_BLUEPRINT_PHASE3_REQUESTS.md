# TETAMU STAFF 3000 — UI/UX V2 BLUEPRINT PHASE 3

## REQUESTS + LEAVE + CLAIMS + ATTENDANCE CORRECTION + APPROVAL ENTRY

审计日期：2026-09-01  
Canonical workspace：`C:\CodexTetamuP0`  
Canonical Staff App：3000 ONLY  
3100：REFERENCE ONLY / READY TO RETIRE / DO NOT USE  
环境：LOCAL / TESTING ONLY

本文件是蓝图，不是实现报告。结论来自当前 Staff 3000 真实代码、现有 390/412 浏览器视觉快照，以及已经批准但仍位于受控 Staff 3000 工作树中的 Approval Center V2。没有依据旧文档假设功能已经存在。

---

## 1. FINAL DESIGN VERDICT

Requests V2 应采用现有 Staff V2 设计语言，以“分组 List Rows + 单一主状态 + 按需展开详情”为主要结构，不再保留四张巨型入口卡，也不建立 Requests 专属卡片系统。

最终产品边界：

- **Requests**：员工管理自己提出的 Leave、Claims、Attendance corrections。
- **Approval Center**：有审批能力的用户处理其他人的请求，并查看自己的审批历史。
- **Attendance History**：发现具体考勤问题并发起修正。
- **Timesheet**：显示处理后的工时影响，并把可操作缺失时间导向 canonical correction flow。
- **Home**：只有 pending > 0 时显示 `Needs My Approval`；不承载完整审批队列。

推荐方案：

1. Requests Hub 先改为紧凑 gateway。
2. Leave 与 Claims 分别采用相同的 V2 header、row、detail section、attachment pattern。
3. Attendance corrections 只有在完整员工历史 read model 可用后，才成为真正的 archive/status 页面。
4. Approval Center 保留已批准的 Pending / My History IA，只做视觉归一，不重做业务归属。

核心原则：**Less cards. One request. One status. One next action. Details only when needed.**

---

## 2. REQUESTS V2 PRODUCT PRINCIPLES

1. 员工不需要理解内部 HR workflow enum，只需要知道：我能申请什么、目前到哪一步、是否需要我处理。
2. 每个列表项只显示一个主状态；证据核验、付款等第二流程作为次要事实。
3. 正常状态不显示“无需操作”；只解释异常与真正的下一步。
4. manager 仍然是 employee；Approvals 入口不能取代其个人请求入口。
5. manager queue 不混入个人 request history。
6. 列表只显示扫描决策所需信息；原因、附件、审计记录、政策细节进入详情。
7. 所有列表、详情、表单沿用 Phase 1/2 已批准的 Staff V2 token 与 primitives。
8. 不用前端从不完整分页数据推断完整数量或完整历史。
9. 不复制 Leave、Claims、Attendance 的 canonical 状态或审批模型。
10. mobile-first：固定底部导航、键盘、safe area、长名称与附件名必须在布局契约内。

---

## 3. CURRENT REQUESTS AUDIT

### 3.1 真实实现盘点

| 区域 | 当前真实实现 | 视觉/产品问题 | 处理 |
|---|---|---|---|
| Requests Hub | `/staff/requests` 并行读取 Leave、Claims、open Attendance corrections、manager summary、OT summary | 三张大入口卡占用首屏；Recent activity 被推后；normal/manager 信息层级不够清楚 | **REPLACE** 为 manager Action Row + grouped request rows |
| Manager entry | capability-gated，当前文案 `Team approvals` / `N waiting` / `All clear` | 产品名与已批准 IA 的 `Approvals` 不一致 | **SIMPLIFY** 为永久 `Approvals` Action Row |
| Leave landing | `/staff/leave`，每个 entitlement policy 一张大 balance card | 多 policy 时形成 balance-card wall；嵌套 facts 密度高 | **MERGE** 为 compact balances + `View all balances` |
| Leave history | 最多 50 条，卡片内包含日期、原因、review note、evidence、操作 | 默认列表暴露过多详情；decision 与 evidence 同级，容易误读 | **REPLACE** 为 rows + detail |
| New Leave | `/staff/leave/new`，独立 task route，隐藏全局 bottom nav | 业务逻辑完整；视觉仍像长 HR form；提交动作不固定 | **KEEP logic / SIMPLIFY presentation** |
| Leave evidence | 最多 5 个、每个 10MB；pending 时可增删替换 | 当前证据列表与请求卡混在一起，状态层级不清 | **KEEP capability / REPLACE visual pattern** |
| Claims landing | `/staff/claims` 同页同时放新申请三步表单与历史 | 巨型绿色 hero；form 与 history 同时竞争；首屏不以历史为主 | **REPLACE** 为 landing + 独立 task presentation |
| Claims flow | Expense → Details → Review 三步；React local state | 流程合理，但刷新/离开会丢失；stepper 与外围卡片偏重 | **KEEP flow / SIMPLIFY chrome** |
| Claim receipt | native file input；历史以普通链接显示 | 上传控件不像 Staff V2 attachment；Leave/Claims 不一致 | **REPLACE** 为 shared attachment row |
| Attendance correction employee view | Requests 只读取 OPEN / UNDER_REVIEW / RETURNED，最多 20 条；入口仍指向 `/staff/history/records` | 不是完整历史 archive；resolved/rejected 不在 read model | **READ MODEL ENRICHMENT REQUIRED** |
| Attendance correction manager view | `/staff/requests/attendance-corrections` 是 manager queue，卡片内展开 review form | 容易被误认为员工 Requests archive；页面密度高 | **KEEP workflow / MOVE mentally under Approvals** |
| Approval Center current main tree | `/staff/approvals` 目前仍是 Pending-only + domain tabs | 与已经批准的 V2 Pending/My History 存在 runtime/source divergence | **DO NOT BUILD ON THIS AS FINAL IA** |
| Approval Center approved controlled source | Pending / My History、个人审批历史、只读详情 | IA 已批准；filters 占首屏较多 | **KEEP IA / SIMPLIFY visuals later** |

### 3.2 视觉快照结论

现有 capture manifest 的 H/I/J/O/N/P/Q 系列显示：

- H01/H03V2：Requests 入口以大卡为主，manager row 与个人请求入口没有形成清晰组别。
- I01/I04：Leave landing 的 balance 与 history 都是高厚度卡片；new form 比 landing 清楚，但仍有多层 surface。
- J01/J09：Claims 巨型 hero、form、history 同时出现；native receipt input 与 V2 不一致。
- O06/O06D：manager attendance review 很密，展开后 action/form 与 fixed nav 争夺空间。
- N02V2/P01/Q01/Q02：批准版 Approval Center 已具 Pending/History 与 read-only detail，但筛选器在首屏占比过高。

现有快照为浏览器 390/412 capture，不等于 physical-device UAT；Phase 3 尚无完整 360 Requests capture。

---

## 4. REQUESTS HUB V2

### Normal Staff hierarchy

1. `StaffV2PageHeader`：Requests + 简短说明。
2. `MY REQUESTS` grouped rows：Leave、Claims、Attendance corrections。
3. 有真实 actionable/recent 数据时才显示紧凑 recent summary；没有则不制造巨型 empty state。

### Manager hierarchy

1. Page Header。
2. capability 存在时永久显示 `Approvals` Action Row。
3. `MY REQUESTS` 仍显示自己的 Leave、Claims、Attendance corrections。

入口 row 契约：

| Row | Title | Meta | Destination |
|---|---|---|---|
| Leave | Leave | Balances, requests and history | `/staff/leave` |
| Claims | Claims | Expenses you've submitted | `/staff/claims` |
| Attendance | Attendance corrections | Missing or incorrect attendance | 员工 correction archive；当前尚需 read model/route 决定 |

不显示 giant request cards、不复制 recent list 到每个入口、不把 OT 说明作为独立大块。若 OT 仍需入口，应保留在 canonical manager workflow，而不是混入普通员工 request destination。

---

## 5. MANAGER APPROVAL ENTRY

最终产品文案：

- Pending > 0：`Approvals` / `{N} waiting for you` / `>`
- Pending = 0：`Approvals` / `All clear` / `>`

规则：

- 只要拥有任何有效 approval capability，入口永久可见。
- 可见性继续由 capability + business + branch scope 决定，不以 role name 硬编码。
- normal staff 完全看不到入口。
- 点击进入 accepted Approval Center V2；不在 Requests 直接展示队列。
- 不恢复 `You’re all caught up · View approval history`，除非另行通过 product review。

当前代码已经使用 `All clear`，但标题仍是 `Team approvals`。V2 应统一为 `Approvals`。

已知测试冲突：受控工作树的 `tests/unit/staff-approval-center-v2.test.ts` 仍断言旧文案。蓝图结论以 **`All clear`** 为最终产品 copy；本轮不改测试。

---

## 6. LEAVE V2

Leave landing 只回答余额、可申请入口与最近请求。

推荐结构：

1. Page Header：Leave。
2. compact `New leave request` primary action。
3. `BALANCES`：最相关的 1–3 个 policy balance rows/compact summary。
4. `View all balances` Action Row。
5. `RECENT REQUESTS`：日期、类型、duration、一个主状态。
6. `View all requests`（数据超过 landing limit 时）。

Leave detail 使用 flat Detail Sections：Request、Decision、Supporting documents、Evidence status、Next action（仅适用时）。不为每个 section 再建立大型 card。

---

## 7. LEAVE BALANCE UX

当前 canonical read model 已提供：current entitlement、carry forward、used、pending、manual adjustment、remaining、expiry，因此可安全显示：

- Available
- Current entitlement
- Carry forward
- Used
- Pending
- Adjustment
- Expires

Landing 只突出 `Available`；其余进入 `View all balances` 详情。不得显示 bucket ID、rule-pack 名称或内部 ledger enum。

余额排序建议：可申请且仍有效 → 有余额 → 最近到期 → 其余；但如果现有 read model 没有明确的“primary policy”语义，不要自行称某一个为“主要余额”。

多 bucket 与 carry-forward 的运算继续完全由 server 负责，UI 不重新计算 entitlement。

---

## 8. LEAVE REQUEST FORM

保留当前 canonical fields 与 validation：

- Leave type
- From / To
- Full day / Half day（AM/PM，按现有能力）
- Reason
- Supporting documents

V2 presentation：

1. 独立 mobile task route `/staff/leave/new`。
2. `StaffTaskNavigation` 继续在 task flow 隐藏 global bottom nav，避免两个 action bars 冲突。
3. 使用 Form Sections，不使用 page card inside form card。
4. 日期控件保持 mobile-friendly、labels 永久可见。
5. server 返回的 calculated duration 在提交前以 compact summary 显示；前端不自行计算 entitlement。
6. `Submit request` 使用 Sticky Action Bar，并为 keyboard 与 safe-area 预留空间。
7. loading 时防止重复提交；成功后回到 detail 或 history，不留下重复 draft illusion。

不新增字段，不改变 evidence requirement、half-day 或 multi-day canonical logic。

---

## 9. LEAVE EVIDENCE

Leave 与 Claims 共用同一个 attachment visual pattern：

```text
Supporting documents
Medical certificate.jpg
Uploaded                                      >
```

行为与状态：

- 保留当前最多 5 文件、每个 10MB 约束与 pending 状态下的增删替换能力。
- 长文件名单行截断，但可通过详情/辅助文本获取完整名称。
- 上传中、上传失败、已上传、需补充必须分别可辨，不只靠颜色。
- evidence verification 是次级 workflow fact，不覆盖 Leave decision。
- 员工 UI 使用 `Awaiting review`、`Verified`、`Needs follow-up`，不显示技术 enum。

当前 employee overview 没有可靠的 reviewer name / decision actor，若详情要求显示经理姓名：**READ MODEL ENRICHMENT REQUIRED**。

---

## 10. LEAVE STATUS MODEL

### 主状态优先级

| Canonical meaning | Employee copy | Tone |
|---|---|---|
| draft（若真实存在且可继续） | Draft | neutral |
| submitted/pending | Waiting for manager | warning |
| approved | Approved | success |
| rejected | Rejected | danger |
| cancelled/withdrawn | Cancelled | neutral |

### Evidence 作为次要事实

```text
Leave decision        Approved
Supporting document  Awaiting review
```

不能因为证据仍在 review，就把已批准 Leave 的主状态显示为 Pending。只有 employee 必须补交/更换文件时，row 的主状态才可提升为 `Action needed`，详情仍明确 Leave decision。

---

## 11. CLAIMS V2

Claims landing 不再展示 giant green hero，也不在同一首屏同时展开新申请 form 与历史。

推荐结构：

1. Page Header：Claims。
2. `New claim` Action Row/button。
3. `RECENT CLAIMS` grouped rows。
4. 每行突出 amount，其次 category/date，最后一个综合可读状态。
5. 详情分别显示 Approval 与 Payment。

当前 read model 已有 category、dates、amounts、review reason、attachments 与 reimbursement snapshot，可支持安全的详情表达。

---

## 12. CLAIM SUBMISSION FLOW

当前 3-step 结构成立，建议保留：

1. **Claim details**：category、date、amount/mileage、merchant（现有时）。
2. **Receipt & reason**：receipt、description/note、policy hint。
3. **Review & submit**：只读摘要、附件、最终提交。

V2 要求：

- stepper 仅表达 `1 of 3` 与简短名称，不做装饰性大组件。
- 每一步只有一个 primary CTA；Back 是 secondary。
- 金额使用适合移动数字键盘的 input mode。
- entered data 在三个步骤之间保留。
- 当前只保存在 React local state，刷新/离开会丢失。若产品要求跨 reload 恢复，不能伪装为已支持：**READ MODEL / DRAFT PERSISTENCE ENRICHMENT REQUIRED**。
- 新 claim 可以保持现有 route 内 task mode，也可在实施审计后建立 `/staff/claims/new`；路由变化必须先证明不会破坏 deep link/history。
- sticky actions 要避开 keyboard 与 safe-area。

---

## 13. CLAIM APPROVAL VS PAYMENT

Claims 必须把两个 canonical facts 分开：

| Approval | Payment | Employee presentation |
|---|---|---|
| Waiting | — | Waiting for manager |
| Rejected | — | Rejected |
| Approved | Awaiting channel/payment | Approved · Awaiting payment |
| Approved | Processing | Approved · Payment processing |
| Approved | Payroll linked | Approved · Added to payroll |
| Approved | Settled | Approved · Paid / Included in finalized payroll，依 canonical snapshot |

`src/lib/claim/presentation.ts` 已经拥有正确语义，V2 必须复用它，不在 UI 另写状态解释。Approved 绝不等于 Paid；没有 payment snapshot 时不显示付款日期。

列表保持一个主状态，详情使用独立 `Approval` 与 `Payment` sections。

---

## 14. CLAIM RECEIPT UX

使用与 Leave 一致的 attachment row：

```text
Receipt
parking-receipt.jpg
View                                          >
```

上传态应包含选择文件、已选择、上传中、失败重试、已上传。不要用巨型 receipt card，不添加 OCR/auto-fill，不推断图片内容。

历史附件链接必须具有描述性 accessible name，例如 `View receipt parking-receipt.jpg`，不能只有多个重复的 `View receipt`。

---

## 15. ATTENDANCE CORRECTIONS V2

产品目标是“员工查看自己已经提交的 correction 状态/历史”，而不是复制 Attendance History。

当前事实：

- `loadEmployeeAttendanceResolutionCases` 只读 OPEN、UNDER_REVIEW、RETURNED_FOR_CORRECTION，最多 20 条。
- 已解决、被拒、被 supersede 的完整 lifecycle 不在当前 employee Requests read model。
- 当前 Requests 的 Attendance corrections 入口实际指向 `/staff/history/records`。
- `/staff/requests/attendance-corrections` 是 manager review queue，不是 employee archive。

因此完整 V2 correction list/detail：**READ MODEL ENRICHMENT REQUIRED**。

在 enrichment 前不能把 open-only 列表包装成“完整历史”，也不能前端推断 Approved/Rejected。实现前必须决定安全 child route（建议 employee-owned `/staff/requests/attendance-corrections/history` 或等价路径），同时避免与当前 manager route 冲突。

员工 row 最小信息：work date、correction type、一个主状态。pending 项不显示重复 submission CTA；returned 项只在 canonical workflow 允许时显示 `Update correction`。

---

## 16. CORRECTION OWNERSHIP ACROSS MODULES

| Module | Canonical responsibility | 禁止 |
|---|---|---|
| Attendance History | 发现具体异常、显示原始 attendance context、发起 correction | 不变成通用 Requests dashboard |
| Requests | 查看已提交 correction 的状态与历史 | 不生成第二套 attendance exception |
| Timesheet | 显示处理后的工时影响；把 actionable missing time 导回 canonical flow | 不自建 correction form |
| Approval Center | manager review / decide corrections | 不混入 manager 自己的 request history |

同一 correction 只能有一个 canonical backend record 与一个决策状态。所有入口通过同一个 case ID/read model 连接，不创建 frontend-only status。

---

## 17. APPROVAL CENTER VISUAL INTEGRATION

IA 不重设计。后续只把已批准 V2 视觉归一为：

- Page Header
- Pending / My History segmented tabs
- compact Filter Chips 或 filter bottom sheet
- grouped approval rows
- Detail Sections
- Sticky Action Bar
- Reject bottom sheet

Pending 保持 oldest actionable first；History 只显示该 manager 自己作出的决定；Leave/Claims/Attendance/OT 继续读取 canonical records；Reject reason 与 OT adjustment reason 继续 required。

重要 source risk：当前 `C:\CodexTetamuP0` 的 Approval Center 仍是 Pending-only；已批准的 Pending/My History source 与测试位于 `C:\CodexTetamuP0-staff-testing-deploy-20260830`。实施 Phase 3 前必须先确定 accepted V2 commit 并回到 canonical Staff 3000 source，避免在两套工作树继续分叉。此动作不属于本蓝图。

---

## 18. STATUS SYSTEM

复用 `StaffV2StatusBadge`：neutral / success / warning / danger / info。

| Semantic group | Copy examples | Tone |
|---|---|---|
| Action needed | Action needed / Update correction | danger |
| Waiting | Waiting for manager | warning |
| Approved | Approved | success |
| Rejected | Rejected | danger |
| Payment pending | Awaiting payment / Payment processing | info 或 warning |
| Paid | Paid / Included in payroll | success |
| Evidence secondary | Awaiting review / Needs follow-up | info / warning，详情次级事实 |
| Closed neutral | Cancelled / Withdrawn | neutral |

一个 row 只有一个主 badge。`Approved · Awaiting payment` 可以作为一行可读 summary，但详情仍拆成 Approval 与 Payment。不得同时堆三个同权 badge。

---

## 19. FILTERS

### Landing

Requests Hub 不需要 filters。Leave/Claims landing 默认 recent list，不在首屏放大型筛选区。

### Full history

可选 compact chips：All / Pending / Approved / Rejected，更多条件进入 bottom sheet。只在 backend 能完整 query 时提供。

当前限制：

- Leave employee overview `take: 50`。
- Claims employee overview `take: 100`。
- Attendance correction open cases `take: 20` 且不含 closed lifecycle。

因此不能对这些 partial datasets 做 client filter 后宣称是完整结果。准确 server filtering/pagination：**READ MODEL ENRICHMENT REQUIRED**。

Approval Center V2 的 filters 应收敛高度，避免 tabs + filters 占据第一屏大部分空间；不改变其 scope 或 history semantics。

---

## 20. EMPTY / LOADING / ERROR

### Empty

- Requests Hub：入口永远存在，不显示 giant empty state。
- Leave：`No leave requests yet.` + `New leave request`。
- Claims：`No claims yet.` + `New claim`。
- Corrections：`No attendance correction requests yet.`；同时说明问题应从 Attendance History 发起，不放泛化 `Fix attendance`。
- Approval Center：沿用已批准 V2 empty rules。

### Loading

使用稳定 skeleton，尺寸接近最终 rows：

- Requests：可选 manager row + 3 destination rows。
- Leave：balance summary + 3 request rows。
- Claims：3 claim rows。
- Corrections：3 correction rows。

### Error

- `Leave couldn't load.`
- `Claims couldn't load.`
- `Attendance corrections couldn't load.`
- 提供 44px `Try again`。

不得显示 backend enum/stack。Requests Hub 的一个模块失败不应阻断其他 destinations；summary fetch 应支持分区降级或明确 unavailable，而不是整页消失。

---

## 21. NAVIGATION / ROUTES

Bottom Navigation 保持：Home / Time / Requests / Pay / Profile；不添加第六 tab 或 More。

| Purpose | Current route | V2 decision |
|---|---|---|
| Requests Hub | `/staff/requests` | 保留 |
| Leave landing/history | `/staff/leave` | 保留 |
| New Leave | `/staff/leave/new` | 保留 task route |
| Leave detail | 当前以 landing 内展开/卡片信息为主 | 推荐 child detail；实现前确认 canonical ID/deep-link contract |
| Claims landing/history | `/staff/claims` | 保留 landing |
| New Claim | 当前没有独立 route，同页 3-step | 可先保留 task mode；独立 route 需实施审计 |
| Claim detail | 当前 `details` 展开 | 推荐 child detail；不改变 API ownership |
| Attendance issue discovery | `/staff/history/records` | 保留 canonical initiation |
| Employee correction archive | 当前不存在完整安全 route/read model | **READ MODEL ENRICHMENT REQUIRED** |
| Manager attendance review | `/staff/requests/attendance-corrections` | 保留 workflow；视觉/命名上归属 Approval Center |
| Approval Center | `/staff/approvals` | 保留；accepted V2 Pending/My History |
| Approval detail | `/staff/approvals/[domain]/[requestId]` | 保留 pending detail |
| Approval history detail | 仅批准受控 source 有 `/staff/approvals/history/[domain]/[sourceId]` | canonicalize accepted V2 source 后保留 |

所有 child routes 必须继续验证 session、businessId、branchId、employeeMembershipId 与 capability，不能依赖页面入口隐藏提供安全性。

---

## 22. REQUESTS HUB WIREFRAMES

### Normal Staff

```text
Requests
Manage your leave, claims and attendance corrections.

MY REQUESTS
┌────────────────────────────────────────────┐
│ Leave                                      ›│
│ Balances, requests and history              │
├────────────────────────────────────────────┤
│ Claims                                     ›│
│ Expenses you've submitted                   │
├────────────────────────────────────────────┤
│ Attendance corrections                    ›│
│ Missing or incorrect attendance             │
└────────────────────────────────────────────┘

[ Home | Time | Requests | Pay | Profile ]
```

### Manager — pending

```text
Requests
Manage your requests and team approvals.

┌────────────────────────────────────────────┐
│ Approvals                                  ›│
│ 3 waiting for you                           │
└────────────────────────────────────────────┘

MY REQUESTS
Leave                                       ›
Claims                                      ›
Attendance corrections                     ›
```

### Manager — zero pending

```text
Approvals                                   ›
All clear
```

---

## 23. LEAVE WIREFRAMES

### Landing

```text
Leave
[ New leave request ]

BALANCES
Annual leave                    8 days available
Medical leave                  12 days available
View all balances                              ›

RECENT REQUESTS
28 Aug
Annual leave
1 day · Approved                               ›

24–25 Aug
Medical leave
2 days · Waiting for manager                   ›
```

### Detail

```text
Annual leave                         [Approved]

REQUEST
Date                                      28 Aug
Duration                                   1 day
Reason                             Family matter

DECISION
Status                                 Approved
Decision date       [only if canonically available]

SUPPORTING DOCUMENTS
medical-document.jpg                         ›

EVIDENCE STATUS
Awaiting review
```

### New request

```text
New leave request

LEAVE TYPE
[ Annual leave                         v ]

DATES
[ From ]  [ To ]

DURATION
(•) Full day   ( ) Half day
Calculated duration: 1 day

REASON
[                                            ]

SUPPORTING DOCUMENTS
[ Upload file ]

┌── sticky above keyboard/safe area ────────┐
│ Submit request                             │
└────────────────────────────────────────────┘
```

---

## 24. CLAIMS WIREFRAMES

### Landing

```text
Claims
[ New claim ]

RECENT CLAIMS
28 Aug
Parking                             RM 12.00
Approved · Awaiting payment                  ›

24 Aug
Transport                           RM 45.00
Waiting for manager                          ›
```

### Detail

```text
Parking                              RM 12.00

APPROVAL
Approved

PAYMENT
Awaiting payment

CLAIM DETAILS
Date                                      28 Aug
Reason                           Business travel
Merchant                    [if canonically present]

RECEIPT
parking-receipt.jpg                         ›
```

### Submission

```text
New claim                              2 of 3
Receipt & reason

RECEIPT
[ Upload receipt ]

REASON / DESCRIPTION
[                                            ]

┌── sticky actions ─────────────────────────┐
│ Back                         Review claim │
└────────────────────────────────────────────┘
```

---

## 25. CORRECTION WIREFRAMES

### Employee archive — after read model enrichment

```text
Attendance corrections
View requests submitted from Attendance History.

24 Aug
Missing clock out
Waiting for manager                          ›

20 Aug
Clock-out correction
Approved                                     ›

18 Aug
Clock-in correction
Rejected                                     ›
```

### Detail

```text
24 Aug 2026                 [Waiting for manager]

ATTENDANCE
Clock in                                  9:05 AM
Clock out                                       —

REQUESTED CORRECTION
Clock out                                  6:00 PM

REASON
Forgot to clock out

STATUS
Waiting for manager

[No duplicate submit action while pending]
```

若 canonical fallback 仍要求从 archive 发起，只能提供 `Open Attendance History`，不能创建第二个 generic correction form。

---

## 26. CURRENT → V2 MAPPING

| Current element | Decision | V2 mapping |
|---|---|---|
| Requests giant destination cards | REPLACE | grouped `StaffV2ListRow` |
| `Team approvals` manager card | SIMPLIFY | permanent `Approvals` Action Row |
| `All clear` zero copy | KEEP | final approved concise copy |
| Requests recent mixed activity | SIMPLIFY | only useful/actionable compact summary；不与 destinations 竞争 |
| Overtime explanatory block | REMOVE from employee gateway | OT remains canonical Time/Approval flow |
| One large card per leave balance | MERGE | compact balances + `View all balances` |
| Leave balance calculations | KEEP | server-owned canonical figures |
| Leave history cards with all details | REPLACE | rows + detail route/presentation |
| Leave withdraw/document actions | KEEP | move to detail / contextual next action |
| Leave evidence capability | KEEP | shared attachment pattern |
| Leave decision/evidence equal visual weight | REPLACE | decision primary, evidence secondary |
| New Leave independent route | KEEP | mobile task with Form Sections + sticky CTA |
| Claims green hero | REMOVE | V2 Page Header |
| New Claim and history on same first viewport | REPLACE | landing + explicit task entry |
| Claims 3-step business flow | KEEP | lighter progress and one primary CTA |
| Claim local step state | KEEP short-term / RISK | persistence enrichment only if required |
| Claim approval/payment presentation helper | KEEP | canonical source of employee copy |
| Native receipt visual | REPLACE | shared attachment row/uploader |
| Expandable claim history card | REPLACE | compact row + detail |
| Requests attendance link to History | KEEP initiation ownership | archive requires separate enriched read path |
| Open-only correction summary | SIMPLIFY temporarily | never label as complete history |
| Manager correction inline dense cards | SIMPLIFY later | Approval V2 rows/detail/sticky actions |
| Approval Pending-only main-tree source | REPLACE by already-approved source | canonicalize accepted Pending/My History implementation first |
| Approval Pending/My History IA | KEEP | visual normalization only |
| Large Approval filters | SIMPLIFY | compact chips/bottom sheet |
| Fixed bottom navigation | KEEP | shared V2 bottom clearance/safe area |

---

## 27. MOBILE 360

当前 Phase 3 capture pack 没有完整 360 Requests/Leave/Claims 视觉证据；以下是实施验收契约，不是已验证结果。

- 单栏布局，page inline gutter 16px（极窄可降至 14px）。
- grouped rows 的 leading/copy/trailing 不产生横向滚动；`scrollWidth === innerWidth`。
- date range 在 `<370px` 堆叠；half-day controls 保持可读。
- amount、status、chevron 不强行挤在同一行；允许 meta 换行但 title 不被截断到不可辨。
- sticky actions 在屏幕键盘出现后仍可见/可滚动到；不覆盖最后一个 field。
- 最小 touch target 44×44px。
- 长 employee/business/branch/category/file names 使用 wrap 或 ellipsis，不能推宽 viewport。
- bottom content clearance 至少覆盖 fixed nav + `env(safe-area-inset-bottom)` + 舒适余量。

---

## 28. MOBILE 390

现有 390 capture 已证明当前页面可单栏渲染，但有明显密度问题：Requests giant cards、Leave balance wall、Claims hero/form/history 堆叠、manager correction review 与 nav 争空间。

V2 target：

- Requests manager row + 3 request rows应在约一个 viewport 内完成主要扫描。
- Leave 首屏至少看见 primary action、2 个 compact balances 与 recent heading。
- Claims 首屏看见 New claim 与至少 2 个 recent rows，不再被 hero/form 占满。
- forms 使用 sticky actions，iOS/Android keyboard 打开时不遮挡当前 input。
- final row 能完整滚到 bottom nav 上方。
- 390×844 验证 safe-area top/bottom、长状态 copy、附件名与错误态。

---

## 29. MOBILE 412

现有 412 capture 与 390 具有相同结构问题，不能因为宽 22px 就增加 columns 或恢复大型 cards。

V2 target：

- 与 390 保持相同 IA 和单栏行为，避免 breakpoint 导致信息重排。
- compact summary 可在内容允许时两列，但长数字/名称必须安全 wrap。
- Approvals Pending/History + filters 不占满首屏；至少露出第一条 actionable row。
- 412×915 页面底部最后 action/detail section 可完整越过 fixed nav。
- Android dynamic viewport 与 browser toolbar resize 后 sticky/fixed 元素不跳动覆盖。

---

## 30. ACCESSIBILITY

- Page 只有一个 `h1`；section labels 与 rows 有明确层级。
- status 不只靠颜色，必须有文字；warning/danger 对比满足 WCAG AA。
- grouped rows 使用 list semantics；整个 row 可点击但不嵌套第二个 interactive control。
- icon-only actions 必须有 accessible name。
- attachment links 包含文件名与动作目的。
- error summary 使用 `role="alert"`，loading/empty 使用适当 `status`，避免重复播报。
- 表单 labels 持续可见；错误与对应 input 用 `aria-describedby` 关联。
- focus order 与视觉顺序一致；bottom sheet 打开时 focus trap，关闭后回到触发器。
- sticky bar 不遮挡浏览器 text zoom 200% 后的内容。
- reject/withdraw/destructive actions 必须有清楚文案与确认，不只用颜色区别。
- date、duration、currency 不只依赖图标；RM amount 使用一致的 locale 格式。

---

## 31. IMPLEMENTATION RISK

| Risk | Level | Evidence / impact | Mitigation |
|---|---|---|---|
| Approval V2 存在两个工作树版本 | **HIGH** | canonical main 为 Pending-only，受控 tree 才有 accepted Pending/My History | 实施前固定 accepted commit/source 并做 clean diff verification |
| Correction employee read model 不完整 | **HIGH** | 只含 open/returned，take 20，无完整 decisions | 先设计 canonical employee lifecycle read model；不前端推断 |
| Manager attendance route 与 employee archive 命名冲突 | **HIGH** | 当前 `/staff/requests/attendance-corrections` 是 manager queue | route ownership decision + regression deep links |
| Leave decision 与 evidence 混淆 | **HIGH** | 当前同一卡多状态，员工可能误读 Approved 为 pending | 主/次状态模型 + fixtures 覆盖组合状态 |
| Claim Approved 与 Paid 混淆 | **HIGH** | 财务语义风险 | 强制复用 `claim/presentation.ts`，详情拆 section |
| capability/self-review regression | **HIGH** | Approvals 安全边界 | 保留 server authorization；测试 capability/branch/self-review |
| 旧 CSS 层叠覆盖 V2 | **MEDIUM-HIGH** | Leave/Claims CSS 已有多层局部规则 | 分页面替换 presentation，不加第三层 giant override；删除仅限确认无引用样式 |
| fixed nav / sticky action / keyboard | **MEDIUM-HIGH** | 当前 manager correction 与 Claims 底部内容拥挤 | shared bottom clearance + real keyboard/device UAT |
| Leave/Claim partial history filtering | **MEDIUM** | take 50/100 | server pagination/filter enrichment 前不提供“完整” filters |
| Claim step state refresh 丢失 | **MEDIUM** | local React state | 离开确认；若需恢复再定义 draft persistence，不偷偷 localStorage 化 canonical state |
| attachment failure/retry inconsistency | **MEDIUM** | 两模块不同视觉 | shared attachment primitive + upload state contract |
| long policy/category/file names | **MEDIUM** | mobile overflow | 360/390/412 long-copy fixtures |
| current giant cards only是 presentation | **LOW** | read services already separated | 分阶段替换 UI，不碰 backend |

---

## 32. KNOWN REQUESTS TEST DEBT

1. `staff-approval-center-v2.test.ts` 只存在于受控 Approval V2 工作树，且仍断言旧 zero copy；最终应改为 `All clear`，但本轮禁止编辑。
2. canonical main 与 controlled Approval V2 source 的测试集合不一致，导致“本工作区通过”不能证明 accepted IA 存在。
3. Requests Hub 缺少 normal staff / manager pending / manager zero / partial module failure 的 V2 contract tests。
4. Leave 缺少 decision × evidence 组合视觉/语义测试，尤其 Approved + evidence pending。
5. Leave 缺少 multiple buckets、carry-forward expiry、half-day/multi-day、5 attachments、长文件名的 360/390/412 contract tests。
6. Claims 缺少 approved-awaiting-payment、paid、payroll-linked、rejected 的列表与详情语义测试。
7. Claim 3-step 缺少 back/forward state retention、重复 submit、upload failure、keyboard sticky action 测试。
8. Attendance corrections 缺少 employee complete lifecycle read model；在补齐前无法建立可信 archive tests。
9. 需要验证 manager queue 不泄露自己的请求、其他 branch/business，以及 capability 被撤销后的 deep-link denial。
10. 现有 visual capture 主要为 390/412 浏览器；360、iPhone physical keyboard、Android dynamic viewport 仍属 UAT debt。

---

## 33. RECOMMENDED IMPLEMENTATION SEQUENCE

1. Owner approve 本 Phase 3 blueprint。
2. 先 canonicalize 已批准 Approval Center V2 source/commit；只解决 source divergence，不做视觉重构。
3. Requests Hub V2 only：Page Header、permanent manager Action Row、3 grouped destinations。
4. Owner review normal staff / manager pending / manager zero 的 360/390/412。
5. Leave V2 landing/detail/form/attachment pattern；保留所有 canonical calculation 与 workflow。
6. Owner review Leave combinations，特别是 decision vs evidence。
7. Claims V2 landing/detail/3-step task/attachment pattern；复用 canonical approval/payment presentation。
8. Owner review Claims，特别是 Approved != Paid。
9. 设计并批准 employee correction lifecycle read model 与 route ownership；标记为单独的 read-model change，不混在纯 CSS PR。
10. Attendance Corrections V2 archive/detail；History initiation 与 manager Approval flow 保持唯一 ownership。
11. Approval Center 视觉 normalization only。
12. 完整 Requests regression + 360/390/412 + 两台 physical devices。
13. 停止并等待 owner closure；之后才讨论 Pay V2。

不要一次性重写全部 CSS，不把 backend enrichment 与所有页面视觉替换塞进同一个变更。

---

## 34. NO BACKEND CHANGE CONFIRMATION

本轮仅创建蓝图文档，没有修改：

- Leave calculation / entitlement / carry forward / evidence requirements
- Claims approval / payment
- Attendance correction workflow
- Approval Center workflow / OT
- Attendance / Timesheet / Payroll
- RBAC / session / device
- API / Prisma schema / migrations
- 产品代码或测试

文档中标出的 `READ MODEL ENRICHMENT REQUIRED` 是未来实现前置决策，不代表本轮已经授权或执行 backend change。

**NO NEW MIGRATION.**

---

## 35. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮停在 Blueprint。未实现 Requests V2，未编辑 stale Approval Center test，未继续 Pay V2 或 Profile V2，等待 owner review。
