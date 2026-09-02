# TETAMU POS REPORTS — FULL UAT

## Overall Status

**REVIEW REQUIRED**

核心金额计算、日汇总、退款、折扣、拆分付款、费用确认与结算语义均通过；没有发现 P0 财务或已证实的权限泄漏。上线前仍需关闭 TypeScript build gate，并由具备受限权限的账号及真实 390px 视窗补跑浏览器 UAT。退款和付款来源追溯亦存在 P1 业务可解释性缺口。

## Environment

- Local / Testing: **LOCAL** (`https://localhost:3000`)
- Business: **Young Parlor TWU**
- Industry: **SALON_BEAUTY**
- User role: **BUSINESS_OWNER**（当前已认证业务会话；本地资料中唯一 login-enabled 用户为 adeline yong）
- Branch scope: **All branches**；本业务目前只有一个 ACTIVE Branch：Young Parlor TWU
- Timezone: **Asia/Kuching**
- Business Day cutoff: **02:00**
- Expense module: **ENABLED**
- Test date/time: **28 Aug 2026, 09:59 MYT (UTC+08:00)**
- Production accessed: **NO**
- Business data changed: **NO**

## Executive Summary

- Total scenarios: **48**
- PASS: **29**
- FAIL: **0**
- REVIEW REQUIRED: **11**
- BLOCKED: **5**
- NOT APPLICABLE: **3**
- P0: **0**
- P1: **4** unique findings
- P2: **6** unique findings
- P3: **0**

Automated PASS does not override browser findings. A02/A04/O/U and the unequal-period portion of L could not be completed with the authenticated target-business fixture and are explicitly frozen as BLOCKED rather than inferred as PASS.

## Baseline Reviewed

- `docs/TETAMU_REPORTS_CURRENT_FUNCTIONS_AND_OPERATIONS.md`
- `src/app/(business)/reports/page.tsx`
- `src/components/report-filter-panel.tsx`
- `src/lib/reports/daily-sales.ts`
- `src/lib/reports/presentation.ts`
- `tests/unit/reports-daily-sales.test.ts`
- `tests/unit/reports-final-ux.test.ts`

## Scenario Matrix

Each row records the goal, precondition/step, expected and actual result, four UAT dimensions, severity, evidence/cause and recommendation.

| ID | Scenario / goal / steps | Expected | Actual | Functional | Financial | UI/UX | Responsive | Severity | Evidence / suspected cause / recommendation |
|---|---|---|---|---|---|---|---|---|---|
| A01 | BUSINESS_OWNER opens `/reports` | Reports loads | Page loaded with Young Parlor TWU data | PASS | PASS | PASS | N/A | — | Browser DOM and screenshot; no action |
| A02 | User without Reports permission opens `/reports` | Denied; no data | No safe unauthorised session for this business | BLOCKED | N/A | BLOCKED | N/A | Do not create user during UAT; rerun with existing restricted account |
| A03 | All-branches owner selects All / authorised branch | Both options available | All branches and Young Parlor TWU selectable | PASS | PASS | PASS | N/A | Browser URL and select state |
| A04 | Branch-limited staff opens Reports | Branch A only | Target business has no login-enabled branch-limited Reports user | BLOCKED | N/A | BLOCKED | N/A | Rerun with real restricted account |
| A05 | Tamper `branchId` | Server clamps/rejects | Resolver unit scenario J constrains request to staff branch | PASS | PASS | PASS | N/A | `resolveReportBranchScope`; automated test; live restricted session unavailable |
| B01 | Click Today | Current Business Day; custom fields hidden | Period `28 Aug 2026`; fields hidden | PASS | PASS | PASS | N/A | URL `?range=today` |
| B02 | Click 7 Days | Latest 7 Business Days | `22 Aug 2026 - 28 Aug 2026` | PASS | PASS | PASS | N/A | URL `?range=7days` |
| B03 | Click Month | Month start through current date | `01 Aug 2026 - 28 Aug 2026` | PASS | PASS | PASS | N/A | Browser snapshot |
| B04 | Click Custom; enter valid dates | From/To shown and respected | Date controls shown; valid query accepted | PASS | PASS | PASS | N/A | Browser DOM |
| B05 | Enter From 27 Aug, To 25 Aug | Normalised per design and understandable | UI silently became 25 Aug single day while URL retained reversed values | PASS | PASS | REVIEW REQUIRED | N/A | P2; add non-blocking notice or show normalised values consistently |
| C | 01:30 / 02:30 around 02:00 cutoff | Correct Business Day everywhere | Canonical cutoff fixture test K passed | PASS | PASS | PASS | N/A | No live cutoff records in target DB; automated canonical evidence |
| D | Independently reconcile summary | Net/tx/avg/refund/discount correct | All source totals matched | PASS | PASS | PASS | N/A | Read-only DB reconciliation below |
| E01 | Standard sale day | Correct row | 25/26/27 Aug rows correct | PASS | PASS | PASS | N/A | Browser + DB |
| E02 | Multiple transactions same day | Aggregate once per invoice | Canonical test B passed; no duplicate count | PASS | PASS | PASS | N/A | Automated evidence |
| E03 | Multiple Business Days | Correct grouping and period sum | 3 active days, correct total | PASS | PASS | PASS | N/A | Browser + DB |
| E04 | Empty days OFF | Only activity days | Exactly 25, 26, 27 Aug visible | PASS | PASS | PASS | N/A | Browser DOM |
| E05 | Toggle Show empty days | Complete range; no noisy copy | 28 rows from 1–28 Aug; URL `showEmpty=1` | PASS | PASS | PASS | N/A | Browser DOM |
| E06 | Sum daily totals | Equals summary | Net RM1,289,109.90; refunds RM30; discounts RM20 | PASS | PASS | PASS | N/A | Independent sum |
| F01 | Open 27 Aug and click invoice | Correct existing invoice | `/invoices/1c92...` with `REPORT-UX-LOCAL-20260827-B` | PASS | PASS | PASS | N/A | Browser navigation |
| F02 | Close, backdrop, refresh and return | Stable drawer controls | Close button and deep-link refresh work; backdrop link did not close in observed click; browser Back not directly available in UAT runtime | PASS | N/A | REVIEW REQUIRED | N/A | P2; verify/fix backdrop hit target; rerun native Back |
| G | Explain RM30 refund to source | Trace amount → invoice/time/reason/method/processor | Reports exposes total and invoice link; invoice page does not show historical RM30 refund record, reason or processor | PASS | PASS | REVIEW REQUIRED | N/A | P1; preserve calculation, add refund-history trace path in future remediation |
| H | Explain RM20 discount | Trace period/day total to invoice | Invoice page shows `-RM20.00`; drawer does not identify which invoice contributed discount when many exist | PASS | PASS | REVIEW REQUIRED | N/A | P1; direct per-invoice discount trace is missing |
| I01 | Cash payment | Correct cash total | RM50.00, 1 payment | PASS | PASS | PASS | N/A | DB + UI |
| I02 | Card payment/refund | Correct gross/refund/net | Gross RM100, refund RM30, net RM70 | PASS | PASS | PASS | N/A | DB + UI |
| I03 | DuitNow | Correct total | RM150.00, 1 payment | PASS | PASS | PASS | N/A | Split invoice evidence |
| I04 | Large Bank Transfer | Amount not clipped/corrupted | RM1,288,839.90 rendered correctly | PASS | PASS | PASS | N/A | Browser screenshot |
| I05 | Custom payment label | Business label overrides default | No custom payment method in target fixture | NOT APPLICABLE | N/A | N/A | N/A | — | Future fixture only if required |
| J | RM200 split: Cash 50 + DuitNow 150 | 1 transaction, RM200 sale | Exactly matched | PASS | PASS | PASS | N/A | Invoice `REPORT-UX-LOCAL-20260826-A` |
| K | Package use | Does not increase monetary collections | No Package payment/use in target period | NOT APPLICABLE | N/A | N/A | N/A | — | Canonical service excludes PACKAGE; no live fixture |
| L | Valid period with Net Sales ≠ Net Collected | Correct and understandable difference | Copy explains semantics, but current target period net values are equal and no unequal-period fixture exists | BLOCKED | BLOCKED | REVIEW REQUIRED | N/A | Do not manufacture data; rerun on known unpaid/cross-period fixture |
| M | Payment card → individual source payments | Trace method total to records | Daily rows and invoice drawer help, but payment cards have no direct drill-down | PASS | PASS | REVIEW REQUIRED | N/A | P1 per UAT rule; add source link only after product review |
| N01 | Appointment summary | Counts match source | 1 SCHEDULED; other status counts 0 | PASS | PASS | PASS | N/A | DB appointment query + UI |
| N02 | Repeat Customers wording | Period metric clear | Value correct; label can imply lifetime returning customers | PASS | PASS | REVIEW REQUIRED | N/A | P2 terminology clarification recommended |
| N03 | Service Sales and Top 10 | Quantity/amount and ranking clear | No service sales in target period | NOT APPLICABLE | N/A | N/A | N/A | — | Existing code slices top 10 by amount; live state empty |
| N04 | Staff Activity | Appointments and attributed sales, not payroll | OSCAR YONG, 1 appointment, RM0; section not presented as payroll | PASS | PASS | PASS | N/A | Browser DOM |
| N05 | Appointment status | Match source | `scheduled 1` matched DB | PASS | PASS | PASS | N/A | DB + UI |
| O | Non-salon dashboard | Validate non-salon sections and hierarchy | No suitable authenticated non-salon browser fixture | BLOCKED | BLOCKED | BLOCKED | BLOCKED | — | Rerun in approved test business; do not create during this UAT |
| P | Expense recognition and operating balance | Net Sales − Confirmed Expense | 1,289,109.90 − 192.80 = 1,288,917.10 | PASS | PASS | PASS | N/A | DB + UI; wording explicitly not accounting profit |
| Q | Expense settlement | Payment date settles only; no duplicate expense | Period payments RM781.80 = prior-period expense RM589 + selected expense RM192.80; recognised expense remains RM192.80 | PASS | PASS | PASS | N/A | Read-only expense/payment-event query |
| R | Empty period | Clear non-broken empty states | Today shows clear zero states for Sales, Payments, Service, Staff, Appointments | PASS | PASS | PASS | N/A | Browser snapshot |
| S | Query state refresh/deep link | range/from/to/branch/day/showEmpty stable | Branch, day drawer and showEmpty persisted on direct reload | PASS | PASS | PASS | N/A | URL observations; native browser Back not fully exercised |
| T | Desktop owner usability | Fast scan, clear hierarchy, trace suspicious values | Summary/day/payment fast; suspicious refund/payment source still requires unavailable history/drill-down | PASS | PASS | REVIEW REQUIRED | N/A | P1 effects already counted under G/M |
| U | Approximately 390px | No overflow/clipping; usable drawer/cards | Browser runtime ignored requested 390px viewport and remained desktop width | BLOCKED | N/A | BLOCKED | BLOCKED | — | Must rerun on real 390px device/emulator before READY |
| V | Long-page usability | Efficient reach to Sales/Payments/Operations/Expenses | Salon+Expense page is understandable but long; no section navigation | PASS | PASS | REVIEW REQUIRED | N/A | P2; consider navigation only after product review |
| W | Owner: “How did business perform this month?” | Answer via Month → Summary → days → payment → operations | Net sales found under 10s; specific day under 20s; payment mix clear | PASS | PASS | PASS | N/A | Observed browser workflow |
| X | Investigate unusual 27 Aug | Day → invoice → reason | Sale/discount/refund totals and invoice reachable; refund reason/history cannot be established | PASS | PASS | REVIEW REQUIRED | N/A | P1; same root cause as G |
| Y | Terminology audit | Business-readable labels | Core labels clear; Repeat Customers scope ambiguous; raw `scheduled` lower-case is minor | PASS | PASS | REVIEW REQUIRED | N/A | P2; terminology-only remediation later |
| Z | Interaction quality | Labels/focus/close/taps usable | Semantic labels and row links present; backdrop issue; keyboard and 390px tap quality not fully verified | PASS | N/A | REVIEW REQUIRED | BLOCKED | P2; rerun keyboard/mobile after viewport access |

## Functional

- Period filters: **PASS**, except reversed-range communication is **REVIEW REQUIRED**.
- Daily Sales: **PASS**.
- Drawer: **PASS** for data and close button; backdrop interaction **REVIEW REQUIRED**.
- Invoice navigation: **PASS**.
- Payments: **PASS** for amounts and grouping.
- Split Payment: **PASS**.
- Refund: **PASS** financially; source traceability **REVIEW REQUIRED**.
- Discounts: **PASS** financially; period-to-invoice traceability **REVIEW REQUIRED**.
- Salon reports: **PASS** for available fixture; Service Sales live data N/A.
- Non-salon reports: **BLOCKED** by unavailable authenticated fixture.
- Expense reports: **PASS**.

## Financial Reconciliation

### Sales source records

| Date | Invoice | Gross / subtotal | Discount | Invoice total | Refund | Net report | Payments |
|---|---|---:|---:|---:|---:|---:|---|
| 25 Aug | REPORT-UX-LOCAL-20260825-LONG | RM1,288,839.90 | RM0.00 | RM1,288,839.90 | RM0.00 | RM1,288,839.90 | Bank transfer RM1,288,839.90 |
| 26 Aug | REPORT-UX-LOCAL-20260826-A | RM200.00 | RM0.00 | RM200.00 | RM0.00 | RM200.00 | DuitNow RM150 + Cash RM50 |
| 27 Aug | REPORT-UX-LOCAL-20260827-B | RM120.00 | RM20.00 | RM100.00 | RM30.00 | RM70.00 | Card RM100 gross |

### Reconciliation results

- Daily vs Summary: **PASS** — RM1,288,839.90 + RM200 + RM70 = **RM1,289,109.90**.
- Refunds: **PASS** — Daily/summary/UI/DB all **RM30.00**.
- Discounts: **PASS** — Daily/summary/invoice all **RM20.00**.
- Average Sale: **PASS** — RM1,289,109.90 / 3 = **RM429,703.30**.
- Payment totals: **PASS** — Bank RM1,288,839.90 + DuitNow RM150 + Card net RM70 + Cash RM50 = **RM1,289,109.90**.
- Sales vs Collections: **PASS** for current data; unequal-period user explanation fixture **BLOCKED**.
- Expense recognition: **PASS** — only Aug expense RM192.80 recognised.
- Settlement: **PASS** — Aug payments RM781.80 include RM589 payment of a July expense without re-recognising it.
- Business Day: **PASS** by canonical cutoff unit fixture; no matching live 01:30/02:30 target records.

## Permissions

- Business scope: Current authorised owner **PASS**.
- Branch scope: Server-side resolver tests **PASS**; live branch-limited account **BLOCKED**.
- URL tampering: Canonical resolver **PASS**; direct restricted-session browser replay remains required.
- Security verdict: **No observed P0**, but READY requires one live negative-permission pass.

## Source Traceability

- Sale → Invoice: **PASS**.
- Refund → Original transaction: **REVIEW REQUIRED (P1)** — original invoice can be reached, but historical refund time/reason/method/processor is absent.
- Discount → Invoice: **REVIEW REQUIRED (P1)** — invoice shows the discount, but the daily/period total does not identify contributing invoices.
- Payment method total → Individual payments: **REVIEW REQUIRED (P1)** — indirect day/invoice route only; no method-card drill-down.
- Overall: **REVIEW REQUIRED**.

## UI/UX — Desktop

- Information hierarchy: **PASS**.
- Summary scanning: **PASS**; Month Net Sales visible in under 10 seconds.
- Daily Sales usability: **PASS**.
- Payment usability: **PASS** for understanding totals; source traceability **REVIEW REQUIRED**.
- Long page usability: **REVIEW REQUIRED (P2)**.
- Terminology: **REVIEW REQUIRED (P2)** for Repeat Customers period scope.
- Empty states: **PASS**.
- Overall: **REVIEW REQUIRED**.

## UI/UX — 390px

- Layout: **BLOCKED**.
- Overflow: **BLOCKED**.
- Readability: **BLOCKED**.
- Tap targets: **BLOCKED**.
- Drawer: **BLOCKED**.
- Overall: **BLOCKED** because the in-app browser kept a desktop 1280px viewport after a 390px request. Responsive code/unit evidence exists, but it is not a substitute for live 390px UAT.

## Real Owner Workflows

1. Check today
   - Result: **PASS** — zero-state summary is clear.
   - Time / friction: under 10 seconds; no material friction.
2. Check month
   - Result: **PASS** — Month tab and summary answer the main question quickly.
   - Time / friction: Net Sales under 10 seconds.
3. Investigate one day
   - Result: **REVIEW REQUIRED** — 27 Aug drawer opens quickly; refund explanation stops before reason/history.
   - Time / friction: day found under 20 seconds; source explanation incomplete.
4. Explain Sales vs Collections
   - Result: Explanatory copy is clear; live unequal-period proof **BLOCKED**.
5. Trace refund
   - Result: **REVIEW REQUIRED (P1)**.
6. Trace discount
   - Result: **REVIEW REQUIRED (P1)**.

## Top Findings

### P0

- None.

### P1

1. Historical refund details are not exposed from Reports or the reached invoice view.
2. Discount totals lack direct contributor identification when multiple invoices exist.
3. Payment method cards have no direct path to the individual payments/invoices.
4. `pnpm exec tsc --noEmit` fails on current Reports presentation typing, making the release build gate red.

### P2

1. Reversed Custom range is silently collapsed while the URL keeps reversed inputs.
2. Drawer backdrop did not close during the observed interaction.
3. Repeat Customers may be mistaken for a lifetime metric.
4. Long-page section navigation may be inefficient as more data appears.
5. Raw appointment status `scheduled` lacks presentation polish.
6. Keyboard/mobile interaction quality remains partially unverified.

### P3

- None recorded.

## Must Fix Before Production

- Restore a clean TypeScript build for Reports (`DailySalesPresentationRow` shape and readonly payment method typing).
- Complete real browser negative-permission UAT with branch-limited and unauthorised accounts.
- Complete real 390px Reports UAT.

## Should Fix

- Add a governed trace path for historical refund details.
- Add a practical trace path from payment/discount totals to contributing records.
- Make reversed-date normalisation explicit and URL/UI state consistent.
- Repair/verify backdrop close behaviour.
- Clarify Repeat Customers period scope.

## Polish

- Present appointment statuses in title case.
- Consider lightweight section navigation if real data confirms long-page fatigue.

## Future Enhancements (Not Bugs)

- CSV / Excel export.
- PDF / print report.
- Period comparison and sales trend chart.
- Saved presets and scheduled email.
- Accounting P&L, bank reconciliation, GL and tax submission.

## Screenshots / Evidence

Captured in the current Codex in-app browser UAT session:

- **Month Summary + Daily Sales** — shows RM1,289,109.90, 3 transactions and three active days.
- **Payment Mix** — Bank transfer, DuitNow, Card with refund, and Cash.
- **27 Aug Day Drawer** — RM70 net sales, RM30 refund, RM20 discount, invoice navigation.
- **Desktop page** — 1280px authenticated owner view.
- **390px** — capture attempt recorded as BLOCKED because the runtime ignored the requested viewport and rendered desktop width.

Read-only source evidence:

- Invoice rows and payment rows queried from Local DB.
- One `paymentRefund` of RM30 tied to `REPORT-UX-LOCAL-20260827-B`.
- Expense RM192.80 dated 7 Aug; prior-period expense RM589 paid 14 Aug.
- One SCHEDULED appointment in the selected period.

## Automated Tests

- Reports tests: **26/26 PASS**.
- Reports ESLint: **PASS**.
- TypeScript: **FAIL** — 11 errors, all in current Reports presentation typing (`page.tsx` and one test reference).
- `git diff --check`: **PASS**.
- Business-context integration attempt: **BLOCKED before execution** by its `DATABASE_URL is required` guard; it made no fixture changes. The test is data-mutating, so it was not rerun against the Local DB during this read-only UAT.

## Files Changed During UAT

- `docs/TETAMU_POS_REPORTS_FULL_UAT.md` — documentation only.
- Business code changed: **NONE**.
- Tests changed: **NONE**.
- Business data changed: **NONE**.

## Production

**NOT ACCESSED**

## Final Recommendation

- MUST FIX: TypeScript build gate; live restricted-permission UAT; live 390px UAT.
- SHOULD FIX: Refund, discount and payment source traceability; reversed-range explanation; backdrop close.
- CAN DEFER: Long-page navigation polish and terminology refinements after product review.
- DO NOT BUILD YET: Charts, exports, scheduled reports, accounting P&L/GL or other scope expansion.

**Final verdict: REVIEW REQUIRED. Stop after this evidence freeze; do not begin remediation without product review.**
