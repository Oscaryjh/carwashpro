# TETAMU HR & Payroll — Five-role Browser UAT

Date: 26 August 2026
Environment: Local development only
Desktop: `https://localhost:3000`
Standalone Staff App: `http://localhost:3100`

## Verdict

**Five-role browser surface UAT: PASS**

The five requested personas were exercised against the same local Core Acceptance business and canonical Payroll data. No Production tenant, real payment, statutory submission or real OTP was used.

This closes the previous five-role browser-coverage gap. It does **not** by itself make the product Production Ready because a fresh destructive Employee submission → manager decision → Payroll finalization journey, physical-device checks and operational release controls remain outstanding.

## Persona matrix

| Persona | Browser result | Verified access boundary |
|---|---|---|
| Employee | PASS | Own Home, Time, Requests, Pay and Profile only; direct manager Approvals entry redirects away |
| Supervisor | PASS | Leave and Claims approval workspace for the authorized branch; no Payroll navigation |
| Branch Manager | PASS | Time, Leave and Claims within the authorized branch; no Payroll navigation |
| HR | PASS | Payroll preparation/review and final-record visibility; payment and statutory actions remain restricted |
| Business Owner | PASS | Whole-business Payroll workspace, locked run, six entries and published Payslips |

## Business Owner evidence

- Action Center loaded with zero pending actions.
- August 2026 Payroll was locked.
- Six employee entries were present.
- Six of six Payslips were published.
- The run exposed the locked Timesheet revision used by Payroll.
- Canonical acceptance outcomes were visible:
  - Core A base pay: RM 3,000.00.
  - Core B approved OT: RM 64.90; net RM 3,064.90.
  - Core C paid leave: RM 3,000.00.
  - Core D unpaid leave deduction: RM 115.38; net RM 2,884.62.
  - Core E approved claim: net RM 3,120.00.
  - Core F commission: RM 200.00; net RM 3,200.00.

## Supervisor evidence

- Action Center exposed Leave and Claims only.
- Branch selection was limited to Acceptance Main Branch.
- Payroll was absent from navigation.
- No cross-branch or owner-only action was presented.

## Branch Manager evidence

- HR navigation exposed Overview, Time and Leave.
- Action Center exposed Leave and Claims for Acceptance Main Branch.
- Payroll was absent from navigation.
- Branch scope remained server-derived.

## HR evidence

- Canonical Payroll workspace loaded through `/team/payroll/workspace`.
- August 2026 showed six employees, gross RM 18,264.90 and net RM 18,269.52.
- Six of six Payslips were available.
- Calculation gate was ready.
- Payment access was not granted.
- Statutory action remained restricted.
- Bank-profile and statutory-profile follow-up actions remained visible without widening permission.

## Employee evidence

- Standalone Staff App loaded an unprivileged Core B employee session.
- Fixed navigation contained Home, Time, Requests, Pay and Profile.
- Requests displayed Leave, Claims, Attendance corrections and the canonical OT explanation.
- Pay displayed one published Payslip and no draft Payroll value.
- Profile displayed the employee code, employment data and active device.
- Direct access to `/staff/approvals` did not expose manager controls and returned to the employee surface.

## UAT fixture safety

The UAT fixture is development-only:

- `C:\CodexTetamuP0\scripts\prepare-hr-payroll-five-role-uat.ts`
- `C:\CodexTetamuP0\src\app\api\local-uat\session\route.ts`
- `C:\CodexTetamuP0-staff-ui\src\app\staff\uat-sign-in\route.ts`

Controls:

- refuses non-local database targets;
- local host is required;
- Production returns 404;
- credentials are supplied through environment variables;
- no real OTP is sent;
- no Production data is read or mutated.

## Remaining release UAT

Before Production Ready:

1. Run one fresh Employee submission → manager decision → HR/Payroll finalization → published employee document scenario.
2. Repeat the standalone Staff journey on a supported physical iPhone and Android device.
3. Validate the intended testing deployment, environment variables, backup, monitoring and rollback procedure.
4. Execute payment/statutory sandbox checks separately; do not use real payment or statutory submission for product UAT.
