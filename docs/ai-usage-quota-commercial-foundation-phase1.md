# TETAMU AI USAGE / QUOTA / COMMERCIAL FOUNDATION PHASE 1

## A. Environment and workspace

This phase was implemented and verified in **Local / Testing only**. Production was not accessed, deployed, migrated, configured, or validated. The existing dirty worktree was preserved; no reset, destructive checkout, commit, or push was performed.

## B. Boundary audit

`Rate Limit`, `AI Allowance`, OpenAI provider billing, and future Tetamu customer billing remain separate concepts. `BusinessModuleEntitlement` continues to answer whether the AI module is enabled. New commercial allowance records answer how many AI requests a Business or Group may consume. OpenAI invoices and API credits remain provider-side facts and are not modelled as customer billing.

## C. Effective-dated policy

`AiAllowancePolicy` is append-only by revision and records exact scope, effective dates, request allowance, optional token telemetry limit, status, source, timezone snapshot, platform actor, reason, and audit history. Policies are never silently granted by migration. `ACTIVE`, `SUSPENDED`, and `EXPIRED` are explicit states.

Only an active `PLATFORM_ADMIN` can create a policy through the controlled service. Business owners and Group owners can view usage but cannot edit limits. The Local/Testing helper refuses Production execution and still routes writes through the authoritative service.

## D. Scope isolation

Business and Group commercial identities are independent:

```text
BUSINESS:<businessId>
GROUP:<groupId>
```

Database checks require exactly one matching tenant key. A Business allowance never funds Group analysis and a Group allowance never changes an individual Business allowance.

## E. Allowance period

Phase 1 uses calendar months in the policy's snapshotted IANA timezone. Business policies default to the canonical Business timezone. Group policies require an explicit deterministic timezone. Custom billing cycles are deferred.

## F. Hard request quota

Request allowance is a hard pre-provider gate. The server takes a transaction-scoped advisory lock for the commercial scope, locks/creates the month period, re-reads canonical counters, and reserves one request before context construction or provider execution. Serializable transaction conflicts retry safely.

```text
remaining = 1
N concurrent requests
→ exactly 1 reservation
→ N-1 AI_QUOTA_EXCEEDED
```

## G. Reservation lifecycle

```text
RESERVED → CONSUMED
RESERVED → RELEASED
```

A validated assistant answer consumes the request. Provider errors, schema validation errors, grounding failures, and other failures that produce no accepted assistant answer release the reservation. Released requests do not permanently consume commercial allowance.

## H. Idempotency

The canonical `requestKey` contains scope plus `clientRequestId` and is unique in both usage and quota reservation paths. A repeated completed request replays the existing assistant result. Concurrent duplicates cannot create a second reservation, provider call, or commercial consumption.

## I. Immutable ledger

`AiUsageEvent` is an immutable event ledger. The migration installs a database trigger that rejects UPDATE and DELETE. Events distinguish reservation, success, failure/release, and quota denial. Each terminal event records safe scope, user, conversation/usage references, provider/model, provider request id, tokens, latency, prompt/context versions, commercial-count flag, and safe error category.

## J. Telemetry versus consumption

The existing `AiUsage` remains technical request telemetry. Commercial counters count only consumed reservations and commercially counted success events. Mock calls remain technical usage with `commerciallyCounted=false` by default. `AI_MOCK_COMMERCIAL_COUNTED=true` exists only for deterministic Local/Testing quota tests.

## K. Token handling

OpenAI response usage captures input, output, and total tokens plus the provider request id. `AI_MAX_OUTPUT_TOKENS` defaults to 1200 and is bounded between 128 and 4096. `AI_MAX_CONTEXT_TOKENS` defaults to 25,000. Token allowance is Phase 1 soft telemetry because exact provider token usage is known only after completion; it is not used for unsafe pre-response hard billing.

## L. Gate order

```text
authentication / RBAC
→ scope authorization
→ module entitlement
→ rate limit
→ commercial policy and request quota
→ canonical context
→ provider
```

No browser value can bypass a server gate.

## M. Failure contract

- `AI_QUOTA_NOT_CONFIGURED`: no effective policy; fail closed.
- `AI_QUOTA_SUSPENDED`: the current policy is suspended.
- `AI_QUOTA_EXCEEDED`: the hard request allowance is consumed; HTTP 429.
- `AI_GLOBALLY_DISABLED`: the Local/Testing kill switch is off.
- Provider quota, auth, rate, and availability remain provider error categories and are not mislabelled as customer allowance.

## N. Owner UX

Business and Group Ask Tetamu pages show the current period's used/included requests, remaining requests, input/output/total tokens, reset date, and technical failures. When exhausted or not configured, the composer and suggestion buttons are disabled with a clear reason. Existing conversations remain readable.

## O. Reconciliation

`reconcileAiCommercialUsage` checks reserved and consumed period counters against reservations and immutable success events. It also detects commercially counted mock usage for review. It never changes counters automatically.

## P. Local real OpenAI acceptance

The existing Testing key was reused from ignored `.env.local`. It was not read, printed, copied, committed, or documented. No new key was created.

Business allowance:

```text
requestLimit = 2
request 1 → SUCCEEDED → used 1
request 2 → SUCCEEDED → used 2
request 3 → AI_QUOTA_EXCEEDED
provider calls for request 3 = 0
```

Captured real usage:

```text
Request 1: input 1374, output 714, total 2088
Request 2: input 1525, output 382, total 1907
Total: input 2899, output 1096, total 3995
```

Both real calls captured safe provider request identifiers. The third-request hard-block and ledger reconciliation passed. The Local service was then restored to the default mock provider.

## Q. Browser acceptance

The normal Local password login and `/ai` UI were used. The page displayed `0 / 2`, then `2 / 2`, remaining `0`, token totals, and the Malaysia-timezone reset date. Historical conversations remained available after exhaustion; all send controls were disabled. The real answers covered Sales and Supplier AP evidence without changing business data.

## R. Security

The API key remains server-only in ignored `.env.local`. Secret values never enter browser props, source files, docs, logs, or test output. Policy management records actor/reason/history. Production must use a separate OpenAI Project and key in a future Production-controlled task.

## S. Deferred

- Pricing and paid tiers
- Subscription checkout and billing account
- Stripe or payment provider
- OpenAI cost accounting and monetary margin
- Per-user/team sub-allowances
- Custom billing cycles
- Usage export/invoice
- AI Phase 2

## T. Final classification

```text
TETAMU AI USAGE / QUOTA / COMMERCIAL FOUNDATION PHASE 1
→ READY

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
