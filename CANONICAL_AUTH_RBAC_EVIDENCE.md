# Canonical Task 5 — authenticated boundary evidence

All fixtures use disposable PostgreSQL rebuilt from the verified 222 migrations. No Testing or Production data was changed. `authenticated-route-boundaries.test.ts` starts a real local Next server and sends requests bearing persisted, signed backoffice sessions; the other listed integration tests call actual route handlers or domain services with persisted fixtures.

| Boundary | Identity and direct request/action | Observed denial / permitted control |
|---|---|---|
| People admission | `TEAM_READ` signed session, same-branch person deep link | 200, allowed |
| People missing grant | Signed Staff without `TEAM_READ`, same person deep link | 307 to staff home, no profile |
| People branch | `TEAM_READ` Staff in branch A1, person in A2 | Next streamed shell HTTP 200 containing `NEXT_HTTP_ERROR_FALLBACK;404`; target name absent from serialized response |
| People tenant | Tenant A Staff, tenant B person ID | Same server-side 404 fallback; target name absent |
| Payroll admin | `TEAM_READ` Staff, `/team/payroll` | 307, no payroll page |
| Bank editor | `TEAM_READ` Staff, direct `/team/people/[id]/payroll/bank/edit` | 307, no bank page |
| Whole-business payroll | Branch A1 manager with `VIEW_PAYSLIP`, two-branch business, direct `/team/payroll/payslips/[entryId]` | 307 with all-branch access denial before document lookup |
| Group manager bank | Group-only manager with active scoped group grant, direct bank editor deep link | 307 business-access-denied; group directory read never implies bank edit |
| Anonymous People | No cookie, direct People deep link | 307 to login |
| Own payslip bytes | Employee self-service cookie, published PDF route | Own document 200 and private/no-store; other employee ID, other business ID, revoked token and anonymous request return 404 (`staff-pay-read-only-correctness.test.ts`) |
| Self approval | Submitter's own attendance overtime candidate with same persisted actor | `SELF_APPROVAL_NOT_ALLOWED`, no decision write (`payroll-p6a-overtime-approval.test.ts`) |
| Approval inbox | Mixed persisted leave, claim, commission, payroll, attendance fixtures | Self, other branch and other tenant excluded (`unified-approval-center.test.ts`) |
| Tenant context | Direct/group session business resolution | Group grant and requested business revalidated; unauthorized switch denied (`business-context-access.test.ts`) |

For streamed React Server Component pages, Next can send HTTP 200 before a later `notFound()` is raised. The test therefore requires the actual server-side 404 fallback marker **and** absence of target employee data; a 200 shell alone is never counted as authorization. API/PDF routes use explicit 403/404 responses. Final Testing UAT must recheck these outcomes against the deployed SHA.
