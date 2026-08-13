# TETAMU COMMERCIAL / PRICING FOUNDATION PHASE 1

## A. Objective

This phase introduces a Local/Testing commercial configuration source so prices, product bundles and allowances can change through Platform Admin without hardcoded market-price deploys. It does not collect payment.

## B. Existing Commercial Audit

No canonical plan, subscription, promotion, pricing or renewal model existed. `BusinessModuleEntitlement` and its event history were READY; the module registry/dependency graph was READY; Business/Group `AiAllowancePolicy` and quota enforcement were READY; Business Group and Platform Admin RBAC were READY. Commercial plans, subscriptions and branch/employee commercial limits were MISSING. These foundations are reused rather than replaced.

## C. Domain Boundaries

`PRICE ≠ MODULE ENTITLEMENT ≠ RBAC ≠ AI QUOTA ≠ PAYMENT`. Commercial configuration describes the contract and included limits. Existing module entitlements remain the product-access source, RBAC remains user authorization, existing AI allowance remains quota authority, and payment is deferred.

## D. Commercial Plan

`CommercialPlan` has stable code, display identity, BUSINESS/GROUP scope, BASE/ADD_ON type and catalog availability. Only active Platform Admin users mutate commercial data.

## E. Base vs Add-on

A subscription has exactly one active BASE item and zero or more ADD_ON items. Database partial unique indexes prevent concurrent active-base duplication. Combined SKU permutations are not created.

## F. Plan Version

`CommercialPlanVersion` stores MYR prices in integer cents, interval-specific list prices, setup-fee metadata, branch/employee allowances, optional unit prices, AI allowances, effective dates and canonical module links. DRAFT can be prepared; ACTIVE/RETIRED commercial facts are protected by database triggers, with only ACTIVE→RETIRED lifecycle transition permitted.

## G. Versioned Pricing

Market price changes create a new version. Existing subscription items remain pinned to their original version; retiring a catalog version does not migrate existing customers. Null price means `PRICE_REVIEW_REQUIRED`; an explicit zero means free.

## H. Module Bundles

Version modules reference `BusinessModuleKey` and validate the existing module dependency registry. CORE remains system-enabled. Payroll is not present in the Local initial commercial catalog because statutory product governance remains incomplete.

## I. Business Subscription

Business subscriptions are scoped to exactly one Business, store explicit start/renewal/end dates and interval snapshot, and are manually maintained by Platform Admin. Business Owners receive a read-only current-plan view.

## J. Group Subscription

Group subscriptions are independent rows bound to a Business Group. Group AI allowance and commercial price do not multiply by store count and do not alter Business quota. Group Owners have a read-only current-plan route.

## K. Subscription Items

Items pin Plan Versions and preserve BASE/ADD_ON, quantity, effective dates and status. Scheduled base changes end the old item and append a new active base item; history is retained.

## L. Monthly / Annual Pricing

MONTHLY and ANNUAL are configured independently. Annual price is not derived from monthly price. Money calculation uses integer cents and avoids JavaScript floating-point amounts.

## M. Setup Fee Metadata

Setup fee is commercial metadata only. It creates no invoice, receivable or payment.

## N. Promotion

Platform-controlled PERCENT (basis points) and FIXED_AMOUNT promotions are effective-dated, eligible-version scoped and non-stacking. They preserve list price and show a separate discount.

## O. Customer Override

Typed, effective-dated overrides support PRICE, BRANCH_ALLOWANCE, EMPLOYEE_ALLOWANCE, BUSINESS_AI_ALLOWANCE and GROUP_AI_ALLOWANCE. A reason is mandatory, revisions are immutable history, and expiry safely returns to the normal calculation.

## P. Effective Price

`list subtotal → eligible promotion → explicit fixed price override`. Fixed price override has final precedence and prevents promotion stacking. Effective price is a commercial quote/contract fact, not paid amount.

## Q. Branch Allowance

Only ACTIVE branches count. Branch creation re-reads the canonical subscription inside the transaction under a scope advisory lock. At capacity it throws `COMMERCIAL_BRANCH_LIMIT_REACHED`. A downgrade never deletes or disables existing branches; it reports OVER_LIMIT and blocks growth.

## R. Employee Allowance

Only ACTIVE `EmployeeBusinessMembership` records count. New employees and reactivation are guarded in their canonical transaction. Termination, suspension and deactivation remain allowed. Over-limit downgrade preserves all employees and blocks growth.

## S. AI Allowance Integration

Base and add-on AI allowances aggregate into a new effective-dated `AiAllowancePolicy` with source PLAN. The existing quota reservation, period, usage and immutable event ledger remain the only runtime counter. Existing precedence is explicit: PLATFORM_OVERRIDE > TRIAL > PLAN > OTHER. Group and Business scopes remain isolated.

## T. Module Entitlement Projection

Commercial projection appends `BusinessModuleEntitlementEvent` history and updates the existing canonical entitlement row with source PLAN. RBAC assignments are not created or deleted. Downgrade denies future module access without deleting customer domain data.

## U. Legacy / Grandfathering

Existing businesses are not assigned guessed prices. Absence of a commercial subscription produces `LEGACY_REVIEW_REQUIRED` / `LEGACY_PRICE_REVIEW_REQUIRED`; existing entitlement rows continue to work. Missing price is never interpreted as RM0.

## V. Reconciliation / Audit

`reconcileCommercialState()` compares effective pricing, branch/employee counts, module projection and AI PLAN policy. States include MATCH, OVER_LIMIT, ENTITLEMENT_MISMATCH, AI_ALLOWANCE_MISMATCH, PRICE_REVIEW_REQUIRED and LEGACY_REVIEW_REQUIRED. Commercial command keys provide idempotency; serializable transactions, advisory locks and database uniqueness protect concurrent writes. Controlled projection repairs only derived entitlement/policy facts and never invents a price.

## W. Security / Platform Admin

Every commercial mutation service and route enforces active PLATFORM_ADMIN server-side. Business and Group owner views are read-only and scoped through current authenticated tenant/group authorization. Commercial pages do not load payroll salary, bank details, receipts or unrelated customer PII.

## X. Browser / Tests / Migration

The migration is additive and introduces commercial enums/tables, scope checks, value checks, indexes, active subscription/base uniqueness and immutable version triggers. Local browser acceptance covers desktop Commercial Center and mobile owner views; final gate results are recorded in the final task report.

## Y. Deferred Payment / Billing / SST

No Stripe, FPX, DuitNow, card, auto-debit, Public Bank, merchant invoice, tax invoice, receipt, revenue, GL, SST, proration, public pricing sync or self-service paid upgrade is implemented. Group per-business unit pricing is deferred.

## Z. Final Status

Status is determined only after targeted/full tests, migration rebuild, build and Local browser acceptance. All work is Local/Testing only; Production is not accessed or validated.

### Required Final Matrix

| Gate | Result |
| --- | --- |
| Canonical Plan / immutable versions | PASS |
| BASE + post-subscription ADD_ON | PASS |
| Monthly / annual / setup metadata | PASS |
| Customer A v1 RM169 / Customer B v2 RM199 | PASS |
| Promotion / typed override / expiry | PASS |
| Branch / employee transaction limit | PASS |
| AI PLAN allowance projection | PASS |
| Module entitlement projection | PASS |
| Legacy review-required, never RM0 | PASS |
| Tenant / Group / Platform Admin scope | PASS |
| Idempotency / concurrency / reconciliation | PASS |
| Browser E2E / console / hydration | PARTIAL — functional flow and zero-error fresh tab PASS; requested 390px viewport override remained 1280px in the in-app browser backend |
| Unit / Integration / TypeScript / Lint | PASS |
| Prisma validate / generate / status / fresh rebuild | PASS |
| Local production-mode build | PASS |

Browser acceptance covered plan creation and activation, Customer A pinned to v1 RM169, Customer B assigned v2 RM199, effective RM159 override, post-subscription AI Power add-on aggregation to 350 Ask, branch-capacity blocking with a safe form error, pagination, and a fresh-tab console/hydration check with zero errors. Shared responsive form-grid and table-wrap primitives are present, but the in-app browser viewport override continued to report 1280px; a true 390px browser run remains unverified.

Final status: `TETAMU COMMERCIAL / PRICING FOUNDATION PHASE 1 → PARTIAL` until the 390px browser acceptance is executed in a backend that honors the viewport override.

LOCAL / TESTING ONLY. PRODUCTION NOT ACCESSED. PRODUCTION NOT VALIDATED.
