# TETAMU STAFF V2 TESTING MIGRATION LEDGER RECONCILIATION AND OTP HARDENING REPORT

Audit date: 2026-09-02
Canonical isolated worktree: `C:\CodexTetamuP0-first-prod-release`
Branch: `release/first-production-staff-v2-20260902`
Baseline commit: `c75b5d31d311bbb15cd0a6590e24cc3d23e53bdf`
Staff runtime: **3000 ONLY**
Scope: **LOCAL + RAILWAY TESTING READ-ONLY ONLY**

## 1. FINAL VERDICT

**READY FOR OWNER APPROVAL OF FORWARD RECONCILIATION**

The actual Railway Testing ledger of 212 applied migrations is now represented as the canonical immutable base. The four Testing-only applied migration files were recovered byte-for-byte from Git history and their SHA-256 values match the authoritative Testing ledger checksums. The three candidate-only legacy migration IDs were proven unapplied and are excluded locally. One new forward-only OTP hardening migration was created locally after the Testing head.

No migration was applied to Testing. The owner must approve the legacy exclusions, retention of applied PCB/statutory history, and the new forward migration before any separate Testing deployment phase.

## 2. EXECUTIVE SUMMARY

The provisional release candidate had 211 migration directories, while Testing had 212 applied rows. Only 208 entries were common. The divergence was caused by four immutable Testing-applied migrations missing from candidate source and three older candidate migrations that Testing never applied.

The reconciled target is:

- Testing canonical base: **212 exact applied migrations**
- New forward migration: **1**
- Final local candidate chain: **213 migrations**
- Historical Testing migration edits: **0**
- Testing ledger manipulation: **0**
- Testing schema/data changes: **0**
- Production access or changes: **0**

OTP inspection found that Testing already has the canonical SMS123 provider/hash design, delivery-state constraints, phone-wide challenge invalidation, lifecycle guards, and relevant indexes. It does not have `provider_message_code`, while the release Prisma schema declares that field. The safe delta is a nullable historical column, a bounded provider-message constraint, and lifecycle immutability added by a new forward migration. No historical provider code is fabricated and no backfill is required.

## 3. TESTING LEDGER BASELINE

Read-only inspection of `_prisma_migrations` confirmed:

| Migration | Applied | Finished at (UTC) | Rolled back | Checksum |
|---|---:|---|---:|---|
| `20260824190000_staff_app_sms123_otp` | Yes | 2026-08-30T18:47:32.339Z | No | `9594259fb3b109285a6e5a866d2bbc8a25608f5cda61d7e5b1ac76309f6182b4` |
| `20260826173000_non_production_statutory_fixture_evidence_facility` | Yes | 2026-08-30T18:47:32.622Z | No | `f94b40d9cae5e1c73032b105418bfeb736e5894261d26708f9bb21bb1b13b0de` |
| `20260827153000_pcb_2026_p1_correctness_foundation` | Yes | 2026-08-30T18:47:32.902Z | No | `404d77b5821cdadd51dd57769e8bdb06674b9e16e2460e57877100ac3b3e7917` |
| `20260827170000_effective_dated_statutory_participation` | Yes | 2026-08-30T18:47:33.188Z | No | `b08763d334406e23d4647c05525c47d11997e310ff9c86c2471518cf710dde64` |
| `20260829110000_canonical_staff_app_appearance` | Yes | 2026-08-30T18:47:33.465Z | No | `856b3ea13b4143e8b799d2c7f67d632e4b26c46efb20b54dead455a4340fbefd` |
| `20260822010000_staff_app_appearance` | No row | — | — | — |
| `20260822023000_development_concurrent_otp_challenges` | No row | — | — | — |
| `20260824130000_staff_app_sms123_otp` | No row | — | — | — |

No database credentials, OTP values, hashes, phone numbers, provider credentials, or session tokens were printed.

## 4. TESTING 212 MIGRATIONS

The actual Testing ledger has **212 applied migrations**. Before reconciliation:

- Testing applied: 212
- Provisional candidate: 211
- Common immutable entries: 208
- Testing-only applied entries: 4
- Candidate-only/unapplied entries: 3

After local reconciliation:

- All 212 Testing-applied IDs are present in source.
- The four divergent applied SQL files are exact checksum matches.
- The three obsolete never-applied IDs are absent.
- One new forward migration follows the canonical Testing head.
- Local migration directory count is **213**.

The target is therefore `Testing 212 + 1 forward`, not a rewritten or resolved ledger.

## 5. RESTORED TESTING-APPLIED MIGRATIONS

The following files were restored without formatting, renaming, or semantic edits:

1. `20260826173000_non_production_statutory_fixture_evidence_facility`
   - Canonical source commit: `4070f2fdeca66870004065efdad3b0d69d5274c6`
2. `20260827153000_pcb_2026_p1_correctness_foundation`
   - Canonical source commit: `baa0f96ff5ffa2d50ca72fcc6c51276fc6353829`
3. `20260827170000_effective_dated_statutory_participation`
   - Canonical source commit: `baa0f96ff5ffa2d50ca72fcc6c51276fc6353829`
4. `20260829110000_canonical_staff_app_appearance`
   - Canonical source commit: `baa0f96ff5ffa2d50ca72fcc6c51276fc6353829`

Recovery was from Git object history, not reconstruction from memory.

## 6. CHECKSUM VERIFICATION

| Migration | Local restored SHA-256 | Testing checksum | Result |
|---|---|---|---|
| `20260826173000_non_production_statutory_fixture_evidence_facility` | `f94b40d9cae5e1c73032b105418bfeb736e5894261d26708f9bb21bb1b13b0de` | Same | **MATCH** |
| `20260827153000_pcb_2026_p1_correctness_foundation` | `404d77b5821cdadd51dd57769e8bdb06674b9e16e2460e57877100ac3b3e7917` | Same | **MATCH** |
| `20260827170000_effective_dated_statutory_participation` | `b08763d334406e23d4647c05525c47d11997e310ff9c86c2471518cf710dde64` | Same | **MATCH** |
| `20260829110000_canonical_staff_app_appearance` | `856b3ea13b4143e8b799d2c7f67d632e4b26c46efb20b54dead455a4340fbefd` | Same | **MATCH** |

Checksum mismatches: **0**.

## 7. APPEARANCE MIGRATION ANALYSIS

The unapplied legacy migration `20260822010000_staff_app_appearance` performs unconditional additions of:

- `businesses.staff_app_logo_url TEXT`
- `businesses.staff_app_appearance JSONB`

Testing instead applied `20260829110000_canonical_staff_app_appearance`, which adds the same columns using `ADD COLUMN IF NOT EXISTS` inside a transaction and explicitly identifies the canonical 3000 Staff App lineage.

Conclusion:

- The legacy ID was never applied to Testing.
- Its semantic result is satisfied by the later canonical applied migration.
- Keeping it would make Prisma attempt obsolete historical work against Testing.
- Classification: **LEGACY UNAPPLIED MIGRATION — EXCLUDE FROM FIRST-RELEASE CANONICAL HISTORY**.

No migration rename or `migrate resolve` is proposed.

## 8. DEVELOPMENT CONCURRENT OTP MIGRATION ANALYSIS

`20260822023000_development_concurrent_otp_challenges` replaces the invalidation function so mock-provider challenges are invalidated only for the same device fingerprint, while non-mock providers remain phone-wide.

The current canonical runtime explicitly performs phone-wide invalidation before creating the next challenge. Testing's function also serializes by normalized phone using a PostgreSQL advisory transaction lock and invalidates prior active challenges phone-wide.

Assessment:

- Intended purpose: multiple simultaneous Development/mock browser sessions.
- Testing ledger: never applied.
- Production/runtime dependency: none.
- Current canonical security behavior: phone-wide replacement.
- Production suitability: inappropriate as a required Production lineage behavior.
- Classification: **DEVELOPMENT-ONLY / SUPERSEDED — EXCLUDE FROM FIRST-RELEASE HISTORY**.

No forward migration is needed for this development-only behavior.

## 9. SMS123 MIGRATION SEMANTIC DIFF

The two migrations are materially different and are not renamed equivalents.

`20260824190000_staff_app_sms123_otp` — applied in Testing:

- Replaces only the provider compatibility check.
- Accepts:
  - `legacy_local/local` with non-null hash
  - `mock/local` for both historical hashed and provider-owned hashless mock rows
  - `twilio_verify/sms` with null hash
  - `sms123/sms` with non-null hash
- Does not add `provider_message_code`.
- Does not mutate existing rows.
- Does not replace the lifecycle function.

`20260824130000_staff_app_sms123_otp` — never applied:

- Adds `provider_message_code TEXT`.
- Invalidates existing hashless mock challenges.
- Tightens the mock branch to require either a hash or invalidation.
- Adds a provider-message integrity constraint.
- Replaces the lifecycle function to require the message field to be null on insert and immutable once set.

The data mutation and mock-provider check in the older migration conflict with current provider-owned mock semantics. Therefore the old migration must not be resurrected. Only the proven missing message-code hardening is carried forward in a new migration.

## 10. TESTING OTP SCHEMA

Read-only catalog inspection found:

- Table: `employee_otp_challenges`
- `provider_message_code`: absent
- Provider/hash/channel check: present
- Provider reference/delivery acceptance pairing: present
- Attempt bounds and hash-length constraints: present
- Phone/time/verification claim constraints: present
- Invalidation trigger: present
- Lifecycle trigger: present
- Phone-wide advisory-lock invalidation function: present
- Lifecycle function: present
- Provider-reference partial index: present
- Purpose/phone/time and other operational indexes: present

No schema changes were executed against Testing.

## 11. PROVIDER_MESSAGE_CODE

Testing does not currently contain the column. The desired post-forward definition is:

- PostgreSQL type: `TEXT`
- Nullability: nullable
- Default: none
- Historical rows: null accepted
- Fabricated backfill: prohibited
- New challenge insert: must begin null
- Later provider update: may set a bounded value only after provider reference and delivery acceptance exist
- Once set: immutable

The current Staff OTP runtime does not read or write this field. However, `prisma/schema.prisma` declares it, and Prisma model reads/returns can assume the physical column exists. This is a release schema-alignment gap and a desired defense-in-depth lifecycle hardening, so a forward migration is required.

## 12. OTP CONSTRAINTS

Testing's current provider constraint allows the four intended provider/channel/hash combinations described in section 9. The proposed migration deliberately does **not** replace or narrow that check.

The new constraint permits either:

- `provider_message_code IS NULL`, or
- a non-null value of length 1–64 with both:
  - non-null `provider_reference`
  - non-null `delivery_accepted_at`

Existing Testing rows satisfy the proposed constraint because historical null is allowed. The migration validates the constraint after creation.

Other current lifecycle constraints remain unchanged, including attempt limits, delivery-state pairing, hash length, time ordering, phone normalization, and verification-claim integrity.

## 13. OTP TRIGGERS / FUNCTIONS

Testing currently has exactly two OTP triggers:

1. `employee_otp_challenges_10_invalidate_previous`
   - Function: `invalidate_previous_employee_otp_challenges`
   - Uses a normalized-phone advisory transaction lock.
   - Invalidates previous active challenges phone-wide.

2. `employee_otp_challenges_20_lifecycle_guard`
   - Function: `enforce_employee_otp_challenge_lifecycle`
   - Enforces account scope, immutable challenge identity/provider fields, provider-reference immutability, delivery-acceptance immutability, monotonic attempts, terminal invalidation/verification guards, and expiry/attempt verification limits.

The proposed migration uses `CREATE OR REPLACE FUNCTION` only for the existing lifecycle function. It preserves every current Testing rule and adds:

- `provider_message_code` must be null on initial insert.
- A non-null provider message code cannot be changed or cleared.

It does not create another trigger, alter trigger ordering, or replace the invalidation function.

Transaction behavior remains safe:

- The challenge and keyed OTP hash are durably committed before the SMS123 network side effect.
- Provider send occurs outside the Prisma interactive transaction.
- Provider success/failure is recorded by bounded follow-up updates.
- A provider-accepted SMS cannot be made unverifiable by rolling back challenge creation.
- Retry/cooldown logic avoids duplicate sends after a durable accepted or failed state.

## 14. OTP INDEXES

Testing read-only inspection confirmed these relevant indexes:

- Primary key
- Account + created time
- Device + created time
- Expiry time
- IP + created time
- Phone + purpose + created time
- Partial provider-reference index

The forward migration adds no index because no current query uses `provider_message_code`, and uniqueness is not a proven provider contract.

## 15. EXISTING DATA COMPATIBILITY

Aggregate-only Testing audit result:

| Check | Result |
|---|---:|
| Total OTP challenge rows | 11 |
| SMS123/SMS rows | 11 |
| Attempts above max | 0 |
| Provider reference without delivery acceptance | 0 |
| Delivery acceptance without provider reference | 0 |
| Invalid SMS123 provider/hash/channel combinations | 0 |
| Invalid Twilio combinations | 0 |
| Invalid legacy-local combinations | 0 |
| Active duplicate phone groups | 0 |
| Maximum active challenges in a group | 0 |
| Verified and later invalidated historical terminal rows | 6 |

The six verified-and-invalidated rows are permitted by the existing time/lifecycle history and are not violations of the proposed message-code constraint.

Because the new column is nullable, all existing rows remain compatible. **NO BACKFILL REQUIRED. NULLABLE HISTORICAL FIELD ACCEPTED.**

No row-level OTP material or phone number was selected or output.

## 16. RUNTIME SCHEMA DEPENDENCIES

Runtime findings:

- SMS123 generation and verification use a keyed OTP hash owned by Tetamu.
- SMS123 send is outside the interactive database transaction.
- Challenge creation is committed before sending.
- Provider follow-up failure does not erase the durable challenge.
- Cooldown/idempotent delivery-state handling prevents duplicate sends.
- Current runtime does not consume `provider_message_code`.
- Current Prisma schema declares `providerMessageCode`, so the physical post-forward column is required for canonical schema consistency.
- Verification/session transactions have no external provider side effect and retain finite database timeouts.

The restored statutory migrations introduce nullable synthetic-evidence source fields. Minimal local compatibility changes make those fields nullable in the read DTO/digest and fail closed before payroll calculation when source evidence is incomplete. This preserves the applied schema without enabling a new PCB/statutory feature rollout.

## 17. LEGACY UNAPPLIED MIGRATION DECISION

| Migration | Decision |
|---|---|
| `20260822010000_staff_app_appearance` | **EXCLUDE FROM FIRST RELEASE HISTORY** — semantically superseded by applied canonical appearance migration |
| `20260822023000_development_concurrent_otp_challenges` | **EXCLUDE FROM FIRST RELEASE HISTORY** — development-only mock behavior; canonical runtime uses phone-wide invalidation |
| `20260824130000_staff_app_sms123_otp` | **SUPERSEDED BY FORWARD MIGRATION** — contains desired hardening plus incompatible legacy data/provider behavior |

These directories were removed only from the isolated local release worktree. Testing's ledger was not altered.

## 18. CANONICAL MIGRATION HISTORY TARGET

Exact target:

```text
Testing immutable applied history: 212
+ 20260902120000_staff_otp_forward_hardening: 1
= reconciled local candidate history: 213
```

Properties:

- Contains every Testing-applied migration ID.
- Preserves exact SQL/checksum for the four restored entries.
- Excludes the three obsolete never-applied IDs.
- Adds one chronological forward-only delta.
- Builds successfully from an empty database.
- Requires no fake Prisma ledger state.

## 19. FORWARD-ONLY MIGRATION DECISION

Decision: **ONE NEW FORWARD MIGRATION REQUIRED**.

Reason:

- Testing lacks `provider_message_code`.
- The release Prisma model declares it.
- The lifecycle immutability is a valid defense-in-depth requirement.
- The old 20260824130000 migration cannot safely be reused because it also changes mock semantics and mutates legacy rows.
- Current Testing rows are compatible with a nullable, bounded forward addition.

Migration ID: `20260902120000_staff_otp_forward_hardening`.

The migration exists locally only and is pending owner approval.

## 20. PROPOSED FORWARD MIGRATION

Local SHA-256:

`99c3627d6ee3a91a367fd786cf6310a533ce8d532ed4dcd52ac02bbf1dcdffbd`

Contents:

- `ADD COLUMN IF NOT EXISTS provider_message_code TEXT`
- Drop/recreate and validate only the provider-message integrity constraint.
- Replace the existing lifecycle function while preserving all current guards.
- Add insert-null and non-null immutability rules for the new field.
- No row update.
- No provider check change.
- No invalidation function change.
- No duplicate trigger.
- No index change.
- No destructive DDL.
- No data backfill.

Fresh-database safety and current-Testing compatibility were both validated locally.

## 21. PRISMA SCHEMA ALIGNMENT

`prisma/schema.prisma` was restored to describe the four immutable Testing-applied schema migrations, then aligned to the desired post-forward OTP state with:

```prisma
providerMessageCode String? @map("provider_message_code")
```

No unrelated new feature was enabled. Prisma validation and client generation both pass.

Applied statutory fixture fields that are nullable in canonical Testing history are now represented as nullable. The payroll consumer explicitly blocks incomplete evidence instead of inferring a source.

## 22. FRESH DB MIGRATION RESULT

Command: `npm run prisma:migrate:fresh-check`

Result:

- Migration count: **213**
- Applied from zero: **213**
- Failed migrations: **0**
- Result: **PASS**
- Duration: approximately **15 seconds**

This validates that the reconciled history is reproducible on a disposable fresh PostgreSQL database.

## 23. OTP TEST RESULTS

OTP/auth coverage was exercised without real SMS:

- SMS123 challenge creation with mock transport
- Keyed-hash local verification
- Provider failure normalization
- Delivery accepted + follow-up DB failure behavior
- Durable challenge after provider acceptance
- SMS failure invalidation
- Repeated request/cooldown behavior
- Persistent follow-up failure without duplicate send
- Resend/rate-limit and attempt-limit behavior
- Invalidated/expired challenge behavior
- Device, membership, session, and tenant safety
- Production mock rejection
- Forward migration schema/constraint/trigger equivalence

Focused OTP/statutory unit run: **13/13 PASS**.
The canonical PostgreSQL employee-auth integration was included in the selected integration run and passed.
Real SMS sent: **0**.

## 24. SELECTED STAFF INTEGRATION

A disposable fresh PostgreSQL database using the reconciled 213-migration chain ran 11 selected integration files covering:

- Auth/session/device
- Attendance and P2
- Employee correction archive
- Monthly Timesheet
- OT approval
- Leave
- Claims
- Unified Approval Center
- Manager P2 projection
- Pay read-only correctness
- Commission

Result:

- Tests: **34**
- Passed: **34**
- Failed: **0**
- Duration: **10.93 seconds**
- Result: **PASS**

No Testing database mutation was used.

## 25. UNIT RESULTS

Command: `npm test`

Result:

- Tests: **1401**
- Passed: **1401**
- Failed: **0**
- Skipped: **0**
- Todo: **0**
- Duration: **12.66 seconds**
- Result: **PASS**

## 26. TYPESCRIPT / ESLINT / BUILD

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS — 0 errors, 7 pre-existing warnings** |
| `git diff --check` | **PASS** |
| `npm run build` | **PASS** |
| Prisma validate | **PASS** |
| Prisma generate | **PASS** |

The build completed all 145 static-page generation steps and emitted the Staff 3000 routes. Existing deprecation notices for Prisma package configuration and Next middleware naming are non-blocking and were not introduced by this audit.

## 27. MIGRATION RECONCILIATION MANIFEST

Generated:

`TETAMU_STAFF_V2_TESTING_MIGRATION_RECONCILIATION_MANIFEST.tsv`

It records for each divergent or forward migration:

- Testing application state
- Candidate before/after state
- Checksum status
- Semantic classification
- Action and reason
- Runtime dependency
- Production release impact

## 28. TESTING MUTATION STATUS

**TESTING READ-ONLY ONLY**

- **NO TESTING MIGRATION APPLIED**
- **NO TESTING DATA MODIFIED**
- **NO TESTING DEPLOYMENT**
- **NO TESTING OTP**
- No `prisma migrate deploy`
- No `prisma migrate resolve`
- No `_prisma_migrations` insert/update/delete
- No Testing schema DDL
- No Testing Railway variable change

A temporary read-only inspection SSH key was added only to perform catalog queries, then immediately revoked and deleted. The pre-existing user key fingerprint remained unchanged.

## 29. PCB / STATUTORY MIGRATION STATUS

The three applied PCB/statutory migrations are retained because they are immutable Testing history. This does **not** approve or enable a PCB/statutory product rollout.

Local code alignment is limited to:

- Prisma representation of already-applied schema.
- Nullable source evidence compatibility.
- Fail-closed payroll behavior for incomplete/synthetic evidence.

No new PCB UI, workflow, calculation rollout, or feature flag change was introduced.

## 30. BLOCKERS

Current technical blockers: **NONE**.

The previous migration-history blocker is closed at the design/local validation level:

- Exact applied SQL recovered: yes
- Checksums matched: yes
- Existing data compatible: yes
- Forward migration bounded and fresh-safe: yes
- Fresh database build: pass
- OTP and Staff regression: pass
- Static/build gates: pass

Execution remains intentionally paused pending owner approval.

## 31. OWNER REVIEW ITEMS

Owner approval is required for:

1. Accepting the real Testing 212-entry ledger as the first-release canonical base.
2. Retaining the three applied PCB/statutory migrations strictly as history baggage, not feature approval.
3. Excluding the three never-applied legacy migration IDs.
4. Approving `20260902120000_staff_otp_forward_hardening` as the only forward delta.
5. Accepting nullable historical `provider_message_code` with no fabricated backfill.
6. Accepting fail-closed handling for incomplete synthetic statutory evidence.
7. Authorizing a later, separately controlled Testing apply/deploy phase.

## 32. FILES CHANGED

Migration reconciliation artifacts:

- Restored four exact Testing-applied `migration.sql` files.
- Removed three obsolete never-applied migration files.
- Added `prisma/migrations/20260902120000_staff_otp_forward_hardening/migration.sql`.
- Aligned `prisma/schema.prisma`.
- Added schema-equivalence coverage to `tests/integration/attendance-employee-auth.test.ts`.
- Added forward-migration coverage to `tests/unit/staff-sms123-otp.test.ts`.
- Updated nullable statutory evidence compatibility in:
  - `src/lib/payroll/lindung24-participation.ts`
  - `src/lib/team/employee-profile-statutory-read.ts`
  - `src/components/employee-profile-payroll.tsx`
- Generated:
  - `TETAMU_STAFF_V2_TESTING_MIGRATION_RECONCILIATION_MANIFEST.tsv`
  - `TETAMU_STAFF_V2_TESTING_MIGRATION_LEDGER_RECONCILIATION_AND_OTP_HARDENING_REPORT.md`

The worktree also contains the previously prepared provisional Staff V2 release delta; this audit did not commit, push, finalize, or deploy it.

## 33. NEXT STEP

Stop here for owner review.

If the owner approves this reconciliation, the next task should be a separately authorized controlled Testing phase that:

1. Re-verifies the exact release source and clean deployment input.
2. Backs up/records Testing state as required.
3. Applies only the new forward migration through normal Prisma deployment.
4. Deploys the exact candidate to Railway Testing.
5. Runs Testing smoke and physical-device owner UAT.
6. Does not access Production unless separately authorized later.

This report does not authorize those actions.

## 34. PRODUCTION STATUS

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

- **NO PRODUCTION DEPLOYMENT**
- **NO PRODUCTION DATABASE ACCESS**
- **NO PRODUCTION MIGRATION**
- **NO PRODUCTION OTP**
- No Production secrets or variables were inspected.
- No Production Railway configuration was changed.
