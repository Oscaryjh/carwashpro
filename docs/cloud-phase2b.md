# Clean cloud baseline — Phase 2B

## Source identity and exclusions

Base: `e24b96f450e60ac6876de5b5c2f6badb58415944` (deployed Company wording release).
Preparation branch: `codex/cloud-baseline-phase2b-20261029`.

Only selected CI/setup content from `c229dc871410986b71ab4034fd4e8a7ef6933acb` is ported. `92fb919a553a92796b65814056ee75331fee9910` is reviewed but NOT ported: this baseline has exactly 230 migrations and its existing manifest already matches. Meta migrations 231/232, schema/provider/webhook changes, delivery tools, recipients, credentials, Windows Local startup changes, generated files and Phase 2A's baseline-specific documentation are excluded. The canonical branch and dirty files remain untouched.

## Runtime and validation

Node 24.19.0 is pinned in `.node-version`; setup enforces the existing npm 11.12.1 package-manager declaration. Linux setup installs dependencies and generates Prisma without requiring a database, Windows path or Local server. Do not copy any `.env` or auth/session data into the cloud checkout.

CI has read-only repository permission and no secrets, environment attachment, deploy job or deployment credential. A runner-owned PostgreSQL 18 service has a loopback-only published port and disposable database. The migration entry point rejects remote URLs, missing CI opt-in and non-empty databases. It does not invoke existing Local harnesses. Temporary trust authentication applies only to this isolated CI service.

After installation, unit tests, TypeScript and build run under `sudo ... unshare --net`: only a fresh loopback interface exists, so application checks cannot reach Production, Testing or other external resources. The disposable migration command runs separately against the exact loopback service. A runner lacking sudo/network-namespace support must fail, never silently fall back to unrestricted execution. Dependency installation still needs registry/Prisma-download access and receives no application credentials.

The cloud setup is not a web preview launcher. Preview setup is a later task using disposable resources. Existing Windows-oriented Local scripts remain in baseline history but are not executed by the cloud entry points.

## Main-only patches reviewed, not merged

- `fc88f44`: older browserslist override/lock updates (4.28.4 to 4.28.8 plus related browser-data packages). This deployed baseline already locks browserslist 4.29.0 and overrides js-yaml to 4.3.2. Its specific version bump is superseded here; blindly applying it could downgrade dependencies. No patch is ported. Current advisory exposure still needs a separate dependency audit; this version comparison does not certify vulnerability absence.
- `1702e1`: sanitized PostgreSQL restore-startup diagnostics.
- `9c5b7e5`: disposable restore runtime helper, temporary Unix socket directory, startup/cleanup handling and tests.
- `71f4786`: includes that helper in `Dockerfile.database-ops`.

The last three patches matter if database-ops/restore verification is adopted on Linux. They are not required by this CI path, which uses a service container and never runs restore tooling. No main patches are merged automatically.

## Validation and release boundaries

Windows validation is explicitly distinct from Linux validation. Record dependency-install scope, targeted tests, manifest, TypeScript, script syntax and diff checks. Actual Linux setup, network namespaces, disposable migration execution and production build remain BLOCKED until a Linux runner executes them. No remote migration or deployment is authorised.

Proposed next step after approval: push only this preparation branch, then open a draft PR with an explicitly chosen base and run CI without a Railway deployment connection. First confirm no existing Railway service watches the proposed branch. Never push canonical, main or testing as part of this preparation. Production publication remains a separate explicit human approval.

## Recorded local verification

- Independent Windows dependency install: `npm ci --ignore-scripts --no-audit --no-fund` passed; `npm ls --depth=0` reported no dependency problems. No canonical node_modules directory was shared or modified. Local npm was 11.17.0; the pinned cloud npm 11.12.1 installation still needs Linux verification.
- Prisma Client 6.19.3 was generated from this worktree's own 230-migration schema. An initial TypeScript run raced client generation and is not acceptance evidence. The correctly ordered rerun passed with 8192 MiB heap.
- Targeted tests: 19/19 passed. Existing migration manifest matches 230 files; no SQL, schema, lockfile, package scripts or business logic changes.
- YAML parsing/structure, scoped lint, Bash/JavaScript syntax and diff checks passed. CI migration guards rejected missing CI opt-in, a remote URL and the real Local business database without connecting.
- Canonical HEAD stayed `c229dc871410986b71ab4034fd4e8a7ef6933acb`; original thirteen dirty-file hashes remained exact. Preparation-file scan found no known Local secret matches or common token/private-key patterns. This is not a full-history security attestation.
- Linux npm install, network-namespace execution, actual disposable migrations and production build: BLOCKED (no Docker or installed WSL Linux distribution). No remote database checks, migrations or deployments were run.
