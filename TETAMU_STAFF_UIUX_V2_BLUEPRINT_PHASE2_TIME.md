# TETAMU STAFF 3000 — UI/UX V2 BLUEPRINT PHASE 2: TIME

Date: 31 Aug 2026  
Canonical workspace: `C:\CodexTetamuP0`  
Canonical Staff App: **3000 ONLY**  
3100: **REFERENCE ONLY / READY TO RETIRE / NOT USED**  
Scope: **BLUEPRINT ONLY — Time Hub + Schedule + Attendance History + Timesheet/OT**  
Environment: **LOCAL / TESTING ONLY**

Evidence reviewed:

- Current Staff 3000 source code, not legacy documentation alone.
- `src/components/staff-pwa/staff-history.tsx`
- `src/app/staff/history/page.tsx`
- `src/app/staff/roster/page.tsx`
- `src/app/staff/timesheet/page.tsx`
- `src/lib/staff-pwa/schedule.ts`
- `src/lib/staff-pwa/attendance-correction-eligibility.ts`
- `src/lib/attendance/read-service.ts`
- `src/lib/attendance/employee-timesheet.ts`
- `src/lib/attendance/overtime-service.ts`
- `src/components/staff-pwa/staff-home-v2-primitives.tsx`
- `src/components/staff-pwa/staff-home-v2.module.css`
- `src/app/staff/staff.css` and `src/app/staff/staff-consolidation.css`
- D01, E01, F01 and G01 at 390×844 and 412×915 in `artifacts/staff-ui-capture/`.
- Approved Phase 1 blueprint and Home V2 final-polish report.

Important evidence limitation: D01 and F01 are intentionally identical captures because `/staff/history` currently acts as both the Time landing page and Attendance History. The capture manifest contains no safely reproducible full correction/OT lifecycle for this blueprint task; those states were derived from the real projectors and tests, not fabricated data.

---

## 1. FINAL DESIGN VERDICT

**APPROVE A LIGHT TIME HUB, THREE FOCUSED DETAIL DESTINATIONS, AND ONE SHARED ROW/STATUS LANGUAGE.**

The current business meanings are sound:

- Schedule = expected work.
- Attendance = actual clock activity.
- Attendance History = past actual records.
- Timesheet = processed monthly work result.
- OT = Attendance-derived manager review outcome.

The problem is presentation and information architecture, not the canonical engine. `/staff/history` currently combines a 2×2 navigation grid, global missing-punch entry, full filter form, correction form and Attendance History into one client page. Schedule already has the right states but gives the header, Today, week and empty state too much independent visual weight. Timesheet correctly projects employee action, manager action, final results and OT, but expands Result / Why / Next Action for every day.

V2 therefore must:

1. Keep the five bottom tabs unchanged: `Home / Time / Requests / Pay / Profile`.
2. Keep `/staff/history` as the existing bottom-tab destination and convert it into the Time Hub to avoid breaking navigation and installed PWA links.
3. Put full Attendance History behind a dedicated child destination, recommended as `/staff/history/records`.
4. Keep `/staff/roster` and `/staff/timesheet` as stable routes and user-facing names `Schedule` and `Timesheet & overtime`.
5. Use one clear row status and one next action; technical evidence moves to expandable detail.
6. Reuse Home V2 primitives and extract their tokens from the current `.home`-only scope before Time implementation. Do not build a third giant CSS override layer.
7. Preserve every existing canonical rule and employee/manager responsibility boundary.

This document authorizes **no implementation, backend, schema, fixture, deployment or Production change**.

---

## 2. TIME V2 PRODUCT PRINCIPLES

1. **Expected vs actual vs processed** — every destination states which of these it represents.
2. **Current state first** — Time opens with current Attendance, then expected Schedule, then historical/processed destinations.
3. **Action before archive** — an actionable missing punch appears near the top of Time and on its History row.
4. **One primary status** — do not stack `Incomplete`, `No approval required`, GPS and adjustment chips.
5. **One next action** — show `Submit correction` only when the canonical record is employee-actionable.
6. **Rows over cards** — repeated days and navigation entries are rows in one surface, not standalone cards.
7. **Details on demand** — Break, branch, reasons, manager note, schedule difference and OT evidence appear after opening a row.
8. **Do not infer** — no published/effective schedule means `No schedule`, never automatically `Rest day`.
9. **Employee language** — no `Roster`, `P2`, `Resolution Case`, `FinalResult`, `Snapshot`, `ExpectedDay`, `Materialization` or `Canonical Queue` in ordinary UI.
10. **Canonical state stays canonical** — visual mapping may simplify wording but may not manufacture a result, action or approval state.
11. **Mobile is the product contract** — 360-class Android, 390×844 and 412×915 must be designed first.
12. **Stable geometry** — loading, empty and error states preserve section position and do not jump beneath the fixed navigation.

---

## 3. CURRENT TIME AUDIT

### 3.1 Route and data ownership

| Area | Current route | Rendering/data | Current state | Main issue |
|---|---|---|---|---|
| Time landing | `/staff/history` | Client `StaffHistory`; GET `/api/employee-attendance/history` | PARTIAL HUB | Hub and full History are the same page |
| Schedule | `/staff/roster` | Force-dynamic server page; roster, leave and holiday services | FUNCTIONALLY STRONG | Header/Today/week/empty surfaces are visually equal |
| Attendance History | `/staff/history` | Same client/page as Time landing | FUNCTIONALLY PRESENT | Starts below navigation and large filters; D01 = F01 |
| Correction | `/staff/history#attendance-correction` and contextual row CTA | POST canonical `/api/employee-attendance/exception` | FUNCTIONALLY PRESENT | Generic form is promoted above contextual correction |
| Timesheet/OT | `/staff/timesheet` | Force-dynamic server page; canonical P2 final/exception/locked snapshot + OT review projection | FUNCTIONALLY STRONG | Every day and OT item is a heavy expanded card; current month only in UI |

### 3.2 Current Time landing — D01

Current order:

1. `MY TIME / Time` page title.
2. Supporting sentence.
3. Four 58px navigation tiles: Today, Schedule, History, Monthly.
4. `Report a missing punch` button even when no actionable record is visible.
5. Full From / To / Status filter card.
6. History loading/results below the first viewport.

Classification:

| Current section | Verdict | Reason |
|---|---|---|
| Page title `Time` | **KEEP / SIMPLIFY** | Correct mental model; use approved Page Header without a hero card |
| Today / Schedule / History / Monthly 2×2 tiles | **REPLACE** | They behave like rows, not feature cards |
| Global `Report a missing punch` | **MERGE / DEMOTE** | Prefer contextual issue CTA; keep a low-emphasis fallback only if product still requires forgotten clock-in without a record |
| Permanent full filter form | **REPLACE** | Too much mobile space and appears before any history |
| History on the same landing page | **MOVE** | The landing page cannot remain a light hub while carrying the entire archive |

### 3.3 Current Schedule — E01

Real implementation already supports:

- Published/effective `WORK_SHIFT`, `REST_DAY` and `NOT_SCHEDULED`.
- Approved Leave and Public Holiday.
- Multiple shifts, cross-midnight shifts, break and expected working time.
- Active employee Branch assignments and branch-specific holidays.
- Week navigation and expandable day detail.

Current visual issues:

- Large bordered section hero followed by another bordered Today card.
- Empty week becomes a large standalone surface even though it contains one fact.
- Previous/Next controls and week title compete rather than forming one date control.
- Branch can repeat in every shift row.
- Legacy rules exist in both `staff.css` and `staff-consolidation.css`; the latter overrides the former.

Classification:

| Current section | Verdict | Reason |
|---|---|---|
| Schedule projector/data | **KEEP** | Correct source and state coverage |
| Page hero card | **REPLACE** | Use plain Page Header |
| Today card | **SIMPLIFY / MERGE** | Today is a highlighted row in the week, plus a compact summary only when useful |
| Week navigation | **KEEP / NORMALIZE** | Keep route query, use shared Period Navigator anatomy |
| Expandable day rows | **KEEP / SIMPLIFY** | Correct progressive-disclosure model; reduce minimum height and repeated meta |
| Large no-week card | **REPLACE** | Compact section empty state |
| Planned-vs-actual note | **KEEP / MOVE** | Short info line below Page Header or week group, not page-end filler |

### 3.4 Current Attendance History — F01

Real implementation:

- Defaults to a 31-day inclusive range.
- Fetches 12 rows per page.
- Supports raw Attendance session status filter.
- Hides Branch filter when only one available Branch exists.
- Shows four facts: Clock in, Clock out, Break, Worked.
- Shows geofence, approval and adjusted flags.
- Shows contextual `Submit correction` only for `INCOMPLETE` + missing clock-out + no pending approval.
- Shows `Correction pending` instead of a duplicate CTA.
- Posts to the canonical Attendance exception endpoint and handles duplicate requests.

Current UX issues:

- The archive is buried below hub navigation and filters.
- Every result is a card with four mini-cards and multiple chips.
- Branch is repeated for a single-Branch employee.
- `No approval required` and GPS evidence are technical, low-value default-row content.
- Correction form expands above the list and requires substantial scrolling.
- `Reason` and generic Branch/session selection make contextual correction heavier than necessary.
- Loading replaces the result region with a generic loading block rather than stable row skeletons.

Classification:

| Current section | Verdict | Reason |
|---|---|---|
| Canonical History API/read model | **KEEP** | Correct employee/business/membership/date source; max-range rule already enforced |
| Full From/To/Status form | **REPLACE** | Use period summary + Status filter chip + compact sheet |
| Conditional Branch field | **KEEP** | Existing `>1 availableBranches` behavior matches V2 contract |
| History card | **REPLACE** | Compact chronological row + expandable detail |
| Clock/break/worked mini-cards | **MERGE** | One compact secondary line; full facts in detail |
| Geofence / approval / adjusted chips | **MOVE / MERGE** | One primary status; evidence goes to detail |
| Contextual correction CTA | **KEEP / NORMALIZE** | Correct discoverability and eligibility |
| Generic correction entry | **DEMOTE** | Fallback only, not primary archive action |
| Pagination | **KEEP / SIMPLIFY** | Only render when `totalPages > 1`; compact Previous/Next without record-count filler |

### 3.5 Current Timesheet/OT — G01

Real implementation:

- Uses current month `[monthStart, monthEndExclusive)`.
- Latest immutable daily final wins over stale exceptions.
- Locked monthly snapshot takes precedence over live finals/exceptions.
- `MISSING_CLOCK_IN/OUT` may be employee-actionable.
- Schedule deviations and non-self-correctable issues become `WAITING_FOR_MANAGER`.
- OT comes from canonical final Attendance results and manager reviews.
- Employee has no `Submit OT` action.
- Pending, approved, adjusted and rejected OT semantics are preserved by the canonical review.

Current UX issues:

- One large outer page card contains all sections.
- Month state is one badge; counts are not scannable.
- Result / Why / Next Action is expanded for every attention and final day.
- A final day can appear in Workdays while OT for the same date appears as another standalone card.
- `Manager-reviewed overtime` explanation is repeated at section level.
- Final leave/no-clock data still shows two `—` clock boxes.
- No visible month navigation despite the underlying service accepting a reference date.

Classification:

| Current section | Verdict | Reason |
|---|---|---|
| Canonical day projector | **KEEP** | Correct de-duplication, actionability and lock precedence |
| Canonical OT candidate/review source | **KEEP** | Correct Attendance-derived ownership |
| Outer mega-card | **REMOVE** | Page shell should be canvas + sections |
| Month badge only | **REPLACE** | Period Navigator + Compact Summary |
| Attention section | **KEEP / SIMPLIFY** | Rows first, detail on tap |
| Separate OT cards | **MERGE** | Join into the same work-date presentation row when possible |
| Workday cards | **REPLACE** | Compact rows in one surface |
| Result / Why / Next Action always open | **MOVE** | Detail Section only |
| Empty `—` clock mini-cards | **REMOVE** | Show only meaningful facts |

### 3.6 Mobile burden observed

- D01/F01 at 390px uses nearly the entire first viewport before a History result can appear.
- E01 empty state repeats `Not Scheduled`, week range and `No schedule yet` across three surfaces.
- G01 displays a single final paid-leave day as a large multi-level card and leaves most of the page empty.
- Current fixed navigation clearance is generally present, but Time implementation must not assume Home-only `.home` tokens or spacing.
- Typography and radii still vary between legacy CSS, consolidation CSS and Home V2 CSS module.

---

## 4. TIME HUB V2

### 4.1 Information architecture

Recommended stable routes:

| Destination | Route | Rationale |
|---|---|---|
| Time Hub | `/staff/history` | Keeps existing bottom-tab href and PWA/deep links stable |
| Attendance History | `/staff/history/records` | Separates archive from hub without changing the primary navigation |
| Schedule | `/staff/roster` | Existing stable route; UI never says Roster |
| Timesheet & overtime | `/staff/timesheet?month=YYYY-MM` | Existing stable route with optional read-only period query |

Redirect/compatibility rule for implementation: existing `/staff/history#attendance-correction` must continue to land in a valid correction flow. Do not silently break saved links. It may redirect to `/staff/history/records#attendance-correction` or an equivalent contextual route after focused regression.

### 4.2 Hierarchy

1. Page Header: `Time` + one sentence, no bordered hero.
2. `Today` current Attendance summary.
3. Conditional `Attention` Action Row only if the employee can act.
4. Schedule List Row.
5. Attendance History List Row.
6. Timesheet & overtime List Row.

No four-card dashboard. The three destination rows may share one bordered surface with dividers.

### 4.3 Current Attendance contract

- Reuse the existing `/api/employee-attendance/today` canonical client path/view-state; do not create a second Attendance store.
- Show one of: `Ready to clock in`, `Clocked in · since …`, `On break · since …`, `Shift completed`, or a compact load/error state.
- `View today` leads to Home Attendance; Time Hub does not duplicate Clock In/Out/GPS controls.
- Worked time is displayed only when it is meaningful.
- No Schedule is not Rest Day.

### 4.4 Actionable issue contract

- Derive from the same canonical History/correction eligibility used by History.
- Show at most the newest employee-actionable issue in the Hub.
- Copy: `Attendance needs attention · 24 Aug · Missing clock out` + `Fix attendance`.
- `Waiting for manager` is informational and belongs in the Timesheet/History summary; it must not display a Fix action.
- Do not surface a generic missing-punch action when there is no eligible contextual record, except a deliberately retained low-emphasis fallback for missing clock-in scenarios that genuinely lack a session.

### 4.5 Summary row examples

- Schedule: `Today · 10:45 AM – 7:45 PM` / `No schedule today`.
- Attendance History: `Recent attendance` plus latest meaningful status/date, never a count-only card.
- Timesheet & overtime: `August 2026` + `1 waiting for manager`, `2 need attention`, or `Up to date`.

---

## 5. SCHEDULE V2

### 5.1 Page structure

1. Page Header: `Schedule`; meta `Your expected work and approved time away.`
2. Shared Week Period Navigator: previous icon, `25–31 Aug 2026`, next icon.
3. One grouped week surface containing seven compact day rows.
4. Inline explanation only when needed: `Schedule shows expected work. Attendance shows what you actually worked.`

Today is visually marked inside its row; do not add a second large Today card when the selected week already includes today. If the user views another week, a small `Today` jump control may return to the current week without injecting today’s full card above the selected week.

### 5.2 Day row anatomy

- Leading: weekday + day number; `TODAY` as accessible text, not color alone.
- Primary: shift time or state (`Rest day`, `Annual Leave`, `Public Holiday`, `No schedule`).
- Secondary: shift name; common Branch is suppressed.
- Trailing: chevron only when additional detail exists.
- Target: 64–72px for a normal row; 56px minimum for a simple state row.

### 5.3 State matrix

| Canonical state | Default row | Expand/detail |
|---|---|---|
| One scheduled shift | `10:45 AM – 7:45 PM` + shift name | Branch, break, expected working time |
| Rest Day | `Rest day` | No extra copy unless canonical roster note exists |
| Public Holiday | `Public Holiday` + holiday name | Branch scope only if relevant |
| Approved Leave | Leave policy label + `Approved leave` | Related scheduled shift only if canonical data shows both |
| No Schedule | `No schedule` | `Ask your manager if you expected a shift.` |
| Multiple shifts | `2 shifts` + first–last time | Each shift time/name/Branch/break |
| Cross-midnight | Time + `Ends next day` | Exact dates, shift name, break, Branch |
| Long shift name | Two-line wrap, no ellipsis-only loss | Full name in detail |
| Different Branch | Branch shown on that row | Full Branch in detail |
| Shift on Public Holiday | Shift remains primary + `Public Holiday · name` | Both schedule and holiday evidence |

### 5.4 Branch de-duplication

- Compute Branches represented in the visible week from the existing schedule projector.
- If all useful rows share one Branch, show it once in the Page Header meta or week group header.
- If Branch varies, show Branch only on differing shift rows.
- Never hide Branch when doing so would make two shifts ambiguous.

### 5.5 Empty week

When no week facts exist:

`No schedule this week`  
`Published shifts and approved time away will appear here.`

Use a compact section Empty State; no icon larger than 24px and no `min-height` filler. For today specifically use: `No schedule today · Ask your manager if you expected a shift.`

---

## 6. ATTENDANCE HISTORY V2

### 6.1 Page structure

1. Page Header: `Attendance history`; meta `Your actual clock-ins and worked time.`
2. Period summary: `August 2026` or `1–31 Aug 2026`.
3. One Status filter chip/action opening a compact filter sheet.
4. Conditional contextual issue Action Row.
5. Chronological rows grouped in one surface.
6. Compact pagination only when more than one page exists.

### 6.2 Normal completed row

Default:

- Date.
- Primary status: `Completed`.
- Time range: `4:47 PM – 4:49 PM`.
- Worked: `Worked 0h 01m`.
- Chevron to detail.

Do not show Branch on each row for a single-Branch employee. Do not show `No approval required` or GPS evidence on the default row.

### 6.3 Issue row

Employee-actionable:

- `24 Aug`
- `Action needed`
- `Missing clock out · Clocked in 9:05 AM`
- `Submit correction`

Manager-actionable/pending:

- `24 Aug`
- `Waiting for manager`
- `Missing clock out correction`
- `No action needed`

The existing `getMissingClockOutCorrectionState` remains the source for missing-clock-out CTA eligibility. No V2 component may independently approximate it.

### 6.4 Correction presentation

- Contextual action preselects session/date/Branch exactly as current code does.
- Use a focused Form Section or task sheet; do not insert a giant form above the full archive.
- Keep requested time and any canonically required reason fields.
- Single Branch stays hidden.
- Submit uses the same canonical exception endpoint and duplicate handling.
- Pending request replaces Submit with `Waiting for manager`.
- A generic fallback correction entry, if retained, belongs after the list or in the filter/action sheet and must be labelled as a fallback, not the primary path.

### 6.5 Filter contract

Collapsed state:

- Period summary.
- `Status` chip showing active value.
- Optional Branch chip only when the employee has multiple authorized Branches.

Compact sheet:

- From and To.
- Status.
- Branch only for multiple authorized Branches.
- `Apply filters` primary action.
- `Reset` low-emphasis action.
- Hint: `Choose up to 31 days.`

The current backend accepts raw Attendance session statuses, not every proposed V2 workflow label. Implementation must either map only semantically exact supported filters or obtain an explicitly approved canonical read-filter extension. It must not client-filter one paginated page and pretend the result represents the whole period.

### 6.6 Detail contract

An opened row uses one Detail Section system:

- Date and primary status.
- Branch, only once.
- Clock In, Clock Out, Break, Worked.
- Schedule/difference only when supplied by a canonical read model.
- Issue/correction status.
- Manager note only when supplied by canonical records.
- Geofence/adjustment evidence under `Attendance details`, not as default badges.

Current History DTO does not include schedule, manager note or a complete correction lifecycle. V2 must not infer them from `adjusted: true` or from a missing clock time. Any future read-only DTO enrichment must reuse canonical records and be separately reviewed; this blueprint creates no new state.

---

## 7. TIMESHEET V2

### 7.1 Page structure

1. Page Header: `Timesheet & overtime`; meta `The monthly work record used for review and payroll.`
2. Month Period Navigator: `< August 2026 >`.
3. Compact Summary: employee action, waiting for manager, final.
4. Conditional Action Rows first.
5. One chronological Workday row group.
6. Detail expands on tap; no Result/Why/Next Action on every closed row.

### 7.2 Month summary rules

- Count **unique work dates after presentation merge**, not raw exception + OT record counts.
- A date appears in only one summary bucket.
- Priority: `Action needed` > `Waiting for manager` > `Final`.
- Pending OT on an otherwise final Attendance day makes the employee-facing date `Waiting for manager`, while Attendance finality remains detail/meta.
- If there are no open employee or manager actions, summary reads `Up to date`; if the monthly Timesheet is locked, it reads `Final`.
- Do not show three zero counters. Use `Up to date` instead.

### 7.3 Workday row

Closed row:

- Date.
- One primary status.
- Outcome/issue summary.
- Actual time range when present.
- Small OT secondary label when applicable.
- Chevron.

Examples:

- `30 Aug · Waiting for manager · Schedule difference · 4:47 PM – 4:49 PM`.
- `29 Aug · Final · Present · 6:31 PM – 6:31 PM`.
- `18 Aug · Final · Approved paid leave` with no meaningless Clock In/Out dashes.

### 7.4 Date/OT merge rules

- Join current `days` and effective OT items by membership + work date in a **presentation-only mapper**.
- Do not change P2 final, exception, locked snapshot or OT review records.
- Do not mutate one canonical status to make the UI simpler.
- If an OT item cannot safely match a workday row, keep one compact OT fallback row rather than dropping it.
- Locked snapshot OT remains the source when Timesheet status is locked.

### 7.5 Month navigation

The existing overview service already accepts an optional reference `now`; UI currently always passes current time. A later presentation implementation may parse `?month=YYYY-MM` and pass a safe reference date into the same read service. That is read selection, not a new calculation. Invalid/future policy must follow approved product rules and cannot be guessed by the UI.

---

## 8. OT EMPLOYEE UX

### 8.1 Ownership

OT remains Attendance-derived. Employees never receive `Submit OT`.

### 8.2 Employee wording

| Canonical OT status | Employee row/detail wording |
|---|---|
| No review / `PENDING_REVIEW` | `Potential overtime · Waiting for manager` |
| `APPROVED` | `OT · 1 hr 30 min approved` |
| `ADJUSTED` | `OT · 1 hr 00 min approved` + original potential in detail |
| `REJECTED` | `Overtime not approved` + manager reason when allowed |
| Locked snapshot | `Final` + approved OT amount from snapshot |

Use `1 hr`, `1 hr 30 min`, `45 min`; do not show `1h 30m` in employee-facing OT copy unless space is severely constrained. Raw minutes are diagnostics only.

### 8.3 Detail

Detail may show:

- Potential overtime.
- Approved overtime.
- Status.
- Manager note/reason where canonical policy permits.
- `No action — your manager is reviewing this.` for pending.

No editable approved-minutes field and no employee submission action.

---

## 9. STATUS SYSTEM

### 9.1 Time Hub/current Attendance

| Canonical evidence | Primary employee status | Tone |
|---|---|---|
| No open session, action available | Ready to clock in | neutral/brand |
| `OPEN` | Clocked in | success |
| `ON_BREAK` | On break | warning |
| Completed latest session | Shift completed | success-soft |
| Attendance load failure | Attendance unavailable | danger/info + Retry |

### 9.2 History

| Canonical evidence | Primary status | Action |
|---|---|---|
| `COMPLETED`, no higher-priority correction state | Completed | Open detail |
| Missing clock-out + `ACTIONABLE` | Action needed | Submit correction |
| Missing clock-out + current `PENDING` | Waiting for manager | None |
| Canonical approved adjustment represented in read model | Corrected | Open detail |
| Canonical rejected correction represented in read model | Rejected | Open detail / retry only if eligible |
| Other canonical exception requiring review | Review required | Only canonical next action |
| Current-day `OPEN`/`ON_BREAK` record | In progress / On break | View today |

Do not derive `Corrected` solely from `adjusted: true` until the read model confirms the adjustment semantics. Do not derive `Rejected` from absence of approval.

### 9.3 Timesheet/OT

| Projected evidence | Primary status | Meaning |
|---|---|---|
| Employee-actionable missing time | Action needed | Employee can act now |
| Non-self-correctable exception or pending correction/OT | Waiting for manager | No employee action |
| Canonical daily final | Final | Processed day; open for detail only |
| Locked month/snapshot | Final / Locked for payroll | Immutable source used by Payroll |
| No open action in draft month | Up to date | Summary text, not repeated badges |

One row gets one badge. Secondary facts become meta text.

---

## 10. FILTER / DATE NAVIGATION

### 10.1 Shared Period Navigator

Use one anatomy across Time:

- 44×44px previous button.
- Center period label.
- 44×44px next button.
- Accessible names include target period.
- Query-driven links for server pages; no hidden duplicate date store.

### 10.2 Per-page variants

| Page | Period | Control |
|---|---|---|
| Time Hub | Today/current month summaries | No large navigator; rows show their own period |
| Schedule | ISO week | `< 25–31 Aug 2026 >` |
| Attendance History | 31-day range/month | Period summary + Filter action |
| Timesheet | Calendar month | `< August 2026 >` |

### 10.3 Consistency rules

- Use `Aug`, `August 2026`, and `25–31 Aug 2026` consistently by context.
- Employee time uses localized 12-hour display where the current product already does; one page must not mix 24-hour and 12-hour formats.
- Date inputs in filter/task sheets retain native/mobile-friendly behavior and visible labels.
- Do not invent three unrelated calendar components.

---

## 11. EMPTY / ERROR / LOADING

### 11.1 Empty

| Area | Empty state |
|---|---|
| Time issue | Omit the Attention section entirely |
| Schedule today | `No schedule today` + manager guidance |
| Schedule week | Compact `No schedule this week` section state |
| Attendance History | `No attendance records in this period.` |
| Timesheet | `No workdays yet for August 2026.` |
| OT | Omit OT label/section; do not show `No OT` giant card |
| No issues | Summary `Up to date`; no “You’re all set” card |

### 11.2 Error

- Section failure: inline alert + `Try again`, preserving the remaining Time destinations.
- Entire page failure: one Section Empty/Error surface, not a raw framework error.
- Attendance action/error uses existing session redirect and canonical error handling.
- Never expose Prisma names, internal enums, stack traces or source digests.
- `aria-live`/`role=alert` only for meaningful state changes; do not repeatedly announce static content.

### 11.3 Loading

- Time Hub: stable skeleton for current Attendance plus three 64px rows.
- Schedule: fixed-height period navigator plus 5–7 row skeletons; do not draw a giant hero skeleton.
- History: period/filter line plus 3 row skeletons.
- Timesheet: month summary plus 3 row skeletons.
- Skeletons use the same final row geometry and reduced-motion-safe opacity; no spinning icon inside each row.

---

## 12. COMPONENT REUSE

### 12.1 Reuse directly after scope extraction

- `StaffV2PageHeader`
- `StaffV2CompactSummary`
- `StaffV2ListRow`
- `StaffV2ActionRow`
- `StaffV2StatusBadge`
- `StaffV2EmptyState`
- Existing fixed Bottom Navigation

### 12.2 Required primitive extensions

Do not create domain mega-cards. Extend the shared system with:

- `StaffV2Section` / grouped row surface with dividers.
- `StaffV2DetailSection` for definition rows.
- `StaffV2PeriodNavigator`.
- `StaffV2FilterChip` and compact filter sheet shell.
- `StaffV2FormSection`.
- `StaffV2Row` trailing slot for badge/CTA/chevron.
- `StaffV2StatusBadge` `info` tone.
- Button/action variant for Action Row; current primitive is link-only.

### 12.3 Token extraction requirement

Current semantic variables are declared under `.home` in `staff-home-v2.module.css`; they are not a reusable Time scope yet. Before Phase 2 implementation:

1. Move/alias semantic tokens into one Staff V2 scope owned by the Staff shell or a shared V2 module.
2. Keep Home output unchanged through focused visual regression.
3. Import shared primitives from a neutral module name; Time must not depend on `staff-home-v2.module.css` as a permanent architecture.
4. Retire replaced Time/Schedule/History/Timesheet legacy selectors as each page migrates.
5. Do not add `staff-time-v2-overrides.css` on top of `staff.css` + `staff-consolidation.css`.

---

## 13. TIME HUB WIREFRAME

```text
[PH] Time
     Expected work, actual attendance and monthly results

[TODAY]
Clocked in · since 10:47 AM
Worked 2 hr 18 min                                      >

[AR — only when employee can act]
ATTENTION
Attendance needs attention
24 Aug · Missing clock out                 [Fix attendance]

[ROW GROUP]
Schedule
Today · 10:45 AM – 7:45 PM                            >
--------------------------------------------------------
Attendance history
Recent actual attendance                               >
--------------------------------------------------------
Timesheet & overtime
August 2026 · 1 waiting for manager                    >

[BOTTOM NAV]
Home       Time       Requests       Pay       Profile
```

No-action variant omits the entire Attention row. Attendance load error replaces only Today with `Attendance couldn't load · Try again`; Schedule/History/Timesheet stay reachable.

---

## 14. SCHEDULE WIREFRAME

```text
[PH] Schedule
     Your expected work and approved time away

[PERIOD]
[‹]                 25–31 Aug 2026                 [›]

[ROW GROUP]
MON 25   10:45 AM – 7:45 PM
TODAY    Morning shift                                  >
---------------------------------------------------------
TUE 26   Rest day
---------------------------------------------------------
WED 27   Annual Leave
         Approved leave                                  >
---------------------------------------------------------
THU 28   2 shifts
         9:00 AM – 8:00 PM                               >
---------------------------------------------------------
FRI 29   Public Holiday
         National Day
---------------------------------------------------------
SAT 30   No schedule
---------------------------------------------------------
SUN 31   10:00 PM – 6:00 AM
         Night shift · Ends next day                     >

Schedule is expected work. Attendance is actual time.
```

---

## 15. HISTORY WIREFRAME

```text
[PH] Attendance history
     Your actual clock-ins and worked time

August 2026                         [Status: All] [Filter]

[AR — contextual]
24 Aug · Missing clock out                   [Submit correction]

[ROW GROUP]
30 Aug   Completed
         4:47 PM – 4:49 PM · Worked 0 hr 01 min          >
---------------------------------------------------------
29 Aug   Completed
         6:31 PM – 6:31 PM · Worked 0 hr 00 min          >
---------------------------------------------------------
24 Aug   Action needed
         Missing clock out                  [Submit correction]
---------------------------------------------------------
22 Aug   Waiting for manager
         Missing clock out correction · No action        >

[Previous]                                      [Next]
```

The contextual row may appear either above the list or in the matching date row, but it must not create two active Submit buttons for the same record.

---

## 16. TIMESHEET WIREFRAME

```text
[PH] Timesheet & overtime
     Monthly work results used for review and payroll

[PERIOD]
[‹]                  August 2026                    [›]

[CS]
2 need attention | 1 waiting for manager | 18 final

[ROW GROUP]
30 Aug   Waiting for manager
         Schedule difference · 4:47 PM – 4:49 PM          >
         OT · Potential 1 hr 30 min
----------------------------------------------------------
29 Aug   Final
         Present · 6:31 PM – 6:31 PM                       >
         OT · 1 hr approved
----------------------------------------------------------
24 Aug   Action needed
         Missing clock out                     [Fix attendance]
----------------------------------------------------------
18 Aug   Final
         Approved paid leave                                >
```

Expanded 30 Aug:

```text
Attendance
Clock in                                      4:47 PM
Clock out                                     4:49 PM

Schedule
Expected                              8:00 AM – 11:00 PM

Result
Schedule review required

Why
Clocked in after scheduled start
Clocked out before scheduled end

Overtime
Potential                                    1 hr 30 min
Status                              Waiting for manager

Next action
No action — your manager needs to review this day.
```

---

## 17. CURRENT → V2 MAPPING

| Area | Current section | V2 decision | V2 destination |
|---|---|---|---|
| Time | `MY TIME / Time` | KEEP / SIMPLIFY | Plain Page Header |
| Time | Supporting description | KEEP / REWRITE | One line: expected vs actual vs processed |
| Time | Four navigation tiles | REPLACE | Three grouped List Rows + current Attendance summary |
| Time | Global correction button | MERGE / DEMOTE | Contextual Action Row; optional fallback after archive |
| Time | Full filters on landing | MOVE | Attendance History compact filter sheet |
| Time | Full history on landing | MOVE | `/staff/history/records` |
| Schedule | Section hero | REPLACE | Page Header |
| Schedule | Today card | MERGE | Highlighted current-day week row |
| Schedule | Previous/week/Next controls | KEEP / NORMALIZE | Shared Period Navigator |
| Schedule | Seven expandable days | KEEP / SIMPLIFY | Grouped compact rows |
| Schedule | Branch on every shift | MERGE | Common Branch once; exceptions per row |
| Schedule | Break/expected time default | MOVE | Expanded detail |
| Schedule | Large empty week | REPLACE | Compact section Empty State |
| Schedule | Planned-vs-actual note | KEEP / SIMPLIFY | One short informational line |
| History | From/To fields always visible | MOVE | Filter sheet |
| History | Status select always visible | REPLACE | Filter chip + sheet |
| History | Branch select | KEEP CONDITIONALLY | Only multi-Branch employees |
| History | Apply filters card | REPLACE | Compact filter action/sheet |
| History | Standalone record cards | REPLACE | Grouped chronological List Rows |
| History | Four fact mini-cards | MERGE | Time range + worked meta; full facts in detail |
| History | GPS/approval/adjusted chips | MOVE / MERGE | One status; evidence in detail |
| History | Contextual correction | KEEP | Action Row/task presentation |
| History | Pending correction | KEEP / NORMALIZE | `Waiting for manager`, no CTA |
| History | Pagination record count | REMOVE | Compact Previous/Next only when needed |
| Timesheet | Outer page card | REMOVE | Page canvas + sections |
| Timesheet | Month title + single badge | REPLACE | Period Navigator + Compact Summary |
| Timesheet | Needs Attention cards | REPLACE | Priority rows |
| Timesheet | Clock mini-cards | MERGE | Row time meta; detail definitions |
| Timesheet | Result/Why/Next always expanded | MOVE | Open detail only |
| Timesheet | Separate OT section/cards | MERGE | Work-date secondary OT line; fallback row only if unmatched |
| Timesheet | Final workday cards | REPLACE | Compact rows |
| Timesheet | Empty workday card | REPLACE | Compact section Empty State |
| Timesheet | Correction form inside card | KEEP / MOVE | Focused task/detail using canonical exception |

---

## 18. MOBILE 360

Target: 360-class Android, minimum checked viewport 360×800.

- Page horizontal padding may be 12px; rows keep 44px touch targets.
- Page title remains 28px maximum; long titles wrap without clipping.
- Period Navigator uses 44px icon buttons and a `minmax(0,1fr)` center label.
- Schedule day row uses 48px leading date column, flexible copy, fixed 20px trailing affordance.
- Status badge moves below title/meta when the row cannot hold it beside long content.
- Long Branch/shift/reason wraps to two lines; never force horizontal scrolling.
- Timesheet Compact Summary may wrap from three cells to two rows, or become a sentence (`2 need attention · 1 waiting · 18 final`) when larger text is enabled.
- Correction/filter sheets use one-column fields.
- Content bottom padding = fixed nav measured height + `env(safe-area-inset-bottom)` + at least 16px.
- Acceptance: `document.documentElement.scrollWidth === window.innerWidth`.

---

## 19. MOBILE 390

Target: 390×844 iPhone-class viewport.

- Standard 16px page padding.
- Normal rows 64–72px; simple Rest Day/No Schedule rows may be 56px.
- Three-cell Timesheet summary stays one row only when values remain legible; no font smaller than 12px for status/value.
- Schedule rows keep date + copy + chevron; Branch drops to meta line rather than a fourth column.
- Contextual Action Row may use a trailing text action if it remains at least 44px; otherwise action becomes a full-width row footer.
- Filter sheet fits visible From/To/Status with sticky action above the browser/PWA navigation.
- At scroll end, the final row/action must move fully above Bottom Navigation.
- Safe-area top is solid canvas; no radial gradient, translucent white veil or `backdrop-filter` in the page header.

---

## 20. MOBILE 412

Target: 412×915 Android/iPhone-class viewport.

- Same DOM/order as 390; no device-specific alternate IA.
- Slightly larger whitespace may be used between major sections, but rows must not become cards again.
- Four Compact Summary cells are allowed only when all labels/values remain readable.
- Multiple-shift and long-Branch detail may use two definition columns; larger text collapses to one.
- Filter sheet may place From/To side by side only when each field remains at least 160px and labels do not truncate; otherwise one column.
- Bottom navigation clearance follows actual nav/safe-area height, never a magic screen-height calculation.
- Acceptance: no horizontal overflow, no clipped trailing action, no content under nav, all icon-only controls ≥44px.

---

## 21. ACCESSIBILITY

- One semantic `h1` per destination; section headings follow heading order.
- Status is always written in text; color is supplementary.
- Today uses text/`aria-current="date"`, not green highlight alone.
- Row chevrons are decorative; the interactive row has a complete accessible name.
- `<details>/<summary>` is acceptable for first implementation if keyboard/focus behavior remains correct and the summary exposes the state.
- Icon-only period/filter/close actions are 44×44px with explicit labels.
- `focus-visible` uses a high-contrast outline outside the border.
- Error changes use `role="alert"`; loading uses `aria-busy`; empty states use restrained `role="status"`.
- Correction validation links errors to fields; labels remain visible above values/placeholders.
- Larger text must not hide status/action or convert content into horizontal scroll.
- Reduced motion disables smooth scroll/chevron transitions; no information depends on animation.
- Sticky sheets/actions reserve keyboard and safe-area space so the last field and error remain reachable.

---

## 22. IMPLEMENTATION RISK

| Risk | Level | Evidence | Mitigation |
|---|---|---|---|
| `/staff/history` is both hub and archive | **HIGH** | D01 = F01; same `StaffHistory` component | Keep route as hub, introduce compatible child records route, preserve hash/deep links |
| Home V2 tokens are `.home` scoped | **HIGH** | Time cannot safely reuse current CSS variables outside Home | Extract neutral Staff V2 scope before migrating Time |
| Legacy CSS cascade overlap | **HIGH** | Schedule selectors exist in `staff.css` and later `staff-consolidation.css` | Migrate one page at a time and delete replaced selectors; no third override file |
| History workflow labels exceed current DTO | **HIGH** | DTO has session status, approval flags and `adjusted`, but not full correction status/note/schedule | Show only proven labels; defer any canonical read-only enrichment; never infer |
| History filters are paginated raw statuses | **HIGH** | Client-side grouped filtering would misrepresent unseen pages | Keep exact supported filtering or separately approve canonical filter enrichment |
| Correction eligibility duplicated by presentation | **HIGH** | CTA depends on dedicated canonical helper | Reuse helper/read model; no UI-local approximation |
| Timesheet day + OT duplication | **MEDIUM** | Current arrays render as separate sections/cards | Presentation-only merge by canonical work date with fallback for unmatched OT |
| Timesheet month navigation | **MEDIUM** | UI passes current time; service supports reference `now` | Parse validated month query and reuse service; no new calculation/model |
| Schedule multi-Branch load | **MEDIUM** | Page queries each active assignment Branch, leaves and holidays | Preserve server source; presentation only de-duplicates labels |
| Schedule leave/holiday/shift coexistence | **MEDIUM** | Projector preserves secondary evidence but chooses one primary state | Render canonical priority and expose coexistence in detail |
| Current Attendance client/server split | **MEDIUM** | Home uses client `/today`; Time Hub can easily duplicate state | Extract/reuse read-only hook/view-state; do not copy actions/GPS logic |
| Fixed Bottom Navigation | **MEDIUM** | Browser toolbar and standalone safe area vary | Shared shell clearance; test 360/390/412 and scroll-end visibility |
| Generic correction fallback | **MEDIUM** | Missing clock-in may have no session/context row | Keep a clearly secondary fallback only if canonical workflow needs it |
| Loading layout shift | **LOW/MEDIUM** | History is client-loaded; Schedule/Timesheet server pages have route loading files | Match final row skeleton geometry |
| Long names/reasons | **MEDIUM** | Current roster uses one-line ellipsis in row copy | Permit two-line wrap; full value in detail; `min-width:0` |

---

## 23. RECOMMENDED IMPLEMENTATION SEQUENCE

1. **Approve this blueprint** — routes, status wording, filter constraints, OT date merge and four wireframes.
2. **Extract shared Staff V2 design scope** — tokens and primitives only; prove Home V2 screenshots remain unchanged.
3. **Add shared row infrastructure** — Section/row group, Period Navigator, Detail Section, Filter Chip/Sheet, Form Section and row trailing slot.
4. **Split Time IA safely** — keep `/staff/history` as Hub; introduce History child destination; preserve bottom nav active prefixes and correction deep links.
5. **Implement Time Hub read-only summaries** — reuse current Attendance source, schedule projector and existing History/Timesheet read models; no new action logic.
6. **Implement Schedule V2** — presentation-only refactor on the existing server data; remove duplicate Today card and retired schedule CSS selectors.
7. **Implement Attendance History V2** — compact rows, conditional filters, contextual correction and stable loading/error/empty states. Do not add unsupported workflow labels.
8. **Implement Timesheet date presentation mapper** — merge day/OT by work date, compute unique-date summary counts, keep locked snapshot precedence.
9. **Implement Timesheet V2/month query** — validated read-only period selection; no Attendance/Payroll calculation changes.
10. **Focused regression** — correction eligibility/no duplicate, Schedule states, Timesheet projection, OT status, locked month, session redirects, module/RBAC visibility.
11. **Mobile visual regression** — 360, 390×844, 412×915; long names, long shift, multi-Branch, large text, error/loading/empty, nav clearance.
12. **Physical-device UAT** — iPhone employee and Android manager/employee as relevant; Time-only issues fixed before proceeding to Requests V2.
13. **Railway Testing deployment only** — from clean controlled source after owner approval; stop before any further module redesign.

Do not implement Schedule, History and Timesheet simultaneously in one unreviewable CSS rewrite. Each page must reach a stable visual and functional checkpoint before the next.

---

## 24. NO BACKEND CHANGE CONFIRMATION

This Phase 2 deliverable is a product/UI blueprint only.

No changes were made or authorized to:

- Attendance calculations, punch records, Clock In/Out, break, GPS or geofence.
- P2/Expected Attendance/Roster engines.
- Attendance correction eligibility, submission, duplicate or approval workflow.
- Timesheet daily projection, locking, snapshots or Payroll input.
- OT derivation, review, adjustment, rejection or self-review controls.
- Leave, Claims, Pay, Profile, Approval Center IA, RBAC, session/device security.
- API behavior, Prisma schema, database data or migrations.

Any future read-only presentation DTO enrichment identified in this blueprint requires separate scope approval and must use existing canonical records; it may not create duplicate state.

**NO NEW MIGRATION.**

---

## 25. PRODUCTION STATUS

**LOCAL / TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

No Production request, deployment, database connection or mutation was performed for this blueprint.

---

## FINAL PRINCIPLE

Time should help the employee understand:

**Expected work**  
vs  
**Actual attendance**  
vs  
**Processed timesheet**

without making them understand the HR engine.

Less cards. More rows. One clear status. One clear next action.
