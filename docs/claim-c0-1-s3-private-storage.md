# Claim C0.1 — S3-Compatible Private Object Storage

Claim C0.1 adds a private, durable S3-compatible quarantine adapter for Claim receipts. It does not add Claim models, submission, approval, release, download, Payroll, Payment, Bank, OCR, reports, or notifications.

## Mandatory preflight

1. The C0 interface supported quarantine put and server-only read. C0.1 adds `getQuarantinedMetadata` so filesystem and S3 providers expose the same integrity boundary.
2. `putObject` maps to `putQuarantined`; `readObject` and SHA-256 verification remain combined in `readQuarantined`.
3. Quarantine is mandatory. Finalize/release is not added because malware scanning and privacy-metadata sanitization are not implemented.
4. Signed access is not added. There is no Claim download route or user-facing attachment API.
5. The repository had no AWS SDK, Cloudflare R2 client, Supabase Storage client, or reusable private object-storage dependency before C0.1.
6. Existing public uploads remain on `/app/public/uploads` and are not migrated or reused.
7. Railway Testing had no Claim/S3/R2 storage variables. Its only Web volume is mounted in the public uploads directory and remains unchanged.
8. Node SHA-256 and the existing 10 MB attachment limit are reused. A single conditional object PUT is sufficient; multipart upload is not required.
9. Existing request timeout patterns use bounded timeouts. C0.1 applies a 15-second abort boundary and the AWS SDK retry policy to every S3 request.
10. Existing PDF routes return server responses, but C0.1 intentionally adds no streaming/download route.

## Provider decision

Railway Testing uses a dedicated private Cloudflare R2 bucket through its S3-compatible API.

- The bucket is private and has no public/custom domain.
- R2 provides durable object persistence, object metadata, Head/Get/Put, conditional Put and lifecycle configuration.
- R2 encrypts data at rest and in transit. The adapter does not send AWS-specific SSE/KMS headers that R2 does not implement through the generic S3 compatibility layer.
- Testing receives a bucket-scoped read/write token. Production uses no Testing credential or bucket.
- The bucket and object prefix are Testing-specific.

## Runtime configuration

```text
CLAIM_PRIVATE_STORAGE_PROVIDER=s3
CLAIM_PRIVATE_STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CLAIM_PRIVATE_STORAGE_S3_REGION=auto
CLAIM_PRIVATE_STORAGE_S3_BUCKET=<private-testing-bucket>
CLAIM_PRIVATE_STORAGE_S3_ACCESS_KEY_ID=<testing-only>
CLAIM_PRIVATE_STORAGE_S3_SECRET_ACCESS_KEY=<testing-only>
CLAIM_PRIVATE_STORAGE_S3_PREFIX=testing/claims
CLAIM_PRIVATE_STORAGE_S3_FORCE_PATH_STYLE=false
```

All required values fail closed. The endpoint must use HTTPS and may not contain credentials, query parameters, or fragments. Secrets must be configured only as Railway Testing variables and must never be logged, committed, screenshotted, or copied to Production.

## Object security and integrity

- Object keys are opaque UUID-based keys; client filenames never become storage keys.
- `If-None-Match: *` prevents overwriting an existing object.
- Objects are stored with `private, no-store` cache policy and quarantine metadata.
- SHA-256, byte length, detected MIME, and quarantine disposition are recorded as object metadata.
- A Head request verifies metadata immediately after upload.
- Server-side reads re-check metadata, expected SHA-256, actual SHA-256, and byte length.
- Object metadata must remain within the 10 MB Claim attachment policy.
- The interface exposes no delete, public URL, signed URL, release, or finalize operation.

## Audit and privacy

Audit sanitization redacts private object keys, storage bucket/endpoint identifiers, URLs, and original filenames. Credentials and full object metadata must never be passed to Audit or application logs.

## Existing upload isolation

C0.1 does not change Group logos, Business logos, WhatsApp media, their URLs, or the `/app/public/uploads` Railway volume. The S3 adapter is instantiated only when `CLAIM_PRIVATE_STORAGE_PROVIDER=s3` is explicitly configured.

## Remaining blockers before receipt release

1. Malware scanner is not implemented.
2. EXIF/XMP/PDF metadata sanitizer is not implemented.
3. Authorized Claim attachment streaming/download is not implemented.
4. Claim domain models and workflow are not implemented.
5. Lifecycle policy must be configured on the Testing bucket and later aligned with the approved Claim retention policy.
