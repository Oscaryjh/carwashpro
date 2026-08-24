# Known Limitations and Deferred Scope

These items are transparent launch constraints. External provider, human governance and explicitly deferred product scope are not Development blockers when the safe boundary is enforced.

## Ready with limitation

1. **Real employee OTP live acceptance** — the SMS123 delivery adapter and Tetamu-owned hashed OTP lifecycle, replay/concurrency protection, rate limiting and existing session/device binding are implemented. SMS123 credentials and a real receiving phone were not configured during migration, so real-SMS acceptance remains blocked. Local mock regression is not SMS acceptance. Production remains a separate Production Owner configuration and validation action.
2. **Attachment malware scanning** — private storage, signature/MIME validation, size limits, sanitised names, checksum, tenant authorization and quarantine are implemented. A scanner is not integrated. Files remain non-releasable until a trusted process records `CLEAN` plus safe/sanitised metadata.
3. **Worker HTTP health** — workers use process supervision, database leases, retry/recovery state and structured logs rather than public HTTP endpoints. Production monitoring must provide liveness and queue-age/lease alerts.
4. **Warnings** — ESLint reports 9 existing warnings and 0 errors. Next.js also reports the middleware-to-proxy deprecation and two webpack Edge-runtime compatibility warnings; the build succeeds. Prisma reports its package.json configuration deprecation. These are DEV-P3 cleanup items, not a release blocker.

## External / human actions

- Statutory EPF, SOCSO, EIS and LINDUNG24 engineering is ready, but authorised human review/sign-off is pending and activation remains off.
- Production database, backups/PITR, secrets, domain/TLS, monitoring and deployment are Production Owner responsibilities.
- Production SMS123, WhatsApp and OpenAI Projects/credentials are Production Owner/provider actions and must be separate from Testing.

## Deferred product scope

- PCB/MTD remains partial pending the remaining official closure work.
- Public Bank payroll payment remains `PUBLIC_BANK_SPEC_NOT_READY`.
- Online subscription payment provider integration is deferred; current subscription billing boundary must not imply automatic settlement.
- SST/tax invoice commercial policy is deferred to the authorised tax/business decision.
- Supplier credit notes and return-to-supplier flows are deferred.
- General ledger, complete accounting, FIFO/COGS and inventory valuation are deferred.
- AI Business Analysis Phase 2 is deferred; Phase 1 remains read-only.

## Terminology

`READY_FOR_PRODUCTION_HANDOFF` means Development has produced a safe, tested and documented artifact for the Production Owner. It does not mean Production ready, Production validated or Production deployed.
