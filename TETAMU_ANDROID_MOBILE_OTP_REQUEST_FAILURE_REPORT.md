# TETAMU STAFF 3000 — ANDROID MOBILE OTP REQUEST FAILURE REPORT

Date: 2026-08-31  
Canonical runtime: Staff App 3000 only  
Environment: Railway Testing (`tetamu-staff-app`)  
Deployment: `aac0156b-4aae-46f5-8d91-3208de702ca1` (`SUCCESS`)  
Fix commit: `b2ca88481e5126d5e3848a1a205e8d6a677d00c9`

## 1. FINAL VERDICT

**CODE FIX DEPLOYED; AUTOMATED OLD-ANDROID UAT PASS; PHYSICAL DEVICE RETEST REQUIRED.**

The target Vivo V2204 did reach Railway and downloaded the Staff login page and JavaScript, but its Android WebView / Chrome engines were Chrome 87 and Chrome 91. The deployed Next.js client runtime contained a class static block that those engines could not parse. React therefore never hydrated the login form and no OTP request was emitted.

The fix is a narrow production-build compatibility transform for the two affected Next.js client error-boundary modules. OTP security, origin checks, device identifiers, cooldowns, rate limits, challenge persistence and SMS123 logic were not weakened or bypassed.

## 2. DOES ANDROID REQUEST REACH RAILWAY?

The Android device reached Railway for page and asset requests, but **the OTP request did not reach Railway**.

Evidence from the pre-fix Testing deployment for the V2204 user agents:

- 62 HTTP requests were observed.
- `/staff/login` returned HTTP 200 repeatedly.
- Next.js chunks and PWA assets returned HTTP 200/304.
- `/api/employee-auth/request-otp`: **0 POST requests**.
- `/api/employee-auth/me`: **0 requests**, confirming that client hydration never completed.

## 3. DESKTOP VS ANDROID DIFFERENCE

Desktop Chrome 151 hydrated normally and sent `POST /api/employee-auth/request-otp`, receiving HTTP 202 in 862 ms.

The physical Android reported:

- VivoBrowser WebView: Chrome `87.0.4280.141`.
- Direct Android Chrome: Chrome `91.0.4472.114`.

Both downloaded the same client chunk but stopped before React hydration. A real Chrome 87 production-bundle reproduction produced `SyntaxError: Unexpected token '{'` in the shared Next.js client chunk. The exact unsupported construct was a class static block in Next.js client error-boundary code. The current Next.js 16 documented baseline is substantially newer than these target engines.

## 4. HTTP RESULT

Pre-fix Android OTP click had **no OTP HTTP result** because no request was sent. It was not an HTTP 4xx, HTTP 5xx, provider timeout or database timeout.

Relevant controls:

- Android page/assets: HTTP 200/304.
- Desktop OTP request: HTTP 202.
- iPhone Safari OTP request: HTTP 202 in 860 ms.
- Post-deployment `/api/health`: HTTP 200 with `database: ready`.
- Post-deployment `/staff/login`: HTTP 200.

## 5. RATE LIMIT / COOLDOWN

Rate limiting and cooldown were not the cause. They execute only after `POST /api/employee-auth/request-otp` reaches the server; the affected Android device emitted no POST.

No rate-limit or cooldown rule was changed. Focused tests confirm that rate-limited responses do not open a fake verification countdown and delivery failures do not trigger duplicate sends.

## 6. DEVICE FINGERPRINT

The device identifier was not the cause. `getOrCreateDeviceIdentifier()` runs inside the hydrated submit handler, which the affected browser never reached.

Existing behavior remains:

- Prefer `crypto.randomUUID()` when supported.
- Fall back to `crypto.getRandomValues()` when `randomUUID()` is unavailable.
- Replace malformed persisted identifiers.
- Preserve the verified device identifier across workplace switches.

The secure fallback and malformed-identifier paths passed regression tests.

## 7. FRONTEND ERROR HANDLING

The existing `staffApiFetch` and login `try/catch` correctly surface API/network failures after hydration. They could not catch this defect because the JavaScript parser failed before React installed the submit handler.

In the Chrome 87 reproduction, clicking the unhydrated form fell back to native browser form behavior and reloaded `/staff/login?`; no POST and no actionable error message were produced.

After the fix, the same engine hydrates, calls `/api/employee-auth/me`, controls form submission, sends one OTP POST and routes to `/staff/verify` without a page error.

## 8. ROOT CAUSE

The shared Next.js 16 client bundle contained class static block syntax from:

- `next/dist/client/components/catch-error.js`
- `next/dist/client/components/error-boundary.js`

Chrome 87/91 could not parse that syntax. Browserslist alone did not lower framework-internal precompiled code, so a targeted loader was required.

This is a client compatibility failure before API, database, cooldown, device fingerprint or SMS123 processing.

## 9. FIX IMPLEMENTED

Implemented a narrow Webpack production transform:

- Added an explicit Staff Android compatibility target (`chrome 87`).
- Added `scripts/chrome-87-compat-loader.cjs` using esbuild target `chrome87`.
- Applied the loader only to the two affected Next.js client error-boundary modules and only for the client build.
- Added regression tests verifying the browser target and elimination of class static blocks.

Not changed:

- OTP request/verification API.
- CSRF / same-origin checks.
- OTP challenge durability or hashing.
- SMS123 provider flow.
- Rate limits or cooldowns.
- Device/session security.
- Staff 3100.

## 10. ANDROID CHROME RESULT

Automated Chrome 87 production-build simulation: **PASS**.

- Page errors: 0.
- OTP POST attempts after double-click: 1.
- Navigation: `/staff/verify`.
- Post-deployment Testing smoke with Chrome 87: 1 controlled POST, 0 page errors, `/staff/verify` reached.

Physical V2204 Chrome retest: **OWNER ACTION REQUIRED** after closing/reopening the browser so the new chunks replace cached pre-fix assets.

## 11. ANDROID INCOGNITO RESULT

Automated Chrome 87 incognito simulation: **PASS**.

- Page errors: 0.
- OTP POST attempts: 1.
- Navigation: `/staff/verify`.

Physical Android incognito retest: **OWNER ACTION REQUIRED**.

## 12. ANDROID PWA RESULT

Automated Chrome 87 app-mode simulation: **PASS**.

- Page errors: 0.
- OTP POST attempts: 1.
- Navigation: `/staff/verify`.

Physical installed-PWA retest: **OWNER ACTION REQUIRED**. If the installed shell retains the old chunk, fully close it once and reopen; reinstall should only be needed if the device does not update its cached shell.

## 13. DESKTOP REGRESSION

**PASS.**

- Pre-fix Desktop Chrome 151 already reached the canonical endpoint and received HTTP 202.
- The compatibility loader is scoped to two Next.js client modules and does not change Staff business logic.
- Production build and TypeScript completed successfully.
- Staff authentication and PWA regression tests passed.

## 14. SMS123 RESULT

No real SMS was sent during this fix validation.

- Browser tests used a controlled HTTP 202 response to validate submission and deduplication without invoking SMS123.
- SMS123 adapter, verification, safe error mapping and fail-closed configuration tests passed.
- Existing Testing evidence confirms that supported clients reach the canonical OTP endpoint; this defect occurred before provider invocation.

## 15. TEST RESULTS

- Focused OTP / auth / PWA / device / delivery lifecycle tests: **53 passed, 0 failed**.
- New browser compatibility tests: **2 passed** (included in the 53).
- Chrome 87 normal mode: **PASS**.
- Chrome 87 incognito mode: **PASS**.
- Chrome 87 app/PWA mode: **PASS**.
- Double-click / duplicate request simulation: **1 POST only**.
- ESLint (changed files): **PASS**.
- `git diff --check`: **PASS**.
- Production build with Webpack: **PASS**.
- TypeScript: **PASS** (part of build).
- Railway Testing deployment: **SUCCESS**.
- Runtime health/database readiness: **PASS**.

## 16. NO NEW MIGRATION

**YES — NO NEW MIGRATION.**

No Prisma schema or migration file was changed.

## 17. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

