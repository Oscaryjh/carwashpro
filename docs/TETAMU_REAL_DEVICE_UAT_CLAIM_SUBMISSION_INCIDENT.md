# TETAMU Real Device UAT — Claim Submission Incident

## 1. Incident Summary

Railway Testing 的真实 iPhone Staff App 在 `Requests → Claims → New Claim → Submit` 后没有出现 Pending Claim，却显示 Attendance 专属网络错误。调查结论：Claim 前端确实进入了提交路径，但浏览器中的 `fetch()` 在请求到达 Railway HTTP edge 前拒绝；共享 `staffApiFetch` 又把任何 fetch rejection 固定映射为 Attendance 文案，因此 UI 同时隐藏了正确业务域和真实 HTTP 结果。

本次失败没有创建 Claim、Claim line、attachment、approval item 或 private-storage object。最小修复已部署到 Testing。受控 service-level retest 成功创建一笔 RM 12.30 Claim，并验证附件、private storage、Manager inbox 与 duplicate audit。实体 iPhone 仍须进行一次人工最终重测。

## 2. Environment

- Environment: Railway **Testing only**
- Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Service: `tetamu-staff-app`
- Employee: Twilio OTP QA Staff (`TWILIO-OTP-QA`)
- Membership: `8a32ee4a-bdef-451e-8a0d-09fc082190dc`
- Business: Royal Salon (`611b0c19-ebf7-4548-8a48-a3b6a7af8a81`)
- Branch: salon online (`41575966-238f-46ab-a114-22bbee4949c5`)
- Production: **not accessed and not changed**

## 3. iPhone Observation

- Claim form rendered and accepted user input.
- Submit produced: `attendance requires a network connection. connect to the internet and try again`.
- The iPhone was otherwise online; Claim list GETs succeeded around the incident.
- Claim list refresh showed no Pending Claim.
- Whether the failed attempt had a selected attachment is **UNKNOWN** because no POST reached the server and no device network capture was retained.

## 4. Request Trace

Railway Testing HTTP logs were queried for `/api/employee-claims` before any retest.

| Question | Evidence-based result |
|---|---|
| Did frontend attempt submit? | **YES** — this exact UI error is emitted only from the `staffApiFetch` fetch-rejection catch reached by the Claim submit handler. |
| Did HTTP request leave Staff App? | **NO** — Railway HTTP edge had zero matching `POST /api/employee-claims` records in the incident search window. |
| Route | `/api/employee-claims` |
| Method | Intended `POST`; no POST reached Railway. |
| Timestamp | No server POST timestamp exists. Surrounding iPhone GET evidence: 2026-08-26 06:29:33.652Z, 06:29:41.816Z, 06:29:44.800Z and 06:35:59.851Z. |
| HTTP status | **None / client status 0**; there was no HTTP response. |
| Backend received | **NO** |
| Claim created | **NO** |
| Claim ID | None |
| Attachment selected | **UNKNOWN** |
| Attachment uploaded | **NO** |
| Storage object created | **NO** |
| Backend error code/message | None; backend was not reached. |

The surrounding GETs were HTTP 200 from iPhone Safari (iPhone OS 18.7 / Safari 27.0), on deployment `b88a612e-cce3-468d-8185-e66399a4bf94`, confirming the correct Testing host was reachable before and after the failed submit.

## 5. Claim API Route

Canonical flow:

1. `src/components/staff-pwa/staff-claims.tsx` — `submit()` builds payload and multipart `FormData`.
2. Same-origin `POST /api/employee-claims`.
3. `src/app/api/employee-claims/route.ts:20` — parses `payload` plus `receipt:{lineNumber}` files.
4. `src/lib/claim/service.ts:88` — `submitEmployeeClaim()` validates scope, policy, duplicate warning, persistence, attachment and audit event.

The Claim frontend did not call an Attendance endpoint or legacy localhost/port-3000 Staff route. The API route reuses the employee-auth/response infrastructure, but that server helper was not reached in this incident.

## 6. Attendance Error String Source

Before the fix, `src/lib/staff-pwa/client.ts` caught every rejected `fetch()` and unconditionally threw the Attendance-specific network message. Claims called this shared helper, so a Claim transport failure was mislabeled as Attendance.

This is classified as:

- **FRONTEND_ERROR_MAPPING**
- **ATTENDANCE_HELPER_REUSE**

The actual browser transport outcome is additionally classified as **NETWORK**, but server evidence cannot identify a narrower Safari transport cause without a device-side network capture.

## 7. Offline Detection

- `StaffClaims.submit()` has no `navigator.onLine` pre-check and did not hard-block on cached offline state.
- `navigator.onLine` is used by the global status banner in `src/components/staff-pwa/staff-pwa-chrome.tsx:287-290`.
- The only direct pre-request guard found is Attendance Today at `src/components/staff-pwa/staff-today.tsx:148`, not Claims.

Verdict: **not `FRONTEND_OFFLINE_DETECTION`**. The Claim attempted canonical fetch and the fetch promise rejected.

## 8. Service Worker

`public/sw.js` uses cache version `tetamu-pos-static-v4`. At `public/sw.js:29` it immediately ignores non-GET requests; at `public/sw.js:39` it also excludes `/api/` from caching. Therefore the Claim POST was neither queued, rewritten nor rejected by the service worker.

Verdict: **not `SERVICE_WORKER`**.

## 9. Deployment / Bundle Version

- Incident GET traffic hit the then-current Testing deployment `b88a612e-cce3-468d-8185-e66399a4bf94`.
- The service worker does not cache navigations, API requests or the Claim POST.
- No evidence showed an old origin, localhost asset, or old deployment handling the incident traffic.
- Fix commit: `ce40cc8 fix(claims): report claim network failures correctly`.
- Fixed Testing deployment: `0a0608bd-8c7b-41d0-88cb-4c13766380f1` — **SUCCESS**.

Verdict: `STALE_PWA_BUNDLE = NO` based on available server/deployment evidence. A device asset hash was not captured, so the final iPhone retest remains required.

## 10. API Base URL

The frontend uses the relative path `/api/employee-claims`, with `credentials: "same-origin"`. Actual surrounding traffic used `https://tetamu-staff-app-testing.up.railway.app`.

No localhost, port 3000, Production URL or legacy Railway host was found in this Claim path.

## 11. Claim Payload

Canonical payload assembled by `staff-claims.tsx:89-106`:

- `clientRequestId`: browser UUID
- `purpose`
- `currency`: `MYR`
- line: `lineNumber`, `categoryId`, `expenseDate`, `merchant`, `description`, `amount`, `mileageKm`
- optional receipt: multipart field `receipt:1`

`staffApiFetch` deliberately does not set JSON content type for `FormData`, allowing the browser to generate the correct multipart boundary. The failed request did not reach the server, so the exact user-entered payload and file metadata for that attempt are unavailable.

## 12. iPhone Attachment Analysis

The current validator supports:

- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`
- maximum 10 MB, with signature/MIME matching

HEIC/HEIF is not currently accepted. This is a future iPhone compatibility limitation, but it is **not the root cause of this incident**: an unsupported file reaching the backend would produce an HTTP validation response, while this request never reached Railway. The controlled retest used a valid PNG equivalent and passed.

## 13. Private Storage

- Failed attempt: storage code was not reached; no Claim object was created.
- Existing Testing private-storage canary: PUT/read/delete previously passed.
- Controlled retest attachment: object metadata and read both returned 24,932 bytes; stored checksum matched the database checksum.

Verdict: **PASS**, not `PRIVATE_STORAGE`.

## 14. Claim Policy

Testing preflight on 2026-08-26 confirmed:

- Category: Travel (`TRAVEL`)
- Category ID: `03273013-25f1-4123-b200-852723a8e7fa`
- Policy revision: `98b9d0be-bacb-48ff-9027-66dcd784b870`
- Effective from: 2000-01-01; no end date
- Receipt: required
- Description: required
- Maximum line amount: no limit
- Statutory treatment: `VERIFIED_NON_WAGE`
- Employee membership: `ACTIVE`
- Primary branch assignment: `ACTIVE`

Verdict: policy/category/eligibility **PASS**.

## 15. Approver Scope

Real Device UAT Manager:

- User ID: `5840c06f-fd53-4d8f-8983-e70d0011f876`
- Business: Royal Salon
- Allowed branch: salon online
- Capability: `REVIEW_CLAIM`
- Actor level: `MANAGER`

The manager and employee are in the same business/branch. Controlled inbox projection confirmed the new Claim is visible as Pending. No approval was executed.

## 16. Persistence / Orphan Audit

Before controlled retest, Testing DB contained zero matching `Real Device UAT Claim` records for this membership and no recent failed Claim record from the incident. Because no POST reached backend, no line, event, attachment, approval item or private object could have been partially persisted.

No orphan cleanup was necessary.

## 17. Idempotency

The frontend creates `clientRequestId` once per submission. `submitEmployeeClaim()` first looks up `(businessId, membershipId, clientRequestId)` at `src/lib/claim/service.ts:96-100`, and Prisma enforces `@@unique([businessId, membershipId, clientRequestId])` at `prisma/schema.prisma:6889`.

The controlled retest used one new UUID and no retry. Duplicate audit returned exactly one matching Claim.

## 18. Root Cause

Primary root cause:

1. Browser-side `fetch()` rejected before the HTTP request reached Railway (`NETWORK`, client status 0).
2. Shared `staffApiFetch` hardcoded an Attendance-specific message for all rejected fetches (`FRONTEND_ERROR_MAPPING` + `ATTENDANCE_HELPER_REUSE`).

The server evidence proves the boundary but cannot distinguish the lower-level Safari cause (temporary connection reset, browser/PWA process condition, or device path interruption) without a retained device network trace. It was not policy, storage, service worker, endpoint, API base or backend validation.

## 19. Fix

Minimal change only:

- `src/lib/staff-pwa/client.ts`
  - added optional `networkErrorMessage` per caller;
  - replaced the default Attendance wording with neutral Staff App wording.
- `src/components/staff-pwa/staff-claims.tsx`
  - supplies a Claims-specific message for load, submit and withdraw:
    `Claims requires a network connection. Connect to the internet and try again.`

No Claim accounting, approval, Payroll, PWA cache strategy or offline functionality was redesigned.

## 20. Regression

Added `tests/unit/staff-claims-network-error.test.ts` covering:

- rejected fetch maps to `NETWORK_ERROR`, status 0 and Claims-specific wording;
- online same-origin multipart POST returns 201;
- `FormData` is preserved and no incorrect manual content-type boundary is added;
- Claim source retains `clientRequestId`, payload and `receipt:1` contract;
- Attendance network text is absent from Claims.

Validation:

- Full unit test suite: **1163/1163 PASS**
- TypeScript: **PASS**
- ESLint (changed files): **PASS**
- `git diff --check`: **PASS**

## 21. Testing Deployment

- Service: `tetamu-staff-app`
- Deployment ID: `0a0608bd-8c7b-41d0-88cb-4c13766380f1`
- Status: **SUCCESS**
- Region: Southeast Asia
- `/staff/login` health check: HTTP **200**
- Claim route present in Next build manifest: `/api/employee-claims`
- Production deployment: **not performed**

## 22. Controlled Retest

Exactly one service-level Testing Claim mutation was executed after deployment:

- Employee: `TWILIO-OTP-QA`
- Amount: RM 12.30
- Description/purpose: `Real Device UAT Claim`
- Category: Travel
- Receipt: supported PNG fixture
- Claim ID: `c10c4671-4b1e-43c4-afe3-e7a6d58130b6`
- Client request ID: `b3aa6afc-8183-440b-81a2-94f2a7479344`
- Status: `SUBMITTED`
- Event: `SUBMITTED`
- Duplicate warning: false
- Attachment ID: `1d5fe272-922e-40c4-9e7e-90a8b0cc5f95`
- Attachment storage integrity: **PASS**

Two earlier local script starts failed during read-only category preflight because Railway private/public DB connectivity was unavailable; neither reached `submitEmployeeClaim` and neither created data. The business mutation itself executed exactly once.

## 23. Manager Visibility

Unified approval inbox was read using the Real Device UAT Manager business/branch scope and `REVIEW_CLAIM` capability.

- Matching approval items: **1**
- Employee: Twilio OTP QA Staff (`TWILIO-OTP-QA`)
- Status: `PENDING`
- Target: `/team/claims?employee=TWILIO-OTP-QA&status=SUBMITTED`
- Approved: **NO**

Verdict: **PASS**.

## 24. Duplicate Check

- Matching controlled Claims: **1**
- Matching Claim IDs: only `c10c4671-4b1e-43c4-afe3-e7a6d58130b6`
- Claim lines: **1**
- Attachments: **1**
- Matching Manager approval items: **1**
- Duplicate financial records: **0**
- Duplicate warning: **false**

## 25. Human iPhone Retest Requirement

Codex did not control the physical iPhone and therefore cannot claim real-device pass. Required human step:

1. Reload/reopen the Testing Staff App after deployment `0a0608bd-8c7b-41d0-88cb-4c13766380f1`.
2. Submit one new small Claim from the real iPhone.
3. Confirm a real HTTP POST reaches Railway, a Pending Claim appears, and any actual iPhone photo format is accepted or produces a Claim-specific validation message.

No further automated Claim should be created before this human retest.

## 26. Final Verdict

**HUMAN RETEST REQUIRED**

| Real Device UAT checkpoint | Status |
|---|---|
| Claim form rendering | PASS (observed) |
| Claim category | PASS |
| Claim photo/attachment selection | REQUIRED on actual iPhone; controlled PNG PASS |
| Claim submit | Controlled service-level PASS; actual iPhone REQUIRED |
| Claim persistence | PASS |
| Manager visibility | PASS |
| Claim-specific error handling | PASS in regression and deployed code |
| Actual iPhone final retest | REQUIRED |

The diagnosable product defect is fixed and deployed to Testing. The original low-level Safari transport interruption was pre-edge and is not recoverable from backend logs; the next physical-device submission is required to close the Real Device UAT checkpoint.
