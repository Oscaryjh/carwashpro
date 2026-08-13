# TETAMU Master UAT Bug Register

Audit date: 2026-08-12 (Asia/Singapore)

Environment boundary:

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```

## Open items

| ID | Severity | Area | Scenario | Description | Reproduction | Expected | Actual | Status | Fix | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-P3-001 | P3 | WhatsApp UI | Lint gate | Existing inbox avatar/media markup uses a native `<img>` and raises the Next.js performance advisory. | `npm run lint` | No performance advisory. | Lint passes with one `@next/next/no-img-element` warning. | OPEN / NON-BLOCKING | Deferred to a focused WhatsApp UI cleanup; no unrelated UAT refactor. | Lint PASS with warning. |
| UAT-P3-002 | P3 | Attendance UI CSS | Local production-mode build | Existing `align-items: end` style raises an Autoprefixer compatibility advisory. | `npm run build` | No compatibility advisory. | Build passes and recommends `flex-end`. | OPEN / NON-BLOCKING | Deferred to a focused CSS compatibility cleanup; current supported browser UAT has no layout failure. | Build PASS with warning; 390px page usable. |

## Closed during this UAT

| ID | Severity | Area | Scenario | Description | Reproduction | Expected | Actual | Status | Fix | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-CLOSED-001 | P2 | Master Golden fixture | TypeScript gate | The new Local-only fixture script did not preserve the environment-variable narrowing across the async function boundary. | `npx tsc --noEmit` | Fixture compiles. | `bcrypt.hash` received a `string \| undefined` type. | CLOSED | Added an explicit post-guard `string` binding; no business logic changed. | TypeScript PASS; fixture remains idempotent. |
| UAT-CLOSED-002 | ENV | Integration runner | First full integration invocation | The first shell invocation omitted `DATABASE_URL`; DB-backed tests could not start. | `npm run test:integration` in a shell without Local DB variables. | Runner reaches Local PostgreSQL. | Environment-variable failure before domain assertions. | CLOSED / COMMAND ENVIRONMENT | Re-ran with the canonical Local PostgreSQL URL. No product change. | 160/160 PASS. |
| UAT-CLOSED-003 | ENV | Prisma generation | Generate while Local dev server holds Windows DLL | Windows prevented Prisma from replacing the loaded query-engine DLL. | `prisma generate` while Next.js is running. | Client generation completes. | `EPERM` rename on the loaded DLL. | CLOSED / COMMAND ENVIRONMENT | Stopped only the Local dev process, generated the client, built, then restarted Local service. | Prisma generate PASS; `/login` HTTP 200 after restart. |

## Data-quality observations (not product bugs)

- The long-lived Local database contains thousands of historical test businesses. Golden fixtures are selected by canonical IDs/slugs; random historical tenants are not acceptance evidence.
- The legacy `qa-supplier-ap-e2e` fixture intentionally contains a Goods Receipt reversal after a confirmed bill. AP reconciliation correctly reports `RECEIPT_REVERSAL_AFTER_BILL`. It is detector evidence and is excluded from the clean Golden set.
- Businesses without a canonical commercial subscription correctly report `LEGACY_REVIEW_REQUIRED`; they are not interpreted as RM0 or silently activated.

## Severity totals

```text
OPEN P0 BUGS -> 0
OPEN P1 BUGS -> 0
OPEN P2 BUGS -> 0
OPEN P3 BUGS -> 2
```
