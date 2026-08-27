# TETAMU Real Device UAT — Leave Submission Incident

## 1. Incident Summary

- Environment: Railway `testing`
- Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Employee: Twilio OTP QA Staff (`TWILIO-OTP-QA`)
- Intended request: Annual Leave, 27–28 Aug 2026, full day, reason `Urgent leave`
- User-visible result before the fix: `Unable to process the attendance request.`
- Actual server result before the fix: HTTP `500`, caused by `ClaimPrivateStorageConfigurationError`
- Final verdict: **FIXED**

## 2. Environment

- Railway project: Tetamu-POS
- Environment: Testing only
- Staff service: `tetamu-staff-app`
- Desktop service: `tetamu-pos-web`
- Testing Staff deployment: `b88a612e-cce3-468d-8185-e66399a4bf94` — `SUCCESS`
- Testing Desktop deployment: `a7c05d69-5702-461b-87c5-d6384ba193cc` — `SUCCESS`
- Production was not inspected, modified, or deployed.

## 3. Real Device Input

The failed iPhone request was sent with the following user-entered data:

- Leave type: Annual Leave
- Start date: 27 Aug 2026
- End date: 28 Aug 2026
- Unit: Full day
- Reason: `Urgent leave`
- Supporting document: an attachment was included in the original failed multipart request

The original multipart request body was not retained by Railway logs, so its generated `clientRequestId` cannot be recovered. The approximately 1.69 MB received request size is consistent with the reported attachment.

## 4. Request Trace

Three failed POST attempts were found in Railway Testing HTTP logs:

| Timestamp (UTC) | Request ID | Method / route | HTTP |
| --- | --- | --- | --- |
| 2026-08-26 05:14:49.581 | `kk8EmakFQ6uVvzPeoB_USg` | `POST /api/employee-leave` | 500 |
| 2026-08-26 05:14:51.413 | `OYEJHCLqR4KGHZ1RacI7Nw` | `POST /api/employee-leave` | 500 |
| 2026-08-26 05:14:52.818 | `c1_a7tqzShiMN-vdAQeqjw` | `POST /api/employee-leave` | 500 |

Application logs recorded `[employee-attendance] Request failed`; the underlying exception was `ClaimPrivateStorageConfigurationError` and was reduced to the generic `INTERNAL_ERROR` response.

## 5. API Route

- Frontend component: `src/components/staff-pwa/staff-leave.tsx`
- Correct API: `POST /api/employee-leave`
- Route handler: `src/app/api/employee-leave/route.ts`
- Service: `submitEmployeeLeave` in `src/lib/leave/service.ts`
- Payload transport: multipart form data when an attachment is selected

The request did not incorrectly call an Attendance API. The misleading Attendance wording came from shared error normalization.

## 6. Frontend Error Mapping

Before the fix, unknown Leave exceptions passed through the shared Attendance error handler:

- `src/lib/attendance/api-error.ts`
- `src/lib/attendance/response.ts`

This converted the storage exception to:

```text
Unable to process the attendance request.
```

The fix adds `src/lib/leave/api-error.ts` and applies `normalizeEmployeeLeaveApiError` to Leave request and Leave document routes. A missing private upload service now returns HTTP `503` with a Leave-specific, actionable message:

```text
Supporting document upload is temporarily unavailable. If the document is optional,
remove it and submit your Leave request again. Otherwise, try again later.
```

## 7. 27 Aug Roster

- Date: 27 Aug 2026
- Published roster: YES
- Shift: Real Device UAT Shift, 09:00–18:00
- Expected day: `WORKDAY`
- Expected-day source: `ROSTER`
- Controlled retest snapshot ID: `51a27967-85c4-42b2-bee1-f45426a710c2`

## 8. 28 Aug Roster

- Date: 28 Aug 2026
- Published roster: YES
- Shift: Real Device UAT Shift, 09:00–18:00
- Expected day: `WORKDAY`
- Expected-day source: `ROSTER`
- Controlled retest snapshot ID: `51a7159b-0e8a-4e4a-b0cf-0756c115f185`

## 9. Expected Day Analysis

Both requested dates have valid current Expected Days. The Leave service successfully materialized:

- 27 Aug: 1.00 day, `FULL_DAY`, `WORKDAY`
- 28 Aug: 1.00 day, `FULL_DAY`, `WORKDAY`
- Total requested: 2.00 days

Missing roster or missing Expected Day was not the cause of the original HTTP 500. Such a condition would have produced a Leave-specific validation/conflict response before persistence.

## 10. Leave Policy

- Policy ID: `514f167b-57d6-4efa-a081-8a22dba5d8c7`
- Policy: Annual leave (company policy)
- Version ID: `29cf5a5e-db7b-492d-ba37-f0f00b92db13`
- Effective from: 1 Jan 2026
- Status: Active
- Day basis: Weekdays
- Pay treatment: Paid
- Balance tracked: YES
- Negative balance: Not allowed
- Supporting document required: NO

The policy was valid for the requested dates and did not block submission.

## 11. Balance

- Available balance before the controlled retest: 5 days
- Requested: 2 days
- Balance sufficient: YES

The entitlement ledger was not the source of the failure.

## 12. Approver Resolution

- Manager: Real Device UAT Manager
- User ID: `5840c06f-fd53-4d8f-8983-e70d0011f876`
- Business: Royal Salon
- Branch/scope: salon online
- Required permission: `APPROVE_LEAVE`
- Permission and scope available: YES

## 13. Current Attendance Interaction

The employee had an open Attendance session on 26 Aug 2026. The request concerned future dates, 27–28 Aug 2026. `submitEmployeeLeave` does not reject a future Leave request because the employee is currently clocked in. The open session did not cause this incident.

## 14. Timezone Analysis

- Business timezone: Asia/Kuching
- Branch Attendance timezone: Asia/Kuala_Lumpur
- Both are UTC+08:00 for these dates.
- Leave dates are parsed and stored as date-only UTC-midnight values.
- No one-day shift or date-boundary error was observed.

Timezone handling was not the root cause.

## 15. Multi-day Materialization

The controlled retest created one `LeaveRequest` and exactly two `LeaveRequestDay` rows:

| Date | Fraction | Expected kind |
| --- | ---: | --- |
| 2026-08-27 | 1.00 | WORKDAY |
| 2026-08-28 | 1.00 | WORKDAY |

The request's `requestedDays` is `2.00`, confirming correct multi-day calculation.

## 16. Root Cause

### Primary root cause

The Testing services did not have private attachment storage configured. Selecting an optional supporting image called the Leave document preparation path, which raised `ClaimPrivateStorageConfigurationError` before `submitEmployeeLeave` could create the request.

### Secondary root cause

Leave routes reused a generic Attendance error response. This hid the storage fault behind an unrelated message, making the incident appear to be an Attendance or roster failure.

### Explicitly ruled out

- Roster publication
- Expected Day generation
- Leave policy effective version
- Leave balance
- Manager approval scope
- Open clock-in session
- Timezone conversion
- Multi-day requested-day calculation

## 17. Fix

### Testing infrastructure

- Created a Testing-only private object-storage bucket in Railway, region Singapore.
- Configured private claim/leave attachment storage variables on Testing `tetamu-staff-app` and `tetamu-pos-web`.
- Used the isolated prefix `testing/private-attachments`.
- Completed a real PUT/read/delete storage canary successfully; the canary object was deleted.
- No credential is recorded in this report or source code.

### Code

- Added Leave-specific storage error normalization.
- Applied it to Leave submission and Leave document routes.
- Commit: `7aae797 fix(leave): report private evidence outages correctly`
- Branch: `codex/staff-ui-testing-integration`

## 18. Regression

- Targeted unit test: `tests/unit/leave-management-phase2e.test.ts`
- Result: 8/8 passed
- TypeScript: passed
- ESLint on changed files: passed
- `git diff --check`: passed
- Both Testing deployments: successful

## 19. Controlled Retest

Exactly one controlled Leave submission was performed after the two successful Testing deployments.

- Employee: Twilio OTP QA Staff
- Dates: 27–28 Aug 2026
- Reason: `Urgent leave`
- Supporting document: none (optional under the selected policy)
- Result: `SUBMITTED`
- Leave request ID: `3adf4414-36e9-44cb-8c35-cc5e9cf67d0a`
- Client request ID: `c6521a63-6307-49c9-8dd0-dcbc4691ef26`
- Status: `PENDING`
- Revision: `0`
- Matching requests after retest: exactly `1`
- Requested days: `2.00`
- Approval action performed: NO

The controlled retest was service-level inside the deployed Testing Staff container. Therefore the incident's observed HTTP result remains `500`; no HTTP status is invented for the direct service retest.

## 20. Manager Visibility

The unified approval inbox was queried read-only using the existing Real Device UAT Manager's real business, branch, and `APPROVE_LEAVE` scope.

- Leave inbox total: 1
- New request visible: YES
- Domain: `LEAVE`
- Kind: `APPROVAL`
- Approval stage: `LEVEL_ONE`
- Employee: Twilio OTP QA Staff
- Summary: Annual leave (company policy), 27–28 Aug 2026, 2 days, Paid
- Status: `PENDING`

The request was not approved or otherwise mutated.

## 21. Real Device UAT Status

The server-side blocker is cleared in Testing:

- Correct Leave API route: PASS
- Private attachment storage: PASS
- Leave-specific error response: PASS
- Policy and balance: PASS
- Roster and Expected Days: PASS
- Multi-day materialization: PASS
- Manager approval visibility: PASS
- Production touched: NO

A final human iPhone UI retry may be used to validate the complete browser upload experience, but it is no longer blocked by the identified server configuration issue.

## 22. Final Verdict

**FIXED**

Testing can accept this two-day Annual Leave request and expose it to the correct Manager approval scope. The original blocker was missing Testing private attachment storage, compounded by incorrect generic Attendance error wording. Both were corrected without changing Production or approving the Leave.
