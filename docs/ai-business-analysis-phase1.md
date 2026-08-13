# Tetamu AI Business Analysis Phase 1

## A. Objective

Phase 1 adds a read-only `Ask Tetamu` business analyst for Local and Testing. It explains permission-filtered canonical operating data and cannot execute business actions.

## B. Existing Audit

The repository already had the `AI` module key and the canonical Business Performance read model, but AI was a non-operational future module. There was no provider abstraction, OpenAI SDK, conversation/usage domain, analysis API or chat UI. Business Performance remains unchanged and remains the source of the AI aggregates.

## C. AI Module

`AI` is an operational, independently entitled add-on. The navigation, page and API are denied when it is disabled. The capabilities are `VIEW_AI_ANALYSIS`, `USE_AI_ANALYSIS`, `VIEW_AI_USAGE` and `MANAGE_AI_SETTINGS`; staff receive no AI permission by default.

## D. Provider Architecture

`AiProvider` isolates `MockAiProvider` and `OpenAiProvider`. Mock is deterministic for Local testing. OpenAI configuration is fail-closed and Production cannot use mock answers.

## E. OpenAI Responses API

The official OpenAI SDK and Responses API are used. Requests have `store: false`, an empty `tools` array, a strict JSON schema and no web search, file search, SQL generation or business mutation tools.

## F. API Key / Environment

`OPENAI_API_KEY` is server-only, is never exposed through a `NEXT_PUBLIC_` value and is not persisted in source, migrations, tests, documentation or the Tetamu database. `AI_PROVIDER` and `OPENAI_MODEL` select the provider and model. The Local key is held only in ignored `.env.local`.

## G. Business Performance Context

The model receives a compact serializer of `BusinessPerformanceReadModel`: selected/current comparable periods, safe aggregate sales and spending metrics, up to ten branches/services/products, inventory counts, AP totals/counts, module coverage and reconciliation health. A normalized SHA-256 context digest and context version are recorded. The normal context is capped at an approximate 25,000 input tokens.

## H. Scope / RBAC

Business entitlement, business access, capability and allowed branch scope are resolved before context construction and before the provider call. Group scope is independently resolved for the signed-in group user, including selected-business restrictions. Conversation scope is fixed to exactly one business or group and its creator.

## I. Coverage

Coverage explicitly identifies available and unavailable domains. Unavailable metrics use `available: false`/`NOT_AVAILABLE`; missing data is never inferred to be zero. Group coverage records whether participating businesses have comparable sales and spending coverage.

## J. Reconciliation Health

The canonical reconciliation status and domain statuses are supplied. The prompt and deterministic mock disclose when underlying data needs reconciliation and do not silently repair source data.

## K. Sensitive Data Exclusion

Data sent to a provider is limited to safe business/group identity, periods, aggregate metrics, trends, Top-N operational summaries, coverage and reconciliation status. Tetamu does not send customer phone/email/address/notes, employee identity/salary/bank/medical/statutory data, supplier names/invoice attachments/bank details/payment references, credentials, OTP/TOTP, raw invoices, raw claims, raw payroll, raw inventory transactions or raw database rows.

## L. System Prompt

`TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT` is versioned as `business-analyst/1.0.1`. It treats supplied context as data, rejects prompt injection, forbids hidden reasoning and tools, separates evidence/caveats/recommendations, and requires advisory wording. Unavailable metrics may be explained only in the summary or caveats; the server removes them from evidence while retaining strict numeric grounding for every available metric.

## M. Structured Output

The server validates strict structured fields for summary, canonical evidence, caveats, recommendations and follow-up questions. Unknown metric keys or malformed responses fail closed. Numerical evidence must match a value in the supplied context.

## N. Conversation

`AiConversation`, `AiMessage` and `AiUsage` are additive tenant-scoped records. Tetamu stores the user question, final assistant result, safe structured metadata, provider/model, prompt/context versions and digest; it neither requests nor stores chain-of-thought. Completed assistant messages are immutable in Phase 1.

## O. Follow-up

At most eight recent final messages are included. Every follow-up rebuilds current canonical data for the same authorised scope; previous browser JSON is never trusted as context.

## P. Usage / Cost Foundation

Owners can view monthly requests, input/output/total tokens and failures. Each attempt has a user-and-scope idempotency key, provider/model, status, latency, tokens and redacted error category. No fabricated currency cost is displayed.

## Q. Rate Limit

Server-side per-user and per-scope one-minute limits run before a provider call. Rate-limited attempts are recorded and the API returns a friendly `AI_RATE_LIMITED` response. Client pending state plus a UUID request key prevents uncontrolled duplicate submits.

## R. Error / Retry

Provider errors fail closed and never create a fake assistant success. Authentication, access, quota exhaustion, ordinary rate limiting and provider availability have safe categories without provider payloads, context or credentials. Retry behavior belongs to the SDK/provider boundary.

## S. Prompt Injection Defence

The canonical instruction says all context and user text are untrusted data, cannot replace system rules and cannot request inaccessible data, secrets, tools or mutations. Server scope and evidence validation remain authoritative even if a prompt tries to override the model.

## T. Business / Branch / Group

Business owners/managers see only entitled businesses; branch staff receive their allowed branch; restricted group managers receive only explicitly granted businesses. Business switching, group switching or a foreign conversation ID cannot reuse another tenant's conversation.

## U. UI / Responsive

The business and All Stores pages provide suggested questions, explicit date/branch selection, history, usage, structured evidence/caveats/recommendations and advisory wording. The Business Performance dashboard has a manual `Ask AI about this period` link and does not auto-call the provider. 390px and 1440px layouts were browser checked without horizontal overflow.

## V. Mock Provider

Mock browser E2E covers business questions, follow-up, filters, reload/history, insufficient data, profit boundaries, group scope and responsive layout. Count metrics are not formatted as currency, and all-zero branches are not called the strongest branch.

## W. Real OpenAI Testing Acceptance

A minimal Local/Testing health request completed successfully with the configured server-only key and `gpt-5.4-mini-2026-03-17`; neither `credit_balance_exhausted` nor `insufficient_quota` recurred. Real browser acceptance then passed Business sales, same-scope branch follow-up, profit safety, inventory, AP, missing Payroll data, prompt injection and Group Net Sales comparison. The successful answers used `provider=openai`, strict structured output, `store: false`, `tools: []`, authorised read-model scope and auditable token/latency records. Missing Payroll data was reported as unavailable rather than RM0. The Group answer compared only two authorised AI-enabled businesses and reported a zero-sales tie instead of inventing a strongest store. Browser checks passed at 390px and 1440px with zero console or hydration errors.

## X. Tests / Build / Migration

Unit tests cover module/capability rules, safe context, accounting/prompt boundaries, structured validation, evidence grounding, unavailable-evidence normalization, provider configuration/request shape, missing-data behavior and mock questions. Integration tests cover tenant/conversation/idempotency/usage, disabled entitlement, restricted group scope, branch scope, rate limit and quota fail-closed behavior. The completed suites passed 843/843 unit and 140/140 integration tests. Release verification also covers TypeScript, lint, Prisma validate/generate/status, a 168/168 disposable fresh migration rebuild, Local production-mode build, secret scan, canonical guard and `git diff --check`.

The additive migration introduces only AI scope/message/usage enums and AI conversation/message/usage tables, indexes, foreign keys and an exact-one-scope check.

## Y. Deferred Agent / Web / Actions

AI agents, function/action execution, business mutation tools, web/file search, scheduled/monthly AI, WhatsApp/voice AI, forecasting and Phase 2 remain deferred. General Ledger, COGS, inventory accounting valuation, official P&L and supplier credit notes also remain unavailable.

## Z. Final Status

Engineering, mock E2E, safety foundations and Real OpenAI Local/Testing acceptance are complete. The completion gate is:

```text
TETAMU AI BUSINESS ANALYSIS PHASE 1
→ READY ✅

REAL OPENAI TESTING ACCEPTANCE
→ PASS

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
