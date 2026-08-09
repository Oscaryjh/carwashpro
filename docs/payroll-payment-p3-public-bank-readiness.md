# Payment P3A - Public Bank specification and adapter readiness

## Decision

**PAYMENT P3A PUBLIC BANK - PARTIALLY READY**

Tetamu has a safe provider-neutral adapter contract, an explicit provider
readiness registry, and a fail-closed Public Bank state. Public Bank's current
official public material confirms the product and portal workflow, but it does
not publish the byte-level file specification required to build a real bank
file.

`PUBLIC_BANK` must remain `NOT_RELEASE_READY` with the safe blocking code
`PUBLIC_BANK_SPEC_NOT_READY`.

`FULL FIELD-LEVEL PUBLIC BANK SPECIFICATION NOT AVAILABLE`

This document separates four evidence classes:

- **Confirmed from official Public Bank source** - supported by a source in the
  official-source register below.
- **Inference** - a cautious conclusion, never an implementation fact.
- **Internal Tetamu design** - a proposed or implemented Tetamu boundary, not a
  statement about Public Bank.
- **Still TBD** - `TBD - REQUIRES PUBLIC BANK CONFIRMATION`.

No third-party payroll vendor, another bank's layout, generic CSV convention,
or AI inference is accepted as a file-format fact.

## A. Canonical workspace gate

Verified on 8 August 2026 before the P3A work:

| Check | Result |
| --- | --- |
| Workspace | `C:\CodexTetamuP0` |
| Git root | `C:\CodexTetamuP0` |
| Branch | `codex/business-group-user-accounts` |
| Starting HEAD | `6db4e3dfa9aa5ebedf7977c01118bb423ef3ef6a` |
| Canonical guard | PASS |
| `git diff --check` before changes | PASS |

The path contains neither `OneDrive` nor `.p0-testing-deploy`.

## B. Current P3 work audit

The restored, uncommitted P3 work was reviewed and preserved:

- `src/lib/payroll/payment/index.ts`
- `src/lib/payroll/payment/providers/contract.ts`
- `src/lib/payroll/payment/providers/registry.ts`
- `src/lib/payroll/payment/providers/index.ts`
- `tests/unit/payroll-payment-p3-public-bank-readiness.test.ts`
- this readiness document

Already implemented before this review:

- provider-neutral `PaymentBankAdapter` types and method surface;
- an explicit adapter registry with no registered adapters;
- an explicit Public Bank readiness entry;
- payment-module exports;
- targeted tests proving there is no Public Bank adapter, route, or fixture.

Safe to keep:

- the provider-neutral contract;
- the empty registry;
- frozen batch and instruction snapshot inputs;
- test-only P0 artifact support, which is guarded by `NODE_ENV === "test"` and
  is not a bank adapter or download route.

Needs revision and was addressed in P3A:

- use the exact fail-closed code `PUBLIC_BANK_SPEC_NOT_READY`;
- distinguish a known but not-release-ready provider from an unknown provider;
- make deterministic instruction ordering explicit;
- ensure readiness errors contain no account, beneficiary, or configuration
  value.

Must not release:

- any Public Bank `buildArtifact` implementation;
- guessed filenames, extensions, encodings, layouts, payment types, or bank
  identifiers;
- a Public Bank artifact generation or download route.

There is no fake adapter, Public Bank placeholder adapter, or test-only Public
Bank implementation.

## C. Public Bank product identification

| Question | Official finding |
| --- | --- |
| Current corporate online-banking product | **PB enterprise**, Public Bank's Online Cash Management Service for businesses and corporates. The FAQ says it is distinct from and not linked to PBe Business Banking. |
| Payroll module | **Bulk Payroll**, formerly part of PB ECP terminology; it covers salaries, wages, overtime, bonuses, commissions, and allowances. |
| Bulk-payment module | **Bulk Payment**, for supplier/vendor and other beneficiary payments. |
| File upload | Yes. The service requires upload of a bank-prescribed electronic/data file. |
| Separate payroll subscription | Yes. The terms state Bulk Payment and/or Bulk Payroll applies only to customers subscribed to the relevant service. |
| Maker / Checker / Authorizer | Maker and Authoriser are confirmed. Verifier is an optional pre-authoriser role; Releaser is an optional post-authoriser role. The current official role name is not “Checker”. |
| Future-dated payment | Generic PB enterprise transaction approval supports a `Future Dated` instruction mode. Bulk Payroll file-specific date range and effective-date rules are **not confirmed from official Public Bank documentation**. |
| Same-bank | Yes, via Intrabank/PBB accounts. |
| Interbank | Yes, via IBG and RENTAS in the current Bulk Payment/Bulk Payroll FAQ. |
| Validation before authorisation | Yes. PB enterprise validates an uploaded file; the Maker then confirms it in `Bulk Payroll Status` or `Bulk Payment Status` before submitting it to the Approver. This confirms portal validation, not the Bank's verification of payee correctness. |
| Corporate/company identifier | Every registered corporate has a PB enterprise Company ID for login. Whether it is serialized in the upload file is TBD. |
| Debit/funding account | A Funding Account with sufficient funds is operationally required. Whether its number is embedded in the file, selected in the portal, or both is TBD. |
| Token / SecureSign | PB SecureSign and SecureSign Token are official approval mechanisms. The FAQ requires Authoriser approval using SecureSign for Maker-submitted transactions. |
| Transaction/daily limits | Authorised-person and configurable company limits are confirmed. Public pages publish rail-level transfer limits, but a Bulk Payroll file/batch maximum amount is not confirmed. |
| Test/sandbox/validation flow | Uploaded-file validation is confirmed. No public Bulk Payroll sandbox or non-funds UAT environment is confirmed. `Submit Test File` in the FAQ is for selected statutory-payment services, not proof of a Bulk Payroll sandbox. |

Terminology boundary:

- `PBe` / `PBe Business Banking` is not interchangeable with PB enterprise.
- `PB enterprise web` describes the web channel, not a separate confirmed
  product.
- The current service includes `Bulk Payment`, `Bulk Payroll`, Intrabank, IBG,
  and RENTAS.
- The current terms also name `ECP Payroll`, `ECP Payment`, `DuitNow ECP
  Payroll`, and `DuitNow ECP Payment`. Those labels do not disclose their file
  layouts or prove that one common format is accepted for every rail.
- No public Host-to-Host specification was found for this scope.

## D. Official source register

Sources were accessed on 8 August 2026. Only Public Bank-controlled pages and
documents are used as evidence.

| Source title | Official URL / document | Date / version | Relevant product | What it confirms | What it does not confirm | Reliability |
| --- | --- | --- | --- | --- | --- | --- |
| PB enterprise Bulk Payment / Bulk Payroll | https://www.pbenterprise.com/products-services/payments/bulk-payment-bulk-payroll/ | Live page; no document version shown | PB enterprise Bulk Payment / Bulk Payroll | Service purpose, payroll categories, upload capability, Intrabank/IBG/RENTAS processing windows, stop cut-off, Funding Account requirement | File layout, file limits, identifier values, filename, validation rules | MEDIUM - official operational/product page |
| PB enterprise FAQ | https://www.pbenterprise.com/help-support/faq/ | Live page; no document version shown | PB enterprise | Product identity, PBe distinction, Company ID, roles, File Upload validation/status/approval workflow, rails, stop workflow, transaction-approval lifecycle | Byte layout, exact upload errors, result-file format, correction filename/sequence rules | MEDIUM - official workflow/FAQ |
| Terms and Conditions Governing PB enterprise Service | https://www.pbenterprise.com/media/et3ft1og/pbenterprisetnc-en.pdf | `eFORMS/EBANK006/REV100726` | PB enterprise; ECP/DuitNow ECP Payroll and Payment | Subscription, bank-prescribed electronic file, Public Bank and other-institution payees, authorisation limits, sufficient funds, post-processing successful/unsuccessful reports | Field-level format, file transport details, report-file schema | MEDIUM - official terms/workflow |
| PB enterprise Online Application | https://apply.pbenterprise.com/pbenterprise | Live page; no version shown | PB enterprise | PB enterprise is the corporate platform; Bulk Payroll and Bulk Payment purposes; Approval Management | Operational file details and limits | LOW - official marketing/application page |
| PB enterprise Transaction Limit | https://www.pbenterprise.com/help-support/transaction-limit/ | Live page; no version shown | PB enterprise transfer rails | Current published Intrabank/IBG/DuitNow/RENTAS transfer-limit information | Bulk Payroll file, batch, or record limits; file amount control | LOW - official generic limit page, not bulk-file specification |
| PB enterprise Mobile App FAQ | https://www.pbenterprise.com/media/xucnsr5o/pb-enterprise-mobile-app-faq.pdf | Updated 23 June 2025 | PB enterprise / PB SecureSign | Company ID/User ID device binding, eligible roles, approval authentication | Upload-file layout or payroll workflow fields | MEDIUM - official security FAQ |

The current official FAQ embeds Public Bank tutorial videos titled
`Preparation Of Payment File`, `Uploading Of Payment File`, and
`Approve/Reject/Stop Payment File`. Their existence supports the workflow
context only. They are not treated here as a field-level specification or a
golden fixture.

No source in this register has `HIGH - field-level official specification`
reliability.

## E. File format status

Official sources confirm only a bank-prescribed electronic/data file. They do
not publicly identify the exact accepted container.

| Scope | Status |
| --- | --- |
| Payroll format | TBD - REQUIRES PUBLIC BANK CONFIRMATION |
| Bulk Payment format | TBD - REQUIRES PUBLIC BANK CONFIRMATION |
| Same-bank format | TBD - REQUIRES PUBLIC BANK CONFIRMATION |
| Interbank/IBG format | TBD - REQUIRES PUBLIC BANK CONFIRMATION |
| RENTAS format | TBD - REQUIRES PUBLIC BANK CONFIRMATION |
| DuitNow ECP format | The service name is official; its upload format is TBD |
| Portal-accepted format | Bank-prescribed electronic/data file; exact type TBD |
| CSV | Not confirmed |
| TXT / fixed width | Not confirmed |
| Excel | Not confirmed |
| XML / ISO 20022 | Not confirmed |
| Bank-specific template | A bank-prescribed format is confirmed; the actual template/specification is not publicly available |
| Manual entry only | False for Bulk Payment/Bulk Payroll because file upload is confirmed; manual alternatives are outside this adapter scope |

Ordinary payment upload must not be treated as a payroll file, and statutory
payment test-file support must not be treated as a payroll format.

## F. Field-level specification status

### File-level rules

All of the following are TBD: extension, content type, encoding, BOM, delimiter,
quote rules, escape rules, line endings, header presence, trailer presence,
filename rule, file sequence, duplicate filename handling, maximum records,
maximum file size, maximum batch amount, and maximum control amount.

The product page says the system imposes no bound on the number of Bulk Payment
transactions. This marketing statement is not sufficient evidence that an
individual uploaded file has no record or byte-size limit.

### Header

No public official header layout is available. Order/position, field name,
length, mandatory flag, data type, allowed characters, padding, format, and
description are all TBD for:

- record type;
- Company/Corporate ID;
- debit account;
- payment/effective date;
- currency;
- payment type;
- batch reference;
- record count;
- control amount;
- sequence number.

### Transaction/detail

Order, length, required flag, representation, allowed characters, padding, and
validation are all TBD for beneficiary name, account number, official bank
identifier, amount, payment reference, employee/reference ID, salary indicator,
transaction type, purpose, email, mobile, advice indicator, resident status,
beneficiary ID/type, and currency.

Tetamu currently has frozen sources for name, account number, amount, currency,
employee code, internal bank display code/name, and payment reference. Presence
in Tetamu does not establish a Public Bank field or layout.

### Trailer/footer

No footer confirmed. Public sources do not confirm a trailer record type,
record count, total/control amount, file reference, checksum, or sequence. Do
not design one internally.

### Date, amount, and characters

Payment date format, effective-date rule, decimal places, decimal separator,
thousands separator, rounding, zero/negative amount rules, name character set,
special-character handling, maximum beneficiary length, and uppercase rule are
all TBD.

These missing facts prevent byte-for-byte implementation.

## G. Bank identifier scheme

The official FAQ confirms the business rails/labels Intrabank (PBB), IBG, and
RENTAS. It does not disclose the identifier value or field used for a
beneficiary bank inside the upload file.

| Current bank-directory field | Public Bank requirement | Compatible? | Additional identifier required? |
| --- | --- | --- | --- |
| `bankCode`, e.g. internal display code `PBB` | TBD: IBG code, RENTAS code, DuitNow participant code, SWIFT/BIC, a Public Bank internal code, or another official code | No evidence of compatibility | Yes, if the official upload layout requires a serialized clearing identifier |
| `bankNameSnapshot` / display name | Official machine identifier not confirmed | No | Yes |

The Tetamu `PBB` display code must not be serialized merely because the official
FAQ also uses “PBB” as an Intrabank label. It is not an official clearing or
file identifier in the current model.

## H. Same-bank / interbank rules

Confirmed:

- Public Bank beneficiaries use the Intrabank path.
- Other-bank beneficiaries can use IBG or RENTAS.
- Processing windows and estimated receipt times differ by rail and by
  business/non-business day.
- Stop Payment must be approved at least 30 minutes before the processing
  cut-off.

Still TBD:

- transaction code;
- serialized bank code;
- row/record type;
- layout differences;
- file-level fees;
- exact effective-date encoding;
- advice rules;
- validation differences.

A future adapter must branch explicitly on bank-confirmed rails and identifiers;
it must not infer the rail from a display name.

## I. Payroll-specific rules

Confirmed:

- Bulk Payroll is a distinct service from Bulk Payment.
- It covers salary, wages, overtime, bonuses, commissions, and allowances.
- subscription to Bulk Payroll is required;
- official product material states data-file confidentiality protections;
- same-bank and other-bank payroll payments are supported.

Still TBD:

- salary transaction indicator and serialized payment type;
- confidentiality marker or narrative;
- employee advice fields;
- company payroll-registration value in the file;
- future payroll date and weekend/public-holiday effective-date behaviour;
- same-day file cut-off interpretation beyond published processing windows;
- maximum employees per file;
- salary-specific rejection/correction rules.

Ordinary Bulk Payment is not assumed to be equivalent to Bulk Payroll.

## J. Portal workflow

Confirmed workflow:

```text
Prepare bank-prescribed file
-> File Upload
-> PB enterprise validates file contents
-> Maker opens Bulk Payroll Status or Bulk Payment Status
-> Maker confirms file contents
-> Maker submits to Approver
-> optional Verifier -> Authoriser -> optional Releaser
-> processing window
-> successful / unsuccessful transaction report and total service fee
```

Confirmed menu/status names include `File Upload`, `Bulk Payroll Status`, `Bulk
Payment Status`, `Transaction Approval`, `Pending Approval`, and `Transaction
Approval Status`.

The Maker may save and edit incomplete transactions, edit submitted
transactions returned for rework, and withdraw a submitted transaction before
any approver has approved it. Generic PB enterprise approval supports Today,
Future Dated, and Recurring modes, but Bulk Payroll-specific file date rules are
not confirmed.

Still TBD: exact validation error payload/display, whether row-level errors can
be exported, whether invalid files remain stored, whether the Maker can edit
file rows in the portal, required re-upload behaviour, exact batch-reference
generation, and acknowledgement-download format.

## K. Result / error readiness

Official terms confirm that, after processing, PB enterprise makes available a
report of successful transactions, unsuccessful transactions, and total service
fee. The FAQ confirms `Transaction Approval Status` for workflow status.

`Result file specification not publicly available.`

Not publicly confirmed: result CSV/Excel/TXT/XML, PDF-only reporting, per-row
schema, validation-result export, upload-rejection schema, accepted/rejected
batch schema, transaction reference, bank reference, or stable machine-readable
error codes. P4 result parsing remains a separate contract and is not part of
`PaymentBankAdapter`.

## L. Correction / re-upload findings

Confirmed generic lifecycle facts:

- Maker can withdraw before any approver has approved.
- If at least one Authoriser has approved a wrong transaction, a later approver
  must reject or request rework.
- Reworked submitted transactions can be edited by the Maker.
- Expired transactions cannot proceed and must be recreated.
- A fully approved Bulk Payment/Bulk Payroll file can be stopped only if the
  Stop Payment instruction is approved at least 30 minutes before its processing
  window.
- Report discrepancies must be reported to the Bank; the terms specify a
  seven-day review/notification window.

Not confirmed: invalid-upload re-upload rules, new filename/sequence rules,
deletion of rejected uploads, cancellation after processing starts, isolated
employee re-upload, and whether the complete batch must be recreated. Those
remain blockers for the P3C correction lifecycle.

## M. Adapter contract

The current provider-neutral contract includes all requested P3 build
responsibilities:

- provider key, format version, content type, and extension;
- configuration, batch, instruction, and limit validation;
- control-total calculation;
- deterministic filename and artifact construction;
- frozen batch and instruction snapshots;
- explicit deterministic `instructionSequence` ordering.

The contract deliberately has no Prisma return type, UI dependency, live
employee-profile lookup, logging, or result parser. Validation issues expose
codes and safe identifiers only, not human-entered values or full account
numbers.

No additional Public Bank method is justified before the specification exists.
If official rules later require pre-build normalization or multiple file types,
extend the provider-neutral contract only after comparing at least one other
bank/provider to avoid encoding Public Bank semantics into the generic layer.

## N. Current provider foundation

| Classification | Finding |
| --- | --- |
| Already implemented | Contract, provider key, readiness map, empty registry, safe access error, registry lookup/list, payment-module export |
| Safe to keep | All of the above; none generates a bank file |
| Needs revision | Only when an official field specification/golden fixture identifies missing neutral inputs |
| Must not release | Public Bank file generation, filename, bank-code mapping, artifact route/download |

`PUBLIC_BANK` is known but `NOT_RELEASE_READY`; unknown provider keys are a
separate safe error. No adapter is registered.

## O. Public Bank readiness matrix

| Requirement | Officially confirmed? | Current Tetamu support | Schema change needed? | Adapter change needed? | Blocked? |
| --- | --- | --- | --- | --- | --- |
| File format/container | No | None | TBD | Yes | Yes |
| Filename | No | Artifact can store a filename but no builder | No for storage; rule TBD | Yes | Yes |
| Encoding/BOM | No | Byte-oriented artifact storage | No | Yes | Yes |
| Line ending | No | Byte-oriented artifact storage | No | Yes | Yes |
| Bank identifier | Rail labels only; no file identifier | Internal display code/name only | Likely additive mapping/config after confirmation | Yes | Yes |
| Payment date | Generic future-date workflow only | Contract has nullable requested date; persistent payment-date snapshot absent | Likely | Yes | Yes |
| Amount representation | No | Decimal net-pay snapshot exists | No for amount source | Yes | Yes |
| Corporate/Company ID in file | Company ID exists for login; file use unconfirmed | Provider config contract only | TBD | Yes if required | Yes |
| Debit/Funding Account in file | Funding Account operationally required; file use unconfirmed | No provider config persistence | Likely if byte-affecting | Yes if required | Yes |
| Payment type value | Service names only; serialized values unconfirmed | None | TBD | Yes | Yes |
| Record count | File control rule unconfirmed | Batch/artifact record counts exist | Possibly no | Yes if required | Yes |
| Control total/amount | No | Contract can calculate; artifact does not persist it | Likely if required | Yes | Yes |
| File sequence | No | None | Likely if required | Yes | Yes |
| Same-bank | Rail confirmed; layout unconfirmed | Bank display snapshot exists | TBD | Yes | Yes |
| Interbank | IBG/RENTAS confirmed; layout/identifier unconfirmed | Bank display snapshot exists | Likely identifier addition | Yes | Yes |
| Max records | Product page says no transaction-count bound; file cap unconfirmed | Batch count exists | No unless a new provider limit snapshot is required | Yes | Yes |
| Max amount | Bulk-specific file/batch maximum unconfirmed | Batch total exists | No unless control snapshot required | Yes | Yes |
| Advice | No | No frozen advice fields | Yes if required | Yes | Yes |
| Salary indicator | No serialized rule | Batch purpose exists internally, not a bank value | TBD | Yes | Yes |
| Currency | Service is Malaysian; upload representation unconfirmed | MYR batch/instruction snapshot | No for source | Yes | Yes |

## P. Provider configuration

Do not add environment variables from this audit.

| Candidate | Classification | Reason |
| --- | --- | --- |
| Company ID for PB enterprise login | CONFIRMED_REQUIRED for portal access only | Every corporate receives one; no evidence it belongs in file bytes |
| Corporate ID serialized in file | TBD | No public field specification |
| Debit/Funding Account | CONFIRMED_REQUIRED operationally | Official material requires sufficient funds in the Funding Account; representation and file inclusion are TBD |
| Payment type | TBD | Service/rail names do not establish serialized values |
| File sequence | TBD | No public rule |
| Authorization mode | NOT_REQUIRED for the adapter with current evidence | It is a portal role/workflow concern; revisit only if it changes bytes |
| Other provider ID | TBD | No official field specification |

Any byte-affecting sensitive configuration must be server-only, absent from
HTML/DTO/log/audit, and versionable. Audit events may store only non-sensitive
configuration revision identifiers.

## Q. Provider configuration versioning

Design decision: if Corporate ID, Funding Account, payment type, sequence state,
or another provider setting affects immutable bytes, every artifact must prove
which configuration revision was used.

Preferred design after confirmation:

1. immutable `PayrollPaymentProviderConfigurationVersion` records with encrypted
   sensitive values and a safe revision ID; or
2. an equivalently immutable encrypted configuration snapshot referenced by the
   artifact.

The build context already carries `configurationRevision`, but the database
does not persist a provider configuration version or an artifact reference to
one. Do not create the table until official fields are confirmed. An editable
singleton configuration without version history is not acceptable for bank
artifact provenance.

## R. Model gap

### Already available

- `EmployeeBankAccountVersion`: internal bank code/name, account holder,
  encrypted account number, last four, fingerprint, verification and revision.
- `PayrollPaymentBatch`: business/payroll run, number, revision/type, status,
  currency, instruction/control counts, total ready amount, approvals and
  immutable lineage.
- `PayrollPaymentInstruction`: frozen employee/name/code, frozen internal bank
  code/name, encrypted account snapshot, net pay, currency, reference and
  blocker state.
- `PayrollPaymentArtifact`: provider key, format version, revision, encrypted
  bytes, IV, auth tag, encryption key version, SHA-256, byte length, record
  count, filename, creator and creation time.

### Safely derivable

- batch total and instruction count from frozen instructions;
- deterministic internal instruction order using a frozen sequence assigned
  before adapter execution;
- full beneficiary account number by decrypting the frozen instruction snapshot
  at server-side build time only;
- same-bank candidate only after an official bank-identifier mapping exists.

### Missing - requires model change if confirmed

- official clearing/bank identifier snapshot;
- requested/effective payment-date snapshot;
- provider configuration version reference;
- provider file sequence;
- immutable provider control totals;
- beneficiary purpose/identity/residency/advice data, if the official layout
  requires them.

### Bank-specific configuration

- provider Company/Corporate ID;
- Funding/Debit Account;
- provider payment type and other provider IDs;
- any sequence namespace/state.

### Not needed with current evidence

- live employee-profile lookup during artifact build;
- UI state or Prisma result types in the adapter;
- a P4 result parser in the P3 adapter;
- schema fields based only on third-party examples.

No schema field should be added from this audit alone.

## S. Artifact gap

The existing artifact already stores:

`providerKey`, `formatVersion`, `revision`, `ciphertext`, `iv`, `authTag`,
`encryptionKeyVersion`, `sha256`, `byteLength`, `recordCount`, `filename`,
`createdById`, and `createdAt`.

Potential immutable additions, subject to the official specification:

- control amount and bank-defined control record count;
- file sequence;
- payment/effective date snapshot;
- content type;
- provider configuration version reference;
- debit-account snapshot reference or configuration-version link.

Design outcome: **P3B ADDITIVE MIGRATION REQUIRED** before release if any of
those values affects bank acceptance or historical reproduction. No migration
is authorized in P3A.

## T. Golden fixture gate

No Public Bank adapter may be registered without a fixture from one of:

1. official Public Bank sample;
2. PB enterprise portal template/sample;
3. Public Bank officer-confirmed sample;
4. controlled PB enterprise validation output.

Minimum synthetic coverage:

- one and two employees;
- Public Bank beneficiary;
- interbank beneficiary for every supported rail;
- decimal amount and maximum field length;
- future date if officially supported;
- invalid account and bank identifier;
- invalid control total;
- duplicate sequence if applicable.

Fixtures must never contain real employee salary/account data. Portal testing
must stop after validation and must not authorise or release funds. If the portal
cannot validate without fund release, contact Public Bank before UAT.

## U. Code changes in P3A

Allowed generic/readiness changes only:

- retained the provider-neutral contract and empty registry;
- registered `PUBLIC_BANK` as known but `NOT_RELEASE_READY`;
- standardized the safe block as `PUBLIC_BANK_SPEC_NOT_READY`;
- added fail-closed known/unknown provider access;
- added explicit frozen instruction sequencing;
- expanded documentation and targeted readiness tests.

Not added: Public Bank adapter, artifact bytes, filename rule, layout, bank-code
mapping, route, download, environment variable, Prisma migration, P4 parser, or
production integration.

## V. Tests

Targeted P3A tests cover:

- provider registry remains empty;
- unknown provider handling;
- Public Bank not-release-ready state;
- artifact access fails with `PUBLIC_BANK_SPEC_NOT_READY`;
- errors do not echo provider input or sensitive values;
- no guessed adapter, route, filename, identifier mapping, or golden fixture;
- required provider-neutral methods;
- deterministic frozen instruction ordering;
- no Prisma/UI/result-import dependency in the adapter contract;
- documentation hard-block assertions.

P0/P1/P2 regression, full unit, integration, lint, TypeScript, and production
build are part of the local gate, not evidence of Public Bank format readiness.

## W. Local gate

Required before handoff:

1. canonical guard;
2. TypeScript type-check;
3. lint;
4. targeted Payment P3A unit tests;
5. full unit tests;
6. integration tests, with isolated/serial rerun if a known deadlock appears;
7. production build;
8. `git diff --check`.

Passing these gates does not authorize a real Public Bank file.

## X. Blockers

The hard-block facts remain unconfirmed:

- actual upload format and extension;
- field order/layout and header/trailer rules;
- beneficiary bank identifier scheme;
- amount, rounding, encoding, BOM, and line endings;
- payment/salary type values;
- control-total rule;
- filename and sequence rules;
- bank-confirmed golden fixtures;
- result/correction file specifications.

Any one of these is sufficient to prevent real file generation.

## Y. Recommended next action

Ask the customer's Public Bank Account Holding Branch / PB enterprise support
for the current, product-specific package covering **Bulk Payroll and Bulk
Payment** for every intended rail (Intrabank, IBG, RENTAS, and DuitNow ECP if
subscribed):

- current user/file-format guide with revision/date;
- official template and blank/synthetic samples;
- bank/clearing-code directory;
- filename/sequence and duplicate rules;
- field validation, amount/date/character rules;
- maximum file/record/amount limits;
- result/error/correction specification;
- a non-funds validation/UAT procedure.

Then compare the package's product name and revision with the customer's actual
PB enterprise subscription. Only after field-level review and golden-fixture
approval may P3B implement configuration persistence, any additive migration,
and the real adapter.

## Z. Production safety

- No commit or push.
- No Railway Testing or production deployment.
- No production migration or variables.
- No real bank artifact or download route.
- No Bank submission, approval, payment marking, reconciliation, P4 work, Claim
  resumption, or production change.

The only safe current behaviour is fail-closed:

```text
PUBLIC_BANK_SPEC_NOT_READY
```
