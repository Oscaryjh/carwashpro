# Member Wallet release gate

Wallet access is evaluated on the server for the current authenticated business.
UI capabilities are presentation only. Production is default-deny; publishing this
code does not enable Wallet for any business.

## Production contract

All four conditions must hold:

- `APP_ENVIRONMENT=production`
- `RAILWAY_ENVIRONMENT_NAME=production`
- `TETAMU_WALLET_PRODUCTION_PILOT=true`
- Authenticated business UUID is in `TETAMU_WALLET_PRODUCTION_BUSINESS_IDS`.

The flag accepts only exact lowercase `true`. Missing, false, or malformed flags
deny. The list is comma-separated UUIDs: surrounding whitespace and duplicate IDs
are normalized, but an empty list, empty entry, wildcard, or any malformed UUID
denies the entire list. UUID matching is case-insensitive. Conflicting or unknown
environment identities deny, including a conflicting `TETAMU_ENVIRONMENT` alias.
`NODE_ENV` is a build mode, never sufficient authorization on its own.

## Unchanged Testing and Local contracts

Testing still requires both environment identities to be `testing`, exact
`TETAMU_WALLET_TESTING_PILOT=true`, and membership in
`TETAMU_WALLET_TESTING_BUSINESS_IDS`. Production variables cannot authorize
Testing, and Testing variables cannot authorize Production.

Controlled Local disposable-database access remains governed by the existing
`TETAMU_WALLET_LOCAL_TEST` policy. These variables are private server variables;
never expose them through `NEXT_PUBLIC_` or accept them from request payloads.

## Enforcement and rollout boundary

Existing server authorization remains responsible for business, customer, role,
branch and permission checks. Current release access is rechecked before sensitive
reads, offer management, posting, checkout, refund, reversal, void and completed
operation replay / pending-intent recovery. Removing a business from the list
revokes replay and recovery as well; it does not alter ledger history or balances.
Ordinary non-Wallet Cash/Card payments and refunds retain their existing rules.

This change has no schema, migration, funds, reporting or loyalty changes.
Production deployment, flag configuration, allowlisting and financial smoke each
require separate authorization. This release is validated on Testing only, without
new funds activity or changes to the existing Testing allowlist.
