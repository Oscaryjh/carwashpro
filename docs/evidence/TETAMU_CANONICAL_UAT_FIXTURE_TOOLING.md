# TETAMU Canonical Testing UAT Fixture Tooling

## Scope

This tooling prepares and verifies reusable UAT data in the Railway **Testing** environment only. It must never be used against Production.

Canonical tenants:

- `TETAMU CANONICAL UAT`
- `TETAMU UAT ISOLATION BUSINESS`

Canonical branches:

- `UAT MAIN BRANCH`
- `UAT SECOND BRANCH`
- `UAT ISOLATION BRANCH`

## Safety model

Every command fails closed unless all of these are proven:

1. `RAILWAY_ENVIRONMENT_NAME=testing`
2. `APP_ENVIRONMENT=testing`
3. Railway project, environment and service IDs match the approved Testing context
4. the database is PostgreSQL on a Railway internal/TCP proxy endpoint, or an explicitly identified SSH tunnel to the exact canonical Testing database service
5. `current_database()` is `railway`, `current_schema()` is `public`
6. the required forward migration exists and the migration ledger has no unfinished row

Database hostname is supporting evidence only; it is not treated as the canonical identity because Railway hostnames rotate. Localhost is rejected unless the exact Railway SSH-tunnel mode, database service ID and database service name are all present and match the approved Testing database.

There are no bypass flags. Any force, production, ignore, unsafe, skip, reset, delete, truncate or drop argument is rejected.

The prepare script does not import or call SMS, WhatsApp, email, payment-provider, refund-provider or webhook clients. Audit and verify are read-only.

## Commands

Run from an environment where Railway Testing metadata and `DATABASE_URL` are present.

```powershell
npm run uat:canonical:audit
npm run uat:canonical:prepare
npm run uat:canonical:prepare -- --apply
npm run uat:canonical:verify
```

`uat:canonical:prepare` is always a dry run unless the exact `--apply` argument is present. Apply repeats the complete environment and database guard immediately before the first mutation.

Never paste an SSH key passphrase, database URL, password, OTP, cookie, token or credential into chat, source, command output or a report. If Railway SSH requires a passphrase, enter it directly in the local terminal.

## Fixture ownership and idempotency

Fixture records use deterministic UUIDs derived from `TETAMU_CANONICAL_UAT_V1` and durable markers such as:

```text
[TETAMU_CANONICAL_UAT_V1:business.primary]
```

The tool only creates or repairs records addressed by those fixture-owned identifiers. A canonical unique key owned by a different record is `BLOCKED`; it is never overwritten. Existing Testing employee accounts for the two approved real-device UAT phones are reused without changing their authentication state or credentials.

No reset, truncate, drop or arbitrary delete exists in this workflow.

## Dataset contract

The primary business contains:

- owner/admin, branch-scoped manager/approver and normal staff identities
- two branches with manager-versus-second-branch isolation
- synthetic customer/contact and vehicle
- service, completed work order/sale, invoice, safe local payment and refund history
- historical and upcoming appointments
- product stock, supplier, purchase order and AP bill
- representative confirmed expense
- published roster shift
- completed attendance, same-date multi-session attendance, a missing-clock-out approval fixture, subordinate OT and manager self-OT negative fixtures
- leave policy/balance, approved request, subordinate pending request and manager self-approval-negative request
- approved/subordinate-pending/manager-self claims
- approved commission statement
- finalized payroll run, entry and protected staff payslip publication

The isolation business has its own branch and synthetic customer and has no membership for the primary business users.

All customer contact data uses reserved synthetic values and `invalid.test` email addresses.

## Expected workflow

1. Run audit. A missing fixture is expected before first preparation.
2. Run prepare without arguments and review `WOULD CREATE`, `WOULD UPDATE`, `ALREADY EXISTS`, `NO CHANGE` or `BLOCKED` results.
3. Run explicit `--apply` only after a safe dry run.
4. Run verify. Do not begin authenticated browser smoke until `ready: true`.

The scripts do not deploy application runtime code and do not merge branches.
