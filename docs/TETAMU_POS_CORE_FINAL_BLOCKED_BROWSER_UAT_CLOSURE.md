# TETAMU POS CORE — FINAL BLOCKED BROWSER UAT CLOSURE

## Overall Status

```text
REVIEW REQUIRED
Environment: LOCAL UAT
UAT date: 28 Aug 2026
Production: NOT ACCESSED
```

Reusable Salon and Auto fixture businesses now exist and the highest-value blocked
desktop journeys were rerun. Salon appointment checkout, Auto work-order checkout,
invoice creation, Reports reconciliation, Shift Closing and frozen Daily Closing
all produced correct Local UAT results. The verdict remains `REVIEW REQUIRED`
because the required observable 390 × 844 run did not take effect and several
required live browser flows were not executed.

## Fixture Set

- Salon UAT Business: `TETAMU UAT SALON` (`tetamu-uat-salon`),
  `b56a01ef-4388-4314-93cd-84d8a7edd9f4`
- Salon Branches: Branch A `284b368a-b757-433b-bd6b-46a0fd4d9458`; Branch B
  `d2050367-f487-40d2-8275-2fa7671adda8`
- Owner: `uat.salon.owner@tetamu.test`
- Manager: `uat.salon.manager@tetamu.test`
- Cashier: `uat.salon.cashier@tetamu.test`
- Branch-limited Staff: `uat.salon.branch-a@tetamu.test`
- No-Reports Staff: `uat.salon.no-reports@tetamu.test`
- Catalog: Haircut RM50, Hair Colour RM150, Treatment RM100, Shampoo RM30,
  Serum RM60
- Customers: UAT Customer A, UAT Customer B, UAT Walk-in
- Appointment fixture: Scheduled, Completed, Cancelled and No-show; UAT Stylist A
  and UAT Stylist B are appointment-bookable
- Payment methods: Cash, Card and DuitNow
- Discount fixture: valid 10%, expired RM5 and RM20 with RM100 minimum spend
- Package fixture: Haircut 3-Visit Pass, RM120
- Financial trace: one RM100 paid invoice with Card RM40 + DuitNow RM60
- Seed command: set `POS_CORE_UAT_FIXTURE=LOCAL_ONLY_CONFIRMED`, provide a
  runtime-only `LOCAL_POS_CORE_UAT_PASSWORD`, then run `npm run uat:pos-core:seed`
- Reset command: the same environment variables with
  `npm run uat:pos-core:reset`; this safely reasserts master records and retains
  settled work orders plus financial/audit evidence. It does not purge money data.
- Status command: set the confirmation flag and run
  `npm run uat:pos-core:status`
- Production guard: refuses Production labels, missing explicit confirmation,
  missing database URL and non-local database hosts
- Credential safety: the password is supplied only at runtime and is not stored in
  source, fixtures, documentation or Git

Repeated seed verification kept stable fixture counts and preserved the paid Auto
work order. It did not create duplicate fixture businesses, branches, personas,
customers, catalog rows, appointments, work orders or invoices.

## Auto Fixture

- Auto Business: `TETAMU UAT AUTO` (`tetamu-uat-auto`),
  `ada6c0ae-12cf-4bbf-9b27-69bae0203c3a`
- Branch: Branch A `5dd35cea-2105-4fc9-9a57-03381f95b4a1`; Branch B
  `7fbf2629-55fd-421e-b956-d37d54302681`
- Owner: `uat.auto.owner@tetamu.test`
- Manager: `uat.auto.manager@tetamu.test`
- Cashier: `uat.auto.cashier@tetamu.test`
- Customer: UAT Auto Customer, `+601100000201`
- Vehicle: Toyota Vios White, plate `UAT 2026`,
  `a388a07b-2aa7-481e-8c1d-8ff055d67a0f`
- Work Order: `UAT-WO-0001`,
  `b46b47e1-80e2-4512-a694-4ce973266f24`
- Catalog: Premium Detailing RM180; Car Shampoo RM35

## Salon Owner Browser

- Customer: existing UAT Customer A was resolved through the appointment; live
  create/edit/reopen was not run
- Appointment: PASS — Completed fixture appointment remained linked to customer,
  Haircut and UAT Stylist A
- Checkout: PASS — service checkout correctly required the canonical Appointment
  path; direct catalog service sale showed an actionable policy message
- Cash payment: PASS — one RM50 Cash payment
- DuitNow: PASS as deterministic financial trace; not created live in this run
- Split payment: PASS as one RM100 invoice with Card RM40 + DuitNow RM60 fixture
  trace; live split UI not run
- Partial payment: NOT RUN
- Invoice: PASS — Invoice 1001, RM50 paid, balance RM0, invoice ID
  `b1cc0ec2-5ccf-4359-bacc-0c4eef343447`
- Refund: NOT RUN in browser
- Discount: fixtures present; live valid/expired/min-spend UX not run
- Package: fixture present; live purchase/use/retry not run
- Reports: PASS — Net Sales RM150, two transactions, Cash RM50, Card RM40,
  DuitNow RM60, refunds RM0, discounts RM0
- Closing: PASS — Expected Cash RM50, Counted Cash RM50, difference RM0, frozen
  Daily Closing snapshot
- Result: PARTIAL PASS; the executed appointment-to-closing chain passed, but all
  required Owner browser acceptance areas are not closed

## Salon Cashier Browser

- Login: PASS
- Shift: BLOCKED BY UAT SEQUENCE — Owner had already frozen Branch A for the day
- Customer: NOT RUN
- Checkout: NOT RUN
- Payment: NOT RUN
- Invoice: NOT RUN
- Closing: PASS for own-shift surface inspection
- Branch Daily Close denied: PASS — no manual branch Daily Close control; starting
  a new shift after frozen close was correctly blocked
- Result: PARTIAL PASS; authorization is correct, full Cashier transaction journey
  remains unexecuted

## Salon Manager Browser

- Login: PASS
- Scope: Branch A operational data visible; fixture grants `ALL_BRANCHES`, but the
  live operational branch list still returned only the home branch
- Reports: PASS for Branch A, RM150 reconciled
- Closing: PASS for Branch A frozen snapshot
- Daily Closing authority: control is granted by fixture permission, but no new
  close was executed after the Owner had frozen the business day
- Result: PARTIAL PASS; Branch A flow passed, all-branch operational scope needs
  product/permission clarification

## Negative Permissions

- No-Reports route: PASS — Reports absent from menu and a direct/deep Reports URL
  redirected to Appointments without report data
- Branch B tampering: PASS for live Reports, Closing and Appointments query/URL
  attempts; Branch B customer/stylist/closing data did not leak
- Direct action tampering: PASS in the affected auth/permission integration suite;
  no destructive direct browser payload was submitted
- Result: PASS for executed browser and server authorization coverage

## Auto Browser

- Customer: PASS — UAT Auto Customer and phone visible
- Vehicle: PASS — Toyota Vios White, plate UAT 2026, customer relation visible
- Work Order: PASS — UAT-WO-0001, Premium Detailing RM180, Ready For Pickup
- Checkout: PASS — amount due RM180 and payment method shown before commit
- Payment: PASS — one Cash RM180 payment
- Invoice: PASS — Invoice 1001, paid RM180, balance RM0, ID
  `10c827f5-42b8-4368-958b-53fcf5d061f4`
- Reports: PASS — Net Sales/Collections RM180, one transaction/payment/job/invoice
- Closing: PASS — Expected and Counted Cash RM180, difference RM0, frozen snapshot
- Result: PASS for the existing customer/vehicle/work-order-to-closing journey;
  new plate/customer creation and cancellation smoke were not run

## Financial Browser Reconciliation

- Sales: Salon RM150; Auto RM180
- Payments: Salon Cash RM50 + Card RM40 + DuitNow RM60; Auto Cash RM180
- Discounts: RM0 in browser-created transactions; live discount UX not run
- Refunds: RM0; live refund UX not run
- Reports: exact match to invoices and payment methods for executed data
- Shift: Salon cash RM50; Auto cash RM180
- Daily Closing: Salon RM50/RM50/difference RM0; Auto
  RM180/RM180/difference RM0
- Result: PASS for executed and seeded financial traces; refund/discount coverage
  remains open

## Reload / Duplicate UI Smoke

- Refresh after payment: PASS — Auto checkout remained fully paid after reload
- Back/re-entry: PASS — returning to Checkout showed Invoice 1001 and RM0 balance
- Rapid submit: NOT RUN
- Duplicate invoice: none; Auto invoice count remained 1, Salon invoice count 2
  including the deterministic trace invoice
- Duplicate payment: none observed; re-entry had no payment action
- Result: PASS for reload/re-entry, incomplete for rapid-click acceptance

## 390px

- Observable viewport dimensions: BLOCKED — the requested 390 × 844 override was
  accepted by the browser capability but the page still reported 1280 × 721 CSS
  pixels and rendered a desktop screenshot
- Login: NOT RUN at observable 390px
- Customer: NOT RUN at observable 390px
- Appointment: NOT RUN at observable 390px
- Cashier: NOT RUN at observable 390px
- Split payment: NOT RUN at observable 390px
- Invoice: NOT RUN at observable 390px
- Refund: NOT RUN at observable 390px
- Reports: NOT RUN at observable 390px
- Closing: NOT RUN at observable 390px
- Auto: NOT RUN at observable 390px
- Horizontal overflow: NOT VERIFIED
- Tap targets: NOT VERIFIED
- Result: BLOCKED BY UAT BROWSER CAPABILITY; not reported as a product failure or
  mobile PASS. The temporary viewport override was reset.

## UI/UX — Cashier

- Workflow clarity: canonical service checkout policy is explicit and points staff
  back to Appointment checkout
- Payment clarity: amount, method, paid state and remaining balance were clear
- Error clarity: frozen-day shift error explained why the cashier could not start
  another shift
- Branch clarity: Branch A was visible in Closing and financial context
- Friction: owner/cashier run order closed the business day before the Cashier full
  flow; this is fixture sequencing, not a confirmed product defect
- Result: PASS for observed desktop clarity; complete Cashier/mobile acceptance is
  still open

## UI/UX — Owner

- Reports: Owner can answer what sold, how it was paid and which payment method
  contributed
- Refund trace: automated UI contracts pass; no live refund was created here
- Closing: frozen status, expected/actual cash and difference are explicit
- Branch clarity: Owner could select Branch A/B; Manager all-branch behavior differs
- Result: PASS for executed desktop Owner chain with remaining live-flow gaps

## New Defects Found

### P0

- None.

### P1

- No confirmed P1 product defect.
- Acceptance blocker: an observable 390 × 844 browser run remains unavailable.
- Acceptance blocker: complete Cashier, live customer create/edit, live refund,
  live discount, live package and live split-payment journeys remain unexecuted.

### P2

- `UAT Salon Manager` has `ALL_BRANCHES`, but the operational Closing branch list
  exposed only Branch A. Suspected boundary: staff operational branch resolution
  in `src/lib/branches.ts` does not consume the granted permission. No remediation
  was attempted in this UAT closure.

### P3

- None newly confirmed.

## Final Gates

- Fixture tests: PASS — 3/3
- Focused POS/Reports/Closing/Auth unit tests: PASS — 65/65
- Auth/permission/Closing disposable integration: PASS — 10/10
- TypeScript: PASS
- Production build: NOT REQUIRED — no POS business code changed; fixture/test/docs
  only
- ESLint: PASS for changed fixture/test files
- Diff check: PASS for changed fixture/test/package files
- Fixture status: PASS — Local-only database, expected business/persona IDs and
  stable counts
- Repeated seed after payment: PASS — Auto work order remained paid; no audit state
  was reset

## Files Changed

- `package.json` — Local UAT seed/reset/status commands
- `scripts/lib/pos-core-uat-contract.ts` — fixture lookup keys and execution guard
- `scripts/prepare-pos-core-uat-fixtures.ts` — isolated idempotent Salon/Auto fixture
  preparation and status output
- `tests/unit/pos-core-uat-fixture-contract.test.ts` — guard and password tests
- `docs/TETAMU_POS_CORE_FINAL_BLOCKED_BROWSER_UAT_CLOSURE.md` — this frozen report

No POS, Reports, Closing, payment, refund, invoice or Production business logic was
changed by this task.

## Production

```text
NOT ACCESSED
```

## FINAL VERDICT

```text
TETAMU POS CORE
→ FUNCTIONAL READY ✅
→ FINANCIAL READY ✅
→ SECURITY READY ✅
→ DESKTOP EXECUTED PATHS READY ✅
→ COMPLETE UI/UX ACCEPTANCE NOT YET CLOSED
→ MOBILE READY NOT PROVEN
→ LOCAL UAT FIXTURES READY ✅

PRODUCTION CANDIDATE
→ NO

PRODUCTION VALIDATED
→ NO

Overall Status
→ REVIEW REQUIRED
```

Stop POS Core development here. Do not deploy Production. The next activity is a
separate observable 390 × 844 UAT plus the remaining explicitly listed browser
journeys, not a POS Core redesign.
