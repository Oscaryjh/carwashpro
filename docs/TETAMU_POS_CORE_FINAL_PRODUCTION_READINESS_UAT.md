# TETAMU POS CORE — FINAL PRODUCTION READINESS UAT

## 1. Final Status

```text
Status: REVIEW REQUIRED
Environment: LOCAL development + Railway TESTING read-only browser checks
Business Types: Salon primary; Auto automated coverage only
Branch Scope: dedicated Local Closing branches + authorised Testing branch
UAT Date: 28 Aug 2026
Production Accessed: NO
Production Data Changed: NO
Business Code Changed During This UAT: NO
```

The current code passes the automated financial, security, isolation, migration,
TypeScript and production-build gates executed in this UAT. It is **not** marked
Production Ready because the required complete real-browser Owner / Manager /
Cashier / Auto journeys and a real 390px viewport run could not be completed from
the available UAT sessions and fixtures.

No P0 money, tenant-isolation or duplicate financial-event defect was found.

## 2. Scope And Safety Boundary

- Local URL used: `https://localhost:3000`
- Testing URL used: `https://tetamu-pos-web-testing.up.railway.app`
- Production URL and Production database were not opened or queried.
- Real payment, bank export, statutory submission and external customer action were
  not executed.
- The full integration suite used a disposable PostgreSQL database.
- The local Closing browser check used the existing `Closing Full UAT Local Only`
  identity and dedicated Closing branches.
- The existing Testing browser session was used read-only to inspect Cashier,
  Appointments and permission redirection.
- A project-provided local Auth QA account script was attempted only against
  localhost. It stopped on missing legacy QA businesses before any user write.
- No financial record was created, approved, refunded or closed during this UAT.

## 3. Executed Gates

| Gate | Result | Evidence |
|---|---:|---|
| Full unit suite | PASS | 1,282 / 1,282 |
| Disposable integration suite | PASS | 197 / 197 main integration + 1 / 1 Attendance route |
| Focused POS / Reports / Closing suite | PASS | 107 / 107 |
| TypeScript | PASS | `pnpm exec tsc --noEmit` |
| ESLint | PASS WITH WARNINGS | 0 errors, 3 warnings |
| Git whitespace | PASS | `git diff --check` |
| Prisma schema | PASS | project embedded-DB wrapper |
| Current migration status | PASS | 211 migrations, schema up to date |
| Fresh disposable migration rebuild | PASS | all 211 migrations applied |
| Release environment contract | PASS | valid for `development` |
| Production build | PASS | `pnpm build` after controlled local dev stop |
| Local health after restart | PASS | HTTP 200, database ready |
| Read-only DB integrity queries | PASS | all nine anomaly counts were zero |

The first build attempt was blocked by the running Windows dev server holding the
Prisma query-engine DLL. The dev supervisor was stopped in a controlled manner,
the canonical `pnpm build` then passed, and the supervisor was restarted. This was
an environment lock, not a compilation defect.

## 4. Database Integrity Evidence

All of the following returned `0` in the current local database:

- payment → invoice tenant mismatch
- refund → payment tenant mismatch
- invoice item → invoice tenant mismatch
- payment → cashier shift tenant or branch mismatch
- cumulative refund greater than payment
- duplicate business invoice number
- duplicate business / branch / date Daily Closing snapshot
- orphan payment invoice
- orphan refund payment

Relevant schema controls were also present and migration-verified, including
business-scoped invoice numbers, business-scoped payment methods, business/branch
shift relations, unique Daily Closing snapshots, Decimal money columns and
financial idempotency migrations.

## 5. Browser UAT Evidence

### Local Shift Closing

```text
Identity: Closing Full UAT Local Only
Cashier: Closing UAT Cashier
Branch: Manual Control Branch
Opening Float: RM100.00
Net Cash Sales: RM10.00
Expected Drawer Cash: RM110.00
Shift State Before Test: OPEN
Daily Closing: already completed
```

Negative money-control check:

1. Counted Cash was entered as `RM109.00`.
2. Difference reason was left empty.
3. `End shift` was attempted.
4. The system rejected the command with:
   `Cash is short by RM1.00. Please add a note before ending the shift.`
5. The shift remained `OPEN`; no snapshot or financial record was created.

### Testing Cashier / Appointment / Permission Check

- The signed-in Testing business was `Oscar Salon Lintas`.
- Cashier rendered a valid empty-catalog state and links to create a package or
  product.
- Appointments rendered a current-week staff calendar with active staff rows and
  accessible New Appointment controls.
- Direct navigation to `/reports?range=today` did not grant Reports access; the
  session was redirected to `/appointments`.
- No Testing record was created or modified.

### Real 390px Check

The explicit 390 × 844 viewport capability was requested, but screenshots remained
at the normal desktop width. A real 390px result therefore could not be observed or
accepted. This is frozen as a UAT coverage blocker and is not reported as PASS.

## 6. Scenario Matrix

Legend:

- `PASS` — executed and accepted by automated and/or browser evidence.
- `BLOCKED` — required live acceptance could not be executed with the available
  fixture/session. No product failure is inferred.
- `FAIL` — an executed scenario produced an incorrect product result.

| Area | Scenario | Result | Evidence / Actual Result |
|---|---|---:|---|
| Auth | password abuse, session revocation, disabled-user rejection | PASS | disposable integration + unit security suite |
| Auth | same-origin mutation guard and hardened session cookie | PASS | unit security suite |
| RBAC | direct unauthorised Reports URL | PASS | Testing session redirected to Appointments |
| RBAC | Owner / Manager / Cashier full live menu and action comparison | BLOCKED | canonical local QA businesses absent |
| Tenant | cross-business customer and audit access | PASS | disposable tenant-isolation integration |
| Tenant | cross-business financial idempotency key and payload | PASS | POS financial idempotency integration |
| Branch | authorised branch selection and branch-filtered report | PASS | Reports A–M tests H–J |
| Branch | live multi-branch tampering through UI | BLOCKED | no current multi-role live fixture |
| Customer | create/edit/view CRM trace | BLOCKED | no isolated current browser fixture |
| Auto | customer + vehicle + work order full journey | BLOCKED | legacy QA Auto fixture absent |
| Salon | appointment staff branch scope | PASS | focused unit tests + Testing calendar render |
| Salon | appointment → checkout → invoice full live journey | BLOCKED | Testing catalog is empty |
| Catalog | service/product/package empty state | PASS | Testing Cashier explicit empty-state UI |
| Catalog | service/product/package live sale | BLOCKED | Testing catalog is empty |
| Payment | cash checkout accounting | PASS | daily-sales scenario A + integration invariants |
| Payment | card/custom method snapshot | PASS | business-payment-method integration |
| Payment | DuitNow separated from Cash | PASS | daily-sales scenario D |
| Payment | split payment remains one sale with separate legs | PASS | daily-sales scenario E |
| Payment | partial payment and concurrent full payment | PASS | POS financial idempotency integration |
| Payment | duplicate submit / retry replay | PASS | same key replays once; conflicts reject |
| Payment | 20 concurrent multi-branch retries | PASS | exactly 20 effects from 20 operations |
| Payment | negative / unsafe Closing money input | PASS | empty, negative, >2dp, NaN, Infinity, overflow rejected |
| Payment | long amount display | PASS | Reports long-money presentation test |
| Invoice | unique scoped invoice number | PASS | schema + DB anomaly query |
| Invoice | unpaid / partial / paid summary | PASS | daily report status and outstanding tests |
| Discount | percentage, scoped, min spend and cap | PASS | focused catalog discount tests |
| Discount | fixed amount and subtotal floor | PASS | focused catalog discount tests |
| Discount | expired/invalid live discount UI | BLOCKED | no isolated live catalog fixture |
| Package | purchase/redemption financial isolation | PASS | disposable integration |
| Package | retry decrements once | PASS | POS package idempotency integration |
| Package | concurrent last use has one winner | PASS | POS package idempotency integration |
| Refund | refundable amount excludes prior refunds | PASS | focused refund tests |
| Refund | partial refund invoice state | PASS | focused refund tests |
| Refund | full refund invoice state | PASS | focused refund tests |
| Refund | over-refund / double refund | PASS | concurrency suite + DB over-refund count 0 |
| Refund | refund affects correct date/method/report | PASS | daily-sales F and payment drill-down M |
| Reports | one cash sale / multi transaction / multi day | PASS | scenarios A–C |
| Reports | branch / all authorised branches | PASS | scenarios H–J |
| Reports | cutoff boundary / empty range | PASS | scenarios K–L |
| Reports | payment mix / split legs / method refunds | PASS | scenarios D, E, M |
| Reports | discount contributors and refund processor details | PASS | focused Reports UX tests |
| Reports | real Owner/Manager live page | BLOCKED | available browser users lack Reports authority |
| Closing | current shift totals reconcile | PASS | live Local Closing state + unit arithmetic |
| Closing | cash difference requires reason | PASS | live rejected End Shift attempt |
| Closing | post-cutoff activity cannot attach to prior shift | PASS | focused unit + disposable integration |
| Closing | open shift blocks Daily Close | PASS | disposable Closing integration |
| Closing | concurrent shift start / close | PASS | snapshot XOR open shift |
| Closing | duplicate snapshot prevention | PASS | integration + DB duplicate count 0 |
| Closing | frozen snapshot and late activity separation | PASS | focused Closing UI/control tests |
| UX | Desktop Closing readability and labels | PASS | live browser inspection |
| UX | Testing Cashier empty state | PASS | live Testing browser inspection |
| UX | Appointment calendar controls | PASS | live Testing browser inspection |
| UX | keyboard / Escape / backdrop dialog contracts | PASS | focused UI contract tests |
| UX | real 390px layout and table scrolling | BLOCKED | viewport override did not take effect |
| Build | TypeScript / lint / build / migrations | PASS | all gates above |

## 7. Financial Reconciliation

Automated canonical reconciliation passed for:

- `Sales = Subtotal - Discounts + Tax + Tips` within the implemented invoice
  definition.
- `Collections = Payments - monetary Refunds`.
- split legs remain separate while the invoice remains one sale.
- package redemptions are not cash sales and restored package uses are not monetary
  refunds.
- tips are not gross/net sales.
- report cash expected uses net cash collected.
- shift expected cash includes opening float, cash payments, refunds and drawer
  payouts in their canonical positions.
- opening float is not counted as Daily Sales.
- late/post-cutoff activity cannot silently mutate a prior business day.

No reconciliation mismatch was observed in executed tests or current DB integrity
queries.

## 8. Security And Isolation

```text
Tenant Isolation: PASS (automated + DB evidence)
Branch Isolation: PASS (automated); live multi-role UI coverage BLOCKED
Role Separation: PASS (automated); complete live role matrix BLOCKED
Unauthorised URL Handling: PASS (live Testing redirect)
Audit Rollback: PASS
Idempotency: PASS
Concurrency: PASS
Production Secret Exposure: none observed
```

## 9. UI / UX

### Desktop

- Closing values, labels, state, difference reason and End Shift action were clear.
- Testing Cashier provided an actionable empty state.
- Testing Appointments provided usable date navigation and per-staff creation
  controls.
- The current Local Closing page still displays technical timezone copy
  (`Asia/Kuching`). This is a polish item rather than a financial correctness issue.

### 390px

- Not accepted. The requested explicit viewport remained desktop-sized.
- Mobile navigation, form fitting, tables, dialogs and critical-action reachability
  remain unverified in this final run.

## 10. Defect / Blocker Register

### P0

None found.

### P1

| ID | Finding | Type | Impact | Required Closure |
|---|---|---|---|---|
| P1-001 | Legacy QA Salon and QA Auto businesses required by the existing local Auth QA script are absent | UAT fixture blocker | Owner / Manager / Cashier / Auto live role journeys cannot be completed | Prepare current isolated canonical local fixtures; rerun only blocked role journeys |
| P1-002 | Explicit 390 × 844 viewport request remained desktop-sized | UAT tooling blocker | Real mobile acceptance cannot be claimed | Run in a browser/device where the viewport is observably 390px |
| P1-003 | Available Testing Cashier business has no active sale items and lacks Reports permission | UAT data/scope blocker | Browser checkout, refund and Reports reconciliation cannot be completed in that session | Provide an isolated Testing business with catalog, transactions and authorised Owner/Manager session |

### P2

None frozen.

### P3 / Advisory

| ID | Finding | Impact |
|---|---|---|
| P3-001 | ESLint reports three warnings (unused local script variable, raw WhatsApp `<img>`, unused parameter) | No build or POS financial failure |
| P3-002 | Prisma `package.json#prisma` config and embedded wrapper child-process mode emit deprecation warnings | Upgrade maintenance item; current schema/build pass |

## 11. Test Data / Cleanup

```text
Financial records created in this UAT: 0
Financial records approved/refunded/closed in this UAT: 0
Local QA users created: 0
Existing dedicated Closing data modified: NO
Disposable integration database: created and disposed by the canonical runner
Temporary read-only integrity script: removed after execution
Production data: untouched
```

The pre-existing dirty worktree was preserved. This UAT adds only this report.

## 12. Evidence List

1. `pnpm test` — 1,282 / 1,282 PASS.
2. `pnpm test:integration:disposable` — exit 0; 197 / 197 + 1 / 1 PASS.
3. Focused POS / Reports / Closing command — 107 / 107 PASS.
4. `pnpm exec tsc --noEmit` — PASS.
5. `pnpm lint` — 0 errors, 3 warnings.
6. `pnpm prisma validate` through project wrapper — PASS.
7. `prisma migrate status` — 211 migrations, up to date.
8. `pnpm prisma:migrate:fresh-check` — PASS on disposable database.
9. `pnpm build` — PASS after controlled local dev stop.
10. `/api/health` after restart — HTTP 200, database ready.
11. Read-only DB integrity query — all nine anomaly counts `0`.
12. Live Local Closing rejected RM1 short close without a reason and remained open.
13. Live Testing unauthorised Reports route redirected to Appointments.
14. Live Testing Cashier empty catalog and Appointments calendar were inspected.
15. 390px viewport attempt was captured but remained desktop-sized; frozen as
    blocked evidence.

## 13. Recommendation

Do not redesign or refactor the POS core based on this run. The code-level money,
isolation, idempotency, reconciliation, migration and build gates passed.

Before a Production Ready verdict, prepare current isolated Local or Testing
Salon/Auto fixtures with explicit Owner, Manager and Cashier sessions, ensure an
active catalog and representative invoice/refund data, and rerun only the blocked
real-browser journeys at desktop and observable 390px.

## 14. Release State

```text
Final Classification:
REVIEW REQUIRED

Ready for Handover:
YES — frozen report and exact blockers are complete.

Ready for Continued Testing:
YES

Ready for Production:
NO

Production:
NOT ACCESSED

Stop Here:
YES
```

No remediation, deployment or Production action is authorised by this report.
