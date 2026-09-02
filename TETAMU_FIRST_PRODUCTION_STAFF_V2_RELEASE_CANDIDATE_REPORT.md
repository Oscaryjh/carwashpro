# TETAMU FIRST PRODUCTION STAFF V2 RELEASE CANDIDATE REPORT

Date: 2026-09-02
Scope: Railway Testing only
Staff runtime: 3000 only

## 1. FINAL VERDICT

**BLOCKED**

The Staff V2 code delta was isolated and its provisional code gates passed, but the actual Railway Testing migration ledger is not compatible with the migration directory inherited from the prescribed `c75b5d3` Git baseline. Deploying this branch would introduce three unreviewed pending historical migrations while omitting four migrations already applied to Testing. This meets the task's explicit blocking condition: the candidate migration history cannot yet safely extend the accepted Testing ledger.

## 2. EXECUTIVE SUMMARY

- A clean isolated worktree was created from the exact requested Testing SHA.
- Approved Staff V2 content was extracted narrowly; `94db430` was not cherry-picked wholesale.
- AI/PCB/HR/Admin monolith runtime was not imported as an ancestry bundle.
- Provisional unit, TypeScript, lint, build, selected PostgreSQL integration, and fresh-database gates passed.
- The live Testing ledger read found 212 applied migrations with no failed or rolled-back entry in the comparison set.
- The provisional candidate contains 211 migrations: 208 match Testing, four Testing-applied IDs are absent, and three candidate IDs are not applied in Testing.
- The SMS123 migrations are materially different, not simple renames.
- No Testing deployment, migration, variable change, backup, OTP, or data mutation was performed.

## 3. FIRST RELEASE BASELINE

- SHA: `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf`
- Subject: `fix(build): generate Prisma client before Next build`
- Commit date: `2026-08-26T11:50:24+08:00`
- Parent: `23e433448dd1ab05b9c442cfd9a3c210439a170c`
- Containing local refs: `codex/staff-ui-testing-integration`, `release/first-production-staff-v2-20260902`
- Commit object was available locally and was safe to use as the requested Git branch base.

## 4. ISOLATED WORKTREE

- Worktree: `C:\CodexTetamuP0-first-prod-release`
- Branch: `release/first-production-staff-v2-20260902`
- Initial HEAD proof: exact `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf`
- Dirty canonical workspace `C:\CodexTetamuP0` was not used for construction.

## 5. RELEASE CONSTRUCTION STRATEGY

The candidate was built as `c75 baseline + narrow approved Staff V2 file/hunk extraction`. A mixed candidate commit was inspected as a content source, but its unrelated ancestry was not imported. Conflicts were reconciled manually against the baseline's existing Staff/Auth/Attendance contracts.

## 6. STAFF V2 DELTA

The provisional delta covers Home, Time, Schedule, Attendance History, Attendance Corrections, Timesheet/OT, Requests, Leave, Claims, Approval Center, Pay, Payslips, Commission, Profile, Staff auth/session hardening, PWA/build compatibility, and focused regression tests. The current working tree has 192 code/config/test paths before adding these two audit artifacts.

## 7. ALREADY-IN-BASELINE STAFF FEATURES

The baseline already supplied the Staff 3000 shell, employee authentication foundation, attendance/clock actions, employee appointments, roster, leave/claims foundations, payslip publication foundation, PWA foundation, and the baseline Prisma schema/migration history. These were modified only where the approved V2 behavior required it.

## 8. NEW STAFF FEATURES APPLIED

- V2 presentation primitives and scoped styling
- V2 Home, Time, Schedule, Attendance History and correction archive
- Timesheet/OT projections and manager action surfaces
- Requests Hub, Leave, Claims and Approval Center normalization
- Read-only Pay Hub, Payslips, Commission and Profile V2
- Canonical correction eligibility/projection compatibility
- OTP delivery lifecycle/timeout tests and related Staff auth handling
- Android/mobile safe-area and bottom-navigation regression coverage

All items remain provisional until migration reconciliation is approved.

## 9. SHARED DEPENDENCIES

Required shared dependencies include Attendance read/P2/punch/resolution services, employee timesheet/OT services, claim presentation, commission read models, payslip publication fields, employee APIs, Staff navigation/types, and the Chrome 87/npm build guard. No schema change was added by the Staff V2 extraction.

## 10. UNRELATED MONOLITH FEATURES EXCLUDED

The release construction did not wholesale import later AI, PCB, Payroll expansion, HR/Admin, or monolith runtime features. However, the actual Testing ledger already contains later PCB/statutory migrations; their presence is now a migration-lineage fact that cannot be deleted or ignored even though those features were not selected as Staff V2 delta.

## 11. FINAL RELEASE DIFF MANIFEST

`TETAMU_FIRST_PRODUCTION_STAFF_V2_DELTA_MANIFEST.tsv` records the 192 provisional changed code/config/test paths. It is a pre-release manifest because no final release SHA exists while the migration blocker remains.

## 12. TESTING OTP MIGRATION PRESERVATION

The requested Git baseline carries:

- `20260822023000_development_concurrent_otp_challenges`
- `20260824130000_staff_app_sms123_otp`

The latter adds `provider_message_code`, provider-message constraints, and lifecycle trigger hardening. The actual Testing ledger does **not** contain either ID. Testing instead contains `20260824190000_staff_app_sms123_otp`, whose SQL only replaces the provider check constraint and does not add the `provider_message_code` column or lifecycle hardening. Therefore OTP hardening cannot be declared preserved by ledger identity or semantic equivalence.

## 13. MIGRATION HISTORY DECISION

No migration history decision was silently made. Applied Testing migration IDs will not be deleted, renamed, rewritten, or faked. The three candidate-only IDs will not be applied blindly. Manual owner-approved reconciliation is required before a release candidate can be finalized.

## 14. TESTING MIGRATION LEDGER

Read-only query result:

- Testing source migrations: 212
- Testing ledger rows: 212
- Successfully applied: 212
- Testing source vs ledger pending: 0
- Testing source vs ledger checksum mismatches: 0

Temporary Testing SSH access was removed immediately after the read. The temporary key and local password/key files were deleted; the user's original SSH key was restored and its fingerprint verified.

## 15. TESTING MIGRATION DELTA

Candidate count: 211
Testing applied count: 212
Common immutable entries: 208
Checksum mismatch among common entries: 0

Testing ledger-only entries:

1. `20260826173000_non_production_statutory_fixture_evidence_facility`
2. `20260827153000_pcb_2026_p1_correctness_foundation`
3. `20260827170000_effective_dated_statutory_participation`
4. `20260829110000_canonical_staff_app_appearance`

Candidate-only/pending against Testing:

1. `20260822010000_staff_app_appearance`
2. `20260822023000_development_concurrent_otp_challenges`
3. `20260824130000_staff_app_sms123_otp`

Semantic findings:

- The two appearance migrations target the same columns, but use different immutable IDs; the later Testing migration is additive with `IF NOT EXISTS`.
- The two SMS123 migrations overlap but are not equivalent; the candidate's older migration contains additional column/constraint/trigger hardening.
- The concurrent-development OTP function has no matching Testing ledger ID.

## 16. PACKAGE MANAGER POLICY

- Canonical package manager: npm
- npm version used: `11.12.1`
- Node version used: `v24.15.0`
- `package.json` includes `packageManager: npm@11.12.1`.
- `package-lock.json` remains canonical.
- `pnpm-lock.yaml` was retained to avoid an unapproved repo-wide workflow deletion, while the release build contract explicitly selects npm.

## 17. RELEASE BRANCH

`release/first-production-staff-v2-20260902` exists locally. It has not been finalized, committed, or pushed because the migration lineage is blocked.

## 18. RELEASE SHA

**NOT GENERATED.** Current HEAD remains the baseline SHA; the provisional delta is uncommitted and must not be represented as a release SHA.

## 19. SOURCE DIGEST

**NOT GENERATED.** A canonical git-archive digest requires a final clean release commit, which does not exist while reconciliation is blocked.

## 20. GIT CLEAN / UPSTREAM STATUS

- Current worktree: intentionally dirty with provisional candidate content and audit artifacts.
- Upstream: not configured/pushed for this provisional branch.
- Ahead/behind: not applicable.
- No secrets, OTP values, `.env`, `node_modules`, `.next`, screenshots, or local databases were intentionally added to the candidate delta.

## 21. UNIT RESULTS

- Command: `npm test`
- Unit files present: 231
- Tests: 1400 passed / 0 failed
- Skipped/todo: none reported in the final unit run

## 22. TYPESCRIPT / ESLINT / BUILD

- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS, 0 errors; 7 pre-existing unrelated warnings
- `git diff --check`: PASS at the code-gate checkpoint
- `npm run build`: PASS, Next.js 16.3 webpack, 145 static pages
- Non-blocking build warnings: middleware deprecation and an existing Edge trace involving `process.cwd` in Staff permissions

## 23. INTEGRATION RESULTS

Selected Staff PostgreSQL integration:

- Files: 11
- Tests: 33 passed / 0 failed
- Covered auth, Attendance/P2, employee correction archive, monthly timesheet, OT approval, Leave, Claims, unified approvals, manager P2 projection, Pay read correctness, and Commission.

A broader 192-test repository integration attempt produced 180 pass / 12 fail, including unrelated commercial/Payroll suites and time-sensitive fixtures. It is not reported as a full integration pass. Relevant Staff fixture issues found by that attempt were corrected and the selected required gate then passed.

## 24. FRESH DB MIGRATION RESULT

The provisional 211-migration candidate history applied successfully from zero to a disposable PostgreSQL database. This proves its internal fresh-build coherence, but it does not prove compatibility with the live Testing ledger, which is the blocker.

## 25. ARCHIVE BUILD

**NOT RUN.** Archive reproducibility requires a final committed release SHA.

## 26. TEST / FIXTURE GUARDS

No Testing fixture, employee, OTP, payroll data, approval, or attendance record was changed. Integration used disposable/local PostgreSQL. The local-UAT endpoint remains guarded for local-only use and was not deployed in this phase.

## 27. LOCAL UAT ROUTE EXTERNAL RESULT

**NOT RUN AGAINST A NEW CANDIDATE DEPLOYMENT.** No candidate was deployed. The required external 404/no-cookie gate remains mandatory after reconciliation.

## 28. RAILWAY TESTING DEPLOYMENT

**NOT DEPLOYED.** Accepted Testing deployment `0924624b-7261-4ec7-bb88-22e9ffa14b42` was inspected read-only. No Railway Testing variable, source, database, or deployment was modified.

## 29. HEALTH IDENTITY

**NOT APPLICABLE.** No release SHA/digest or candidate deployment exists, so no identity claim was made.

## 30. NORMAL EMPLOYEE UAT

**NOT RUN** because the health identity hard gate could not be reached.

## 31. PAY / PAYSLIP / COMMISSION UAT

**NOT RUN on an exact deployed candidate.** Read-only code/integration coverage passed, but owner Testing UAT remains outstanding.

## 32. PROFILE UAT

**NOT RUN on an exact deployed candidate.**

## 33. MULTI-EMPLOYER UAT

**NOT RUN.** A→B→A exact-candidate owner verification remains mandatory.

## 34. LOGOUT UAT

**NOT RUN on an exact deployed candidate.**

## 35. MANAGER UAT

**NOT RUN on an exact deployed candidate.** No approval was submitted or mutated.

## 36. IPHONE / ANDROID CHECK

**NOT RUN** because no exact candidate was deployed. Physical-device review remains mandatory after migration reconciliation and identity validation.

## 37. PWA UPDATE

**NOT RUN.** No deployed candidate existed to reopen.

## 38. FINAL TESTING EQUIVALENCE

**NOT EQUIVALENT / NOT PROVEN.** The code delta is provisional and the migration lineages differ by four Testing-only and three candidate-only entries. No final SHA, digest, deployment, or owner UAT exists.

## 39. BLOCKERS

1. Testing migration ledger is not a subset/prefix of the provisional candidate history.
2. Four immutable Testing-applied migration directories are absent from the candidate.
3. Three candidate migrations would become unexplained pending migrations on Testing.
4. SMS123 migration semantics differ materially; `provider_message_code` hardening cannot be assumed present from ledger evidence.
5. Resolving this safely may require a new forward-only reconciliation migration and/or an owner-approved canonical-history decision; it must not use blind `prisma migrate resolve`.

## 40. OWNER REVIEW ITEMS

Owner must choose a forward-only reconciliation policy:

- **Recommended:** treat the actual 212-entry Testing ledger as canonical, restore the four exact immutable migration files to source, retain the security requirement as a new forward-only OTP hardening migration with a new ID after auditing the current Testing schema/data, and retire the three unapplied legacy IDs from this first-release branch only with an explicit documented decision.
- Alternative: rebuild a new Testing database from a newly approved canonical history and cut over after data reconciliation. This is higher risk and is not authorized implicitly.

The owner must also confirm whether the Testing-applied PCB/statutory migrations are accepted first-release baseline baggage. They cannot be removed from an extension of the existing Testing database.

## 41. FILES CHANGED

- Provisional code/config/test paths: 192
- Staged extraction paths at checkpoint: 183
- Additional manually reconciled paths at checkpoint: 17 (some overlap staged paths)
- Migration/schema paths changed by the provisional Staff delta: 0
- Detailed per-file inventory: `TETAMU_FIRST_PRODUCTION_STAFF_V2_DELTA_MANIFEST.tsv`

## 42. NEXT PHASE DECISION

Do not deploy. First perform an owner-approved migration reconciliation audit against the current Testing schema:

1. restore the four Testing-applied SQL files byte-for-byte and verify their recorded checksums;
2. inspect live Testing for `provider_message_code`, OTP constraints, lifecycle functions and current row compatibility;
3. design a forward-only idempotent OTP security migration if the hardening is missing;
4. decide treatment of the three never-applied legacy IDs without editing the Testing ledger;
5. rerun fresh DB, selected integration, full code gates, archive build, push, exact Testing deploy and bounded owner UAT.

The later decision between a new clean first Production database and an existing operational TETAMU database remains separate and must not be made silently.

## 43. PRODUCTION STATUS

**FIRST PRODUCTION HAS NOT BEEN DEPLOYED**
**TESTING ONLY**
**PRODUCTION NOT ACCESSED** — no Production target/runtime/database/secrets/variables were queried; one broad Railway project-status response incidentally included project-level environment metadata, which was not followed or used.
**PRODUCTION NOT MODIFIED**
**NO PRODUCTION DEPLOYMENT**
**NO PRODUCTION DATABASE ACCESS**
**NO PRODUCTION MIGRATION**
**NO PRODUCTION OTP**

No Production environment, service, domain, storage, employee account, SMS123 setting, variable, database, or runtime was created or changed.
