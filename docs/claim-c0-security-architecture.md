# Claim C0 — Security and Architecture Foundation

This document records the verified preflight state and the boundaries introduced by Claim C0. C0 does not implement a Claim database model, workflow, UI, approval, finance workspace, Payroll bridge, Payment, Bank file, OCR, report, or notification.

## Verified baseline

- Branch: `codex/business-group-user-accounts`
- Baseline commit: `2f4a9ea368e3ae05b25f61a51e3774178a5f964b`
- Production was not modified.

## Mandatory preflight answers

1. Current file uploads write to `public/uploads` for Group logos, Business logos and WhatsApp media/documents. Statutory export artifacts are encrypted database artifacts and are not a general attachment service.
2. Group logos, Business logos and WhatsApp media are represented by public `/uploads/...` URLs.
3. A reusable private object-storage service was **Not implemented** before C0.
4. Signed URLs were **Not implemented**.
5. A general attachment MIME allowlist was **Not implemented**. Group logos have a local PNG/JPEG/WebP allowlist; WhatsApp handling is separate and trusts broader media metadata.
6. A general magic-byte validator was **Not implemented**. Group logos validate basic magic bytes; Business logos and WhatsApp paths do not provide the Claim security boundary.
7. Malware scanning was **Not implemented**.
8. Existing image upload paths retain original bytes, so EXIF removal was **Not implemented**.
9. Existing Audit calls may store public logo URLs or media metadata depending on the caller. C0 forbids Claim object keys, URLs and file contents in Audit. No Claim Audit writer exists yet.
10. Claim capabilities were **Not implemented** before C0.
11. Employee Bank storage and Payroll Payment workflow are **Not implemented**. Existing reserved capabilities and truthful unavailable screens do not constitute those products.
12. Payroll has no traceable Claim line. `PayrollEntry.allowances` is a mutable monthly aggregate and Draft refresh deletes/rebuilds it.

## Confirmed product architecture

- Structure: `EmployeeClaim` header with one or more Claim Items.
- Default settlement: separate reimbursement, not a salary allowance.
- Payroll eligibility: only a Claim Category explicitly configured for Payroll reimbursement may be eligible in a later phase.
- Approval: Employee Submit → Manager Review → Finance Verification.
- Approved never means Paid.
- Payment and Bank file states remain unavailable until their separate products exist.

## C0 capabilities

- `VIEW_CLAIM`
- `REVIEW_CLAIM` (implies View)
- `VERIFY_CLAIM` (implies View)
- `MANAGE_CLAIM_SETTINGS` (reserved; implies View)
- `LINK_CLAIM_TO_PAYROLL` (reserved; implies View and Payroll Run read)

Business and Group Owners continue to receive owner-equivalent capability policy. Group Managers receive no Claim capability by default. Direct Staff receive only explicitly granted permissions. Employee self-service will use the existing Employee Session and strict membership self-scope in C1/C2, not a back-office permission.

## Private attachment boundary

C0 provides a server-only filesystem adapter behind `ClaimPrivateAttachmentStore`.

- It requires explicit `CLAIM_PRIVATE_STORAGE_PROVIDER=filesystem` and an absolute `CLAIM_PRIVATE_STORAGE_ROOT`.
- The root may not resolve inside `public`.
- Stored files receive opaque server-generated keys and do not receive public or signed URLs.
- Reads occur on the server and require an expected SHA-256 checksum.
- Files enter `QUARANTINED` state only.
- No runtime delete API is exposed.
- A durable private Railway volume is required before enabling the filesystem provider in Testing.
- Production object storage is not selected by C0. An S3-compatible private provider can implement the same interface later without changing Claim domain code.

## Attachment security policy

- Allowed: JPEG, PNG, WebP and PDF.
- Maximum size: 10 MB per file.
- Declared MIME must match validated magic bytes.
- PDF requires a valid header and terminal EOF marker.
- Filenames are normalized and sanitized; storage keys never use client filenames.
- SHA-256 is calculated before storage and verified on read.
- Common EXIF/XMP/text metadata markers are detected.
- C0 does not claim to sanitize metadata and does not include a malware scanner.
- Release is fail-closed: both a `CLEAN` malware result and `SAFE`/`SANITIZED` privacy metadata result are required.

## Audit and privacy policy

Future Claim writes must use transactional, fail-closed Audit. Audit may record status transitions, changed-field names, receipt counts, checksums where necessary and safe reasons. Audit must not record receipt bytes, private object keys, URLs, original unsafe filenames, merchant account data or unredacted free text.

## Payroll boundary

C0 does not write `PayrollEntry`, `allowances`, Payslip or Payroll Runs. A later bridge must create a dedicated Claim reimbursement allocation and immutable Payroll Claim snapshot. Draft refresh must be deterministic and Finalized Payroll must never be rewritten.

## Remaining blockers before Claim submission UI

1. Select and configure a durable private storage provider for Railway Testing.
2. Integrate malware scanning or a quarantine release worker.
3. Add privacy metadata sanitization/normalization for supported images and PDFs.
4. Implement C1 Claim header/items, immutable revisions/events and tenant/scope domain services.
5. Add authorized attachment download streaming; signed URLs remain optional and are not part of C0.
