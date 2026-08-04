# Payroll Payment P0 integrity foundation

Payment is a separate domain from Payroll calculation and POS customer
payments. A `FINALIZED` Payroll Run means that calculations are locked; it
does not mean that employees have been paid.

P0 adds append-only employee bank versions, deterministic payment readiness,
payment batches and instruction snapshots, command/event records, an
independent AES-256-GCM payment keyring, and immutable artifact storage.

P0 intentionally has no UI, server action, public download route, generic CSV,
bank adapter, payment execution, paid/settled/reconciled state, or employee
self-service status.

## Payment date rule

Until a payment-date UI exists, bank-account applicability is evaluated at the
last instant of the Payroll Run period (`periodEnd - 1 ms`). This rule is
deterministic and included in the payment calculation digest.

## Encryption

Payment keys are independent from Statutory Artifact keys:

```text
PAYROLL_PAYMENT_ACTIVE_KEY_VERSION
PAYROLL_PAYMENT_ENCRYPTION_KEYS
PAYROLL_PAYMENT_FINGERPRINT_KEY
```

Bank account numbers and instruction account snapshots use AES-256-GCM with
domain-separated AAD. Duplicate detection uses HMAC-SHA256 rather than an
unsalted digest. Full account numbers, ciphertext, IVs and authentication tags
must never enter Audit DTOs or public/read DTOs.

## Future PayrollDisbursementProfile

P0 does not create a provider configuration table. It must only be introduced
after the first formal bank adapter defines the organisation code, debit
account, provider identity, format version and approval requirements. No fake
provider or organisation code may be persisted in P0.

## Reopen boundary

An active draft/submitted Payment Batch blocks Payroll Reopen until cancelled.
An approved/instruction-ready Batch or immutable artifact blocks standard
Reopen without an override path.
