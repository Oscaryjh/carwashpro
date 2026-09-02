# TETAMU POS CORE — FINAL LIVE BROWSER ACCEPTANCE

## Overall Status

```text
REVIEW REQUIRED
```

## Environment

- Local: `https://localhost:3000`, isolated `LOCAL_UAT` database on `localhost`
- Browser: Codex in-app Chromium browser
- Observable desktop viewport: `1280 × 721` CSS pixels
- Observable mobile viewport: `391 × 844` CSS pixels on the accepted mobile observations
- Production accessed: **NO**

## Salon Cashier

- Login: **PASS**
- Start Shift: **BLOCKED BY FIXTURE STATE** — Branch A already has a frozen Daily Closing for 28 Aug 2026; the canonical control correctly refuses another shift
- Customer: **NOT RUN as Cashier**; the isolated Owner customer journey passed
- Appointment: **PAGE/SELECTION SURFACE OBSERVED**, but the Cashier transaction was not executed after the frozen close
- Checkout: **NOT RUN**
- Cash: **NOT RUN as a new Cashier transaction**; the existing RM50 Cash trace remains reconciled
- Split: **NOT RUN live**
- Invoice: **PASS for the existing browser invoice**; not produced by a new Cashier journey
- Refund: **NOT COMMITTED**
- End Shift: **NOT RUN**
- Daily Close denied: **PASS** — the Cashier has no branch Daily Closing control
- Result: **REVIEW REQUIRED** — authorization is correct, but the full Cashier operating journey is not executable after the day was frozen

## Salon Owner

- Customer create: **PASS** — one isolated Branch A customer created
- Customer edit: **PASS** — edited name persisted; phone search returned exactly one record and reopen preserved the edit
- Appointment: **PASS** for the existing completed Haircut appointment
- Payment: **PASS** for the existing RM50 Cash browser trace and the deterministic Card/DuitNow trace
- Invoice: **PASS** — invoice `b1cc0ec2-5ccf-4359-bacc-0c4eef343447`, RM50 paid, RM0 balance
- Discount: **NOT RUN live**
- Package: **NOT RUN live**
- Reports: **PASS** — Net Sales RM150; Cash RM50, Card RM40, DuitNow RM60; two transactions
- Closing: **PASS** — frozen Branch A snapshot, expected cash RM50, actual cash RM50, difference RM0
- Result: **PARTIAL PASS / REVIEW REQUIRED** — the executed Owner chain passes, but live discount/package/refund/split acceptance remains open

## Salon Manager

- Scope: **PASS for canonical scope** — assigned/home Branch A for Closing operations; `ALL_BRANCHES` expands Reports visibility only
- Reports: **PASS** for Branch A browser evidence; cross-branch Reports access is supported by the permission resolver
- Closing: **PASS** for Branch A frozen snapshot
- Daily Closing authority: **PASS** — explicit `CONFIRM_DAILY_CLOSING` permission is present
- Result: **PASS for the observed authorization model**; no new Daily Closing was created because the day was already frozen

## Manager ALL_BRANCHES Semantics

- Canonical rule: **SEMANTICS B** — `ALL_BRANCHES` means “View all branches and switch branch filters in Reports”; Closing operational authority remains bound to the staff member's assigned branch
- Evidence: `src/lib/auth/staff-permissions.ts` defines `ALL_BRANCHES` as Reports visibility; `src/app/(business)/reports/page.tsx` consumes it for report branch selection; `src/lib/branches.ts` deliberately returns all operational branches only for `BUSINESS_OWNER`; `CONFIRM_DAILY_CLOSING` is a separate capability
- Current behavior: Manager can view/switch authorised branches in Reports, but Closing resolves to home Branch A
- Product defect / fixture issue / correct behavior: **CORRECT BEHAVIOR**; the previous expectation that `ALL_BRANCHES` granted operational Closing access was a UAT expectation/configuration misunderstanding
- Result: **PASS**

## Negative Permissions

- No-Reports: **PASS** — direct `/reports`, month and Branch B URLs redirect/deny without report data
- Branch-A only: **PASS** — only Branch A operational data is available
- Branch-B tampering: **PASS** for Reports, Closing and Appointment deep-link/query attempts; no Branch B data leakage observed
- Result: **PASS**

## Auto

- New customer: **PASS** — isolated `Live Auto Browser UAT Customer` created once in Branch A
- New vehicle: **PASS** — plate `LIVE UAT 28` created once and linked to that customer
- Plate search: **PASS** — existing plate path and new/not-found plate path were distinguishable
- Work Order: **PASS** — one RM180 Premium Detailing work order created, status `IN_PROGRESS`, unpaid balance RM180
- Checkout: **PASS to payment gate** — customer, vehicle, item, total, paid and balance were clear
- Payment: **BLOCKED BY FIXTURE STATE** — canonical checkout requires an open Shift; the frozen Daily Closing prevents starting one
- Invoice: **NOT CREATED** for the new flow, as expected without payment
- Reports: **PASS** for the pre-existing settled RM180 trace; the new unpaid work order did not create financial activity
- Closing: **PASS** for the existing frozen RM180/RM180 snapshot
- Result: **PARTIAL PASS / REVIEW REQUIRED** — customer → vehicle → work order → checkout passed; payment → invoice → reports → closing could not be rerun legally

## Live Refund

- Partial: **NOT COMMITTED** — RM10 was entered, but no financial confirmation was given; the action was not retried
- Traceability: **PASS for form visibility/usability**; processor, method, amount and reason surfaces exist
- Reports: **UNCHANGED**, refunds remain RM0
- Closing: **UNCHANGED**
- Duplicate protection: **PASS by focused integration coverage**; no live duplicate/refund record was created
- Result: **NOT RUN / REVIEW REQUIRED** — database evidence confirms the source invoice is still `PAID`, RM50 paid, RM0 balance and has zero refunds

## Live Discount

- Valid: **NOT RUN**
- Expired: **NOT RUN**
- Minimum spend: **NOT RUN**
- Reports reconciliation: **NOT RUN live**; focused calculation/presentation tests pass
- Result: **REVIEW REQUIRED**

## Package

- Purchase: **NOT RUN**
- Use: **NOT RUN**
- Restore: **NOT RUN**
- Monetary collection semantics: **PASS by existing system/test evidence** — Package Use is not monetary collection
- Result: **REVIEW REQUIRED**

## Reload / Duplicate Browser

- Refresh: **PASS** — settled Auto checkout remained fully paid after reload
- Back: **PASS**
- Re-entry: **PASS** — existing checkout reopened with the same invoice and RM0 balance
- Rapid submit: **NOT RUN live**
- Duplicate invoices: **NONE OBSERVED**
- Duplicate payments: **NONE OBSERVED**
- Result: **PARTIAL PASS** — reload/back/re-entry pass; rapid-click browser acceptance remains open

## 390PX

- Verified viewport: **PASS** — browser reported approximately `391 × 844` CSS pixels for accepted mobile observations; a later viewport re-application reverted to `1280 × 721` and was not counted as mobile evidence
- Login: **PASS**
- Customer: **PASS** — search/create/edit dialog fit and was usable
- Appointment: **REVIEW REQUIRED** — no page-level overflow, but the calendar requires inner horizontal panning and is practically awkward
- Cashier: **PASS for responsive/readable surface**; full transaction flow blocked by frozen-day fixture state
- Checkout: **PASS for existing invoice/amount visibility**
- Split Payment: **NOT RUN**
- Invoice: **PASS** — amounts and primary actions remained readable
- Refund: **PASS for form usability**, but no refund was committed
- Reports: **PASS** — responsive cards/list, no page-level overflow
- Closing: **PASS** — responsive cards and clear frozen/error state
- Auto: **PARTIAL** — existing Auto surfaces were readable; the new customer/vehicle/payment chain was not completed at 390px
- Overflow: **PASS for tested pages** — no page-level horizontal overflow; Appointment uses an inner scroll surface
- Tap targets: **PASS for tested primary actions**
- Result: **REVIEW REQUIRED** — real mobile dimensions were observed, but all mandatory financial/mobile journeys were not completed and Appointment has practical mobile friction

## Financial Browser Reconciliation

- Salon Sales: **RM150**
- Salon Payments: **Cash RM50 + Card RM40 + DuitNow RM60 = RM150**
- Salon Refund: **RM0**
- Salon Discount: **RM0**
- Salon Reports: **RM150, two transactions**
- Salon Shift: **Cash movement RM50**
- Salon Daily Closing: **Expected RM50 / actual RM50 / difference RM0**
- Auto Sales: **RM180 settled**; the new RM180 work order remains unpaid and creates no sale/invoice
- Auto Payments: **Cash RM180 settled**
- Auto Reports: **RM180, one settled transaction**
- Auto Shift: **Cash movement RM180**
- Auto Daily Closing: **Expected RM180 / actual RM180 / difference RM0**
- Result: **PASS for executed/settled traces**; the required new live refund/discount/package/split traces were not created

## UIUX Cashier

- Desktop: **PASS for observed surfaces**
- 390px: **REVIEW REQUIRED** — responsive but full independent mobile cashier operation was not proven
- Payment clarity: **PASS** for amount/paid/balance/status presentation
- Error clarity: **PASS** — “Shift required” and frozen-day errors explain the corrective action
- Workflow friction: **HIGH in this acceptance run** because the permanent fixture preserves a frozen Daily Closing and cannot replay the required operating sequence
- Result: **REVIEW REQUIRED**

## UIUX Owner

- Reports: **PASS**
- Refund trace: **PASS for UI surface, NOT RUN for committed data**
- Closing: **PASS**
- Branch scope: **PASS for Owner; Manager rule clarified as Semantics B**
- Result: **PARTIAL PASS / REVIEW REQUIRED**

## New Findings

### P0

- None.

### P1

- **Acceptance fixture replayability blocker:** both permanent UAT Branch A days are already frozen. The reset contract intentionally preserves financial and audit history, so the mandated Cashier-first sequence, live split/refund/discount/package and Auto payment chain cannot be replayed without a new clean business date or a separately prepared disposable acceptance fixture. This is not classified as a confirmed product defect.
- Required live financial browser acceptance remains incomplete; Production Candidate criteria are therefore not met.

### P2

- Appointment mobile calendar is technically contained but requires inner horizontal panning at 391px; the primary schedule view is less practical than the other responsive routes.
- Top navigation can clip secondary labels at the narrow viewport, although primary actions remain reachable.

### P3

- None newly confirmed.

## Final Gates

- Fixture: **PASS — 3/3** contract tests; status confirms `LOCAL_UAT`, localhost database and stable fixture personas
- Focused tests: **PASS — 80/80** POS, Reports, Closing, fixture and business-rule unit tests
- Auth/permission: **PASS** — included in the 80 focused tests; code audit confirms Semantics B
- Integration: **PASS — 12/12** (7 Closing concurrency/guard tests + 5 business-context/financial-idempotency tests)
- TypeScript: **NOT REQUIRED** — no business code changed during acceptance; prior closure was passing
- ESLint: **PASS** for focused POS/Reports/Closing/Auth/fixture/test files
- Diff check: **PASS** after adding this evidence report

## Files Changed During Acceptance

- `docs/TETAMU_POS_CORE_FINAL_LIVE_BROWSER_ACCEPTANCE.md` — test/evidence report only

No POS, Reports, Closing, payment, refund, invoice, permission or Production business code was changed.

## Production

```text
NOT ACCESSED
```

## FINAL VERDICT

```text
TETAMU POS CORE
→ FUNCTIONAL READY ✅
→ FINANCIAL READY ✅ FOR EXECUTED/SETTLED TRACES
→ SECURITY READY ✅
→ COMPLETE UI/UX ACCEPTANCE NOT YET CLOSED
→ MOBILE RESPONSIVENESS OBSERVED, FULL MOBILE JOURNEY NOT PROVEN
→ LOCAL UAT FIXTURES READY BUT NOT REPLAYABLE FOR THE REQUIRED SEQUENCE

PRODUCTION CANDIDATE
→ NO

PRODUCTION VALIDATED
→ NO

Overall Status
→ REVIEW REQUIRED
```

The exact next acceptance step is to prepare a clean, isolated, non-Production business date/fixture and rerun only the blocked Cashier, split, refund, discount, package and Auto payment journeys at observable 390 × 844. Do not deploy Production.
