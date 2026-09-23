# Testing external outlet closure (222 baseline)

Release identity: `APP_ENVIRONMENT=testing` and `RAILWAY_ENVIRONMENT_NAME=testing` must agree; `TETAMU_TESTING_OUTBOUND_MODE=intercept`. Startup validation runs for web, notification, analytics and WhatsApp workers. Missing/invalid identity or mode fails closed.

| Outlet | Entrypoints and bypass paths | Final boundary in Testing | Evidence |
|---|---|---|---|
| Staff OTP SMS | request/resend API → OTP service → Twilio Verify or SMS123 adapter | Mock/local only, `EMPLOYEE_OTP_TESTING_ENABLED=true`, explicit phone allowlist and `is_test_account=true`; direct Twilio/SMS123 adapter calls denied before `fetch` | `testing-outbound-boundary.test.ts`, `attendance-employee-auth.test.ts` |
| WhatsApp | send API, manual send action, closing/reminder queue, retry worker → connector client → independent connector `/send` and socket | Queue requires explicit `mock`; web connector client denied before `fetch`; connector itself rejects Testing profile without Git SHA/intercept/mock and denies actual sender/recipient lookup before opening a socket | `testing-outbound-boundary.test.ts`, `notification-queue-worker-send-mode.test.ts`, `whatsapp-connector/src/testing-boundary.test.ts` |
| Email | No email transport implementation exists in this candidate (`rg` source inventory) | Startup requires `TESTING_EMAIL_MODE=disabled`; any future provider must call `assertTestingExternalDeliveryBlocked("email")` at its final transport | `release-environment-validator.test.ts` |
| Payroll/payment export | `/team/payroll/export`, payment provider registry | Export route returns 403 before file generation; bank adapter acquisition denied; no release-ready bank adapter exists | `testing-outbound-boundary.test.ts` |
| PCB/EPF/PERKESO official artifact or submission | statutory export route, authorization/status actions, artifact service, file builder | Route 403 and actions, artifact service and file builder deny before official generation/status mutation | `testing-outbound-boundary.test.ts`, `payroll-pcb-vc1-disposable-e2e.test.ts` |

Payroll/PCB internal calculation, snapshots, finalization and payslip publication remain usable on synthetic Testing data. Local disposable PCB VC1 E2E retains its legacy CP39 mathematics assertions; the same test additionally proves that the Railway Testing identity cannot create or download an official CP39 artifact. The two deferred post-alignment PCB migrations and their dependent features remain excluded.

No test intentionally calls a real provider. Transport spies verify zero network invocations at direct SMS/WhatsApp and queue boundaries. Testing UAT must re-check the effective Railway variables and actual worker deployment; source tests alone do not prove deployed configuration.
