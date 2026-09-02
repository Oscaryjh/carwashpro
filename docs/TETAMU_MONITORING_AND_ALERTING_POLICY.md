# TETAMU Monitoring and Alerting Policy

## 1. Scope

This policy covers operational health, backup/restore, workers, HTTP server errors and SMS123
provider failures. It does not change HR, Payroll, statutory, Leave, Claims, Attendance, Timesheet,
Roster or Staff App business behavior.

## 2. Signals

Primary signals are Railway deployment/runtime logs, Desktop `/api/health`, Staff `/staff/login`,
PostgreSQL readiness, backup/restore outcomes, worker outcomes, SMS123 adapter failures, Payroll
audit logs and statutory deny audit/log records.

## 3. Severity

`INFO` is audit or recovery, `WARNING` is a degraded/provider rejection path, `ERROR` is a repeated
operational failure, and `CRITICAL` is service, database, backup or restore unavailability. Normal
business validation must not be classified CRITICAL.

## 4. Alert Receiver

One real Testing HTTPS webhook must be configured as `OPS_ALERT_WEBHOOK_URL` on every emitting
service. The URL is a secret. A delivery is not accepted as human-visible evidence unless the
receiver returns a message/event/request identifier and an operator can inspect it.

Current state on 27 Aug 2026: **NOT CONFIGURED**. No Slack, Discord, Teams or generic operations
webhook variable exists on the audited Testing services.

## 5. Health Checks

Desktop probes `/api/health`; its payload must report `ok=true` and `database=ready`. Staff probes
`/staff/login` and accepts HTTP 2xx/3xx. The monitor never authenticates as an employee.

## 6. Failure Thresholds

Health alerts require three consecutive failures. HTTP server errors require five events within
five minutes. These defaults suppress transient noise while preserving repeated failures.

## 7. Recovery Notifications

Health and database incidents recover after two consecutive successful probes and emit
`SERVICE_HEALTH_RECOVERED` or `DATABASE_RECOVERED` with status `RECOVERED`.

## 8. Backup Alerts

Final backup job failure emits `BACKUP_JOB_FAILED` at CRITICAL severity. A Testing-only controlled
archive-validation injection is permitted only with `OPS_ALERT_TEST_MODE=true`.

## 9. Restore Alerts

Final disposable restore verification failure emits `RESTORE_VERIFICATION_FAILED` at CRITICAL
severity. Controlled checksum injection cannot run outside Testing.

## 10. DB Alerts

Three consecutive Desktop health responses without `database=ready` emit
`DATABASE_UNAVAILABLE`. The test harness simulates the monitor decision; it never stops PostgreSQL.

## 11. 5xx Alerts

Next instrumentation records server request errors. Five errors in five minutes emit
`HTTP_5XX_THRESHOLD_EXCEEDED`. Route metadata is safe and does not include query strings.

## 12. Deployment Alerts

Railway remains the deployment status source. Automatic forwarding to the common receiver is
currently PARTIAL and requires Railway/GitHub notification configuration. Failed deployments must
also be checked in Railway Deployments.

## 13. Worker Alerts

Fatal workers, three repeated analytics sweeps, exhausted notification delivery and failed closing
reminder sweeps emit `SCHEDULED_JOB_FAILED` with job name, attempt and stable error code.

## 14. SMS123 Alerts

The Staff adapter emits `SMS123_PROVIDER_ERROR` for API rejection, timeout, unavailability or an
invalid provider response. Provider-accepted/handset-unknown delivery remains a provider delivery
investigation and does not trigger an application outage.

## 15. Payroll Audit Events

Payroll submit/finalize, owner override, payslip publication, reopen, statutory/export and payment
attempts remain searchable in canonical audit logs with actor, business, timestamp and resource.
Routine audit events are not webhook pages.

## 16. Statutory Security Events

`SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE` remains an expected security deny at INFO or security
audit level. It is not CRITICAL.

## 17. Secret Redaction

Database URLs, Authorization, Cookie, password, secret, token, API key, OTP and bank-keyed metadata
are replaced with explicit redaction markers before serialization. Alerts must never contain full
phones or private identifiers.

## 18. Deduplication

Fingerprint is environment + event + service + stage + code + status. An identical delivered alert
is suppressed for five minutes, with a maximum of three deliveries per fifteen-minute window.

## 19. Retry

Webhook delivery performs at most three attempts with bounded 100/200 ms exponential backoff for
network, 429 and 5xx errors. Final failure emits local structured `ALERT_DELIVERY_FAILED`.

## 20. Ownership

Primary owner: System Administrator / Release Owner. The owner acknowledges alerts, preserves
evidence and begins the relevant runbook.

## 21. Escalation

Escalation owner: Business Owner / Technical Owner. CRITICAL incidents escalate immediately;
ERROR incidents escalate when not contained within the operating response window.

## 22. Testing

`npm run ops:test-alert -- --confirm-testing --event=...` supports controlled events only when
`APP_ENVIRONMENT` is `testing` or `local`. Backup/restore injection additionally requires
`OPS_ALERT_TEST_MODE=true`. No tool changes business data.

## 23. Production Activation

Production remains disabled. Required future configuration includes `OPS_ALERT_WEBHOOK_URL`, probe
URLs, thresholds, interval and service ownership. Production receiver, monitors and backup schedule
require a separate approved activation and real delivery drill.
