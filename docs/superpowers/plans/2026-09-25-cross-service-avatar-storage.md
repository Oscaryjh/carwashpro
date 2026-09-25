# Cross-service Avatar Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Staff and Web serve identical employee-avatar bytes from a private shared store while preserving relative URLs and safe legacy reads.

**Architecture:** A server-only S3-compatible avatar store writes immutable random-key WebP objects to a fixed namespace. Web and Staff use the same GET route to read that store, with read-only local fallback for legacy filenames only on object-not-found.

**Tech Stack:** Next 16 route handlers/server actions, AWS S3 SDK v3, Sharp, TypeScript, Node test runner, Prisma.

**Spec:** `docs/superpowers/specs/2026-09-25-cross-service-avatar-storage-design.md`

## Global Constraints

- Only `D:\Dev\TetamuPOS-Canonical-Reconcile` is edited. No Prisma schema or migration changes.
- Testing and Production use separate private buckets; browser gets no storage credentials.
- Uploads require existing Staff or scoped backoffice auth; avatar GET remains link-readable.
- New writes never use service-local `public/uploads`; legacy files remain untouched.
- JPEG/PNG/WebP/AVIF accepted when genuinely decodable, HEIC rejected; normalized output is 512×512 WebP.
- No Railway CLI source snapshots. Exact clean Git SHA must be deployed and verified before UAT.

## Review Focus

- An S3 outage must yield a safe error, not an accidental local-file fallback.
- A filename with traversal or encoded separators must never reach S3 outside the avatar prefix.
- A browser-supplied MIME/extension must agree with actual decoded image format.
- Replacement must not delete a prior legacy file or expose an uncommitted S3 object after DB failure.
- Staff and Web must produce the same hash while running as independent instances.

---

### Task 1: Shared-store contract and failing cross-instance tests

**Files:** Test `tests/unit/runtime-employee-avatar.test.ts`; modify `src/lib/runtime-employee-avatar.ts`; create `src/lib/employee-avatar-s3.ts` only after RED.

**Interfaces:** `writeRuntimeEmployeeAvatar({membershipId,bytes})` returns `{avatarUrl,filename}`; `readRuntimeEmployeeAvatar(filename)` returns bytes or null; injected S3 command client permits two independent instances to share one fake object map.

- [ ] Add a test that instantiates two separate avatar stores over one fake S3 object map, writes through Staff-side instance, then reads same URL bytes through Web-side instance; reverse the writer/reader. Assert SHA-256 equality and that no local file was written.
- [ ] Run `npx tsx --test tests/unit/runtime-employee-avatar.test.ts`; expect RED because current filesystem implementation cannot share objects.
- [ ] Implement server-only S3 put/get for a fixed avatar namespace, random UUID filename, strict key/config validation and bounded reads. Keep an injected command client for tests.
- [ ] Re-run the focused test; expect PASS. Add and run missing-config, S3-failure, no-enumeration and traversal negatives RED→GREEN.

### Task 2: Route and legacy compatibility

**Files:** Modify `src/app/uploads/employee-avatars/[filename]/route.ts`; test `tests/unit/runtime-employee-avatar.test.ts` and a focused route test.

**Interfaces:** Exact avatar filename parser distinguishes random new names from legacy membership/random names. Only `NoSuchKey` on a legacy name allows `readLegacyLocalEmployeeAvatar`.

- [ ] Add route tests for new shared URL read on independent origins, legacy local fallback, provider failure as sanitized 503, and traversal as 404; run them RED.
- [ ] Implement GET via shared store. Preserve `image/webp`, `nosniff`, immutable cache for success. Do not add public bucket access.
- [ ] Re-run focused tests GREEN and inspect emitted headers/bodies for provider details.

### Task 3: Authenticated upload, validation and cleanup

**Files:** Modify `src/app/api/employee-auth/avatar/route.ts`, `src/app/(business)/team/people/[personId]/avatar-actions.ts`, and avatar validation helper; test `tests/integration/employee-avatar-security.test.ts` and scoped backoffice tests.

**Interfaces:** Both upload paths consume the shared `writeRuntimeEmployeeAvatar`; only newly uploaded unreferenced shared objects may be cleaned up. Existing local files are never deleted.

- [ ] Extend tests with JPEG/PNG/WebP/AVIF, HEIC reject, fake MIME/extension, corrupt/oversized, unauthorized Staff, and scoped backoffice cross-tenant/branch negative cases; run RED.
- [ ] Implement actual-format validation with Sharp and make both upload paths use shared write. Keep current session/People scope and audit writes; prevent deletion of previous legacy URL.
- [ ] Re-run focused integration tests GREEN; verify DB avatarUrl changes only after confirmed shared write.

### Task 4: Complete local gate

**Files:** No extra product files unless a failing gate identifies a concrete issue.

**Interfaces:** The final canonical worktree and all tests are the candidate for one commit.

- [ ] Run `npm ci`, `npx prisma generate`, `npx prisma validate`, `npx tsc --noEmit`, `npm test`, `npm run test:integration:disposable`, `npm run build`, and focused cross-service tests on the final source.
- [ ] Inspect `git diff`, migration checksums/222 count and status. Fix any real failures without skips, deleted tests or weakened assertions; repeat affected gates.
- [ ] Commit only verified avatar code/tests and this plan, then confirm clean HEAD; push canonical branch and independently verify remote SHA equals local SHA.

### Task 5: Railway Testing exact-SHA deployment and UAT

**Files:** No source edits after final gate without repeating Task 4.

**Interfaces:** Testing private avatar bucket is referenced by Web and Staff through identical server-side variables; exact pushed Git SHA is the deployment source.

- [ ] Provision/check Testing private avatar bucket and set server-only references without revealing values. Deploy Testing Web/Staff from exact pushed SHA, not `railway up`.
- [ ] Verify Railway source commitHash, app release SHA and local/remote SHA match for Web and Staff.
- [ ] With synthetic Staff/owner, test Staff JPEG upload → Staff/Web 200 and equal SHA; PNG/WebP/AVIF pass, HEIC reject; reverse Web update → Staff 200/equal SHA. Run auth, scope and traversal negatives. Deactivate test identities and record retained UAT data.
- [ ] STOP before Production if any SHA, security or cross-service gate fails.

### Task 6: Production rollout and acceptance

**Files:** `D:\Dev\TETAMU_POS_CROSS_SERVICE_AVATAR_FIX_20260925.md` and existing Production acceptance report.

**Interfaces:** Same exact pushed Git SHA as Testing; Production has a distinct private avatar bucket. No migrations.

- [ ] Only after Testing PASS, configure Production private avatar bucket/references and deploy exact SHA to Web/Staff/Worker/WhatsApp per the four-service release identity contract. Verify deployments and health before UAT.
- [ ] Re-run synthetic Production Staff/Web same-avatar HTTP 200/equal SHA and remaining Production Acceptance UAT using only approved synthetic identities and any separately approved real OTP receiver.
- [ ] Revoke/deactivate test identities; document observed gates, untested cases and final `CROSS_SERVICE_AVATAR_FIXED` or `CROSS_SERVICE_AVATAR_BLOCKED`. Never mark Production LIVE from deployment health alone.
