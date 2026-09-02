# TETAMU STAFF V2 RELEASE CANDIDATE RECONCILIATION AND EXACT TESTING REPORT

Audit date: 2026-09-02 (Asia/Singapore)  
Canonical project inspected: `C:\CodexTetamuP0`  
Isolated audit worktree: `C:\CodexTetamuP0-global-uat-20260902`  
Runtime policy: Staff 3000 only; Staff 3100 reference only  
Execution boundary: **TESTING ONLY**

## 1. FINAL VERDICT

**BLOCKED**

The release-candidate construction and exact-candidate Railway Testing deployment did not proceed. The mandatory baseline gate cannot be satisfied from the authorized evidence:

- the only remote default ref, `origin/main` at `86ae5f4c00b63582e882ef4690d9b7b0587b0294`, is dated 2026-07-12 and cannot be proven to be the current Production-compatible baseline;
- the proposed `94db430d894d1ee0712ae4201e43505138cbcd06` is 197 commits ahead of `origin/main` and deploys a monolith, not only Staff;
- `94db430` inherits AI, PCB/payroll and broader HR/admin runtime from `9037025`, while those non-Staff modules were not approved by the Staff owner UAT;
- accepted Testing `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf` and proposed `94db430` diverge from merge-base `6a5db247aa8c7ab76234a7ed918a6d5978d08683` by 94 and 63 commits respectively;
- migration differences include a real OTP schema/constraint/trigger lineage gap, not merely migration-name drift.

This matches the explicit blocking condition: **release baseline cannot be proven**. Constructing or deploying a branch now would be speculative.

## 2. EXECUTIVE SUMMARY

The accepted Staff V2 commit ancestry is present in `94db430`, and its previously audited local gates were healthy. That is not enough to approve the entire monolith as a release package.

The root worktree remains release-unsafe with 311 status entries. The isolated worktree points to a clean tracked source commit, but its branch is local-only and has no upstream. A tracked-source diff from accepted Testing to the proposed snapshot contains 554 files. A complete file-level classification is provided in `TETAMU_STAFF_V2_RELEASE_DIFF_MANIFEST.tsv`.

Because no Production-compatible baseline can be proven without owner input, this phase stopped before:

- creating or pushing a release branch;
- querying the Testing migration ledger;
- changing Railway Testing variables;
- taking a Testing backup;
- rerunning release gates as a newly frozen release package;
- deploying to Railway Testing;
- sending any OTP or asking for owner device UAT.

## 3. RELEASE BASELINE

**Classification: BASELINE REQUIRES OWNER DECISION**

| Evidence | Result |
|---|---|
| Only remote default ref | `origin/main` → `86ae5f4c00b63582e882ef4690d9b7b0587b0294` |
| Remote ref date | 2026-07-12 |
| Latest known accepted Testing | `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf` |
| Proposed Staff V2 snapshot | `94db430d894d1ee0712ae4201e43505138cbcd06` |
| Candidate foundation before V2 sequence | `9037025b10adb215a17d19acf61df51e23ef95fb` |
| `origin/main...94db430` | 0 behind / 197 candidate-only commits |
| `c75b5d31...94db430` | 94 Testing-only / 63 candidate-only commits |
| Merge-base | `6a5db247aa8c7ab76234a7ed918a6d5978d08683` |

No existing local/remote ref, release document, or authorized Railway Testing metadata proves which commit matches the current Production code. Production was deliberately not accessed to discover it.

Required owner decision: provide the exact Production-compatible baseline SHA/ref, or explicitly approve the entire tracked monolith at a named SHA after reviewing its non-Staff scope.

## 4. RELEASE CONSTRUCTION STRATEGY

No strategy was executed.

Recommended after owner decision:

1. Prefer strategy A: create a controlled branch from the owner-confirmed Production-compatible baseline and cherry-pick Staff V2 plus proven shared dependencies.
2. Use strategy B (`94db430` whole snapshot) only if the owner explicitly accepts all non-Staff monolith runtime and all migration lineage in that snapshot.
3. A cherry-pick construction creates a new SHA and digest; it must receive the full gate/deploy/UAT sequence.

## 5. FINAL RELEASE SCOPE

**Not frozen.**

The intended Staff product scope is clear:

- Home V2;
- Time Hub, Schedule, Attendance History, Attendance Corrections, Timesheet & OT;
- Requests Hub, Leave, Claims, Approval Center;
- Pay correctness hardening, Pay Hub, Payslips, Commission;
- Profile V2, workplace discovery/switch, This Phone, Security, sign out and `/staff/device` compatibility redirect;
- bottom navigation Home / Time / Requests / Pay / Profile only.

However, the deployable monolith scope is not approved. No Staff 3100 runtime/port reference was found in tracked `src`, `public`, `package.json` or Next config at `94db430`; numeric `3100` path hits were migration timestamps only.

## 6. STAFF REQUIRED COMMITS

Every accepted commit below was reconfirmed with `git merge-base --is-ancestor <commit> 94db430`; all returned exit code 0:

| Module | Reachable commits |
|---|---|
| Home | `5bbbfc5`, `b76070f` |
| Time | `5dacfc1`, `ab76ba2` |
| Schedule | `b06d3fc` |
| Attendance History | `5b9cdd1` |
| Attendance Corrections | `b56d4fb`, `a0bc046`, `cc85e91` |
| Timesheet & OT | `4b46000`, `7c0e948`, `92e674b`, `c9c4359` |
| Requests Hub | `daae682` |
| Leave | `e3f9d08`, `81ba6c0` |
| Claims | `7bf0018` |
| Approval Center | `2ebf764`, `d67b24b`, `22c6b9f` |
| Pay | `87f09e7`, `18057f6` |
| Payslips | `ae1d389` |
| Commission | `772ff07` |
| Profile | `de367d2` |
| Global closure | `94db430` |

Ancestry proves inclusion, not whole-monolith approval.

## 7. SHARED REQUIRED DEPENDENCIES

The file manifest classifies 77 accepted-Testing-to-proposed files as `SHARED_DEPENDENCY_REQUIRED`. The required dependency families include:

- employee OTP, verification, session, device and workplace-switch services;
- employee-facing API routes and tenant/branch/membership scoping;
- Attendance session, exception, correction and P2 projection services;
- Timesheet and OT read models;
- Leave, Claims and Approval canonical records/read models;
- payroll/payslip/commission employee readers and protected PDF path;
- Staff PWA manifest/service worker and shared registration shell;
- environment validation and `/api/health` release identity.

These dependencies cannot safely be inferred from directory location alone. The manifest deliberately flags potential shared dependencies for source-owner review rather than silently omitting them.

## 8. UNRELATED MONOLITH CHANGES

Accepted Testing → proposed candidate file classification:

| Classification | Files |
|---|---:|
| STAFF_REQUIRED | 107 |
| SHARED_DEPENDENCY_REQUIRED | 77 |
| UNRELATED / NOT APPROVED | 127 |
| MIGRATION | 8 |
| BUILD CONFIG | 4 |
| TEST ONLY | 78 |
| DOC ONLY | 153 |
| **Total** | **554** |

The 127 owner-review files include changes under business/admin team pages, AI services/UI, shared shell/middleware, payroll/admin UI, roster/time navigation and operational scripts. Some may ultimately be legitimate Staff dependencies; they have not yet been proven as such. This conservative classification prevents accidental approval.

Candidate foundation `9037025` itself includes explicit non-Staff commits after `bdc15f8`, including:

- `9037025` — Ask Tetamu AI;
- `4070f2f` and related commits — payroll/statutory UAT candidate work;
- PCB 2026 verification/foundation work;
- shared build/environment changes.

Complete per-file manifest: `TETAMU_STAFF_V2_RELEASE_DIFF_MANIFEST.tsv`.

## 9. RELEASE BRANCH

**Not created. Not pushed.**

Current proposed snapshot branch:

- local branch: `codex/staff-v2-global-closure`;
- SHA: `94db430d894d1ee0712ae4201e43505138cbcd06`;
- upstream: none;
- `git ls-remote` found no remote `codex/staff-v2-global-closure` and no `release/staff-v2-testing-candidate-20260902`;
- no release branch was invented because the baseline gate failed.

## 10. RELEASE SHA

**FINAL RELEASE SHA: NOT AVAILABLE**

Proposed audit snapshot only:

`94db430d894d1ee0712ae4201e43505138cbcd06`

It must not be configured in Railway Testing as the final release identity until owner scope/baseline approval and branch construction are complete.

## 11. SOURCE DIGEST

Deterministic `git archive --format=tar 94db430...` SHA-256 for the proposed snapshot:

`edf2c7079ff466329c49b403ab33133bd6cb4fbf5cf2870fb8e76591dce62381`

**FINAL RELEASE SOURCE DIGEST: NOT AVAILABLE**

The value above excludes working-tree timestamps, `.env`, `node_modules`, `.next`, screenshots not tracked at that commit and untracked reports. It is audit evidence only. A constructed release branch will have a different SHA/digest and must be recomputed.

## 12. PACKAGE MANAGER POLICY

Required release policy: **npm + package-lock.json**.

Current snapshot facts:

- Node constraint: `>=22 <25`;
- audit machine: Node `v24.15.0`, npm `11.12.1`;
- `package-lock.json` exists;
- `pnpm-lock.yaml` also exists;
- `package.json` has no `packageManager` declaration;
- build script: `prisma generate && node scripts/guard-next-build.mjs && next build --webpack`;
- start script runs release environment validation before `next start`.

Therefore package-manager ambiguity is not yet frozen. No lockfile was deleted or regenerated and no dependency was upgraded. After baseline approval, add only the narrow policy needed to guarantee Railway uses npm, then run `npm ci` and verify zero unexplained lock drift.

## 13. TESTING MIGRATION LEDGER

**NOT QUERIED IN THIS PHASE.**

Testing access was allowed, but the earlier baseline blocking condition requires stopping before constructing or deploying a speculative package. Querying the ledger would not resolve which source should be released.

Current classification from source evidence: **LEDGER RECONCILIATION REQUIRED**. The actual `_prisma_migrations` comparison remains a mandatory predeploy gate after owner baseline approval.

## 14. MIGRATION RECONCILIATION

Source comparison reveals:

| Testing lineage | Proposed lineage | Finding |
|---|---|---|
| `20260822010000_staff_app_appearance` | `20260829110000_canonical_staff_app_appearance` | Both add the same business columns, but use different IDs/checksums; candidate uses `IF NOT EXISTS`. Semantically related, ledger-distinct. |
| `20260822023000_development_concurrent_otp_challenges` | absent | Testing changes OTP invalidation function for device-scoped mock concurrency. Not represented in candidate lineage. |
| `20260824130000_staff_app_sms123_otp` | absent | Adds `provider_message_code`, constraints and lifecycle-trigger hardening. Not equivalent to `20260824190000`. |
| `20260824190000_staff_app_sms123_otp` | same file/checksum | Shared file; SHA-256 content matches on both commits. |
| absent | `20260826173000_non_production_statutory_fixture_evidence_facility` | Truly additional candidate migration. |
| absent | `20260827153000_pcb_2026_p1_correctness_foundation` | Truly additional, non-Staff payroll/statutory migration. |
| absent | `20260827170000_effective_dated_statutory_participation` | Truly additional, non-Staff payroll/statutory migration. |

The missing `20260824130000` is a material lineage gap: proposed `prisma/schema.prisma` also lacks `provider_message_code`. An existing Testing database may retain the column/constraints, while a fresh candidate database will not. That violates exact-candidate equivalence and must not be hidden with `prisma migrate resolve` or casual renames.

No migration file or ledger was changed.

## 15. LOCAL BUILD GATES

No new release branch exists, so release-branch gates were not run in this phase.

Evidence inherited from the immediately preceding audit at exact source commit `94db430`:

- `npx tsc --noEmit`: PASS;
- `npm run lint`: PASS with 0 errors and 3 pre-existing warnings;
- `git diff --check`: PASS;
- `npm run build`: PASS, 145 static pages;
- `npm run prisma:migrate:fresh-check`: PASS, 212 migrations on disposable PostgreSQL.

These results describe the proposed snapshot, not a final release package.

## 16. UNIT RESULTS

Inherited evidence at `94db430`:

- `npm test`: **1407 PASS**;
- failed/cancelled/skipped/todo: 0;
- 229 invoked unit-test files.

Not rerun after this phase because no source was changed and the stop rule fired before release construction. A final branch must rerun the suite.

## 17. INTEGRATION RESULTS

Inherited closure evidence:

- selected relevant PostgreSQL integration: 30/30 PASS across 11 files;
- covered Staff/auth/attendance-related closure scope.

No new integration run was performed because there is no approved release package. If construction changes runtime or migration lineage, rerun selected PostgreSQL integration covering auth/session/device, multi-employer, Attendance/P2/corrections, Timesheet/OT, Leave, Claims, Approvals, Pay/PDF and Commission. Do not label selected integration as the full repository suite.

## 18. ARCHIVE BUILD

Inherited exact-snapshot evidence at `94db430`:

- clean `git archive` extraction;
- independent `npm ci`;
- no `.env.local`, shared `node_modules` or local fixture artifact;
- production build PASS with 145 pages;
- normal Node system CA was required for Prisma engine TLS; TLS verification was not disabled.

This proves proposed-snapshot reproducibility, not final release-branch reproducibility. No new archive build was run after the baseline block.

## 19. TEST / FIXTURE GUARDS

Inherited source audit at `94db430` found:

- `/api/local-uat/session` has a localhost-only host guard and returns 404 for non-local host;
- Production configuration rejects mock OTP and `000000`;
- no former `/staff/uat-sign-in` runtime;
- fixture scripts are local/Testing guarded;
- no tracked `.tmp` fixture enters the archive.

Because exact-candidate Testing deployment did not occur, the external-host guard has not been revalidated against a deployment of the final package. This remains a hard gate.

## 20. LOCAL UAT ROUTE EXTERNAL TEST

**NOT EXECUTED AGAINST AN EXACT CANDIDATE.**

Required later:

`GET https://tetamu-staff-app-testing.up.railway.app/api/local-uat/session`

Expected: HTTP 404, no Staff session cookie, including safe proxy/Host-spoof checks supported by the architecture. Any externally reachable session shortcut is BLOCKED.

## 21. TESTING DEPLOYMENT

**NOT DEPLOYED.**

No Railway Testing variables, service, database, deployment or release identity were modified.

Accepted prior Testing identity remains the evidence supplied to this task:

- deployment ID `0924624b-7261-4ec7-bb88-22e9ffa14b42`;
- SHA `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf`;
- environment `testing`;
- database `ready`;
- source digest absent/null.

It is not equivalent to `94db430`.

## 22. HEALTH IDENTITY

**NOT RUN FOR A NEW DEPLOYMENT.**

The current accepted Testing metadata fails the exact-candidate gate because:

- `commitSha != 94db430...`;
- `sourceDigest` is not the proposed 64-hex digest;
- no tracked release branch/upstream exists.

No owner UAT should be credited to `94db430` until a later deployment returns HTTP 200, `ok=true`, `database=ready`, `environment=testing`, exact release SHA, exact source digest and the new deployment ID.

## 23. NORMAL EMPLOYEE UAT

**NOT RUN AGAINST AN EXACT CANDIDATE.**

Previous owner UAT evidence remains historical evidence for earlier Testing builds only. No OTP was sent and no existing session was used in this phase. The bounded Home/Time/Requests/Pay/Profile scenario remains pending.

## 24. MANAGER UAT

**NOT RUN AGAINST AN EXACT CANDIDATE.**

Requests → Approvals, Approval Center load and own-employee Pay/Profile scope remain pending after exact health identity succeeds.

## 25. MULTI-EMPLOYER UAT

**NOT RUN AGAINST AN EXACT CANDIDATE.**

Historical A → B → A owner checks cannot close the new exact-candidate gate. The later bounded check must verify underlying Home, Time, Requests, Pay and Profile data, not only the workplace label.

## 26. PAY / PAYSLIP / COMMISSION SMOKE

**NOT RUN AGAINST AN EXACT CANDIDATE.**

Later smoke is read-only only: Pay Hub, payslip list, own protected PDF and Commission. It must preserve wording boundaries:

- no unproven Deductions;
- no salary Paid inference;
- Commission “Added to payroll” is not “Paid”;
- Payslip “Available” is not “Paid”.

No payroll was finalized, no payslip published, no Commission approved and no Claim settled.

## 27. LOGOUT / SESSION SMOKE

**NOT RUN AGAINST AN EXACT CANDIDATE.**

Later owner UAT must sign out and verify Time, Requests and Pay denial. No session or auth data was changed in this phase.

## 28. IPHONE / ANDROID RECHECK

**NOT RUN.**

The short iPhone plus oldest supported Android/Vivo-class recheck is contingent on exact health identity and bounded owner sessions. No device action was requested because deployment did not occur.

## 29. PWA UPDATE CHECK

**NOT RUN.**

Expected later behavior remains close/reopen or reload with **NO REINSTALL REQUIRED**. No new service worker/runtime was deployed in this phase.

## 30. FINAL TESTING EQUIVALENCE

**NOT EXACT MATCH**

Current state:

- Testing SHA: `c75b5d31...`;
- proposed local snapshot: `94db430...`;
- exact release branch: absent;
- exact final source digest: absent;
- exact-candidate deployment: absent;
- bounded exact-candidate owner UAT: absent.

Classification: **DRIFT REMAINS / EXACT CANDIDATE NOT TESTED**.

## 31. BLOCKERS

1. Production-compatible baseline cannot be proven from authorized local/remote evidence.
2. The proposed snapshot contains unapproved non-Staff monolith runtime.
3. Testing and candidate migration histories are materially different, including OTP hardening absent from candidate source.
4. Testing `_prisma_migrations` has not been reconciled to an approved final branch.
5. No clean tracked/pushed release branch or upstream exists.
6. npm release policy is not yet explicit while two lockfiles remain.
7. Exact Testing SHA/digest deployment and owner UAT do not exist.

The first item alone requires stopping before branch construction. Items 2–7 must be closed after that decision.

## 32. OWNER REVIEW ITEMS

Owner must choose one of these paths:

1. Provide the exact current Production-compatible Git SHA/ref to use as strategy-A baseline; or
2. Explicitly approve strategy B: release the complete monolith snapshot at `94db430`, including AI, PCB/payroll, HR/admin, shared shell/build and candidate migration changes.

Additional owner review:

- approve or exclude each `UNRELATED / NOT APPROVED` runtime entry in the manifest;
- decide how the missing Testing OTP migrations are preserved in canonical immutable history;
- approve Testing ledger read-only reconciliation and backup before any non-trivial resolution;
- accept npm/package-lock as the release package-manager policy;
- perform bounded employee/manager/device UAT only after exact health match.

## 33. FILES CHANGED

Only audit artifacts were added in the isolated audit worktree:

- `TETAMU_STAFF_V2_RELEASE_CANDIDATE_RECONCILIATION_AND_EXACT_TESTING_REPORT.md`;
- `TETAMU_STAFF_V2_RELEASE_DIFF_MANIFEST.tsv`.

The earlier readiness audit file remains an untracked audit artifact in the same worktree. No tracked application code, schema, migration, lockfile, environment file or deployment configuration was changed. No commit, branch, tag, merge, push or stash was performed.

## 34. PRODUCTION STATUS

**TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**  
**NO PRODUCTION DEPLOYMENT**  
**NO PRODUCTION DATABASE ACCESS**  
**NO PRODUCTION MIGRATION**  
**NO PRODUCTION OTP**

Testing was also not modified: no Testing DB query, backup, variable change, deployment or OTP occurred after the mandatory baseline stop.

## 35. RECOMMENDED NEXT STEP

Stop here and obtain one concrete owner answer: the exact Production-compatible baseline SHA/ref, or explicit whole-monolith approval for `94db430`.

After that authorization, resume in this order:

1. construct a clean `release/staff-v2-testing-candidate-YYYYMMDD` branch;
2. reconcile the per-file scope and immutable migration lineage without rewriting history blindly;
3. freeze npm/package-lock, SHA and archive digest;
4. push and configure upstream;
5. inspect Testing ledger and take/verify Testing backup if reconciliation is non-trivial;
6. run clean local/unit/integration/archive gates;
7. deploy that exact branch/SHA/digest to Railway Testing;
8. require exact `/api/health` identity and external local-UAT-route 404;
9. perform bounded employee, manager, multi-employer, logout, money-read, iPhone/Android and PWA checks;
10. freeze the branch and stop again before any Production work.

No Production read-only verification is authorized or performed by this report.
