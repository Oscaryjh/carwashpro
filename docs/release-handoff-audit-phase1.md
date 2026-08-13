# Tetamu Development / Testing Release Handoff Audit Phase 1

## Scope and ownership

This audit covers Local and the Railway `testing` environment only. Production infrastructure, data, secrets, deployment, smoke tests, rollback execution, monitoring and validation remain the responsibility of the external Production Owner.

No Production environment, database, secret, account, domain or deployment is accessed by this audit.

## Release identity

- Canonical workspace: `C:\CodexTetamuP0`
- Branch: `codex/business-group-user-accounts`
- Base commit: `42dffd1066b9a839cdcea275be136f74d1db0a62`
- Source state: intentionally dirty; all existing changes are preserved
- Source identity: base commit plus `APP_RELEASE_SOURCE_DIGEST`, computed with `npm run release:source-digest`
- Runtime identity: `/api/health` returns environment, commit, source digest, deployment ID and package version without secrets

The source digest covers all tracked and non-ignored untracked release files except the seven handoff documents and Next's auto-generated `AGENTS.md`; these contain post-deployment/agent guidance and do not affect runtime behavior. Production startup fails closed when either `APP_RELEASE_SHA` or the 64-character source digest is absent.

## Development findings and closure

1. WhatsApp mock sending could previously run under a Production runtime. The notification worker now rejects Production mock mode before processing queue items.
2. The seed previously contained reusable default Platform Admin credentials. Production bootstrap is now an explicit one-time action, requires strong explicit credentials and refuses to overwrite an existing Platform Admin.
3. Local golden UAT preparation previously used a weak URL substring check. It now parses the database URL and accepts only exact loopback hosts.
4. Web release health and build identity were not externally observable. `/api/health` now verifies database connectivity and reports safe release identity.
5. Web and worker startup contracts were implicit. All startup entry points now execute the environment contract validator.
6. The previous Next.js runtime chain had published high-severity advisories. The runtime was upgraded to Next.js 16.3.0 with an explicit webpack production build, compatible flat ESLint configuration and audited dependency overrides. `npm audit` now reports zero vulnerabilities.

No open DEV-P0 or DEV-P1 blocker remains. The release can be handed to the Production Owner after the Testing release and smoke checklist are green.

## Automated evidence

The handoff gate includes:

- targeted release safety tests;
- full unit and integration suites;
- TypeScript and lint;
- Prisma validate and generate;
- migration status and disposable fresh rebuild;
- Local production-mode build;
- secret scan, canonical guard and `git diff --check`;
- Local health smoke;
- Testing web/worker deployment identity and Testing browser smoke.

Final automated counts are 856/856 unit tests and 160/160 integration tests. The Local production-mode build contains 136 generated application routes/pages plus the release health route.

Exact counts and deployment identifiers are recorded in the final audit report generated for this phase.

Accepted Testing identity:

- Web deployment: `de051919-180d-40a3-a155-4de716819ef2`
- Worker deployment: `bcec9c85-782b-4728-bb7d-e26cb29af399`
- Base SHA: `42dffd1066b9a839cdcea275be136f74d1db0a62`
- Source digest: `9c3ac840b12607ce4c80fc4341a9c4a95ae0ffcda8d835efb135eed6d8e0b6e0`
- Testing WhatsApp connector health: HTTP 200 with two active Testing sessions at audit time
- Testing migration pre-deploy evidence: 171 migrations and no pending migrations

Testing browser evidence uses the authorised `salon@test.com` QA identity. Login/logout, business performance, timezone/cutoff rendering, Staff App auth separation, Platform Admin route denial, module-entitlement denial and cashier cart behavior passed. A completed financial sale was not added during this handoff run because this POS-only Salon entitlement requires a customer/staff workflow and the canonical idempotency/financial sale path had already passed the current 856 unit and 160 integration suites. Treat the completed browser-sale item in `testing-release-smoke-checklist.md` as `READY_WITH_LIMITATION`, not as Production evidence.

## Runtime topology

| Component | Entry point | Required runtime | Health / recovery |
|---|---|---|---|
| Web | `npm start` | Node 22–24, PostgreSQL | `GET /api/health`, DB readiness, deployment identity |
| Notification worker | `npm run notification:worker` | PostgreSQL, WhatsApp mode/config | DB leases, idempotent queue claims, retry and expired-lease recovery, structured logs |
| Analytics worker | `npm run analytics:worker` | PostgreSQL | DB lease/sweep state and structured logs |
| WhatsApp connector | `whatsapp-connector: npm start` | persistent connector session storage | `GET /health`, connector logs and session state |

The workers do not expose a public HTTP endpoint. Production monitoring must check process liveness and the documented queue/lease signals.

## Security and data boundaries

- Session, Platform MFA/TOTP and payroll high-risk MFA are server-side and fail closed.
- Tenant, branch and capability enforcement are server-side; UI entitlement hiding is not the security boundary.
- Local/Testing OTP mocks are explicitly separated from Production.
- AI can be disabled; Production use requires an independent Production Project/key and `AI_PROVIDER=openai`.
- Private claim, expense and supplier-invoice attachments validate type/signature, size, name and SHA-256 and remain quarantined until malware and metadata checks are clean.
- A malware scanning integration is not implemented; attachment release therefore remains fail-closed. See known limitations.

## Decision

The Development / Testing release is eligible for `READY_FOR_PRODUCTION_HANDOFF` only when the final Testing smoke is green and DEV-P0/DEV-P1 are both zero. This statement is not Production readiness, validation or deployment.
