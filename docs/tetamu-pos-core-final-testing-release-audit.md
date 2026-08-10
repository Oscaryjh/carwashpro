# TETAMU POS CORE — FINAL TESTING RELEASE AUDIT

Audit date: 2026-08-09 (Asia/Singapore)

Environment declaration:

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

## A. Executive Summary

The current canonical workspace and the deployed Testing Web revision are aligned at `ce2188852cd2ff409f970edf12a0fe5144eca059`. The accumulated evidence, fresh authenticated browser smoke checks, deterministic financial fixtures, targeted regressions, full automated suites, build, schema validation and a zero-to-latest migration rebuild support a final Testing release decision.

No open Critical or High POS Core defect was found. Salon and Auto core flows, single-business and multi-branch access, Business Group reporting, financial safety, authentication hardening, tenant/RBAC boundaries, and WhatsApp mock mode meet the Testing release gate.

WhatsApp Testing live delivery was deliberately not executed. `AUTH_TRUST_PROXY_HOPS` remains a Testing infrastructure configuration/verification item; the current effective default is `0`, which ignores forwarded client IP headers and therefore fails safely.

## B. Environment Boundary

- Workspace: `C:\CodexTetamuP0`
- Git root: `C:/CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- HEAD: `ce2188852cd2ff409f970edf12a0fe5144eca059`
- Canonical workspace guard: PASS
- `git diff --check`: PASS
- Pre-existing unrelated untracked zero-byte file `p.())`: preserved and not modified
- Testing Web deployment `9c924578-38ad-46a6-b871-9d15d2068eea`: SUCCESS
- Testing login URL: HTTP 200
- No Production environment, deployment, database, variables, account, payment or WhatsApp action was accessed or executed.

## C. Evidence Reviewed

The audit reviewed the current code and these canonical evidence records:

- `docs/pos-authenticated-e2e-two-day-business-simulation.md`
- `docs/pos-financial-idempotency-production-hardening.md`
- `docs/pos-authentication-security-hardening.md`
- `docs/whatsapp-testing-hardening.md`
- `TETAMU_POS_PROJECT_STATUS.md`

`TETAMU_POS_PROJECT_STATUS.md` is an older 2026-08-08 baseline audit. Its then-open idempotency, authentication and WhatsApp fail-open findings are historical findings superseded by the later hardening evidence and the current regression results; it is not treated as current-state proof by itself.

## D. Salon

Status: **TESTING RELEASE READY**.

Authenticated Owner, Manager and Cashier paths were exercised through the normal login form without an authentication bypass. The current smoke verified Salon cashier access, role-specific navigation, manager reporting access, cashier denial of direct business-settings access, and product selection from the cashier UI. The canonical two-day Salon simulation and post-auth financial fixture remain exactly reconciled.

## E. Auto

Status: **TESTING RELEASE READY**.

Authenticated Auto Owner access loaded the Work Orders/Cashier workflow and CRM navigation without a visible application error. Existing evidence covers customer/vehicle/work-order creation, checkout, invoice/payment, shift close and two-day reconciliation.

## F. CRM

Status: PASS.

Customer isolation is tenant-scoped. Malaysian phone input accepts common `+60`/local formats and stores the canonical local representation. Branch selection reads the submitted branch identity and server authorization determines the trusted business/branch scope.

## G. Appointment

Status: PASS for Salon core.

The evidence covers appointment creation, service completion, mixed sale items, payment/checkout, cancellation/no-show rules, employee assignment eligibility and business-timezone handling. Service payments support partial payment and protect non-cash reference requirements.

## H. Vehicle / Work Order

Status: PASS for Auto core.

Vehicle/customer ownership remains business-scoped. Work-order state, service completion, checkout and payment are distinct, and payment cannot silently change the work-order state machine. Current authenticated smoke displayed the Auto work-order table and an existing QA work order.

## I. Catalog / Product / Package

Status: PASS.

Service, Product and Package cashier paths are represented independently. The fresh browser smoke selected a real product from the Products tab. Package purchase, customer binding, benefit limits, multi-service rules, vehicle-size eligibility and accounting behavior are covered by unit/integration and prior browser evidence.

## J. Cashier

Status: PASS.

Salon and Auto authenticated cashier paths are available. Financial mutations use durable operation keys and payload fingerprints. The current UI renders service, product and package sale entry paths; a service requires an appointment while product and package sales remain independently reachable.

## K. Payment / Invoice / Refund

Status: PASS.

Payment, invoice and refund behavior is protected by tenant/branch scope, integer-cent accounting, unique operation identity, payload-conflict detection and transaction boundaries. Monetary refunds are recorded on their own business date and restored package usage is not misclassified as a cash refund.

## L. Financial Idempotency

Status: PASS.

Targeted and full integration tests verified replay-once behavior, payload conflict rejection, rollback safety, tenant/branch isolation, concurrent full-payment protection, concurrent final package redemption and a bounded 20-operation multi-branch stress run. The serialization/unique-constraint diagnostics printed during these tests are deliberately induced concurrency paths that were caught and retried; all assertions passed.

## M. Closing

Status: PASS.

Post-auth Local evidence remains exact:

| Business | Gross | Refund | Net | Expected cash | Closing cash | Difference |
|---|---:|---:|---:|---:|---:|---:|
| Salon post-auth fixture | RM88.00 | RM0.00 | RM88.00 | RM88.00 | RM88.00 | RM0.00 |
| Auto post-auth fixture | RM150.00 | RM0.00 | RM150.00 | RM150.00 | RM150.00 | RM0.00 |

The two-day business simulation remains exact:

| Business / day | Gross | Refund | Net | Difference |
|---|---:|---:|---:|---:|
| Salon Day 1 | RM400.00 | RM20.00 | RM380.00 | RM0.00 |
| Salon Day 2 | RM20.00 | RM20.00 | RM0.00 | RM0.00 |
| Auto Day 1 | RM80.00 | RM0.00 | RM80.00 | RM0.00 |
| Auto Day 2 | RM0.00 | RM0.00 | RM0.00 | RM0.00 |

Business-day calculation uses each store's IANA timezone and cutoff (`Asia/Kuching`, `02:00` in the verified fixtures).

## N. Dashboard / Reports

Status: PASS.

Reports aggregate integer-cent sales, payment, refund, package and operational measures with bounded date ranges and canonical business-day boundaries. Authorization is resolved before report queries. The Dashboard route's use of the canonical Reports surface is intentional behavior, not a missing release surface.

## O. Multi-Branch

Status: READY.

Branch scope is revalidated server-side. Direct staff, all-branches staff, owner and manager scopes remain bounded to active branches in the current business. The two-day evidence includes branch switching and an empty branch/day with zero financial difference.

## P. Business Group

Status: READY.

Group owners and scoped group managers receive only current active memberships; unauthorized groups are not disclosed. All Stores access, KPI aggregation, Group Reports, event filters, pagination and tenant-safe business context switching passed targeted and full integration tests. Group Manager read-only limitations are intentional policy.

## Q. Authentication

Status: PASS.

The current browser audit used ordinary account credentials and server-issued sessions. The hardened path covers hashed limiter keys without account PII, same-origin mutation checks, bounded rotating cookies, replay/expiry/revocation/disabled-user rejection, safe relative redirects, live capability checks and server-side business-context revalidation.

## R. Tenant / RBAC

Status: PASS.

Owner, Manager and Cashier smoke checks confirmed role-appropriate navigation and denial. A Cashier requesting `/business/settings` was redirected without settings disclosure. Integration tests passed for tenant isolation, live business-context access/switching, multi-branch and Business Group authorization. No browser-visible 5xx or runtime error overlay was observed. Prior full E2E evidence recorded browser console errors as zero; the Local supervisor does not retain a durable server-log archive, so this audit does not claim a historical zero-5xx log search.

## S. WhatsApp

Status: **MOCK READY**.

Testing variables are present for the Web/Worker/Connector secret boundaries, and `WORKER_SEND_MODE=mock`. Mock mode deterministically blocks connector HTTP sends. Webhook authentication, request freshness/body limits, queue deduplication, durable attempts, tenant-scoped status progression, connector authentication, replay behavior and redacted audit logging passed regression tests. Connector tests passed 4/4 and its TypeScript build passed.

## T. Testing Configuration

Current Testing configuration evidence:

- Web session secret: configured and minimum length satisfied
- Webhook secret: configured
- Web-to-Connector API secret/URL: configured
- Worker mode: `mock`
- Worker-to-Connector secret/URL: configured
- Connector API/Webhook secrets: configured
- Connector incoming/receipt/history callback URLs: configured
- `AUTH_TRUST_PROXY_HOPS`: unset; effective secure default `0`

Classification: **`AUTH_TRUST_PROXY_HOPS — TESTING CONFIGURATION REQUIRED`** before Testing infrastructure claims proxy-derived client-IP enforcement. This is not a code release blocker because default `0` ignores forwarded headers instead of trusting unverified proxies; identifier and device controls remain active.

## U. Migration / Build

Status: PASS.

- Main Next.js optimized build: PASS, 103 pages generated
- TypeScript `--noEmit`: PASS
- ESLint: PASS with one existing `no-img-element` warning
- Connector TypeScript build: PASS
- Prisma generate: PASS
- Prisma schema validate with explicit Local-only validation URL: PASS
- Fresh disposable Local database rebuild: PASS, all 143 migrations applied from zero
- Secret scan: no tracked private-key or API-token pattern; only the two expected tracked `.env.example` templates matched sensitive filename rules

## V. Test Results

| Gate | Result |
|---|---:|
| Targeted Unit | 135/135 PASS |
| Targeted Integration | 14/14 PASS |
| Full Unit | 723/723 PASS |
| Full Integration | 91/91 PASS |
| WhatsApp Connector | 4/4 PASS |
| TypeScript | PASS |
| Lint | PASS with existing warning |
| Main build | PASS |
| Connector build | PASS |
| Prisma validate / generate | PASS |
| Fresh migration rebuild | 143/143 PASS |
| Canonical guard | PASS |
| `git diff --check` | PASS |

## W. Remaining Risks

- **Testing configuration:** verify proxy topology and set `AUTH_TRUST_PROXY_HOPS` only to the exact trusted hop count before relying on network IP-derived throttling.
- **Deferred external acceptance:** WhatsApp Testing live send/callback/reconnect was not executed; mock-mode readiness is not live-provider acceptance.
- **Non-blocking operations:** connector request replay response cache is bounded in memory; durable queue identity and deterministic provider message identity remain the restart-safe boundary.
- **Non-blocking operations:** add/confirm retention and purge operations for long-lived webhook/attempt history as volume grows.
- **Deferred feature:** a richer manual retry/operator UI remains outside this release gate.
- **Low:** one WhatsApp inbox `<img>` performance warning and two CSS `flex-end` compatibility warnings remain.
- **Medium, triage required:** package-manager dependency advisories reported in prior build work remain an upgrade/reachability review item; this audit found no demonstrated exploit path in the tested POS flows.
- Payroll/statutory, Public Bank adapter (`PUBLIC_BANK_SPEC_NOT_READY`), Claims, SAVT and AI integrations are separate scopes and do not block the POS Core Testing release.

## X. Release Blockers

Current POS Core Critical blockers: **0**.

Current POS Core High blockers: **0**.

No failure found in authentication, financial reconciliation, financial idempotency, tenant isolation, build or migration gates requires reopening POS Core feature development.

## Y. Handoff Recommendation

Stop POS Core feature development and preserve the tested baseline. Proceed in this order:

1. Testing handoff, including the explicit proxy-hop configuration verification.
2. Controlled customer pilot in Testing with real user roles and operational runbooks.
3. Separate Production-owner handoff. The Production owner must independently configure, deploy, migrate, validate and accept Production; none of those actions is part of this audit.

## Z. Final Status

```text
TESTING SALON E2E — PASS
TESTING AUTO E2E — PASS
TESTING 2-DAY BUSINESS SIMULATION — PASS
TESTING FINANCIAL RECONCILIATION — PASS

SALON POS CORE — TESTING RELEASE READY
AUTO POS CORE — TESTING RELEASE READY
SINGLE BUSINESS — READY
MULTI BRANCH — READY
BUSINESS GROUP — READY
FINANCIAL SAFETY — PASS
AUTH SECURITY — PASS
WHATSAPP MOCK — READY
WHATSAPP TESTING LIVE — NOT EXECUTED

TETAMU POS CORE — FINAL TESTING RELEASE READY
STOP POS CORE FEATURE DEVELOPMENT.

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

### Final Release Matrix

| Domain | Evidence | Status | Blocker? | Notes |
|---|---|---|---|---|
| Salon POS Core | Authenticated Owner/Manager/Cashier smoke, full E2E, two-day fixtures | TESTING RELEASE READY | No | Product tab independently verified |
| Auto POS Core | Authenticated Owner smoke, work-order UI, full E2E, fixtures | TESTING RELEASE READY | No | Work order and cashier route are unified by design |
| CRM | Unit, integration, E2E | PASS | No | `+60` normalization and tenant scope verified |
| Appointment | Unit, integration, E2E | PASS | No | Salon core workflow |
| Vehicle / Work Order | Unit, integration, E2E | PASS | No | Auto core workflow |
| Catalog / Product / Package | Unit, integration, browser | PASS | No | Product UI regression closed |
| Cashier | Browser, idempotency integration | PASS | No | Durable operation identity |
| Payment / Invoice / Refund | Integration, financial fixtures | PASS | No | Integer-cent and business-day accounting |
| Financial Idempotency | Concurrent/replay/stress integration | PASS | No | Replay, conflict, rollback, overpay protected |
| Daily Closing | Post-auth and two-day reconciliation | PASS | No | All verified differences RM0.00 |
| Dashboard / Reports | Unit/integration | PASS | No | Canonical Reports surface |
| Multi-Branch | Browser and integration | READY | No | Live branch authorization |
| Business Group | Access/KPI/report integration | READY | No | Live membership scope |
| Authentication | Browser and hardening tests | PASS | No | Normal login; no bypass |
| Tenant / RBAC | Role smoke and isolation integration | PASS | No | Cashier settings denial verified |
| WhatsApp Mock | Web/Worker/Connector tests and config | READY | No | Connector calls disabled in mock |
| WhatsApp Testing Live | Not authorized/executed | NOT EXECUTED | No for mock release | Separate external acceptance |
| Testing proxy topology | Config review | CONFIGURATION REQUIRED | No code blocker | Keep hop count `0` until verified |
| Build / Migration | Main/connector builds, Prisma, 143 migrations | PASS | No | Local-only execution |
