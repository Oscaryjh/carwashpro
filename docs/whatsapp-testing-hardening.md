# WhatsApp Testing Hardening

## A. Objective

This phase proves the following Local / Testing invariant:

```text
One completed business event
=
one durable logical WhatsApp message intent
```

The durable flow is `business event -> database queue -> atomic worker claim -> connector -> provider/device event -> authenticated replay-protected webhook -> monotonic database status`. WhatsApp delivery is asynchronous and cannot roll back an already committed POS transaction.

## B. Environment Boundary

- Scope: Local / Testing only.
- Acceptance send mode: `WHATSAPP_SEND_MODE=mock`.
- Production was not accessed, changed, migrated, deployed, sent to, or validated.
- Testing live delivery was not executed because no dedicated owned Testing sender/recipient and explicit live connector authorization were supplied.
- A production-mode Next.js build was executed locally; this is not a Production deployment.

## C. Existing WhatsApp Architecture

The existing architecture was retained. No second connector, queue, or status domain was invented.

| Flow | Source event | Queue identity | Send mode | Retry safe | Duplicate safe | Status safe | Restart safe | Security / risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Invoice | Paid invoice | `INVOICE_SENT:<businessId>:<invoiceId>` | Mock or explicitly configured live | Yes | Transactional unique intent | Monotonic receipt policy | DB queue and attempts | External delivery guarantee remains provider-dependent |
| Appointment reminder | Scheduled/rescheduled appointment | Existing appointment reminder key and occurrence | Mock or explicitly configured live | Yes | Existing unique dedupe and cancellation | Monotonic receipt policy | DB queue and attempts | Only supported appointment statuses enqueue |
| Ready for pickup | Work order enters Ready | `READY_FOR_PICKUP:<businessId>:<workOrderId>` | Mock or explicitly configured live | Yes | Transactional unique intent | Monotonic receipt policy | DB queue and attempts | Repeated save returns the canonical intent |
| Service confirmation | Work order confirmation | `SERVICE_CONFIRMATION:<businessId>:<workOrderId>` | Mock or explicitly configured live | Yes | Transactional unique intent | Monotonic receipt policy | DB queue and attempts | Recipient is normalized before enqueue |
| Daily closing | Frozen closing snapshot | Existing closing snapshot/event key | Mock or explicitly configured live | Existing bounded closing policy | Existing unique dedupe | Monotonic receipt policy | Frozen DB snapshot | Message body is frozen, not live-rendered later |
| Incoming/history | Connector webhook | Tenant/provider/event ID | Connector only | Reclaim failed/stale processing | Durable replay ledger | N/A | DB replay ledger | Shared-secret auth, freshness and body limits |
| Receipt | Connector receipt webhook | Tenant/provider/event ID | Connector only | Reclaim failed/stale processing | Durable replay ledger | Centralized state policy | DB replay ledger | Late duplicate/downgrade is audited without mutation |

Actual message-log states remain `DRAFT`, `OPENED`, `SENT_TO_SERVER`, `SENT_MANUALLY`, `DELIVERED`, `READ`, `FAILED`, and `CANCELLED`. Queue states remain `QUEUED`, `SENDING`, `SENT`, `SENT_TO_SERVER`, `DELIVERED`, `READ`, `FAILED`, and `CANCELLED`.

The connector is the existing multi-business Baileys connector. Sessions, status lookup, request identity and webhook payloads remain business scoped.

## D. Queue

`NotificationQueue` is the source of truth for outbound work. It now stores attempt count, safe error category, claim token, lease expiry and last-attempt timestamp. Indexes support ready-item selection, provider-message lookup, and stale-lease recovery.

The message body and attachments are stored when queued. Later template edits do not alter an existing queue item. Legacy queue/message rows are preserved; the migration does not manufacture replay or delivery history.

Queue and `WhatsAppMessage` creation for a stable business event are coordinated in a serializable transaction. If a concurrent request wins the unique dedupe key, the loser returns the canonical queue item and removes its uncommitted/orphan candidate log.

## E. Business Event Dedupe

Stable, tenant-scoped keys cover invoice, appointment, ready-for-pickup, service confirmation, customer welcome and closing flows. The database unique constraint is authoritative under reload, repeated server actions and concurrent requests.

Local browser evidence confirmed:

- Salon appointment checkout produced one Paid invoice, one `INVOICE_SENT` queue item, one message log and one send attempt.
- Auto `IN_PROGRESS -> READY_FOR_PICKUP` produced one queue item, one message log and one send attempt.
- Repeated repository enqueue with the same key returned the same queue identity and retained a count of one.

## F. Worker Claiming

Claiming uses a serializable transaction and an atomic `QUEUED -> SENDING` update conditioned on status, due time and remaining attempts. A UUID claim token is required to complete or fail the send. Two workers racing for one row produce one winner and one `null` claim.

Each successful claim creates exactly one `WhatsAppSendAttempt` with an incremented attempt number. A stale worker cannot complete another worker's lease because its claim token no longer matches.

## G. Retry Policy

Retry classification is explicit:

- Retryable: network/timeout, connector unavailable/not connected, HTTP 408/409/425/429 and 5xx.
- Final: invalid recipient, malformed request/template, missing/invalid authorization, missing configuration, HTTP 400/401/403/404/422 and unknown unclassified failures.

Ordinary message backoff is bounded at 30 seconds, 60 seconds, 5 minutes and 15 minutes, with a maximum of five send attempts. Existing closing-message retry limits remain in force. Retry exhaustion ends in `FAILED` with `RETRY_EXHAUSTED`; it does not remain permanently queued.

Manual retry UI is not implemented, so manual and double-click manual retry are not applicable in this phase.

## H. Connector Authentication

The connector keeps fail-closed shared-secret authentication:

- Missing configured secret: 503.
- Missing or wrong supplied secret: rejected.
- Exact secret: accepted.

Comparison is constant-time for equal-length candidate buffers. Secrets are accepted only in headers and are never logged or placed in URLs. No incompatible custom signing protocol was invented. A future live Testing endpoint must still use TLS plus the shared secret, request ID and replay controls.

## I. Webhook Authentication

Incoming, receipt and history routes preserve the existing constant-time shared-secret gate:

- Missing server configuration: 503.
- Missing/wrong credential: 401.
- Correct credential: request proceeds to freshness, body and replay validation.

Authentication occurs before semantic mutation. Payload limits are 256 KiB for receipts and 12 MiB for incoming/history sync. Raw request bytes are fingerprinted before parsed data is used.

## J. Replay Protection

The connector emits deterministic opaque event IDs and a request timestamp. The application requires both headers, rejects events outside a five-minute freshness window, and stores a tenant/provider-scoped replay record containing event identity, fingerprint, provider occurrence time, receive times, outcome and duplicate count.

The same event ID and payload is one logical effect. Reuse of an event ID with different raw bytes is rejected with 409. Failed processing and processing stale for two minutes can be reclaimed safely.

Webhook replay records define a 30-day retention window through `expiresAt` and an index. Automated purge is intentionally deferred. Send-attempt rows remain attached to queue/business audit history; an automated purge policy is also deferred rather than silently deleting evidence.

## K. Status State Machine

`planWhatsAppStatusTransition` is the centralized policy. Normal progression is `QUEUED -> SENDING -> SENT_TO_SERVER -> DELIVERED -> READ`. Failure is allowed only before a delivered/read fact exists. `CANCELLED` remains terminal under delivery callbacks.

The policy distinguishes `ADVANCED`, `FACT_COMPLETED`, `DUPLICATE`, and `IGNORED_DOWNGRADE`. Receipt ledger outcomes distinguish `APPLIED`, `NO_MATCH`, `DUPLICATE_STATUS`, and `IGNORED_DOWNGRADE`.

Queue, message-log and inbox-chat state updates are tenant scoped. Duplicate callbacks do not rewrite timestamps. Provider occurrence time and server receive time are separately recorded in the webhook ledger.

## L. Out-of-order Events

- `READ` may arrive before `DELIVERED`; the state advances to `READ` while filling an absent delivered fact once.
- A late `DELIVERED` or `SENT_TO_SERVER` cannot downgrade `READ`.
- A late `FAILED` cannot downgrade `DELIVERED` or `READ`.
- Repeated `DELIVERED`/`READ` does not mutate the existing timestamp.

Technical lifecycle timestamps are stored as UTC instants. Closing/report business dates continue to use business timezone rules independently.

## M. Message Attempts

`WhatsAppSendAttempt` records each claim with attempt number, claim token, start/completion, status, retryability, safe error category/message and provider message ID when obtained. Attempt history is append-oriented; the queue's latest error no longer replaces all historical evidence.

The tested retry path records attempt 1 as `RETRY_SCHEDULED` and attempt 2 as `SENT_TO_SERVER`. Lease exhaustion records `FAILED_FINAL`.

## N. Crash / Restart Recovery

`SENDING` rows have a two-minute lease. The worker recovers expired leases before reading ready work. Recoverable rows return to `QUEUED`; exhausted rows become `FAILED`.

Local process evidence covered both cases:

- The notification worker was stopped, a message was queued, and the restarted worker claimed/sent it once in mock mode.
- A synthetic expired in-flight claim became `WORKER_LEASE_EXPIRED / RETRY_SCHEDULED`; a second attempt sent it successfully. The logical queue identity did not change.

Queued, attempt and delivery state are database backed. Connector request-response replay caching is intentionally bounded memory, but the queue request ID and deterministic provider message ID remain stable across connector restart.

## O. Template Snapshot

Managed templates now require every referenced variable key, a non-empty result and no unresolved placeholder. Broken content such as `Hello {{customerName}}` cannot be queued as a rendered message.

Industry validation remains intact: Salon templates do not require vehicle-only fields, while Auto templates may use vehicle fields. The queue stores the rendered body. An integration test edited the active template after enqueue and confirmed the queued body remained unchanged.

## P. Phone Normalization

Outbound queue recipients normalize Malaysian local and `+60` forms to the same canonical digits. Numbers must contain 8-15 digits after normalization. Safe direct JIDs ending in `@s.whatsapp.net` or `@lid` remain supported.

Malformed/short recipients do not enter infinite retry. They are rejected before enqueue or classified as final `INVALID_RECIPIENT`/HTTP 422 by the connector.

## Q. Invoice

Invoice notification identity is `INVOICE_SENT:<businessId>:<invoiceId>`. The message body, invoice association and PDF attachment are frozen at enqueue. Notification creation happens after the financial operation commits and `sendInvoiceIfConnected` contains notification failure, so WhatsApp cannot roll back payment/invoice state.

Authenticated Local browser acceptance produced a Paid RM88.00 Salon invoice, a completed financial operation, exactly one message log/queue item, and one successful mock attempt.

## R. Appointment

Existing appointment scheduling/rescheduling/cancellation semantics were preserved. Reminder integration tests confirmed tenant scope, due-time calculation, dedupe, cancellation and safe rescheduling. Managed appointment templates are required-variable validated before queueing.

## S. Ready for Pickup

Ready notification identity is `READY_FOR_PICKUP:<businessId>:<workOrderId>`. A repeated status save cannot create a second logical notification. Authenticated Local browser acceptance changed an Auto QA work order to Ready and observed exactly one message log/queue item and one successful mock attempt.

## T. Closing Report

The existing closing automation remains bound to a frozen `DailyClosingSnapshot`, branch/business day and stable closing dedupe key. Tests confirm phone normalization, language rendering, recipient dedupe, mock-mode isolation and closing retry behavior. Later transaction/catalog changes cannot re-render the stored queue text.

## U. Tenant Isolation

All queue claims resolve their business from the stored queue row. Webhook replay identity is unique by business, provider and event key. Receipt lookup requires `businessId + providerMessageId`; a Business A callback cannot mutate Business B even if the provider message ID matches.

Send attempts have a composite queue/business foreign key. Webhook events have a business foreign key and indexed tenant identity. Existing connector session state remains isolated by business ID.

## V. Security Logging

Security/audit signals cover authentication rejection, replay/different-payload rejection, duplicate event count, status downgrade outcome, lease expiry, retry category and exhaustion.

The connector logger centrally redacts recipient phone/JID, message body/media, auth paths, raw provider update/attributes, errors and lookup objects. API errors expose safe categories/messages instead of raw stacks. Secrets, message bodies and unnecessary customer PII are not logged.

## W. Testing Live Acceptance

```text
WHATSAPP SEND MODE: MOCK
TESTING LIVE ACCEPTANCE: NOT EXECUTED
```

No live message was attempted. No dedicated Testing WhatsApp account/owned recipient and no explicit live-send authorization were available. `NOT EXECUTED` is an environment boundary, not a fabricated failure.

## X. Tests

- Unit: 723/723 passed.
- Integration: 91/91 passed.
- Connector: 4/4 tests passed; connector TypeScript build passed.
- Authenticated Local browser: platform admin login, Salon POS/queue, Salon checkout/invoice/queue, and Auto ready/queue passed.
- Local worker restart and expired in-flight lease recovery passed in mock mode.
- TypeScript: passed.
- Lint: passed with one existing WhatsApp inbox `<img>` warning.
- Local production-mode build: passed; only existing lint/autoprefixer warnings.
- Prisma validate and generate: passed.
- Fresh rebuild: all 143 migrations applied to a disposable database.
- Secret scan: no matched secret/private-key files.
- Canonical workspace guard: passed at final handoff.
- `git diff --check`: passed at final handoff.

## Y. Remaining Risks

- Internal logical intent dedupe is database enforced. External WhatsApp delivery is not claimed to be exactly once. The connector reuses the queue request ID and a deterministic Baileys message ID, but formal duplicate suppression after a provider accept/response-loss event remains dependent on Baileys/WhatsApp provider behavior.
- Connector request replay responses use a bounded 24-hour, 1,000-entry in-memory cache. Restart loses cached responses, while the durable queue identity and deterministic provider message ID remain stable.
- Webhook replay rows define a 30-day expiry and send attempts retain audit evidence, but automated purge jobs are deferred.
- Testing live send, provider acceptance and delivered/read callback acceptance remain not executed until a dedicated controlled Testing account and recipient are authorized.
- Manual retry UI is not implemented; future manual retry must reuse the same queue identity and atomic claim.

## Z. Final Status

```text
WHATSAPP TESTING HARDENING — READY
WHATSAPP SEND MODE: MOCK
TESTING LIVE ACCEPTANCE: NOT EXECUTED
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

This closes only WhatsApp Testing Hardening. It does not begin Final Testing Release Audit or any other product phase.
