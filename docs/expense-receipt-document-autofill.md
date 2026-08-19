# Expense Receipt Document Autofill

Status: Local / Testing implementation. Production is deliberately disabled in code.

## Architecture

```text
Receipt / invoice
  -> ExpenseDocumentProvider
  -> validated normalized extraction
  -> Tetamu safety rules
  -> tenant-scoped duplicate detection
  -> Expense / Supplier Bill / Claim routing
  -> human review
  -> explicit Draft or Confirm action
```

`ExpenseDocumentProvider` is the only provider contract used by the application layer. Current implementations are:

- `mock`: deterministic Local/automated-test adapter. It does not read document contents.
- `openai`: real image/PDF extraction through the Responses API and strict JSON Schema.

Future Google Document AI, AWS Textract or Azure Document Intelligence support requires a new implementation of the same interface plus one resolver entry. Expense business rules, duplicate checks and UI must not be copied into a provider. No future-provider SDK is installed by this phase.

## Provider boundary

Providers extract visible facts only: document suggestion, merchant, document number, raw and normalized dates, currency, decimal-string amounts, category hint, payment evidence suggestion, confidence and short warnings.

Tetamu remains responsible for:

- final Expense / Supplier Bill / Claim routing;
- category mapping to an active category in the current business;
- final payment state and payment validation;
- duplicate detection and tenant/branch scope;
- canonical spending rules;
- Draft, Confirm and attachment consumption.

Scanning never creates, confirms, pays or posts an Expense.

## Normalized data rules

- Money is a bounded decimal string with exactly two digits, for example `"192.80"`. JSON numbers, exponent notation and JavaScript floating-point amounts are rejected.
- Slash dates follow the Malaysia `DD/MM/YYYY` convention. Raw visible dates are retained alongside ISO dates.
- A date such as `07/08/2026` normalizes to `2026-08-07`, is treated as ambiguous, lowers extraction confidence and adds a human-review warning.
- Provider output is validated by Zod. OpenAI output is additionally constrained by strict Structured Outputs JSON Schema.
- Raw OCR text is not retained.

## Workflow protection

- Supplier Invoice: show the Supplier Bill warning/CTA and block manual Expense creation server-side.
- Claim receipt: show My Claims and block the wrong workflow server-side.
- Unknown/low confidence: retain manual entry and require review.
- `PAID` is only advisory from a provider. Tetamu accepts it only with a strong visible payment signal; otherwise the form defaults to `UNPAID`.
- Duplicate checks run outside providers and are scoped by business across Expense, Supplier Bill and Claim attachments/facts.
- Duplicate continuation requires an explicit human acknowledgement, rechecked server-side.

## Failure behaviour

Timeout, provider error, rate limit, unsupported document and invalid schema do not fall back to mock. Tetamu persists a private, expiring scan with `UNKNOWN`/low-confidence extraction, shows that automatic extraction is unavailable and keeps manual entry usable. No canonical record is created.

## Security

- The server reads `OPENAI_API_KEY` only from ignored environment configuration. It is never sent to the browser, database, audit payload or application error response.
- Uploads require authentication, module/capability checks, same-origin requests and validated business/branch scope.
- Magic bytes, MIME type and the 10 MB limit are validated before provider use.
- Originals remain in the private quarantined attachment store; no public URL or signed URL is returned.
- Receipt base64 and raw provider output are not logged or stored.
- Audit metadata is minimized to provider/model, request identifier, document type, confidence, normalized extraction version, warnings and workflow facts.
- Production runtime hard-disables the feature.

## Configuration

```env
EXPENSE_RECEIPT_AUTOFILL_ENABLED=true
EXPENSE_DOCUMENT_AI_ENABLED=true
EXPENSE_DOCUMENT_AI_PROVIDER=mock # mock | openai
EXPENSE_DOCUMENT_AI_MODEL=gpt-5.4-mini
EXPENSE_DOCUMENT_AI_MAX_OUTPUT_TOKENS=1200
```

`openai` also requires the server-only `OPENAI_API_KEY`. Unknown provider names fail closed. There is no silent provider fallback.

## Local smoke result (2026-08-14)

Input: `C:\Users\oscar\Downloads\receipt.jpeg`

Real OpenAI extraction returned:

```text
Document type: EXPENSE_RECEIPT
Payee: AZUMA SUSHI (CITY MALL K.K)
Document number: 4864
Raw date: 07/08/2026
Normalized date: 2026-08-07
Amount: 192.80
Currency: MYR
Category hint: Meals & entertainment
Provider payment suggestion: PAID
Tetamu payment state: UNPAID / review
Confidence: LOW (ambiguous date requires human verification)
```

Browser upload, structured validation, form prefill and manual correction passed. The scan did not automatically create or confirm an Expense. Browser console/hydration/runtime errors were zero.

LOCAL ONLY

PRODUCTION NOT ACCESSED

PRODUCTION NOT MODIFIED

PRODUCTION NOT VALIDATED
