# Tetamu POS — Cross-service employee avatar storage design

Status: proposed for review. Baseline: `7ea8a00844b466b9302db7113ab8077a42b62248` on `codex/testing-canonical-20260923`.

## Intent and evidence

Close `CROSS_SERVICE_AVATAR_STORAGE_FAILURE` without changing the 222 migration baseline, Payroll/PCB, or Production state before Testing verification. Production acceptance proved that a Staff-uploaded synthetic avatar returned HTTP 200 from Staff and HTTP 404 from Web at the same relative `/uploads/employee-avatars/<filename>.webp` URL. The current writer and reader use each Next service's local `public/uploads`, while Web and Staff are separate Railway services. Their filesystems are not a shared avatar source.

The repository already has an S3-compatible private-attachment client and `@aws-sdk/client-s3`. Testing has a private-attachment bucket, but no shared avatar implementation. Production has no avatar bucket. A Testing Staff `PUBLIC_IMAGE_S3_*` variable set is not consumed by current source and is not evidence of a working avatar store.

## Alternatives and decision

1. **Dedicated private S3-compatible avatar bucket in each environment (selected):** reuse the existing SDK/config-validation pattern, keep attachments and avatars isolated, and let both Web and Staff read the same object. Requires bucket provisioning and server-only variables.
2. Reuse the Testing private-attachment bucket under another prefix: fewer resources there, but combines unrelated privacy/retention policies and still leaves Production without a suitable bucket.
3. Proxy all avatar reads through one Next service's volume: avoids a new bucket, but preserves a single-service filesystem dependency and fails the shared-source goal.

Testing and Production each get an environment-scoped private bucket. No bucket/object ACL is public. Web and Staff receive the same environment's scoped credentials through Railway references; credentials are never placed in `NEXT_PUBLIC_*`, browser responses, logs, or reports. Production bucket/config creation waits until Testing passes and the release sequence reaches Production.

## Data and routing contract

- Keep `EmployeeBusinessMembership.avatarUrl` as an origin-relative `/uploads/employee-avatars/<filename>.webp` URL; no Prisma/schema migration.
- New filenames contain only a cryptographically random UUID and `.webp`, not names, email, phone, or a predictable sequence. The internal S3 key is a fixed configured prefix plus `employee-avatars/<filename>`; the external URL never reveals the bucket, endpoint, key prefix, or credentials.
- Both Web and Staff run the same `GET /uploads/employee-avatars/[filename]` handler. GET remains unauthenticated as explicitly approved for compatibility. The handler accepts only the exact avatar filename grammar, issues only one fixed-namespace object GET, and exposes no list, arbitrary key, signing, or provider passthrough operation. `Content-Type: image/webp` and `X-Content-Type-Options: nosniff` remain fixed.
- A new-format filename reads only from shared storage. A legacy filename (the existing membership-UUID/random-UUID pattern) checks shared storage first and may fall back to that service's local file **only on object-not-found**, never on timeout, auth/config error, or provider failure. The fallback is read-only. Existing local files are not automatically copied, moved, or deleted; cross-service access to a legacy file can still require a later non-destructive backfill or re-upload.
- Shared-storage failure returns a generic non-sensitive error and does not silently fall back to a different object. No bucket names, keys, SDK traces, or secrets reach the client. Provider diagnostics stay in sanitized server logs.
- Objects are immutable and cacheable because each update gets a new random URL. Reads enforce a reasonable maximum normalized object size and verify stored content metadata/checksum where available; corrupt or unexpected content is not served as an image.

## Upload and update boundaries

- Staff POST keeps its real employee session, active membership/business checks, same-origin check, 10 MiB source limit, Sharp decode, 512×512 WebP normalization, and audit event. Backoffice server action keeps `MODIFY_TEAM`, People tenant/branch scope, 2 MiB processed-file limit, and audit event. New writes go **only** to the shared store; Production/Testing must fail closed if the store is absent or invalid.
- Align backoffice accepted formats with the verified Staff policy as needed for JPEG, PNG, WebP and AVIF. HEIC remains explicitly rejected. Preserve HEIF-family AV1 handling where already verified. Check actual decoded input format, not only browser MIME or filename; reject unsupported/corrupt and mismatched MIME/extension safely. Maintain pixel/resource limits and non-sensitive user errors.
- Upload object first, verify the write, then atomically update the scoped membership and audit. If DB update fails, remove only the newly created unreferenced shared object. If DB update succeeds, do **not** delete the former local file. Existing shared objects replaced by a newer URL remain until a separately reviewed retention/garbage-collection policy; no destructive migration is part of this fix.
- No credential or permission change is implied for unrelated documents, claims, Payroll, PCB, Workers, WhatsApp, or other upload namespaces.

## Configuration and rollout

Use explicit server-only `EMPLOYEE_AVATAR_STORAGE_PROVIDER=s3` plus S3 endpoint, region, bucket, access-key ID, secret access key, key prefix, and path-style option under the `EMPLOYEE_AVATAR_STORAGE_S3_*` namespace. Validate HTTPS endpoint, bucket/prefix grammar, nonempty credentials, and a private bucket. Testing Web/Staff must reference one Testing avatar bucket; Production Web/Staff later reference a separate Production avatar bucket. Do not copy Testing credentials or mock settings to Production. Where Railway supplies secret references, use references rather than printing or embedding resolved values.

The selected storage component has one responsibility: `put`, `get`, and narrowly scoped cleanup for new unreferenced avatar objects. An injected in-memory S3 client in tests demonstrates that two independent app instances can read the same uploaded bytes without sharing a filesystem. The route component owns URL parsing, response headers, and the legacy read-only fallback. Upload actions retain authorization and image validation.

## Verification and release gates

1. Write failing tests first: two-instance Staff→Web and Web→Staff same-URL/same-SHA reads; JPEG/PNG/WebP/AVIF success; HEIC, unauthenticated, cross-tenant/branch, oversized, corrupt, forged MIME/extension, traversal, missing/invalid storage config and provider failure negatives. Assert no provider write/read escapes the fixed avatar namespace.
2. Implement the smallest shared-store change. Run avatar unit/integration tests, then clean `npm ci`, Prisma generate/validate, `tsc --noEmit`, full unit, disposable integration and build. No skips or weakened assertions; no migration/schema changes.
3. Commit and push only verified canonical changes. Testing Web and Staff deploy from the exact pushed Git SHA (not CLI snapshot), with matching app release SHA. Synthetic Staff UAT proves Staff upload → Staff/Web HTTP 200 with identical SHA, formats and HEIC rejection, plus reverse backoffice update → Staff read. Check auth and tenant/branch negatives. If any gate fails, stop before Production.
4. Only after Testing passes, configure the separate Production private bucket and deploy the exact same SHA to the four Production services under the established release-identity policy. No new migration. Re-run synthetic Production cross-service avatar and remaining acceptance UAT; do not mark `PRODUCTION_LIVE` until all gates pass. The existing Production `/api/internal/version` 503 is an independent follow-up, not part of this avatar change.

## Explicit follow-ups and exclusions

- Authenticated, tenant-scoped avatar GET is a separate privacy-hardening item; this change preserves the existing link-readable behavior.
- Legacy avatar non-destructive backfill and object retention/garbage collection are separate reviewed operations. No automatic deletion of old files.
- Do not modify Production code/files/volumes by hand, the 222 migration history, Production DB schema, Payroll/PCB, or outbound policies.
