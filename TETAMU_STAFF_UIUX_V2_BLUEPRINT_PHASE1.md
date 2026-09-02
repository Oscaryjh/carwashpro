# TETAMU STAFF 3000 — UI/UX V2 BLUEPRINT PHASE 1

> Scope: Design System + Home V2  
> Canonical Staff App: **3000 ONLY**  
> 3100: **REFERENCE ONLY / READY TO RETIRE / NOT USED**  
> Capture baseline: `TETAMU_STAFF_UI_VISUAL_STATE_CAPTURE_MANIFEST.md` and `artifacts/staff-ui-capture/`  
> This phase is a blueprint. **No product UI code was changed.**

## 1. FINAL DESIGN VERDICT

Staff 3000 的功能结构是可保留的，但视觉语言需要从“每个模块各自做大卡片”转为“少量稳定 primitives 组合页面”。当前 Home 的问题不是缺少美化，而是层级过多、同一信息重复、绿色覆盖面积过大、卡片嵌套过深。

V2 的明确方向：

- 保留 `Home / Time / Requests / Pay / Profile` 五个主导航。
- 保留现有 capability、Attendance、Approval、Leave、Claims、Pay 等 canonical 行为。
- Workplace context 保留在顶部，但减少装饰和重复。
- 移除大面积绿色员工 Welcome Hero；员工姓名并入轻量 Page Header／Attendance 上下文。
- Attendance 成为 Home 唯一允许拥有高视觉权重的 Hero Status。
- Schedule、Upcoming、Next Appointment、Needs My Approval 统一为紧凑 row。
- Quick Actions 保持最多三个，只显示 Schedule、Leave、Appointments（有 SALON capability 时）。
- 不建立新的 domain-specific card family；未来模块复用同一组 Page Header、List Row、Detail Section、Status Badge、Sticky Action Bar。

最终产品感受应是：**更轻，但不是更空；内容更少，但理解更快。**

## 2. V2 DESIGN PRINCIPLES

1. **Now first**：页面首先回答“现在要知道或做什么”。
2. **One visual anchor**：每页最多一个高权重区域；Home 的高权重区域是 Attendance。
3. **Less surface nesting**：一层 surface + typography + divider，避免 card → inner card → mini cards。
4. **Action follows state**：状态和主要动作必须在同一视觉区内。
5. **Green with intent**：绿色用于品牌、主动作、active navigation、成功；普通信息使用 neutral surface。
6. **Rows for navigation**：可点击摘要、重复项目、未来列表全部优先使用 List Row。
7. **Stable state geometry**：Attendance 状态变化尽量不改变主要区块顺序和宽度，减少 layout jump。
8. **Capability before persona name**：Manager UI 继续按可审批能力显示，不按 role 文案推断。
9. **Explain only exceptions**：正常状态不显示技术说明；GPS、device、geofence 仅在动作需要或失败时出现。
10. **Mobile is the contract**：先满足 360–412px，再允许更宽布局增强。

## 3. CURRENT GLOBAL UI PROBLEMS

### 3.1 真实代码现况

- `src/app/staff/staff.css`：3,025 行。
- `src/app/staff/staff-consolidation.css`：382 行，并在 legacy stylesheet 后加载覆盖。
- Home 主要由 `StaffHomeOverview`、`StaffToday`、`StaffManagerApprovalEntry` 拼装。
- `StaffToday` 同时负责 API、GPS、exception、confirmation、状态计算和完整视觉输出，表现层与交互逻辑耦合较深。
- `.staff-welcome-card`、`.staff-home-grid`、`.staff-home-card`、`.staff-state-orb`、`.staff-pwa-shell`、`.staff-pwa-nav` 等在多个位置或文件重复定义/覆盖。
- 当前样式使用至少 20px、22px、24px、19px、18px、17px、16px、15px、14px、13px、12px 等大量 radius，缺少清晰层级。
- 白色 surface、绿色 soft surface、不同 success/warning/danger 颜色存在大量硬编码，semantic role 不统一。

### 3.2 Pattern audit

| Current pattern | Classification | Evidence / problem | V2 direction |
|---|---|---|---|
| 五项 Bottom Navigation | **KEEP** | 产品 IA 已验证；入口稳定 | 保持结构，统一 solid surface、safe-area 和 active state |
| Workplace header | **SIMPLIFY** | Business + branch 有价值，但当前半透明 surface 叠在渐变背景上 | 改为清晰 solid context row；长文字一行截断 + 可访问完整 label |
| 绿色 Employee Welcome Hero | **MERGE / REMOVE** | 姓名、日期、Ready 与 Attendance 重复；128px 高且占据首屏 | 姓名并入轻 Page Header；Ready 只在 Attendance 显示一次 |
| Attendance 大卡 | **SIMPLIFY** | 外卡 + context 内卡 + 4 个 metric 卡 + badge + CTA，层级过多 | 单一 Hero Status；状态、主动作、shift、关键 facts |
| 4 个 metric mini cards | **REPLACE** | 每个数字都像独立功能 | Compact Summary，使用 divider 而非四张卡 |
| Schedule empty 大卡 | **SIMPLIFY** | 无资料却占据大面积并展示长解释 | neutral compact row；一句原因，不推断 Rest Day |
| Upcoming Schedule card | **REPLACE** | 本质是导航摘要 | List Row |
| Next Appointment card | **REPLACE** | 本质是下一条 item | List Row，时间为 leading value |
| Quick Access 图块 | **SIMPLIFY** | 3 个 92–100px tiles 仍偏重 | lighter Action Row / compact icon actions；最多三个 |
| Needs My Approval | **KEEP / SIMPLIFY** | 优先级正确，当前结构可用 | Action Row，pending count + Review；只在 `total > 0` |
| 多种 status chips | **MERGE** | 同一语义有 orb、chip、badge、domain custom pill | 一个 canonical Status Badge family |
| Page/section hero cards | **REPLACE** | 多页都用 border-top + large radius，视觉同权 | Page Header 不一定有 surface；内容按 Detail Section/Row |
| Nested cards | **REMOVE** | Home Attendance、Approval、Pay 多处 surface 套 surface | 最多一层 container；内部用 divider 和 spacing |
| 大面积渐变与阴影 | **SIMPLIFY** | shell radial gradient、hero gradient、button shadow 同时存在 | 页面背景与 header 使用 solid；阴影只给浮层/nav，主内容靠边框 |
| Loading / error / empty custom variants | **MERGE** | 每个模块有独立尺寸与 copy 密度 | 三套 reusable state patterns：Loading、Recoverable Error、Empty |
| 表单 input/action | **KEEP / NORMALIZE** | 44px 基线基本存在，但 radius/padding 不一致 | Form Section + 48px field + Sticky Action Bar |

### 3.3 Excessive green usage

当前绿色同时承担品牌背景、Welcome Hero、按钮、badge、kicker、icon、active nav、manager entry 和数值强调。结果是所有内容都像 primary。V2 中：

- 强绿色只用于 primary button、active navigation mark 和关键 success state。
- 普通标题使用 `text-primary`，不再全部绿色 uppercase。
- informational row 使用 `surface` / `surface-muted`。
- Status 由语义颜色 + 文案 + 必要 icon 共同表达，不只依赖颜色。

## 4. DESIGN TOKENS

Tokens 应在 Staff V2 scope 内集中声明；以下数值是 Phase 1 contract，不要求本轮写 CSS。

### 4.1 Spacing

| Token | Value | Usage |
|---|---:|---|
| `space-1` | 4px | icon/text micro gap |
| `space-2` | 8px | row internal small gap |
| `space-3` | 12px | compact row gap / control gap |
| `space-4` | 16px | page horizontal padding、standard surface padding |
| `space-5` | 20px | Hero internal spacing |
| `space-6` | 24px | section-to-section spacing |
| `space-8` | 32px | major page break only |

Contract：

- Page horizontal padding：16px；360px 可降至 12px，但组件自身不再减小 touch target。
- Section spacing：24px；相关 rows 之间 0–8px。
- Standard surface padding：16px。
- Compact row vertical padding：12px；总高度至少 56px。
- Hero padding：20px；390px 下不超过 24px。

### 4.2 Typography

沿用当前系统字体栈／inherit，不新增网络字体。

| Role | Size / line-height | Weight | Notes |
|---|---|---:|---|
| Page title | 28 / 34px | 700 | 一页一个 `h1` |
| Hero primary value | 24 / 30px | 700 | Attendance state 或主时间 |
| Section title | 17 / 22px | 700 | 不强制 uppercase |
| Section label | 11 / 14px | 700 | 可 uppercase，letter spacing ≤ .08em |
| Row title | 15 / 20px | 650–700 | 可换行两行 |
| Body | 15 / 22px | 400–500 | 主要说明 |
| Secondary / meta | 12 / 17px | 400–500 | date、branch、supporting info |
| Status text | 12 / 16px | 650–700 | badge 内必须可读 |
| Compact value | 14 / 19px | 650–700 | worked / break / counts |

避免继续使用大量 `font-weight: 850/900`；浏览器对非 variable font 的映射不稳定，V2 优先 400/500/600/700。

### 4.3 Radius

| Token | Value | Usage |
|---|---:|---|
| `radius-lg` | 20px | Hero、modal/sheet main container |
| `radius-md` | 16px | standard surface、row group |
| `radius-sm` | 12px | inputs、icon wells、small controls |
| `radius-pill` | 999px | status/filter chips only |

不再为 13、14、15、17、18、19、21、22、24px 各建一种视觉身份。

### 4.4 Touch targets

- 所有 button、link、date selector、filter chip、nav item：至少 44×44px。
- Primary CTA：最少 48px 高。
- Icon-only action：44×44px，并提供 accessible name。
- 相邻主要动作之间至少 8px。

### 4.5 Semantic color roles

| Role | Suggested value | Usage |
|---|---|---|
| `brand` | `#087F76` | primary action、active nav、brand accent |
| `brand-strong` | `#05645D` | pressed/strong text accent |
| `canvas` | `#F6F8F7` | page background |
| `surface` | `#FFFFFF` | primary content surface |
| `surface-muted` | `#F1F5F4` | compact neutral group / disabled context |
| `text-primary` | `#142423` | headings/values |
| `text-secondary` | `#5D6E6C` | body/meta |
| `border` | `#D7E1DF` | standard divider/border |
| `success` | `#207245` | success text/icon |
| `success-soft` | `#E7F5EC` | success badge background |
| `warning` | `#7A5A12` | pending/on-break text |
| `warning-soft` | `#FFF3D6` | warning badge/background |
| `danger` | `#A5362C` | error/rejected/action needed |
| `danger-soft` | `#FFF0EE` | error surface |
| `info` | `#315F7D` | adjusted/informational state |
| `info-soft` | `#EAF2F7` | info surface |
| `disabled` | `#9AA8A6` | disabled text/icon |

Status 不可只靠背景颜色；必须保留可读文案，必要时加 icon。

### 4.6 Elevation

- Content surfaces 默认无 shadow，仅使用 border。
- Floating Bottom Navigation／modal／bottom sheet 可使用单一低强度 shadow。
- Primary button 可有非常轻的 pressed/elevation feedback，但不使用大面积 glow。

## 5. COMPONENT SYSTEM

### 5.1 Page Header

Anatomy：eyebrow（可选）→ page title → one-line supporting text（可选）→ trailing action（可选）。默认无 card surface。

用于：Time、Requests、Pay、Profile、detail pages。Home 使用 compact identity variant。

### 5.2 Hero Status

Anatomy：status label → primary state/value → supporting time/shift → primary action → compact facts。一个页面最多一个。

用于：Home Attendance；未来 Timesheet 的本期状态可用低权重 variant，但不能与 Home 同样重。

### 5.3 Compact Summary

2–4 个等宽 summary cells，使用 divider，不把每个 cell 画成卡片。用于 Break、Worked、Clock in、Clock out、余额/金额/count。

### 5.4 List Row

Leading icon/time（可选）→ title → one/two-line meta → trailing status/chevron。默认 56–72px，多个 row 可共享一个 surface。

用于 Schedule、Appointment、Payslip、History、Approval、Leave/Claim record。

### 5.5 Action Row

用于单一明确入口：Needs My Approval、Submit correction、Upload receipt。必须包含 action verb 或 chevron，不以纯装饰大卡呈现。

### 5.6 Detail Section

detail/task page 内的语义 group。标题 + definition rows/dividers；不要每个 field 都包 card。

### 5.7 Status Badge

统一尺寸、semantic colors、文本规则。一个 row/card 默认最多一个主 badge；次级状态改为 meta text。

### 5.8 Empty State

三种密度：

- Inline empty：一行，例如 “No schedule today”。
- Section empty：标题 + 一句解释 + 可选 action。
- Page empty：仅当整页无内容时使用 icon、标题、说明、CTA。

### 5.9 Form Section

相关 inputs 放在同一 section；label 永远可见；hint/error 紧邻字段；避免 field 外再套多层 card。

### 5.10 Sticky Action Bar

用于长表单和 Approval detail。固定/粘性区域必须预留 safe-area 和内容底部空间；最多一 primary + 一 secondary。

### 5.11 Filter Chips

用于短枚举/域筛选。active 使用 brand-soft + strong text；不将每个 filter 做成大按钮。横向滚动时要有可见 focus 和端点 padding。

### 5.12 Bottom Navigation

保持五项 IA。solid/light surface；active item 使用 brand-soft 或小 active indicator，不让每个 icon 都有额外独立圆块。内容区必须预留 nav 高度 + safe-area + 16px breathing room。

## 6. STATUS SYSTEM

### 6.1 Attendance

| Status | Priority | Color role | Icon | Badge rule |
|---|---|---|---|---|
| Ready | Medium | neutral + brand accent | 不需要 | Hero 内可用小 badge；其他地方用文字即可 |
| Clocked in | High | success | 可用实心 dot/check | Hero 主状态；不再另放第二个 Ready badge |
| On break | High | warning | 可用 pause | Hero 主状态；主动作是 End Break |
| Shift done | Low/positive | success-soft | check | Hero 可用低强调 badge，主要文案为完成时间 |

### 6.2 Workflow / Pay

| Status | Priority | Color role | Icon | Badge rule |
|---|---|---|---|---|
| Pending | Medium | warning | clock 可选 | list/detail 一个 badge |
| Waiting for manager | Medium | warning | 不需要 | 用户端优先显示此文案，不同时再显示 Pending |
| Action needed | High | danger | alert | 必须与可执行 action 同屏 |
| Approved | Low/positive | success | check 可选 | history row badge |
| Rejected | High | danger | x 可选 | badge + rejection reason section |
| Adjusted | Medium | info | adjustment 可选 | badge；原值/调整值进 detail |
| Final | Low | neutral | lock 可选 | 不与 Approved 重复；表示不可再编辑 |
| Up to date | Low/positive | success | 不需要 | 通常作为 summary text，不必 badge |
| Awaiting payment | Medium | info/warning | 不需要 | Claim/Pay row badge |
| Paid | Low/positive | success | check 可选 | row badge；金额仍为主值 |

### 6.3 Badge restraint

- 同一 surface 只允许一个主 badge。
- “Approved + Final”时主 badge 为 Final 或 Approved，另一个进入 meta，按业务语义决定。
- “Pending + Waiting for manager”只显示用户可理解的 “Waiting for manager”。
- “Ready”如果 Hero 标题已写 “Ready to start”，不再额外重复 badge。

## 7. CARD VS ROW RULE

| Component choice | Use when | Do not use when |
|---|---|---|
| Large Card / Hero | 当前最重要状态与主要动作；多个紧密相关信息 | 只是导航入口、空状态或单一数字 |
| List Row | 导航、重复 item、摘要 + tap、下一事项 | 需要复杂编辑或多个并列主动作 |
| Compact Summary | counts/totals/key facts | 内容包含长解释或需要进入详情 |
| Detail Section | detail/task page 中的证据、字段、审批上下文 | Home 上展示完整业务记录 |
| Action Row | 一个明确任务/入口 | 同时承载完整队列 |

约束：一个视觉 group 里最多一层 bordered surface。Rows 之间用 divider；不要把 row 再包成 card。

## 8. HOME CURRENT AUDIT

依据 B01、C02、C03 与当前 `StaffHomeOverview` / `StaffToday`：

1. Workplace header 已回答 business/branch，绿色 Welcome Hero 又显示 employee/date/Ready，Attendance context 再显示 branch/business/date，造成 workplace 与 Ready 三次出现。
2. Welcome Hero 高 112–128px，但不承载主动作；它比 Attendance 更先、更绿，错误抢占视觉优先级。
3. Attendance 使用 outer card、context inner card、四个 metric tiles、badge 和按钮，用户需要扫过多层边界才能找到 Clock In。
4. Before Clock In 时 Clock in/out 两个空值仍占两张 mini card；数据密度低。
5. No Schedule 是大 section card，重复“没有 schedule + 联系 manager + 不推断 rest day”的长解释，挤压首屏。
6. Manager pending entry 的顺序正确，但外观仍像另一张同权卡；应作为紧凑 actionable row。
7. Quick Access 图块有合理 IA，但 tile 高度和图标较大，较像营销入口而非日常工具。
8. shell radial gradient、半透明 workplace surface、绿色 hero、white cards、阴影叠加，使 iPhone PWA 顶部出现 washed/hazy 观感。
9. 390px 截图中 Bottom Navigation 可见，但 Home 长内容需要稳定的底部预留，不能依赖单页偶然高度。

## 9. HOME V2 INFORMATION HIERARCHY

固定顺序：

1. **Current Workplace Context** — business + branch + switch（若多 employer）。
2. **Compact Identity/Page Header** — greeting + employee name；不使用大面积绿色。
3. **Attendance Hero Status** — status + primary action + key facts。
4. **Manager Attention** — `pending > 0` 才出现。
5. **Today / Next Relevant Item** — 今日 shift 优先；无今日资料时只显示 compact neutral state；下一 shift/appointment 为 row。
6. **Quick Actions** — Schedule、Leave、Appointments（conditional）。
7. **Bottom Navigation** — 固定五项。

Home 不是所有模块的 index。Claims、Timesheet、Commission、Payslip 不回到 Quick Actions。

## 10. HOME V2 NORMAL STAFF

### 10.1 Header/context

- Workplace 保留在 shell 顶部，solid surface，business 为主、branch 为 meta。
- Home 内容只显示一次员工名字，例如 “Good morning, Oscar Yong”。
- 日期作为次级 meta，可与 greeting 同行或放 Attendance 顶部，不使用独立 badge。

### 10.2 Attendance Hero

- 首行：status label / status text。
- 第二层：主状态或关键时间，例如 “Ready to start” / “Clocked in at 10:47 AM”。
- Shift：一行 `10:45 AM – 7:45 PM · salon online`；无 schedule 则 compact neutral message。
- Primary action：Clock In / Clock Out / Start Break / End Break；保持现有确认、GPS、exception 流程。
- Facts：最多四个 compact cells，以 divider 组织；没有值时只保留必要 facts。

### 10.3 Next relevant item

- 优先显示下一 appointment（若今天存在且时间相关），否则 upcoming schedule。
- 只有一条最相关 item；“查看全部”进入对应页面。
- 无 appointment 不显示 appointment empty card。
- 无 upcoming schedule 不再建立第二张空卡。

### 10.4 Quick Actions

- 2–3 个轻量 action items。
- 图标 24–28px；每项 56–64px，而不是 92–100px tile。
- SALON capability 才显示 Appointments。

## 11. HOME V2 MANAGER

Manager Home 仍首先是该 manager 自己的员工 Home。

- Attendance Hero 与 Normal Staff 完全相同。
- `approvalSummary.total > 0`：Attendance 之后插入 Action Row：`Needs My Approval · N pending · Review`。
- `approvalSummary.total === 0`：Home 不显示 approval empty state。
- 不在 Home 展开 domain counts、queue cards 或审批详情。
- Requests 永久保留 Approval Center 入口；Home entry 只是高优先提醒。
- capability 继续由现有 `getStaffTeamApprovalSummary` 和 `getStaffOvertimeSummary` 决定，不按 Manager role name 硬编码。

## 12. HOME STATE MATRIX

| Variant | Hero status | Primary action | Shift area | Secondary item | Manager row |
|---|---|---|---|---|---|
| A. Before Clock In | Ready to start | Clock In | 今日 shift；无则 neutral inline | next shift/appointment if useful | capability + pending only |
| B. Clocked In | Clocked in · since time | Clock Out；Start Break 为 secondary | 当前 shift | next relevant item | same rule |
| C. On Break | On break · since time | End Break | 当前 shift | 可省略 next item，避免干扰 | same rule |
| D. Break completed / working | Working · resumed time | Clock Out；Start Break secondary if allowed | 当前 shift | next relevant item | same rule |
| E. Shift Done | Shift done · clock-out time | Start another shift 仅现有规则允许时 | completed shift summary | next shift | same rule |
| F. No Schedule | Ready / current attendance truth | 仍按 Attendance canonical eligibility | “No schedule today” + 一句 manager hint | 不显示第二张空 upcoming card | same rule |
| G. Schedule exists | Attendance truth | canonical action | time + branch | tomorrow/upcoming row | same rule |
| H. Next Appointment exists | Attendance truth | canonical action | 今日 shift | appointment row 优先 | same rule |
| I. No Appointment | Attendance truth | canonical action | 今日 shift | 不渲染 appointment section | same rule |
| J. Manager pending | Manager 自己的 attendance | canonical action | current shift | next relevant item | 显示在 Hero 后 |
| K. Manager 0 pending | Manager 自己的 attendance | canonical action | current shift | next relevant item | 完全隐藏 |

稳定性规则：Workplace → Identity → Attendance →（conditional manager row）→ next item → quick actions 的顺序不变；仅内容和单一 conditional row 增减。

## 13. HOME ASCII WIREFRAMES

Legend：`[PH]` Page Header、`[HS]` Hero Status、`[CS]` Compact Summary、`[LR]` List Row、`[AR]` Action Row、`[QA]` Quick Actions。

### 13.1 Normal Staff — Before Clock In

```text
┌──────────────────────────────┐
│ Royal Salon            Switch│ [workplace]
│ salon online                 │
└──────────────────────────────┘
Good morning, Oscar Yong        [PH]
Mon, 31 Aug

┌──────────────────────────────┐
│ READY TO START                │ [HS]
│ Today's shift                │
│ 10:45 AM – 7:45 PM           │
│ salon online                 │
│ [          CLOCK IN        ] │ primary
│ Break 0m   Worked 0h 00m     │ [CS]
└──────────────────────────────┘

UP NEXT                         [LR]
Tomorrow · Morning shift      ›

Schedule   Leave   Appointments [QA]
```

Conditional：Appointments 仅 SALON；无 next item 时整段隐藏。

### 13.2 Normal Staff — Clocked In

```text
Royal Salon · salon online      [workplace]
Good morning, Oscar Yong        [PH]

┌──────────────────────────────┐
│ ● CLOCKED IN                  │ [HS success]
│ Since 10:47 AM               │
│ Shift 10:45 AM – 7:45 PM     │
│ [ Start Break ] [ Clock Out ]│ actions
│ Break 0m   Worked 2h 18m      │ [CS]
└──────────────────────────────┘

UP NEXT · Tomorrow shift      › [LR]
Schedule   Leave   Appointments [QA]
```

### 13.3 Normal Staff — On Break

```text
Royal Salon · salon online      [workplace]
Oscar Yong                      [PH compact]

┌──────────────────────────────┐
│ Ⅱ ON BREAK                    │ [HS warning]
│ Since 1:05 PM                │
│ Shift 10:45 AM – 7:45 PM     │
│ [          END BREAK       ] │ primary
│ Break 25m   Worked 2h 18m     │ [CS]
└──────────────────────────────┘

Schedule   Leave   Appointments [QA]
```

On Break 时不强制显示 next item，主任务保持清晰。

### 13.4 Normal Staff — Shift Done

```text
Royal Salon · salon online      [workplace]
Oscar Yong · Mon, 31 Aug        [PH]

┌──────────────────────────────┐
│ ✓ SHIFT DONE                  │ [HS success-soft]
│ 10:47 AM – 7:46 PM           │
│ Break 45m   Worked 8h 14m     │ [CS]
│ [ View attendance history ]  │ secondary
└──────────────────────────────┘

UP NEXT · Tomorrow shift      › [LR]
Schedule   Leave   Appointments [QA]
```

`Start another shift` 仅在现有 canonical rule 提供时出现，不能由 V2 自行推断。

### 13.5 Normal Staff — No Schedule

```text
Royal Salon · salon online      [workplace]
Good morning, Oscar Yong        [PH]

┌──────────────────────────────┐
│ READY                         │ [HS]
│ No schedule today             │ neutral inline
│ Check with your manager if    │
│ you expected a shift.         │
│ [          CLOCK IN        ] │ canonical eligibility
│ Break 0m   Worked 0h 00m      │ [CS]
└──────────────────────────────┘

Schedule   Leave   Appointments [QA]
```

不显示第二张 “No upcoming shift”；不写 Rest Day。

### 13.6 Manager — Pending approvals

```text
Royal Salon · salon online      [workplace]
Good morning, Manager Name      [PH]

┌ ATTENDANCE HERO ─────────────┐ [HS]
│ manager's own employee state │
│ [ primary attendance action ]│
└──────────────────────────────┘

✓ Needs My Approval             [AR]
  3 pending            Review ›

Today's shift / next item     › [LR]
Schedule   Leave   Appointments [QA]
```

### 13.7 Manager — No pending approvals

```text
Royal Salon · salon online      [workplace]
Good morning, Manager Name      [PH]

┌ ATTENDANCE HERO ─────────────┐ [HS]
│ manager's own employee state │
│ [ primary attendance action ]│
└──────────────────────────────┘

Today's shift / next item     › [LR]
Schedule   Leave   Appointments [QA]
```

不显示 “You're all caught up” manager card；永久入口仍在 Requests。

### 13.8 SALON — Next Appointment present

```text
Royal Salon · salon online      [workplace]
Good morning, Oscar Yong        [PH]

┌ ATTENDANCE HERO ─────────────┐ [HS]
│ current status + action      │
└──────────────────────────────┘

NEXT APPOINTMENT                [LR]
2:30 PM  Amelia Tan             
         Hair Colour · 90 min ›

Schedule   Leave   Appointments [QA]
```

Privacy：Home 只显示当前业务已允许的 customer name/service summary；不增加电话或敏感备注。

## 14. CURRENT → V2 MAPPING

| CURRENT | V2 ACTION |
|---|---|
| Shell radial gradient | **REPLACE** with solid canvas; optional very subtle section tint only |
| Semi-transparent workplace control | **SIMPLIFY** to solid context row |
| Employee green hero | **REMOVE / MERGE** into compact Page Header and Attendance context |
| Date inside hero | **MOVE** to Page Header meta or Attendance date |
| Ready orb in hero | **REMOVE** duplicate; canonical status remains in Attendance |
| Attendance heading + separate Ready badge | **MERGE** into one Hero primary status |
| Attendance context inner card | **FLATTEN** into shift row inside Hero |
| Four metric cards | **REPLACE** with Compact Summary + dividers |
| GPS/device explanatory panel | **CONDITIONAL ONLY** on action/error |
| Clock action button | **KEEP** as Hero primary action; reduce glow |
| Manager approval compact card | **KEEP / NORMALIZE** as Action Row |
| Today’s Schedule large card | **MERGE** into Hero shift row when relevant |
| No Schedule large empty card | **REPLACE** with neutral inline state |
| Upcoming Schedule card | **REPLACE** with List Row |
| Next Appointment card + count text | **REPLACE** with one List Row; count belongs to Appointments page |
| Quick Access 92–100px icon tiles | **SIMPLIFY** to 56–64px compact actions |
| Domain-specific badges | **MERGE** into canonical Status Badge |
| Fixed Bottom Navigation | **KEEP**; solidify surface and enforce bottom content reserve |

## 15. 390 MOBILE CONTRACT

- Viewport contract：390×844 CSS pixels。
- Page inline padding：16px；内容宽度 358px。
- Hero 不应要求横向双列文字；action 可双列，但 360px 下必须可降为单列。
- Employee/business/branch 名称默认可换行两行；trailing action 不得挤出 viewport。
- Attendance primary action 在首屏可到达；Before Clock In 目标是在不滚动或极少滚动时可见。
- Bottom content padding：`nav rendered height + safe-area inset-bottom + 16px`。
- `scrollWidth === innerWidth`。
- Quick Actions 三项时每项至少 44px touch area，label 不小于 11px。
- 大系统字体时 badge 可换行/下移，不覆盖主标题。

## 16. 412 MOBILE CONTRACT

- Viewport contract：412×915 CSS pixels。
- 仍使用 16px page padding；不要因为更宽而恢复大卡和额外解释。
- Hero 可在 412px 使用更舒展的 2-column summary，但 DOM 与 390 相同。
- Manager Action Row、Next Row、Quick Actions 保持同一顺序。
- 更高 viewport 只增加可见内容，不增加 section 空白。
- 末项必须可以完整滚动到 nav 上方。
- 与 390 共用 breakpoints；禁止针对单一设备写 magic height。

附加 360px contract：12px page padding可接受；Hero actions、manager row、long names 必须自然 wrap；不允许 horizontal scroll。

## 17. SAFE AREA / HEADER

### 17.1 Current cause

当前 top washed/hazy 观感主要来自：

- `.staff-pwa-shell` 顶部 radial gradient + vertical gradient。
- mobile override 又叠加另一组 gradient。
- workplace control 使用 `rgba(255,255,255,.9)`。
- brand logo shadow 与绿色 hero 紧邻，产生多层发光感。
- `backdrop-filter: blur(18px)` 当前用于 bottom nav；顶部本身虽没有 blur，但整体 translucency 让 PWA safe area 看似朦胧。

### 17.2 V2 contract

- `html/body/shell` 在 top safe area 使用同一 solid `canvas`。
- Header 不使用 `backdrop-filter`、radial gradient 或透明白叠层。
- Header 可为 non-sticky；若未来 sticky，必须使用 solid surface + 1px divider。
- 保留 `env(safe-area-inset-top)`，不要以固定状态栏高度代替。
- Workplace context 使用 solid surface；logo shadow 降到最小或移除。
- Bottom Navigation 可保留有限 translucency，但优先 solid `surface`；不得影响 top header。
- standalone PWA 与 Safari browser mode 都必须验证 top inset、scroll bounce 背景和 orientation change。

## 18. ACCESSIBILITY BASELINE

- 一个页面一个语义 `h1`；Section 使用有序 heading 层级。
- Attendance status 使用可读文字，不只使用绿/黄/红。
- Primary action 的 accessible name 与屏幕文案一致。
- 44px 最小 touch target，48px primary CTA。
- Long names 使用 wrap/ellipsis 时提供完整 accessible label；不能裁掉姓氏后无替代。
- 正文与 surface 维持至少 4.5:1；大字至少 3:1。
- Focus ring 不依赖 box-shadow 被 overflow 截断。
- Loading 使用 `aria-live`/`role=status`；Error 使用 `role=alert`，但避免重复播报同一信息。
- Sticky Action Bar 在软键盘出现时保持可达，不盖住最后 input/error。
- `prefers-reduced-motion` 继续保留；V2 不引入无必要 animation。

## 19. FUTURE MODULE APPLICATION

| Module | V2 primitives | Direction preview |
|---|---|---|
| Time | Page Header + Action Rows + Compact Summary | 入口按 Attendance/Timesheet 任务优先，不做 hub 大卡 |
| Schedule | Page Header + Filter Chips + List Rows | week navigation 紧凑，day 使用 expandable row |
| Attendance History | Page Header + Filter Chips + List Rows + Status Badge | Missing Punch 作为 Action Row；history 不用大卡 |
| Timesheet | Hero/Compact Summary + List Rows | 当前周期 summary 一个主 surface，workdays rows |
| Requests | Page Header + Action Rows + Recent List | Approval Center 为 capability-based row；不做模块卡墙 |
| Leave | Compact Summary + List Rows + Form Section | balance cells、request history rows、new request sticky action |
| Claims | Page Header + List Rows + Form Sections | wizard steps 共用 form primitives；receipt 为 attachment row |
| Pay | Compact Summary + List Rows | Payslip/Commission rows；金额使用 value typography，不用绿色大卡 |
| Profile | Page Header + Detail Sections + Action Rows | avatar/workplace/security/device 分 section；Sign out danger row |
| Approval Center | Page Header + Filter Chips + List Rows + Sticky Action Bar | 保留 accepted Pending/History IA，只收敛视觉 primitives |
| Appointments | Date controls + List Rows + Detail Section | week strip 保留；预约摘要 row；warnings 使用 canonical alert |

## 20. IMPLEMENTATION RISK

| Risk | Level | Why | Mitigation |
|---|---|---|---|
| `StaffToday` business interaction and presentation tightly coupled | High | UI rewrite容易破坏 GPS、idempotency、exception、break confirmation | 先提取纯 view-state mapper / presentation component；API functions不动 |
| `staff.css` + `staff-consolidation.css` cascade overlap | High | 新增第三层 override 会继续扩大冲突 | 建立 scoped V2 tokens/primitives；按组件迁移后删除对应旧规则，不做全局大爆改 |
| Server overview 与 client Attendance API 异步 | Medium | 初始 Home 和 attendance load 会发生 layout jump | 预留稳定 Hero skeleton geometry；不要复制状态到第二份 store |
| Manager approval summary 由多个 canonical sources 聚合 | Medium | 视觉组件若自行推断会改变 count/RBAC | 继续消费现有 summary；组件只负责呈现 `total > 0` |
| Conditional modules / quick access | Medium | HR/SALON combinations 不同 | 使用现有 `enabledModules` 和 `quickAccess` read model，不硬编码 persona |
| Long workplace/employee text | Medium | 目前 hero flex + trailing meta 易挤压 | CSS grid minmax(0,1fr)、two-line wrap、trailing action fixed width |
| Safe area / fixed nav | Medium | iPhone standalone 和 Android browser toolbar 差异 | 使用 dynamic viewport + env insets；390/412/360 + physical video regression |
| Status visual consolidation | Medium | 不同 domain 可能有同名不同语义 | 先建立 UI semantic mapping，不修改 backend enum/state |
| Icon consistency | Low | 当前有 SVG 与自定义图片混用 | Phase 1 不替换资产；实现时统一尺寸/icon well，不改变业务入口 |

## 21. RECOMMENDED IMPLEMENTATION SEQUENCE

1. **Approve this blueprint**：确认 tokens、Home hierarchy、status wording、8 个 wireframes。
2. **Create Staff V2 token scope**：只新增 semantic CSS variables 与 primitive class contract；不改 backend。
3. **Build reusable primitives**：Page Header、Hero Status、Compact Summary、List Row、Action Row、Status Badge、Empty State。
4. **Separate Home attendance presentation**：从 `StaffToday` 提取纯呈现层，但保留原 fetch/GPS/confirmation/exception code path。
5. **Implement Home V2 only**：Normal Staff first；保留五项 nav 和 current workplace switching。
6. **Add manager conditional row**：继续使用现有 capability-based approval summary；验证 0 与 >0。
7. **Apply schedule/appointment compaction**：一个 next relevant row；删除重复 empty surface。
8. **Responsive/accessibility QA**：360、390×844、412×915；long names；larger text；bottom nav；safe area。
9. **State regression**：Before Clock In、Clocked In、On Break、Break completed、Shift Done、No Schedule、Schedule、Appointment、Manager 0/>0。
10. **Physical UAT**：iPhone Normal Staff + Android Manager 两段短视频；修复 Home-only P0/P1 后再进入 Phase 2 modules。
11. **Gradual CSS retirement**：Home V2 稳定后删除被取代的 Home legacy/consolidation rules，避免长期三层 cascade。

不建议先建立一个巨大的 `staff-v2.css` 覆盖所有旧 selector；那会重复目前 consolidation layer 的问题。

## 22. NO-BACKEND-CHANGE CONFIRMATION

本 Phase 1 Blueprint 不要求、也不授权修改：

- Attendance calculation / Clock In / Clock Out / break / GPS / geofence。
- Leave、Claims、Payroll、OT、Commission、Payslip rules。
- Approval Center IA、approval records、count semantics。
- capability/RBAC、session/device security、multi-employer behavior。
- API、Prisma schema、database migration 或 canonical data ownership。
- Home / Time / Requests / Pay / Profile navigation。

本轮没有修改任何产品代码、API、schema、migration 或 Testing 数据。

## 23. PRODUCTION STATUS

LOCAL / TESTING ONLY

PRODUCTION NOT ACCESSED

PRODUCTION NOT MODIFIED

