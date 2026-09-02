# TETAMU STAFF 3000 — UI/UX V2 BLUEPRINT PHASE 5

## 1. FINAL DESIGN VERDICT

**READY FOR OWNER REVIEW — BLUEPRINT ONLY**

Profile V2 应以现有 Staff 3000 为唯一 canonical runtime，使用已经建立的 Staff V2 primitives 重组 presentation，不创建新的身份、workplace、device 或 session workflow。

建议的最终页面是一个紧凑、以个人情境为中心的 Profile：

1. `Profile` Page Header
2. Employee identity
3. Current workplace
4. Employment details
5. This phone / security summary
6. Account / Sign out

Manager 与普通员工使用同一 IA。现有 canonical auth、workplace switch、avatar upload 与 logout action 均可复用。没有发现必须阻止蓝图的 critical security bypass，但有三个必须在实施前尊重的事实：

- login phone 目前未进入 `/api/employee-auth/me` employee-safe projection；显示 masked phone 需要 read-model enrichment。
- `firstVerifiedAt` 是 device authorization 时间，不是 last sign-in；当前 `Signed in` 日期语义必须修正。
- `/staff/device` 是第二个 Profile entry point，且只依靠 client `/me` fail-closed；应保留兼容 redirect，但不继续维护第二套页面。

本报告依据当前代码、Prisma schema、employee-auth integration tests 与 L01/L01M/L05/S09C captures，而不是旧文档推断。

## 2. PROFILE V2 PRODUCT PRINCIPLES

1. Identity first：姓名与头像只出现一次。
2. Workplace second：当前 employer/primary branch 是 session context，不是装饰信息。
3. Employment compact：employee code、position、employment type、start date 使用定义行，不做 mini-card wall。
4. Device understandable：默认只说 `This phone`、`Authorized`、`Last active`；技术字段隐藏。
5. Sign out clear：靠近页面底部、容易找到，但不做巨大红色 hero。
6. Manager is still an employee：不显示 approval queue、permission enum 或 manager dashboard。
7. No card wall：采用 V2 Detail Section、List Row、Action Row、Status Badge。
8. No security jargon：不出现 hash、session family、provider、token、UUID。
9. Explicit safe switching：只有多于一个 eligible membership 才出现 `Switch workplace`。
10. Minimum sensitive data：phone 默认 masked，内部 identifier 永不输出。

产品边界保持：Time、Requests、Pay 各自拥有 attendance/schedule/requests/approvals/payslips/commission；Profile 不重复这些摘要。

## 3. CURRENT PROFILE AUDIT

实际实现：`src/app/staff/profile/page.tsx` server-check session 后渲染 client `StaffProfile`；client 再调用 `/api/employee-auth/me`。

视觉证据：

- `artifacts/staff-ui-capture/L01-profile-current-390.png`
- `artifacts/staff-ui-capture/L01M-profile-manager-current-390.png`
- `artifacts/staff-ui-capture/L05-profile-device-activity-expanded-390.png`
- `artifacts/staff-ui-capture/S09C-profile-bottom-navigation-390.png`
- 对应 412px captures

现况问题：

| Current element | Finding | Classification |
|---|---|---|
| Employee hero | 82px avatar、重复 kicker、姓名、employment type、employee code 集中在大卡；没有 `Profile` Page Header | REPLACE |
| Avatar upload | 已有 same-origin、membership-scoped、audited canonical action | KEEP + SIMPLIFY |
| Current workplace card | business、branch、position 加独立 Active badge；position 又在 Employment 重复 | MERGE + SIMPLIFY |
| Employment card | 四个 nested mini-cards；`Not specified` 造成无价值占位 | REPLACE |
| Active badges | session 已要求 ACTIVE membership/business/device；两个 Active badge 重复事实 | REMOVE |
| This phone card | 默认卡过大；`Signed in` 与 device status 混用 | REPLACE |
| Device expansion | 技术密度尚低，但 `firstVerifiedAt` 被标成 Signed in，语义错误 | SIMPLIFY + RELABEL |
| Workplace switch | canonical modal 存在于 shell；Profile 本身没有 permanent switch action | MERGE existing flow into Profile entry |
| Manager presentation | L01M 与 normal 基本一致；这是正确方向 | KEEP |
| Sign out | 清楚但表现为整块大按钮；位置正确 | KEEP + SIMPLIFY |
| App/about/support | Current Profile 不存在 | DO NOT INVENT |

页面在 390/412 capture 没有横向 overflow，但首屏由四张大卡占据；核心个人情境被边框、badge 与嵌套面板稀释，device expanded 后 Sign out 会被推至更下方。

## 4. CURRENT ROUTES / OWNERSHIP

| Route/action | Current ownership | Decision |
|---|---|---|
| `/staff/profile` | server session gate + client Profile | KEEP route；REPLACE presentation only |
| `/api/employee-auth/me` GET | own membership/workplace/current device projection | KEEP；仅在另行批准时做安全字段 enrichment |
| `/api/employee-auth/avatar` POST | current membership avatar upload，same-origin + audit | KEEP |
| `/api/employee-auth/workplaces` GET | eligible workplaces for same EmployeeAccount | KEEP |
| `/api/employee-auth/switch-workplace` POST | in-session workplace switch | KEEP canonical action |
| Shell workplace bottom sheet | active-session workplace selection UI | KEEP as canonical selector；Profile 只增加 trigger |
| `/staff/select-workplace` | OTP 后 multi-membership login-time selection | KEEP；不要与 authenticated switch 合并 |
| `/api/employee-auth/select-membership` POST | consumes one-time selection token and creates session | KEEP |
| `/api/employee-auth/logout` POST | revoke current session + expire cookie | KEEP |
| `/staff/device?verified=1` | duplicate `StaffProfile` rendering after device verification | REPLACE with compatibility redirect to `/staff/profile?device=verified` during implementation；不维持第二个 Profile surface |
| Device detail | no separate route；current inline `<details>` | KEEP inline ownership |

Final product ownership：Profile 是 permanent workplace-switch discovery point；existing shell chooser 仍是唯一 interaction/operation。Home 的 current-workplace trigger 可在 Global Staff V2 closure 时由 owner 决定是否保留为 shortcut；不要创建第二个 selector。

## 5. PROFILE V2 IA

建议 IA：

1. `StaffV2PageHeader` — title `Profile`，无或只有极短 meta。
2. Identity section — compact avatar、full name、position（如有）、existing avatar edit affordance。
3. `CURRENT WORKPLACE` — business + primary branch；多 workplace 时出现唯一明确 action。
4. `EMPLOYMENT` — employee code、employment type、position（若未在 identity 使用可在此显示一次）、joined date。
5. `THIS PHONE` — Authorized、safe platform（如有）、Last active；可展开 low-priority detail。
6. `SECURITY` — Sign-in method `Phone verification`；masked phone 只有在 safe read model 可用时显示。
7. `ACCOUNT` — compact destructive `Sign out` action row。
8. `ABOUT` — 仅在已有 canonical version/support/privacy links 后才出现；当前省略。

每个事实只出现一次。页面不显示 Pay amount、Claim amount、Commission、approval count、current shift 或 timesheet status。

## 6. EMPLOYEE IDENTITY

Canonical source 是 current `EmployeeBusinessMembership`，由 auth context 同时约束 `membershipId`、`employeeAccountId` 与 `businessId`。当前 safe projection 已提供：

- `fullName`
- `avatarUrl`
- `employeeCode`
- nullable `position`
- `employmentType`
- `status`
- `joinedAt`

V2 identity section：compact 52–56px avatar、姓名、position（存在才显示）。不显示 employment type 与 employee code 的第二份副本。

现有 avatar upload 是唯一已支持的 personal edit：可保留相机 affordance，但 avatar 不应成为页面主视觉；不新增 name/photo admin workflow。

永不显示 EmployeeAccount ID、membership UUID、user ID、session ID 或 database ID。

## 7. PHONE / LOGIN IDENTITY

Phone 是 `EmployeeAccount.phoneNormalized` / membership phone identity，但当前 `/api/employee-auth/me` response **不包含 phone**。因此 Profile V2 不可从 localStorage auth flow、cookie、DOM 或其他页面拼出号码。

目标显示（需 read-model enrichment）：

- Label：`Login phone`
- Visible：`•••• 2259` 或产品批准的 `011-****-2259`
- Accessible name：`Login phone ending 2259`

不要显示 full phone 多次，也不要提供 Edit action。安全修改 OTP identity 的 canonical workflow 当前不存在。

Status：**READ MODEL ENRICHMENT REQUIRED**。

## 8. EMPLOYEE CODE

`employeeCode` 是 current business membership 下的 employee-facing identifier，已经 READY。显示：

`Employee ID` → `RS-001`

不要称为 membership ID，也不要将其用于 URL/auth decision。长 code 必须 wrap/reflow，不以极小字体压缩。

## 9. JOB TITLE / ROLE

`position` 是 nullable employee-facing job title，可安全显示；若为空则直接省略，不显示 `Not specified`。

`employmentType`（FULL_TIME、PART_TIME、CONTRACT、DAILY、HOURLY）是 employment fact，可 humanize 后显示。

不要把 system role、Approval capability、`BUSINESS_OWNER`、`PLATFORM_ADMIN` 或 permission enum 当成职位。Current Profile read model 没有暴露 internal RBAC，这是正确的。

## 10. MANAGER-AS-EMPLOYEE

Manager variant 与 normal staff 使用同一 Profile、相同 sections、相同 personal scope。L01M 已证明当前实现没有另建 manager dashboard。

不显示：

- approval count
- capability/permission list
- team member list
- manager queue / My History

若 `position` 本身是 `Manager` 可作为真实 job title 显示；不能由 approval capability 推导该字样。

## 11. CURRENT WORKPLACE

Current workplace 来自 session-scoped membership：

- Business：`membership.business.name`
- Branch：current session `primaryBranchId` 对应的 active primary assignment name

建议呈现为一个 compact Detail Section 或 List Row：business 主标题，branch 次级文字，必要时 `Current workplace` neutral badge。

移除 current `ACTIVE` badge：无效 membership/business/primary branch 本来就无法通过 session validation，重复 Active 不增加信息。Position 不再放在 workplace section。

## 12. MULTI-EMPLOYER

Canonical model 支持一个 `EmployeeAccount` 拥有多个 `EmployeeBusinessMembership`。`getEmployeeWorkplaces` 只返回同一 account 的 eligible active memberships，并标记 current membership；inactive/suspended/terminated workplace 不返回。

- 1 个 eligible workplace：不显示 Switch action。
- 2 个以上：显示 `Switch workplace`，数量和名单来自 shell/current server result。
- Profile 不永久展开所有 employers；点击后打开 existing chooser。
- 不把 login-time `/staff/select-workplace` 当作 authenticated switcher。

建议 Profile 成为 permanent discoverable switch location。Current shell modal 是唯一 canonical selector，不再开发 Profile-specific selector。

## 13. WORKPLACE SWITCH UX

触发器：`Switch workplace` Action Row，仅当 `workplaces.length > 1`。

Existing safe flow 必须原样保留：

1. Open existing `Choose workplace` bottom sheet。
2. Current option disabled and marked `Current`。
3. User selects another eligible membership。
4. POST 只传 `membershipId`；server 不接受 client `businessId`。
5. Serializable transaction locks/validates current session and target membership。
6. Old tenant-scoped session revoked；new business/membership/primary branch session created。
7. New HttpOnly cookie replaces old token。
8. Client clears tenant-prefixed local/session state。
9. Hard navigation `window.location.replace('/staff')` reloads all Pay/Leave/Claims/Attendance scope。

UX contract：switching overlay 保持 `Securing your workplace session…`；失败停在旧 context，显示 employee-safe error；不可 optimistic 显示 target data。

Accessibility gap to validate during implementation：bottom sheet 已有 dialog role、Escape 与 44px+ rows，但应验证 initial focus、focus trap 与 close 后 focus restoration。

## 14. EMPLOYMENT INFORMATION

建议只显示 employee-useful facts：

- Employee ID — READY
- Position — READY but nullable
- Employment type — READY
- Started — READY from membership `joinedAt`

不要显示 pay basis、base salary、working days、work target、department（不存在）、statutory settings、termination metadata 或 compensation revision。

Employment status 不需显示 Active badge：Staff session 只允许 ACTIVE membership。SUSPENDED/TERMINATED employee 应 fail closed，而不是进入 Profile 看状态。

## 15. START DATE / EMPLOYMENT TYPE

`joinedAt` 是 membership 的 canonical joined date，不是 EmployeeAccount `createdAt`。可以显示 `Started · 1 Jan 2026`；实施 UAT 应确认 legacy/migrated memberships 的 date quality，但前端不可回退到 account creation date。

`employmentType` 可显示 Full time、Part time、Contract、Daily、Hourly。不要显示或由其推断工资计算方式；`payBasis` 属 payroll domain，不进入 Profile。

## 16. THIS DEVICE

当前 Profile 只读取 auth context 的 `deviceId`，并再约束同一 `employeeAccountId`、`status=ACTIVE`、`canView=true`。因此 section 正确命名是 `THIS PHONE`，不是可管理多设备的 `DEVICES`。

默认内容：

- Title：`This phone`
- Status：`Authorized`
- Meta：`This phone can access Staff App.`
- Secondary fact：`Last active · Today`（来自 device `lastActiveAt`）

不要在默认层显示 canView/canPunch、device ID、hash、revoke reason 或 session token。

## 17. DEVICE DETAIL

Current L05 expansion 显示 display name、first verified、last active。V2 可保留原生 `<details>/<summary>`，但重新定义语义：

- `Status` → Authorized
- `Platform` → only safe non-empty platform label
- `Browser` → optional，low priority
- `Authorized on` → `firstVerifiedAt`
- `Last active` → `lastActiveAt`

关键修正：`firstVerifiedAt` 不能标为 `Signed in`。`displayName` 是 client-supplied platform/browser metadata，不应被当成可信设备型号；空值时显示 generic `This phone`，不显示 dash。

Device expansion 应保持 keyboard-safe、44px summary、focus-visible，不显示 UUID/hash。

## 18. SECURITY

Security section 使用员工语言：

- `Sign-in method` → `Phone verification`
- `Login phone` → masked phone（仅 enrichment 后）
- `This phone` → `Authorized`

不显示 SMS123、Twilio、provider reference、OTP SID、challenge ID、delivery status、session family 或 authorization version。Provider 是 implementation detail。

## 19. SESSION INFORMATION

Current Profile 没有读取 `EmployeeSession.createdAt`，因此没有真实 last-sign-in timestamp。Device `lastActiveAt` 是 activity touch，不等于 sign-in；device `firstVerifiedAt` 是 authorization date，也不等于 current session creation。

因此：

- `Last active` — READY（device activity）
- `Authorized on` — READY（device first verified）
- `Last signed in` — **READ MODEL ENRICHMENT REQUIRED**（需 current session createdAt 或明确 canonical login event）

即使未来提供，也不显示 expiresAt、issued-at、refresh token、session ID 或 IP hash。

## 20. SIGN OUT

保留现有 `logout()` action，但 presentation 改为 `ACCOUNT` 下的 compact destructive Action Row：

`Sign out` → meta `Sign out of Staff App on this phone`

按钮必须 44px+、有明确 text 和 disabled `Signing out…` 状态。不要藏在 device expansion，也不要做 giant red hero。

建议维持 immediate logout，不新增 confirmation：这是可恢复的 session action，清楚标识且位于独立 Account section；额外确认只会增加日常摩擦。若 owner 在 physical-device UAT 观察到误触，再以 compact sheet 重新评估。

## 21. LOGOUT SECURITY

Current contract 已具备：

- same-origin POST `/api/employee-auth/logout`
- hash token lookup并 revoke current `EmployeeSession`
- audit `EMPLOYEE_SESSION_REVOKED` + `EMPLOYEE_LOGOUT`
- expire HttpOnly employee cookie
- clear auth-flow 与 tenant-prefixed local/session storage
- hard replace 到 `/staff/login?reason=logged-out`
- protected API/page 重新认证；revoked token fail closed
- service worker 不缓存 API 或 Staff navigations

Client 即使收到 expired-session error 仍清 local state并返回 login。Profile V2 不改变此逻辑。

## 22. DEVICE CHANGE / LOST PHONE

Current verified-device binding flow在新 phone registration 时将旧 active device 标为 REPLACED，并 revoke 相关 sessions；schema 与 tests 支持 shared EmployeeAccount 的跨-business session revocation audit。

Profile 只可提供说明：

`Using a new phone? Sign in again with your registered phone number.`

不得提供虚假的 `Remove device` / `Manage devices`。员工自助 remote revoke/lost-phone recovery 当前不存在：

**DEVICE MANAGEMENT ENRICHMENT REQUIRED**。

管理员 device revoke 是另一个受 business/scope 保护的 workflow，不应搬入 Staff Profile。

## 23. PERSONAL DATA EDITING

当前员工可编辑的唯一 Profile 数据是 avatar，且已有 canonical scoped/audited action。Name、phone、address、emergency contact、job title、employment type、employee code 均没有 employee self-edit workflow。

V2 保持 mostly read-only：

- Avatar：KEEP existing action，视觉简化。
- 其他字段：no edit buttons。
- 不创建无目标的 pencil icon 或 fake form。

## 24. BANK / STATUTORY DATA

Profile 不显示或编辑：

- bank account/full bank number
- EPF/SOCSO/EIS identifiers
- PCB/tax profile
- nationality/residency configuration
- salary/pay basis/compensation revisions

这些字段即使存在于 `EmployeeBusinessMembership` 或 related payroll models，也不属于 current employee-safe Profile projection。Pay module 亦不代表 Profile 可复制这些敏感数据。

## 25. APP / SUPPORT / ABOUT

Current Profile 没有 canonical app version、support、privacy、terms 或 help link。`package.json` version 和 runtime implementation metadata 不应直接当作 user-facing product version。

Decision：当前 V2 省略 ABOUT section。只有当产品提供稳定 support/privacy URLs 与 user-facing release version contract 后，才可放在最低优先级 Detail Section。

Status：app version/support **UNSUPPORTED**，不要 invent links。

## 26. EMPTY / PARTIAL FAILURE

Profile 不应出现整页“无资料”状态；有效 session 必须有 identity、current membership、business、primary branch 与 active view-capable device。

Critical：

- auth/session validity
- own membership/business scope
- current primary branch
- current device ownership/status/canView

Optional：

- avatar
- position
- platform/browser/display name
- future masked phone presentation
- future support/about metadata

Optional null 值直接 omit row，不显示 dash 或 `Not specified`。Current `/api/me` 将 membership + device 一起读取；device/membership缺失是 auth failure而非 partial Profile。更细的 section-level degradation需要另行 read-model architecture 决定，本蓝图不改 backend。

## 27. LOADING

Stable skeleton contract：

1. Page Header line
2. Compact identity row
3. Workplace row group
4. Employment definition rows
5. This phone row
6. Sign-out row placeholder

不使用 current centered spinner card，也不生成 giant avatar/card skeleton。Skeleton 固定结构，避免内容加载后大幅跳动。

## 28. ERROR

Non-auth error：

- Title：`Profile couldn't load`
- Copy：`Check your connection and try again.`
- Action：`Try again`

Auth/session/device invalid：使用 canonical login redirect与既有 reason message，不把它包装成普通 Profile error。永不输出 Prisma、membership/device/session IDs、hash、token、RBAC enum 或 provider error。

`/staff/profile` 当前已有 server auth redirect；`/staff/device` 只有 client fail-closed，是 route consistency gap，应以 compatibility redirect 消除重复 surface。

## 29. PRIVACY

| Data | V2 rule |
|---|---|
| Name/avatar | own membership only；显示一次 |
| Phone | masked only；full value不重复；需 safe read model |
| Employee code | employee-facing value，可显示 |
| Position/type/start | own employment facts；仅必要字段 |
| Business/branch | current session context |
| Device metadata | generic current phone + safe platform/activity only |
| Internal identifiers | never render |
| Pay/Claim/Commission | never render in Profile |
| Bank/statutory | never render in current scope |

Masked value需 accessible label `Login phone ending 2259`，不能让 screen reader只读一串 bullets。

## 30. NORMAL STAFF WIREFRAME

```text
Profile

[OY]  Oscar Yong
      Stylist
      [Change photo]

CURRENT WORKPLACE
Royal Salon
salon online

EMPLOYMENT
Employee ID          RS-001
Employment type      Full time
Started              1 Jan 2026

THIS PHONE
This phone           Authorized
Last active          Today
About this phone     >

SECURITY
Sign-in method       Phone verification
Login phone          •••• 2259   [only when safe field exists]

ACCOUNT
Sign out             >

[Home] [Time] [Requests] [Pay] [Profile]
```

## 31. MANAGER WIREFRAME

```text
Profile

[OY]  Oscar Yong
      Salon Manager        [only if canonical position]

CURRENT WORKPLACE
Royal Salon
salon online

EMPLOYMENT
Employee ID          RS-001
Employment type      Full time
Started              1 Jan 2026

THIS PHONE
This phone           Authorized
Last active          Today

ACCOUNT
Sign out             >
```

不增加 Approvals、permissions、team 或 manager badge。Manager 与 normal staff 的视觉和个人 scope相同。

## 32. MULTI-EMPLOYER WIREFRAME

```text
Profile

[OY]  Oscar Yong
      Stylist

CURRENT WORKPLACE
Royal Salon
salon online
[Switch workplace                               >]

EMPLOYMENT
...

THIS PHONE
...

ACCOUNT
Sign out
```

点击 action 后复用 existing chooser：

```text
MY WORKPLACES
Choose workplace                         [Close]

Royal Salon
salon online                              Current

Young Parlor TWU
TWU branch                                Switch
```

名单不永久展开，不显示 membership IDs。

## 33. DEVICE WIREFRAME

Default：

```text
THIS PHONE
This phone                                Authorized
This phone can access Staff App.
[About this phone                              >]
```

Expanded：

```text
THIS PHONE
Status                                    Authorized
Platform                                  iPhone / Android (only if safe)
Browser                                   Safari / Chrome (optional)
Authorized on                             29 Aug 2026
Last active                               Today, 1:09 pm
```

不显示 current device UUID、deviceIdentifierHash、session ID、IP hash、token、canView/canPunch 或 revoke internals。

## 34. CURRENT → V2 MAPPING

| Current | V2 decision | Target |
|---|---|---|
| No visible Profile Page Header | REPLACE | `StaffV2PageHeader title="Profile"` |
| Large employee hero | REPLACE | compact identity block |
| 82px editable avatar | KEEP + SIMPLIFY | 52–56px avatar, same canonical upload action |
| Employment type in hero | MERGE | employment definition row |
| Employee code in hero | MERGE | one Employee ID row |
| Current workplace big card | SIMPLIFY | compact business/branch Detail Section |
| Workplace Active badge | REMOVE | active session already proves validity |
| Position under workplace | MERGE | identity or employment, once only |
| Employment big card | REPLACE | flat definition rows |
| `Not specified` position | REMOVE | omit optional row |
| Employment Active badge | REMOVE | invalid membership cannot enter |
| Manager label/capabilities | REMOVE/DO NOT ADD | manager stays employee |
| No Profile switch action | MERGE | trigger existing shell chooser only for >1 |
| Phone absent | READ MODEL GAP | masked login phone after enrichment |
| This phone big card | REPLACE | compact status row + optional details |
| `Signed in` device heading | REPLACE | `This phone · Authorized` |
| firstVerifiedAt labelled Signed in | RELABEL | `Authorized on` |
| lastActiveAt | KEEP | `Last active` |
| Device expanded grid | SIMPLIFY | semantic definition rows |
| Security OTP copy | SIMPLIFY | `Phone verification`，no provider |
| Full-width Sign out button | KEEP + SIMPLIFY | destructive Action Row |
| `/staff/device` duplicate surface | REPLACE | compatibility redirect to Profile |
| App/about absent | DO NOT INVENT | omit until canonical metadata exists |

## 35. MOBILE 360

360 × 800 contract：

- `scrollWidth === innerWidth`
- 16px horizontal page padding；不缩小基础字体
- long employee name最多自然多行，avatar保持固定 compact size
- business/branch、employee code、device meta使用 `overflow-wrap:anywhere`
- definition row在空间不足时从 label/value横排变为 stacked，不截断 value
- 所有 action/summary 至少 44px
- Switch workplace 与 Sign out 可完整滚到 fixed nav 上方
- content bottom padding = fixed nav height + safe-area inset + comfortable clearance

第一屏目标：Page Header、identity、current workplace，至少看到 Employment section开头。

## 36. MOBILE 390

390 × 844 target：第一 viewport 理想显示 Page Header、identity、current workplace与大部分 employment facts。Device 与 Sign out 可在下方，不应被四张大卡推远。

沿用与 360 相同 IA，不增加卡片大小。以现有 L01 为 baseline，V2 必须明显减少 vertical card padding、nested backgrounds 与重复 badge。

## 37. MOBILE 412

412 × 915 使用与 390 完全相同 IA与字号；额外高度只显示更多内容，不放大 avatar/cards。Device expanded 后仍可将 Sign out完整滚到 nav 上方。

现有 L01/L05/S09C 412 captures 无 horizontal overflow，可作为 regression baseline；V2 需改善 information density 而非改变 bottom navigation。

## 38. LARGE TEXT / LONG NAMES

必须覆盖：

- 40+ character employee name
- long business name
- long primary branch name
- long position
- long employee code
- long platform/display metadata
- 200% text zoom

规则：不使用 fixed-height text containers；不省略关键 identity/workplace 值；次级 browser/device meta可 wrap，不以 font-size < 12px 解围；badge与文字不重叠；action trailing icon保持独立列。

## 39. ACCESSIBILITY

- 页面只有一个 h1：`Profile`。
- Identity name不是第二个 h1。
- Sections使用逻辑 h2/label；employment/device facts使用 `<dl><dt><dd>` 或等价语义。
- Workplace trigger accessible name：`Switch workplace from Royal Salon`。
- Current chooser使用 dialog label、initial focus、focus trap、Escape、focus return。
- Sign out使用完整 destructive text，不只用图标/颜色。
- Status永远有文字 `Authorized`，不依赖绿色。
- `<details>/<summary>` keyboard-safe，summary 44px+。
- `:focus-visible`清楚可见；touch targets 44px+。
- Masked phone提供 meaningful accessible text。
- Avatar button保持 `Change profile photo` accessible name。
- text zoom/reflow不产生横向 scroll。

## 40. SECURITY AUDIT

| Check | Evidence in current implementation | Verdict |
|---|---|---|
| Own identity/employment only | `getEmployeeAuthProfile` filters membership ID + account ID + business ID | PASS |
| Current business/membership scope | opaque HttpOnly session token resolves server-side business/membership/branch context | PASS |
| Workplace switch scope | target membership resolved from same account eligible memberships；client不能指定 businessId | PASS |
| Manager cannot view another profile | Profile uses employee session context only；no manager person ID route | PASS |
| Direct Profile after revoke | `/staff/profile` server auth redirects；`/api/me` rejects revoked session | PASS |
| Logout revokes session | transactional revoke + audit + expired cookie | PASS |
| Pay/Requests/Time after logout | protected routes/API re-auth；client tenant state cleared；navigations/API not SW cached | PASS contract |
| Device ownership | session/device account ID/status/canView checks；profile rechecks current device | PASS |
| Secret leakage | safe profile excludes hashes/token/session/device IDs | PASS |
| Internal account identifiers | integration test serializes Profile and verifies auth context IDs absent | PASS |
| Multi-employer isolation | old session revoked, new scoped session, hard tenant reset；inactive/foreign membership denied | PASS |
| `/staff/device` auth consistency | client `/me` fail closed but lacks `/staff/profile` server redirect pattern | LOW route gap |
| Switch dialog focus containment | role/Escape present；focus trap/restore not evident | ACCESSIBILITY UAT GAP |

No critical bypass found. This blueprint does not modify security behavior。

## 41. READ MODEL READINESS MATRIX

| Desired Profile field/action | Status | Actual canonical source / gap |
|---|---|---|
| Display name | READY | membership `fullName` via `/api/employee-auth/me` |
| Avatar + change photo | READY | membership `avatarUrl` + scoped `/api/employee-auth/avatar` |
| Phone | READ MODEL ENRICHMENT REQUIRED | account/membership stores phone, but safe Profile response omits it |
| Employee code | READY | membership `employeeCode` |
| Job title | READY | nullable membership `position`; omit when null |
| Employment type | READY | membership `employmentType` |
| Employment status | READY but omit | auth only permits ACTIVE; badge is redundant |
| Start date | READY | membership `joinedAt`; never use account createdAt |
| Current business | READY | scoped membership business name |
| Current branch | READY | session primary branch active assignment name |
| Multiple memberships | READY | `getEmployeeWorkplaces` eligible active list |
| Switch workplace | READY | shell chooser + `/api/employee-auth/switch-workplace` |
| Current device status | READY | current context device `status`/canView |
| Device platform | PARTIAL | client-supplied platform/browser metadata；generic fallback required |
| Device display name | PARTIAL | not a verified hardware model；use low priority only |
| Last active | READY | device `lastActiveAt` |
| Authorized date | READY | device `firstVerifiedAt` |
| Last sign-in | READ MODEL ENRICHMENT REQUIRED | current session `createdAt` not projected；device dates are not login time |
| Session/security summary | PARTIAL | valid session/device can support plain summary；no need expose token/expiry |
| Login method | READY as product copy | Staff auth is phone verification；provider hidden |
| Logout | READY | canonical revoke/cookie-clear/client-reset flow |
| Lost-phone self-service | UNSUPPORTED | no employee remote device revoke workflow |
| App version | UNSUPPORTED | no user-facing version contract |
| Support/privacy/terms | UNSUPPORTED | no canonical Profile links |

## 42. IMPLEMENTATION RISK

| Area | Risk | Why | Mitigation |
|---|---|---|---|
| Multi-employer switch | HIGH | tenant context changes across every Staff domain | reuse exact action/sheet；no optimistic data；hard reload；test two employers |
| Session revocation | HIGH | old token must never remain valid | do not alter transaction/cookie flow；regression old-token rejection |
| Device authorization data | HIGH | technical fields and device replacement are security-sensitive | current device only；safe fields allowlist；no admin UI |
| Phone/login identity | HIGH | PII + authentication key | masked projection only；no edit；no client-storage derivation |
| Internal RBAC vs job title | MEDIUM | permission names could misrepresent employment | use nullable `position` only；never capability-derived label |
| Current workplace consistency | HIGH | stale business data is a tenant leak | session-scoped read；clear tenant storage；hard navigation |
| Profile partial failure | MEDIUM | current combined `/me` makes device/membership critical | keep auth fail-closed；omit optional null rows；do not cache stale profile |
| Logout security | HIGH | Pay/requests could remain visible if cache/state survives | keep server revoke, cookie expiry, tenant clear, no SW navigation caching |
| Legacy CSS | MEDIUM | Profile has repeated global selectors/override layers | new scoped Profile V2 module using existing primitives；remove legacy selectors only after proof |
| Sensitive personal data | HIGH | phone/employment/device facts could overexpose | explicit field allowlist；masked phone；no bank/statutory/internal IDs |
| Manager-as-employee | MEDIUM | capability UI could turn Profile into manager dashboard | identical IA；no approval/RBAC data |
| Long names/mobile | LOW–MEDIUM | wrap can push actions/nav or create overflow | flexible grid, wrap/reflow, 360/390/412 + 200% text tests |
| Avatar action | MEDIUM | file upload + PII | preserve current size/type/processing/scope/audit checks |
| `/staff/device` duplicate route | LOW | two entry points can drift | compatibility redirect to one Profile surface |

## 43. RECOMMENDED IMPLEMENTATION SEQUENCE

1. Owner approves this Profile blueprint and permanent workplace-switch ownership。
2. Decide whether masked login phone is required in first Profile V2 release；如 required，先批准 narrow employee-safe read-model enrichment。
3. Implement `/staff/profile` presentation only using existing V2 primitives and scoped Profile CSS module。
4. Preserve existing avatar action、shell workplace chooser、switch action与 logout logic unchanged。
5. Replace `/staff/device` duplicate rendering with compatibility redirect to canonical Profile verified state。
6. Owner review：normal employee + manager，single-workplace + multi-employer。
7. Validate switch A→B→A：old token revoked、all domains reload、no stale Pay/Leave/Claims/Attendance。
8. Validate current phone section、device expansion、new/lost-phone wording。
9. Physical iPhone + Android UAT at 360/390/412 class viewports；long names + text zoom。
10. Run Global Staff V2 visual/security regression。
11. Only then begin Staff App V2 final UAT / closure。

不要在 Profile implementation 中开始任何新 Staff module。

## 44. NO BACKEND CHANGE CONFIRMATION

**BLUEPRINT ONLY**。

本轮没有修改：

- EmployeeAccount / EmployeeBusinessMembership
- Staff auth / OTP / provider
- RBAC / capabilities
- device authorization / replacement / revoke
- session lifecycle / cookie
- workplace switch
- Avatar action
- Payroll / Attendance / Leave / Claims / Approval Center
- API behavior
- Prisma schema
- migrations

Phone、last-sign-in、device management与 app/support gaps 只记录为 read-model/product gaps；没有实施 enrichment。

**NO NEW MIGRATION**。

## 45. PRODUCTION STATUS

**BLUEPRINT ONLY**

**LOCAL / TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

已按 STOP RULE 停止：未实施 Profile V2、未改变 workplace switch、未改变 device/session/security behavior、未开始 Global Final UAT。等待 owner review。
