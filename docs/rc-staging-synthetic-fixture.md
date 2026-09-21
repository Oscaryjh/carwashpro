# Isolated RC Staging synthetic installation

This is not a Production seed command. The independent entrypoint is
`scripts/provision-rc-staging-synthetic.ts`; local and old Preview entrypoints and
their guards are unchanged. Do not set a local/Preview environment to bypass them.

Run only from the clean, committed and source-attested candidate with
`APP_ENVIRONMENT=production NODE_ENV=production`, supplying `--inventory-file`
and `--secrets-file` paths outside the worktree. Both existing files must be 0600.
The inventory hash and exact project/environment/web/database/volume/current
Singapore region/database fingerprint are pinned. The worker independently
fetches fresh authenticated Railway metadata before importing Prisma; an external
DATABASE_URL or caller-issued identity proof is never accepted. Only the approved
Staging database service variables are queried. Protected environments are queried
for service identity metadata only, never connected to.

The first invocation may create a new 0600 credential file only after identity
checks. It normally requires all application tables empty and the exact
216-migration ledger. The sole recovery exception is the versioned
`CORE_PCB_CONFIRMED_DRAFT` checkpoint: before any write, the reconciler checks
every non-empty application-table count, an ordered raw full-row digest and the
business/branch/Payroll/MFA semantics against the committed manifest. Unknown,
extra, duplicated or conflicting state is rejected. A transaction-scoped
advisory lock serializes concurrent installation and recovery.
Real Payroll and Manual PCB services run through password authentication, real
MFA enrollment/step-up, two-person review/finalize and Payslip publication. No
Payroll ledger, confirmation ledger or MFA authorization record is fabricated.
The disabled synthetic tenant Owner is temporarily enabled for its own MFA
approval and restored in `finally`. Installation sessions and usable OTP are
revoked in `finally`, including failure paths. Partial business data is never
deleted, overwritten or broadly repaired. The single proven checkpoint resumes
only unfinished phases. Existing MFA enrollment is recovered through a new
password session plus real TOTP and recovery-code regeneration; no factor,
session or step-up is bypassed.

The same POS master data and financial trace and the eight-role permission
contract are retained. Boundary Leave/Timesheet evidence is aligned to its
September Payroll month. Unlike the old manually constructed one-entry boundary
ledger, the actual Payroll service generates all eligible entries: August core 6,
September core plus boundary 7, and September other tenant 1. The verifier checks
all three finalized runs, 14 manual confirmations/publications, exact employee
sets, consumed authorization, PDF hashes, eight real persona bindings, Branch
Manager's Boundary Branch, POS amounts and zero active authentication artifacts.
Historical Staff session FK references are already expired and revoked; no fixed
OTP or active Staff session is created for login.

The COMPLETE marker is append-only and records version, definition/data digest
and the credential handoff digest after all synthetic MFA material is safely
saved. MFA TOTP secrets remain only in that external 0600 handoff, never reports.
Do not edit or rotate that file on rerun. The second invocation is verify-only;
`--verify` additionally prohibits creating a missing credential file. Wrong or
missing credential evidence, data drift, marker/version mismatch, any unmarked
database other than the exact committed recovery checkpoint, and protected
identities all fail closed. Successful UAT
activity changes data deliberately; this installer is not a reset/reseed tool.

All runtime keys are allowlisted. Each encryption keyring has exactly one active
canonical 32-byte key; both encoded and decoded reuse fingerprints are checked.
The wrapper emits only structured counts/digests/codes. Never run with shell
tracing, print secrets, or persist raw child/API/Prisma diagnostics.

Test only on a new disposable local database using `scripts/rc-disposable-test.mjs`.
The Staging integration files each own a whole disposable database, so run them
separately from other files. They cover first-install concurrency, exact
checkpoint acceptance, unknown/conflicting state rejection, resume, verify-only
replay, credential mismatch, semantic scope tampering, mid-workflow failure
cleanup and unrelated-row rejection. Existing Preview fixture and canonical
Payroll regression files must also pass in their own disposable databases.

Production, Testing, old Preview and old databases remain prohibited mutation
targets. No migrations, schema, business authorization, dependency or payment/
government/communication activation is changed by this implementation.
