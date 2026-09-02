# TETAMU FULL SYSTEM UAT CLOSURE & TESTING DEPLOYMENT

Audit date: 2 September 2026  
Canonical workspace audited: `C:\CodexTetamuP0`  
Railway project: `Tetamu-POS`  
Scope: all Git worktrees, full repository, Railway Testing, and Production metadata read-only

## Executive decision

**Overall Status: BLOCKED**

The Windows source has been safely preserved and pushed, and every local worktree is clean. However, there is no single validated canonical branch that safely contains the full-system snapshot, the final Staff V2 release, and the PCB P3 work. The candidate histories have material merge conflicts. The full-system snapshot fails TypeScript, unit tests, and build; the final Staff release passes typecheck, lint, unit tests, and build but still fails three full disposable integration tests.

Therefore this closure deliberately did **not**:

- merge any candidate into `main`;
- push a new `main`;
- change Railway deployment sources;
- run migrations against Railway Testing or Production;
- redeploy any Testing service;
- modify, restart, or deploy Production.

This is the required safe outcome under the stated rule: preserve first, then stop on merge conflicts, failing tests, migration ambiguity, or unclear deployment provenance.

## 1. Source-control closure

### Final answers

| Check | Result | Evidence |
|---|---:|---|
| Windows workspace clean | **YES** | All 22 listed worktrees returned zero status entries after preservation and validation. |
| Windows local-only source code | **NO** | All discovered source changes were committed to dedicated snapshot branches and pushed. |
| Uncommitted source code | **NO** | No staged, unstaged, or important untracked source remains. |
| Unpushed commits | **NO** | Each newly created preservation branch has a matching `origin/*` ref. |
| Untracked important files | **NO source files** | Remaining ignored files are operational/generated artifacts, DB dumps, build output, and local secrets. They remain on disk and were not deleted. |
| Stash containing source changes | **NO** | `git stash list` is empty. |
| Submodules | **NONE** | No submodules were found. |
| Detached worktrees | **YES, clean** | Detached validation/deployment-history worktrees remain, but have no changes. |
| All important source pushed | **YES, as preservation branches** | This does not mean the branches are safe to merge. |
| Canonical branch established | **NO** | `main` is old; competing candidates conflict and are not fully green. |

### Preservation commits created and pushed

| Branch | Commit | Preserved content |
|---|---|---|
| `codex/full-system-windows-snapshot-20260902` | `e4bb4bf339edf92296d8871bd6df94462af879e9` | Full Windows UAT source/config/migrations/tests/docs plus referenced POS/closing evidence |
| `codex/clockout-local-snapshot-20260902` | `e8e004a499875d86d4eecf22cbb07b6c183e09e5` | Detached Staff clock-out worktree changes |
| `codex/staff-v2-global-closure-snapshot-20260902` | `a063e172207a3fa7c8505fae84806c42a07858a2` | Staff V2 global closure documents |
| `codex/staff-payslip-pdf-v2-report-snapshot-20260902` | `b462b7237aef55cb214d5e56ae5a3a2fd5165300` | Payslip PDF V2 report |
| `codex/pcb-p3-local-snapshot-20260902` | `9f27748bb200707627c88ccf3a6400188d2bad75` | PCB P2/P3 source, tests, datasets, certification artifacts |
| `codex/staff-ui-next-env-snapshot-20260902` | `c5f3650b82658691575a7a00e3ccb3548cd42825` | Generated Next environment marker from a separate worktree |

The initial full-system source preservation commit was `a380f82c0a95c1724c0edaebaf9dae4bd91c008e`; `e4bb4bf` adds the UAT evidence commit on top.

### Files intentionally not committed

- `.env.development.local`, `.env.local`, `whatsapp-connector/.env`;
- `node_modules`, `.next`, `dist`, caches, logs, and other build output;
- `artifacts/`, including approximately 51.8 MB of local database `.dump`/`.sql` backup material;
- generated Railway cutover output and accidental shell-fragment filenames.

These remain local where present. They were excluded locally through `.git/info/exclude`; no secret value was read or printed. A staged-content scan found no real credentials in the preservation commits.

## 2. Tetamu application inventory

The repository is not a conventional multi-package frontend monorepo. The root is one Next.js 16 application containing the main POS/business UI, Staff 3000 UI, admin/group UI, REST/API routes, shared domain services, Prisma schema, background workers, and operational scripts. The WhatsApp connector is a separate Node/TypeScript package.

| Application/service | Directory | Runtime | Build / validation | Start / execution | Railway service | Testing | Production | Source identity |
|---|---|---|---|---|---|---:|---:|---|
| Main Web / POS / Admin / API | repository root | Node 22–24, Next.js 16.3, React 19 | `npm run build` | `npm start` | `tetamu-pos-web` | Yes | Yes | Testing runtime reports `4070f2f`; Production is `86ae5f4` |
| Staff App 3000 | root `app/staff`, shared root services | Same Next runtime | root build/tests | Served by Next app | `tetamu-staff-app` | Yes | No separate Production service discovered | Testing runtime reports `bcb00b0` |
| Backend / REST API | root `app/api`, shared services | Same Next server | root build/tests | Same Next deployment | Embedded in POS/Staff deployments | Yes | Yes through main web | Follows containing deployment |
| Notification worker | root scripts | Node + `tsx` | root install/generate | `npm run notification:worker` | `tetamu-pos-worker` | Yes | Yes | Testing CLI upload SHA not exposed; Production `86ae5f4` |
| Analytics refresh worker/job | root scripts | Node + `tsx` | root install/generate | `npm run analytics:worker` / `npm run analytics:refresh` | No dedicated active service found | Not separately deployed | Not separately deployed | Repository capability only |
| WhatsApp worker wrapper | root scripts | Node | root validation | `npm run whatsapp:worker` | No distinct active service found | Not separate | Not separate | Repository capability only |
| WhatsApp connector | `whatsapp-connector` | Node/TypeScript | `npm run build`; `npm test` | `npm start` | `tetamu-pos-whatsapp` | Yes | Yes | Testing CLI upload SHA not exposed; Production `86ae5f4` |
| DB backup job | root + `Dockerfile.database-ops` | Node/Postgres tools | Docker build | scheduled backup script | `tetamu-db-backup` | Yes | No matching Production service found | CLI upload; Git SHA not exposed |
| DB restore verification | root + `Dockerfile.database-ops` | Node/Postgres tools | Docker build | disposable restore verification | `tetamu-db-restore-verify` | Yes | No matching Production service found | CLI upload; Git SHA not exposed |
| Ops health monitor | root + `Dockerfile.ops-monitor` | Node/TypeScript | Docker/root install | `npm run ops:monitor` | No current service detected | No | No | Repository capability only |
| Prisma/migration tooling | `prisma`, root scripts | Prisma 6 | `npm run prisma:generate`; `npm run prisma:migrate:fresh-check` | migration/seed/backup scripts | Used by deployed apps/jobs | Yes | Yes through deployment process | Branch-dependent |
| Payroll/statutory/report jobs | root services/scripts/tests | Node/Next/Prisma | root build/tests and statutory verification scripts | invoked by app or operator | No separate active service detected | Embedded | Embedded | Branch-dependent |

Root functional areas include POS, cashier, appointments, customers/CRM, catalog/services/products/packages, work orders, invoices/payments/refunds, closing, inventory, expenses, loyalty, discounts, branches/business groups, team/HR, roster, attendance/timesheets, leave, claims, approvals, payroll/payslips/commission/statutory artifacts, reports/analytics, WhatsApp, AI, admin/platform, and Staff self-service.

## 3. Branch audit and classification

### Main and primary candidates

| Branch | HEAD | Ahead / behind `origin/main` | Upstream | Last commit | Merged into main? | Unique/current content | Classification |
|---|---|---:|---|---|---:|---|---|
| `main` / `origin/main` | `86ae5f4c00b63582e882ef4690d9b7b0587b0294` | 0 / 0 | `origin/main` | 12 Jul 2026, WhatsApp session isolation | Yes | Old Production baseline | **ALREADY IN MAIN**, not current UAT canonical |
| `codex/full-system-windows-snapshot-20260902` | `e4bb4bf339edf92296d8871bd6df94462af879e9` | 141 / 0 | matching origin | 2 Sep 2026 | No | Broad full-system UAT working state | **REVIEW REQUIRED**; fails validation |
| `release/staff-v2-payslip-final-polish-20260902` | `bcb00b0b69cb568b59b4872a352aee7bde89b302` | 232 / 0 | matching origin | 2 Sep 2026 | No | Exact deployed Staff V2 candidate, 213 migrations | **REVIEW REQUIRED**; three integration failures and conflicts |
| `codex/pcb-p3-local-snapshot-20260902` | `9f27748bb200707627c88ccf3a6400188d2bad75` | 140 / 0 | matching origin | 2 Sep 2026 | No | PCB P2/P3 certification work | **REVIEW REQUIRED**; conflicts with full-system snapshot |
| `codex/testing-release-2026-08-24` | `9037025b10adb215a17d19acf61df51e23ef95fb` | ancestor of newer snapshots | matching origin | 27 Aug 2026 | No | Earlier full-system Testing baseline | **NOT READY as final canonical**; retained in newer line |
| `release/staff-v2-payslip-pdf-v2-20260902` | `f61404980fcd242c78d7f5fef0bdeca478a68b74` | newer than main | matching origin | 2 Sep 2026 | No | Pre-polish Staff payslip release | **NOT READY as final**; superseded by `bcb00b0` content line |
| `release/staff-v2-payslip-pdf-20260902` | `2fe99bece9c97bd947e2cadffb2659e6e53c91b3` | newer than main | matching origin | 2 Sep 2026 | No | Earlier Staff PDF release | **NOT READY as final**; superseded by later Staff release |
| `release/first-production-staff-v2-20260902` | `ab432c36435fe1eae446bc8ca0f517468b0db694` | newer than main | matching origin | 2 Sep 2026 | No | Earlier Staff production candidate | **NOT READY as final**; superseded by later Staff release |

### Preserved local work

All six newly created preservation branches are **REVIEW REQUIRED**. Their purpose is lossless retention, not an assertion that each should be merged. In particular, the clock-out snapshot overlaps later Staff work; the generated Next marker is not a business feature; and the documentation-only branches should only be reconciled after the underlying code line is selected.

### Staff V2 development chain

Recent Staff branches include `codex/staff-time-v2-phase1`, `staff-schedule-v2`, `staff-attendance-history-v2`, `staff-timesheet-v2`, `staff-timesheet-v2-final-polish`, `staff-approval-center-v2-canonicalization`, `staff-requests-hub-v2`, `staff-leave-v2`, `staff-leave-new-form-polish`, `staff-claims-v2`, `staff-correction-archive-phase1`, `staff-manager-p2-projection`, `staff-approval-visual-v2`, `staff-pay-read-only-prereqs`, `staff-pay-hub-v2`, `staff-payslips-v2`, `staff-commission-v2`, `staff-profile-v2`, and `staff-v2-global-closure`.

These are retained and contain development history, but they must not be individually merged into `main` by branch name. The final Staff release has the strongest validation and is the best Staff-specific comparison target, but non-linear/cherry-picked history means ancestry alone does not prove every historical report branch is safely subsumed. Classification: **REVIEW REQUIRED / superseded as deployment candidates**, not deleted and not blindly merged.

### Older business-group and security branches

The July/August business-group chain, user-side release, platform login recovery, WhatsApp authorization, and later testing-release work are present in the newer full-system ancestry where commit ancestry proves inclusion. Their independent branches are retained. No branch was deleted or labelled obsolete solely from its name.

### Merge simulation evidence

No real merge was performed. Safe tree-only merge simulations found:

- full-system snapshot + final Staff release: about 549 files changed, with conflicts in `next.config.mjs`, lockfile, Staff assets/UI/CSS, OTP, Attendance, approvals, payslips, commission, roster, payroll publication/export, permission/read models, and tests;
- full-system snapshot + PCB P3 snapshot: about 420 files changed, with conflicts across PCB P2 documentation, generators, certification datasets, and tests;
- merge base of full-system snapshot and final Staff release: `6a5db247…`;
- merge base of full-system snapshot and PCB snapshot: `9037025b…`.

These are business-logic conflicts. Selecting `ours` or `theirs` would risk losing UAT work, so there are currently **no SHOULD MERGE branches approved for automatic main canonicalization**.

## 4. Validation evidence

### Full-system Windows snapshot (`e4bb4bf`)

| Check | Result | Detail |
|---|---|---|
| Clean install | PASS | `npm ci` |
| Prisma client generation | PASS | Required `NODE_OPTIONS=--use-system-ca` on this Windows host |
| Typecheck | **FAIL** | 9 errors |
| Lint | PASS with warnings | 0 errors, 5 warnings |
| Unit tests | **FAIL** | 1,396 passed, 8 failed, 0 skipped |
| Build | **FAIL** | Compilation reached TypeScript and failed on the same 9 errors |
| Fresh migrations | PASS | 212 migrations applied to a disposable local database |

The type errors involve missing invoice monetary fields, implicit types in Staff attendance corrections, a missing `loadPendingAttendanceExceptionQueue` export, and a read-service type that does not accept `excludedMembershipId`.

The eight failing unit tests cover employee profile editing, payroll lock/payment wording, sensitive capability/artifact entry points, payroll draft/final download semantics, payroll export/preview/payslip contracts, Attendance projection/scoping/self-review/capability, manager queue scoping, and manager decision canonical workflow/guards.

### Final Staff release (`bcb00b0`)

| Check | Result | Detail |
|---|---|---|
| Clean install | PASS | `npm ci` |
| Prisma client generation | PASS | Windows system CA option used |
| Typecheck | PASS | `npx tsc --noEmit` |
| Lint | PASS with warnings | 0 errors, 7 warnings |
| Unit tests | PASS | 1,408 passed, 0 failed, 0 skipped |
| Build | PASS | Production Next build completed |
| Fresh migrations | PASS | 213 migrations applied; final migration `20260902120000_staff_otp_forward_hardening` |
| Disposable integration tests | **FAIL** | 190 passed, 3 failed, 0 skipped |

The three integration failures are:

1. commercial request allowance expected 99 remaining reservations but read 0;
2. P4A recurring pay scenario was rejected by the backdated recurring-pay guard;
3. P4B payroll explanation scenario was rejected by the same immutable-history guard.

### WhatsApp connector in the final Staff release

| Check | Result |
|---|---|
| `npm ci` | PASS |
| Unit tests | 4 passed, 0 failed |
| Build | PASS |

### Validation conclusion

The repository-wide result is **FAIL**. The Staff line is substantially healthier, but three integration failures prevent full-system release readiness. No test was deleted, filtered, skipped, converted to todo, or weakened.

## 5. Database and Prisma safety

- Full-system snapshot contains 212 migrations and passes a fresh disposable apply.
- Final Staff release contains 213 migrations and passes a fresh disposable apply.
- The additional Staff migration is the committed forward-only OTP hardening migration.
- Generated Prisma client succeeds after dependency installation.
- No Production database command was run.
- No Testing migration was run during this closure.
- Railway Testing remote drift was **not** mutated or automatically repaired.
- Exact remote schema-drift equivalence between every competing branch and the active Testing database is **not established** in this closure.
- The existing Testing backup and restore-verification services show successful active deployments, but this is not a substitute for proving the competing code branches share one migration ledger.

**Database migration result:** local fresh-path PASS for both candidates; remote canonical reconciliation **REVIEW REQUIRED**.  
**Schema drift:** **UNKNOWN / NOT SAFELY PROVEN**, not reported as NO.

## 6. Main canonicalization decision

| Item | Value |
|---|---|
| Previous local/remote main SHA | `86ae5f4c00b63582e882ef4690d9b7b0587b0294` |
| Final local/remote main SHA | `86ae5f4c00b63582e882ef4690d9b7b0587b0294` |
| Main changed | **NO** |
| Final canonical main SHA | **NOT ESTABLISHED** |
| GitHub preservation synchronized | **YES** |
| GitHub canonical main synchronized to UAT | **NO** |

Updating `main` would violate the stated safety conditions because the merge is conflicted and the candidates are not fully green. The current `main` also cannot honestly be presented as the latest UAT source.

## 7. Railway Testing inventory

No deployment or source setting was changed. The following is the read-only state observed during this closure.

| Service | Status | Deployment ID / date | Railway branch/SHA metadata | GitHub traceability | Notes |
|---|---|---|---|---|---|
| `tetamu-pos-web` | SUCCESS | `4b1bd782-94b2-486f-a4b6-05bbd1c4c7bd`, 30 Aug | CLI upload; branch/SHA null | Runtime health reports `4070f2fdeca66870004065efdad3b0d69d5274c6`; commit exists and is now reachable through the pushed snapshot | Source digest `ee035987…` |
| `tetamu-staff-app` | SUCCESS | `64a3d9a9-12a3-4705-83d7-99a25c6aac51`, 2 Sep | CLI upload; branch/SHA null | Runtime health reports exact pushed release `bcb00b0b69cb568b59b4872a352aee7bde89b302` | Source digest `09dfc490…` |
| `tetamu-pos-worker` | SUCCESS | `87636281-82fd-4609-afa2-961331b29365`, 30 Aug | CLI upload; SHA null | **UNVERIFIABLE from Railway metadata** | Starts notification worker; log sample has no error |
| `tetamu-pos-whatsapp` | SUCCESS | `a11df9f0-b107-4e9e-8ba8-333ab4578738`, 9 Aug | CLI upload; SHA null | **UNVERIFIABLE from Railway metadata** | Root `/whatsapp-connector`; health 200 |
| `tetamu-db-backup` | SUCCESS | `d4e6927d-9c99-4a6f-bf5c-2fdca520e416`, 2 Sep | CLI upload; SHA null | **UNVERIFIABLE from Railway metadata** | Cron `30 18 * * *` |
| `tetamu-db-restore-verify` | SUCCESS | `77ec91a9-b9ae-49bd-b107-070972899b4e`, 2 Sep | CLI upload; SHA null | **UNVERIFIABLE from Railway metadata** | Cron `30 19 1 * *` |
| `Postgres-Canonical-Testing` | SUCCESS | `abe80892-29e3-4afe-a118-243b46444914` | Image deployment | N/A | Current canonical-named DB service |
| `Postgres-Canonical-Testing-SG` | latest deployment **FAILED** | `4c0557c6-57d8-4a9a-932a-b624af8c9318`, 30 Aug | Postgres SSL image | N/A | A prior active deployment was observed running; latest status is still a failure requiring owner review |
| `Postgres-Singapore` | SUCCESS | `04b6e663-4d0e-4d6c-8b33-2e0e437d147a`, 12 Jul | Postgres SSL image | N/A | Legacy-named database service |

The Next API/backend is embedded in the POS/Staff web services; there is no separate API Railway service. No separate analytics, payroll, reports, queue, or ops-monitor service was present in the current Testing inventory.

### Deployment reconciliation

| Service | Environment | Declared branch | GitHub/source identity | Railway identity | Match? |
|---|---|---|---|---|---|
| POS Web | Testing | null (CLI upload) | commit `4070f2f` exists; snapshot is 3 commits later | health: `4070f2f` | Runtime identity matches an existing Git commit, but not branch HEAD |
| Staff App | Testing | null (CLI upload) | `release/staff-v2-payslip-final-polish-20260902` = `bcb00b0` | health: `bcb00b0` | **YES**, exact runtime/release identity |
| Worker | Testing | null | unknown | null | **UNVERIFIABLE** |
| WhatsApp | Testing | null | unknown | null | **UNVERIFIABLE** |
| DB jobs | Testing | null | unknown | null | **UNVERIFIABLE** |

Because CLI-uploaded worker/job services expose no commit metadata, **not all Testing deployed commits can be proven to exist in GitHub**. Also, the POS and Staff are intentionally on different code commits. The Testing stack is not yet reproducible from one canonical GitHub branch.

## 8. Post-deployment health and logs

This was a read-only health check against the existing deployments, not a post-new-deployment verification.

| Endpoint/service | Result |
|---|---|
| Testing POS `/api/health` | HTTP 200; database ready; release `4070f2f` |
| Testing Staff `/api/health` | HTTP 200; database ready; release `bcb00b0` |
| Testing Staff `/staff/login` | HTTP 200 |
| Testing POS root | HTTP 307 to `/reports` in an unauthenticated request |
| Testing WhatsApp `/health` | HTTP 200; healthy; 3 active sessions at observation time |
| Staff log sample | 12 lines; no matched error/fatal/panic patterns |
| Worker log sample | 8 lines; no matched error/fatal/panic patterns |
| POS log sample | repeated Prisma unique constraint failures on `(business_id, provider, event_key)` |
| WhatsApp log sample | one `Failed to forward WhatsApp receipt update` match |

The POS duplicate event errors may represent an idempotency race handled above the database or a genuine retry defect; the sampled message alone is insufficient to decide. The WhatsApp receipt-forward failure likewise needs correlation with timestamp/request context. Both are **REVIEW REQUIRED**, not silently treated as healthy.

No crash loop, module-not-found, migration-failed, or boot-failure signature was observed in the limited samples for Staff and worker.

## 9. Full-system smoke status

Only non-destructive, public/read-only smoke was performed. The requested authenticated business workflow smoke requires valid owner/staff sessions and controlled fixtures. No credentials were requested, extracted, or modified, and no unnecessary SMS/WhatsApp message was sent.

| Area | Result | Reason |
|---|---|---|
| POS | **PARTIAL / BLOCKED** | Health endpoint works; authenticated POS/customer/service/work-order/checkout flow not run |
| Staff | **PARTIAL / BLOCKED** | Login and health load; authenticated home and subpages not run |
| Auth | **BLOCKED** | Owner/admin and real OTP flows not executed during this closure |
| HR / employee | **BLOCKED** | Authenticated UI smoke not run |
| Roster | **BLOCKED** | Authenticated UI smoke not run |
| Attendance / Timesheet | **BLOCKED** | Authenticated UI smoke not run; related integration coverage includes failures elsewhere |
| Leave | **BLOCKED** | Authenticated UI smoke not run |
| Claims | **BLOCKED** | Authenticated UI smoke not run |
| Approvals | **BLOCKED** | Authenticated UI smoke not run |
| Commission | **BLOCKED** | Authenticated UI smoke not run |
| Payroll / payslip | **BLOCKED** | Authenticated UI smoke not run; two payroll integration scenarios fail |
| Reports | **BLOCKED** | Root redirects to reports, but authenticated page/data not verified |
| Expenses | **BLOCKED** | Authenticated UI smoke not run |
| WhatsApp | **PARTIAL** | Health 200; no real customer message sent; one receipt-forward error in logs |
| SMS123 | **NOT SENT** | Configuration contract present; no unnecessary OTP sent |
| Worker | **PARTIAL** | Deployment success and clean boot sample; business processing not end-to-end verified |
| DB backup/restore jobs | **PARTIAL** | Active deployments successful; no new destructive restore was initiated |

The smoke requirement is therefore not complete and cannot be called PASS.

## 10. Production metadata — read only

**PRODUCTION WAS NOT MODIFIED, DEPLOYED, RESTARTED, OR RECONFIGURED.**

| Service | Status | Branch/SHA | Deployment date | GitHub commit exists | Difference from Testing |
|---|---|---|---|---:|---|
| `tetamu-pos-web` | SUCCESS | `main` / `86ae5f4c00b63582e882ef4690d9b7b0587b0294` | 20 Jul 2026 | Yes | 138 commits behind Testing POS commit by ancestry |
| `tetamu-pos-worker` | SUCCESS | `main` / `86ae5f4…` | 11 Jul 2026 | Yes | Testing worker exact SHA unavailable |
| `tetamu-pos-whatsapp` | SUCCESS | `main` / `86ae5f4…` | 12 Jul 2026 | Yes | Testing WhatsApp exact SHA unavailable |
| `Postgres-Singapore` | SUCCESS | image deployment | 11 Jul 2026 | N/A | No DB comparison/mutation performed |
| `Postgres` | SUCCESS | image deployment | 23 Aug 2026 | N/A | No DB comparison/mutation performed |

Production POS `/api/health` returned 404 because the old deployment does not expose the newer health route. Production WhatsApp `/health` returned 200 with one active session at observation time. These were read-only HTTP checks.

## 11. Environment and secret migration audit

Do not copy the Windows `.env*` files into Git or chat. Obtain each value from the authorised password manager, Railway variable set, provider console, or a newly generated local-only secret.

| Variable/file family | Used by | Required locally? | Retrieval/configuration |
|---|---|---:|---|
| `.env.local`, `.env.development.local` | root Next app/scripts | Yes for full local runtime | Recreate from `.env.example`; obtain secrets from authorised owner/Railway, never Git |
| `whatsapp-connector/.env` | WhatsApp connector | Only for local connector work | Authorised WhatsApp/Railway configuration |
| `DATABASE_URL` | Next/API/workers/Prisma | Yes | Local embedded DB command or authorised development DB; never copy Production URL |
| `DIRECT_URL` where applicable | Prisma/direct DB operations | Environment-dependent | Authorised DB configuration; contract should be confirmed before use |
| `APP_ENVIRONMENT`, `APP_RELEASE_SHA`, `APP_RELEASE_SOURCE_DIGEST`, `STAFF_APP_ORIGIN` | release identity/runtime | Yes in release-like runs | Set explicitly for local/Testing; digest generated by repo script |
| `SESSION_SECRET`, `EMPLOYEE_AUTH_SECRET`, employee session/OTP limits | owner/staff auth | Yes for auth testing | Generate or retrieve authorised development values |
| `EMPLOYEE_OTP_MOCK_ACCESS_KEY` | controlled mock OTP | Only authorised non-production workflows | Generate locally; must not be enabled in Production |
| `SMS123_API_KEY`; optional Twilio SID/key/token | SMS/OTP provider | Needed for real provider tests only | SMS123/Twilio provider console or Railway Testing variables |
| `STAFF_OTP_VERIFY_*`, `EMPLOYEE_OTP_*` limits | Staff OTP throttling | Defaults may exist; set for release parity | Follow `.env.example` and environment contract |
| `MFA_ENCRYPTION_KEYS`, `MFA_ACTIVE_KEY_VERSION`, `TETAMU_MFA_ENABLED` | MFA-sensitive actions | Required for those paths | Authorised secret store; use local setup script where appropriate |
| `PAYROLL_PAYMENT_ENCRYPTION_KEYS`, active key version, fingerprint key, bank-account MFA flag | Payroll payment protection | Required for payroll payment paths | Authorised secret store; use local payroll key setup script |
| `STATUTORY_ARTIFACT_ENCRYPTION_KEYS`, active version | statutory/payroll artifacts | Required for protected artifact paths | Authorised secret store |
| Claim private storage provider/root or S3 endpoint/bucket/region/credentials/prefix | claim attachments | Needed when testing attachment storage | Local filesystem or authorised S3-compatible development bucket |
| `WHATSAPP_CONNECTOR_URL`, connector/API secret, webhook secret, incoming business ID, send mode | main app ↔ connector | Needed for connector integration | Railway Testing/provider config; use safe non-sending mode unless authorised |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI features | Only for AI paths | OpenAI project secret/config; do not commit |
| Railway CLI authentication/project link | deployment/metadata | Only for Railway work | Authenticate interactively on the Mac and link the correct project/environment |

`gitignore` and the preservation process kept secret files and generated output out of Git. The environment validator enforces key production/release variables, but it does not make secret values portable.

## 12. Toolchain audit

| Tool | Repository requirement / observed Windows version | Mac recommendation |
|---|---|---|
| Node.js | `>=22 <25`; observed `v24.15.0` | Install Node 24 LTS-compatible release used by the team, or pin exact `24.15.0` if available |
| npm | observed `11.12.1`; Railway detects npm | Use `11.12.1` for lockfile parity |
| Git | observed `2.53.0.windows.3` | Current Git with credential helper/SSH configured |
| Railway CLI | observed `5.30.3` | Install `5.30.3` or team-approved compatible version |
| Next.js | `16.3.0` | Installed by `npm ci`; follow bundled Next 16 docs before code changes |
| React | `^19.1.0` | Installed by `npm ci` |
| TypeScript | `^5.8.3` | Installed by `npm ci` |
| Prisma | package range `^6.10.1`; generated CLI observed `6.19.3` | Use the project-local CLI through npm/npx |
| PostgreSQL | embedded/local scripts plus disposable migration tools | No global install required if repository embedded workflow works; native tools help DB operations |

Both `package-lock.json` and `pnpm-lock.yaml`/`pnpm-workspace.yaml` exist, but the validated and Railway-observed install path is npm. Do not copy `node_modules`, `.next`, `dist`, or caches from Windows.

## 13. New MacBook bootstrap

### Safety decision

**MacBook migration safe as a single canonical continuation: NO.**

There is no trustworthy all-system `main` yet. For lossless full-system inspection and reconciliation, start from the pushed Windows snapshot. For exact currently deployed Staff code, use the separate Staff release branch. Do not assume either branch alone is the final whole-system source of truth.

### Full-system preservation baseline

```bash
git clone https://github.com/Oscaryjh/carwashpro.git
cd carwashpro
git fetch --all --prune
git switch --track origin/codex/full-system-windows-snapshot-20260902
git rev-parse HEAD
```

Expected code snapshot HEAD before this report-only closure commit:

```text
e4bb4bf339edf92296d8871bd6df94462af879e9
```

Then install and validate:

```bash
nvm install 24
nvm use 24
npm install --global npm@11.12.1 @railway/cli@5.30.3
npm ci
npm run prisma:generate
npm run prisma:migrate:fresh-check
npm run lint
npm test
npm run build
```

The last two commands are expected to fail on this snapshot until the documented repository errors are reconciled; this is intentional disclosure, not a bootstrap success claim.

Recreate local environment files from the committed template and authorised secret sources, then use:

```bash
npm run doctor
npm run db:start
npm run dev
```

### Exact currently deployed Staff V2 source

```bash
git fetch --all --prune
git switch --track origin/release/staff-v2-payslip-final-polish-20260902
git rev-parse HEAD
```

Expected HEAD:

```text
bcb00b0b69cb568b59b4872a352aee7bde89b302
```

This branch passes typecheck, lint, unit tests, build, and fresh migration validation, but still has the three documented integration failures. It is an exact Staff deployment source, not the approved full-system canonical branch.

## 14. Required next action

Create a controlled reconciliation branch from an explicitly chosen base—do not use `main` directly. Resolve in domain-owned batches:

1. reconcile the full-system and Staff release diffs, beginning with schema/migration ledger and authentication/OTP;
2. reconcile Attendance/approvals/RBAC/read-model conflicts;
3. reconcile payroll/payslip/publication/export and the three Staff-line integration failures;
4. reconcile PCB P3 artifacts and generators without overwriting the UAT line;
5. rerun clean install, Prisma generation, typecheck, lint, all unit/integration/app-specific tests, build, and fresh migrations;
6. only after a fully green result, fast-forward or merge that reviewed branch into `main` without force push;
7. configure Railway Testing services to deploy traceably from the reviewed GitHub branch/main, then deploy in dependency order;
8. run authenticated full-system smoke and reconcile every deployed service identity;
9. leave Production untouched until a separate, explicit Production release approval.

## 15. Requested final closure format

### SOURCE CONTROL

Windows workspace clean: **YES**  
Local-only source code: **NO**  
Unpushed commits: **NO**  
All important source pushed: **YES, to preservation/release branches**  
Canonical branch: **NOT ESTABLISHED**  
Previous main SHA: `86ae5f4c00b63582e882ef4690d9b7b0587b0294`  
Final canonical SHA: **NOT ESTABLISHED; main unchanged**  
GitHub synchronized: **Preserved source YES; canonical main NO**

### BRANCH CLOSURE

Merged branches: **NONE**  
Already merged: `main` baseline only; older inclusion is retained where ancestry proves it  
Not-ready branches excluded: earlier Staff release/development candidates and testing baseline as automatic main candidates  
Obsolete branches: **NONE deleted or conclusively declared obsolete**  
Review-required branches: full-system snapshot, final Staff release, PCB P3 snapshot, clock-out snapshot, and documentation snapshots

### VALIDATION

Typecheck: **FAIL on full-system snapshot; PASS on Staff final**  
Lint: **PASS with warnings**  
Tests: **FAIL overall**  
Tests passed: **1,396/1,404 unit on snapshot; 1,408/1,408 unit plus 190/193 integration on Staff final; WhatsApp 4/4**  
Tests failed: **8 snapshot unit; 3 Staff-final integration**  
Tests skipped: **0 in reported runs**  
Build: **FAIL on snapshot; PASS on Staff final and WhatsApp**  
Database migration: **PASS locally on disposable DB; remote reconciliation REVIEW REQUIRED**  
Schema drift: **UNKNOWN / NOT PROVEN**

### TESTING DEPLOYMENT

POS Web: **EXISTING SUCCESS**, SHA `4070f2fdeca66870004065efdad3b0d69d5274c6`  
Staff App: **EXISTING SUCCESS**, SHA `bcb00b0b69cb568b59b4872a352aee7bde89b302`  
API/Backend: **EXISTING SUCCESS embedded in web deployments**, SHA follows container  
Worker: **EXISTING SUCCESS**, SHA unavailable  
WhatsApp: **EXISTING SUCCESS**, SHA unavailable  
Cron/Jobs: **backup and restore-verify existing SUCCESS**, SHA unavailable  
Other: **latest `Postgres-Canonical-Testing-SG` deployment FAILED; active DB availability must be distinguished from latest deployment result**

No new deployment was executed because the canonicalization prerequisites failed.

### DEPLOYMENT RECONCILIATION

All Testing deployments successful: **NO**  
All Testing deployed commits exist in GitHub: **UNVERIFIABLE / NO strict proof**  
Testing code matches expected GitHub source: **NO single expected canonical source exists**  
Testing reproducible from GitHub: **NO, not yet as one traceable stack**

### SMOKE

POS: **PARTIAL / BLOCKED**  
Staff: **PARTIAL / BLOCKED**  
HR: **BLOCKED**  
Roster: **BLOCKED**  
Attendance: **BLOCKED**  
Leave: **BLOCKED**  
Claims: **BLOCKED**  
Approvals: **BLOCKED**  
Commission: **BLOCKED**  
Payroll: **BLOCKED**  
Reports: **BLOCKED**  
Expenses: **BLOCKED**  
WhatsApp: **PARTIAL**  
Workers: **PARTIAL**

### PRODUCTION

Production inspected: **YES, metadata and non-mutating health only**  
Production modified: **NO**  
Production deployed: **NO**

### MACBOOK

MacBook migration safe: **NO, not as a single canonical continuation**  
Recommended branch: `codex/full-system-windows-snapshot-20260902` for full-system reconciliation; `release/staff-v2-payslip-final-polish-20260902` for exact deployed Staff comparison  
Expected snapshot SHA: `e4bb4bf339edf92296d8871bd6df94462af879e9` before this report-only commit  
Expected Staff SHA: `bcb00b0b69cb568b59b4872a352aee7bde89b302`  
Environment migration required: **YES**

### FINAL

Remaining blockers:

- no conflict-free, validated full-system canonical branch;
- 9 TypeScript errors, 8 unit failures, and build failure on the full-system snapshot;
- 3 integration failures on the final Staff release;
- full-system vs Staff and PCB merge conflicts;
- remote migration/schema equivalence not proven for a combined candidate;
- worker/WhatsApp/DB-job Testing deployment SHA provenance unavailable;
- latest `Postgres-Canonical-Testing-SG` deployment failed;
- authenticated full-system smoke not completed;
- POS duplicate-event and WhatsApp receipt-forward log errors require review.

Warnings:

- `main` and Production remain at the July baseline and are not the latest UAT code.
- Existing Testing POS and Staff run different Git commits.
- A healthy endpoint does not prove all authenticated workflows.

Next action: **Build and review a dedicated reconciliation branch, make the full validation suite green without weakening it, then canonicalize main and redeploy Testing from traceable GitHub sources.**

**PRODUCTION NOT MODIFIED. PRODUCTION NOT DEPLOYED.**
