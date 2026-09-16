# HR/Payroll Controlled UAT Preview Deployment Specification

Date: 2026-09-17

## Objective

Publish the audited HR/Payroll canonical RC to a new Railway UAT Preview that is completely separate from Desktop Testing, Staff Testing, and Production. Use a new PostgreSQL database, synthetic eight-role data, commit-bound deployment metadata, post-deployment browser smoke, and explicit non-mutation proof for existing environments.

## Canonical Identity

- Branch: `codex/hr-payroll-canonical-rc-20260916`
- Source commit: `f2553d3fcf5965b50151a52a374112ccac430417`
- Source tree: `8d8f7cc821aaf1490c746d72be418b1211302549`
- Deterministic archive SHA-256: `1963e5a46bec9630a0b3be7f60674b6f7bfeff060a9eb8440af1c726ed1e2c82`
- Initial verdict: `READY_FOR_HUMAN_UAT`
- Human UAT: `PENDING`
- Deployment: `NOT_DEPLOYED`
- Production eligibility: `false`

## Allowed Actions

- Push only the specified RC branch without force.
- Create one new Railway Preview environment, one Web service, and one PostgreSQL service.
- Configure only Preview variables, migrate only the Preview database, seed only clearly synthetic data, create one Preview domain, and smoke-test only the Preview.
- Read existing Railway metadata for isolation comparison.

## Forbidden Actions

- Do not change or reuse Desktop Testing, Staff Testing, Production, their databases, domains, variables, services, volumes, or deployments.
- Do not clone real employees, payroll, bank, customer, Testing, or Production data.
- Do not merge `main`, create a PR, deploy Production, use a dirty CLI upload, or deploy an evidence-only commit as runtime source.
- Do not enable or call real SMS, WhatsApp, email, payment, bank, government, statutory, PCB Production, webhook, storage, cron, queue, AI, or OCR integrations.
- Do not disclose credentials, tokens, passwords, OTPs, session cookies, private keys, or database URLs.

## Hard Gates

1. Recompute source SHA, tree, digest, Manifest V2 hashes, ordered commits, Next 16.3.5, Sharp 0.35.4, and vulnerable nested-version counts.
2. Run TypeScript, lint, full unit, build, secret, generated-artifact, and absolute-path checks before push.
3. Stop with `PREVIEW_RESOURCE_LIMIT_BLOCKED` if Railway cannot provision fully isolated resources.
4. Stop with `PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING` if the application lacks a production-build-safe Preview integration-disable/intercept path.
5. Use only `prisma migrate deploy`; require 214 migrations and head `20260915090000_people_workbench_account_classification`.
6. Fixture must be idempotent and bind itself to the Preview environment/database while failing closed for Testing and Production.
7. Deploy from Git with authoritative commit metadata for the immutable source SHA.
8. Require health identity, Desktop/Staff/RBAC/restricted-feature smoke, and 1440/834/390/360 responsive smoke.
9. Recheck all existing Testing/Production identifiers, domains, variables, and migration heads. Stop with `ENVIRONMENT_ISOLATION_BREACH` if any changed.

## Synthetic Personas

1. Business Owner
2. Payroll Admin
3. HR Manager
4. Branch Manager
5. Supervisor
6. Group Owner
7. Group Manager
8. Staff

## Deliverables

- `docs/superpowers/plans/2026-09-17-hr-payroll-uat-preview-deployment.md`
- `TETAMU_HR_PAYROLL_UAT_PREVIEW_DEPLOYMENT_REPORT.md`
- `TETAMU_HR_PAYROLL_HUMAN_UAT_CHECKLIST.md`
- Preview URL and secure credential handoff location only when deployment gates pass.

## Allowed Final Verdicts

- `READY_FOR_HUMAN_UAT_ON_PREVIEW`: isolated Preview, source identity, migrations, synthetic fixture, smoke, restrictions, and non-mutation proof all pass.
- `PREVIEW_DEPLOYMENT_BLOCKED`: no acceptable Preview could be deployed; list the exact blocker and never overwrite Testing.
- `PREVIEW_DEPLOYED_WITH_BLOCKERS`: isolated Preview exists but smoke failed; prohibit Human UAT until repaired.

Never claim Production Ready, Production Eligible, Human UAT Passed, or Production Deployed.
