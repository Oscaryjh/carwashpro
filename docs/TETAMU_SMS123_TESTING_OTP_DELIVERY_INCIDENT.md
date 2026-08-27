# TETAMU Staff App — SMS123 Testing OTP Delivery Incident

## 1. Incident scope

This report covers the Testing-only Staff App OTP delivery incident for:

- Employee code: `TWILIO-OTP-QA`
- Employee name: `Twilio OTP QA Staff`
- Input phone: `+601112212259`
- Normalized phone: `+601112212259`
- Provider: `SMS123`
- Testing Staff App: `https://tetamu-staff-app-testing.up.railway.app`
- Testing Desktop: `https://tetamu-pos-web-testing.up.railway.app`

Production was not inspected, changed, deployed, or contacted.

## 2. Final verdict

**APP PASS — PROVIDER DELIVERY INVESTIGATION REQUIRED**

Tetamu successfully accepted the Staff App request, found the intended employee, normalized the phone correctly, created the OTP challenge, called SMS123, retained the SMS123 message reference, and received a successful provider acceptance. SMS123 also lists the controlled request in its sent history.

The phone did not receive the earlier accepted OTP messages. SMS123's public history API does not expose the final handset delivery state, so the final delivery result remains **UNKNOWN**. This is classified as `SMS123_DELIVERY`, not a Tetamu frontend, employee lookup, OTP persistence, configuration, or deployment failure.

## 3. Testing environment

| Check | Result |
| --- | --- |
| Canonical Staff App | `https://tetamu-staff-app-testing.up.railway.app` |
| Canonical Desktop | `https://tetamu-pos-web-testing.up.railway.app` |
| Staff App upstream port | `3100` |
| Railway environment | `testing` |
| Staff App deployment | `4c2c32ad-aa66-4314-83c6-14d43faa2a27` |
| Deployment status | `SUCCESS` |
| Deployment started | `2026-08-26T03:51:00.450Z` |
| Provider selected | `sms123` |
| Channel | `sms` |
| Testing OTP enabled | `true` |

No Testing deployment was required for this incident because the deployed route and provider integration were already functioning.

## 4. Request path traced

The active request path is:

```text
Testing Staff App
→ POST /api/employee-auth/request-otp
→ requestEmployeeOtp()
→ employee account and membership lookup
→ phone and device eligibility checks
→ EmployeeOtpChallenge persistence
→ Sms123OtpProvider.sendVerification()
→ https://www.sms123.net/api/send.php
→ SMS123 acceptance reference
```

The standalone Staff App uses a relative same-origin API URL. Requests were observed on `tetamu-staff-app`; no matching request was observed on the legacy Desktop Staff route.

## 5. Employee and phone validation

| Check | Result |
| --- | --- |
| Employee account | Found |
| Account status | `ACTIVE` |
| Membership status | `ACTIVE` |
| Attendance enabled | `true` |
| Primary branch | One active primary assignment |
| Employee code | `TWILIO-OTP-QA` |
| Stored phone | `+601112212259` |
| Normalized phone | `+601112212259` |
| SMS123 recipient | `601112212259` |

Employee lookup and phone normalization both pass.

## 6. OTP persistence and device state

The controlled request created a real OTP challenge:

| Field | Value |
| --- | --- |
| Challenge ID | `2c5c5af7-e2a1-44f1-9fb4-ba2057028828` |
| Purpose | `REGISTER_DEVICE` |
| Provider | `sms123` |
| Delivery channel | `sms` |
| Employee account linked | Yes |
| OTP hash persisted | Yes, keyed hash only; plaintext is not stored or logged |
| Provider reference | `sms123:q6a8e71794321f` |
| Delivery accepted at | `2026-08-26T04:54:16.941Z` / `26 Aug 2026 12:54:16 MYT` |
| Invalidated | No |
| Verified | No |

Audit events were also persisted:

- `STAFF_OTP_SEND_ACCEPTED`
- `EMPLOYEE_OTP_REQUESTED`

The account already has a verified active iPhone device. A different controlled device is therefore correctly handled as `REGISTER_DEVICE`; this did not prevent delivery.

## 7. SMS123 configuration

The Testing runtime contains the required server-only SMS123 configuration:

| Variable / setting | Result |
| --- | --- |
| `OTP_PROVIDER` | `sms123` |
| `OTP_CHANNEL` | `sms` |
| `SMS123_API_KEY` | Present; value not displayed |
| `SMS123_ENABLED` | `true` |
| `EMPLOYEE_OTP_TESTING_ENABLED` | `true` |
| API endpoint | `https://www.sms123.net/api/send.php` |

No secret was printed, persisted, or added to source control.

## 8. SMS content and payload

The deployed adapter sends one Malaysian recipient per request using:

```text
recipients=601112212259
messageContent=RM0 Tetamu: Your OTP is [REDACTED]. Valid for 5 minutes. Do not share this code.
referenceID=[unique challenge UUID]
```

The OTP itself was never printed or included in this report.

## 9. Rate-limit preflight

Before the controlled send:

- the previous challenge had expired;
- the resend cooldown had elapsed;
- the phone limit permitted another request;
- the controlled device had no prior request count;
- the provider-wide Testing limit permitted the request.

Pre-send verdict: **PASS**.

## 10. Controlled real SMS attempt

Exactly one real SMS attempt was initiated by this investigation.

| Field | Result |
| --- | --- |
| Attempt count | `1` |
| Requested at | `2026-08-26T04:54:15.4139793Z` / `26 Aug 2026 12:54:15 MYT` |
| Target | `+601112212259` |
| Staff API HTTP status | `202` |
| Staff API request status | `CODE_REQUESTED` |
| Challenge persisted | Yes |
| SMS123 called | Yes |
| SMS123 result | Accepted |
| SMS123 message reference | `q6a8e71794321f` |
| Additional SMS attempts by this investigation | `0` |

## 11. SMS123 response and sent history

The provider adapter only records acceptance when all of these conditions pass:

- the SMS123 HTTP response is successful;
- response `status` is `ok`;
- response code is `E00001` or `BE00128`;
- a provider reference is returned.

The exact raw send response code and send HTTP status were not persisted by the current adapter, so they cannot be reconstructed without guessing. The acceptance reference was persisted.

A separate read-only SMS123 sent-history request returned:

| Field | Result |
| --- | --- |
| History API HTTP status | `200` |
| History API status | `ok` |
| History API code | `E00001` |
| Controlled record present | Yes |
| Type | `privateSMS` |
| Scheduled at | `26-Aug-2026 12:54 PM` |
| Recipient | `60111***2259` |
| Part count | `1` |
| Final delivery status exposed by API | No |

SMS123 lists three sent records for this target on 26 Aug 2026: 11:16 MYT, 12:46 MYT, and the controlled 12:54 MYT attempt. The first two were initiated before this investigation's controlled send.

## 12. Root cause classification

```text
SMS123_DELIVERY
```

Evidence excludes:

- `FRONTEND_REQUEST`: request reached the correct standalone Staff App API;
- `PHONE_NORMALIZATION`: normalized recipient is correct;
- `EMPLOYEE_LOOKUP`: active account, membership, and branch were found;
- `PROVIDER_SELECTION`: runtime selected `sms123`;
- `MISSING_ENV`: required key and channel are present;
- `SMS123_AUTH`: SMS123 accepted the request;
- `SMS123_PAYLOAD`: SMS123 accepted and retained the request;
- `SMS123_REJECTED`: provider returned an acceptance reference;
- `RATE_LIMIT`: controlled request returned `CODE_REQUESTED`;
- `OTP_PERSISTENCE`: challenge and audit events exist;
- `DEPLOYMENT_DRIFT`: the request reached the successful Testing deployment.

The remaining unverified segment is SMS123/telco delivery after gateway acceptance.

## 13. Testing fix applied

**No code or database fix was applied.**

Changing Tetamu code would not address the demonstrated failure boundary. The appropriate next step is to inspect the SMS123 portal's delivery report for message reference `q6a8e71794321f`. SMS123 documents delivery states as Success, Queue, or Failure, but its public sent-history API did not return that state for this record.

## 14. Regression

Focused local regression completed successfully:

```text
tests/unit/staff-sms123-otp.test.ts
tests/unit/attendance-employee-auth.test.ts
tests/unit/staff-pwa.test.ts
```

Result: **41 passed, 0 failed**.

No code changed, so a full TypeScript, ESLint, integration, or deployment cycle was not required.

## 15. Required next action

1. Open SMS123's delivery report for `q6a8e71794321f` at `26 Aug 2026 12:54 MYT`.
2. Record whether the SMS123 state is Success, Queue, or Failure.
3. If Queue, allow the provider's retry window; do not repeatedly request OTPs.
4. If Failure or the handset still receives nothing, provide SMS123 support with the message reference, timestamp, and normalized number.
5. Do not change Tetamu code unless SMS123 returns a concrete payload, template, or authentication rejection.

## 16. Safety statement

- Production touched: **NO**
- Production deployment: **NO**
- Testing code changed: **NO**
- Testing database changed by operator: **NO**
- Real SMS attempts by this investigation: **1**
- Additional SMS attempts: **0**
- OTP code exposed: **NO**
- Secrets exposed: **NO**

