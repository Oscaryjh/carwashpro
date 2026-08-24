# Staff App OTP — SMS123 migration

SMS123 is a delivery provider only. Tetamu generates and verifies the Staff
login OTP.

## Runtime flow

1. Normalize the Malaysian number to the existing canonical `+60...` identity.
2. Resolve eligibility without changing the neutral public request response.
3. Generate a six-digit code with Node cryptographic randomness.
4. Store only a challenge-bound HMAC, expiry, attempt limit and delivery metadata.
5. Send one SMS123 request using the `60...` recipient and a unique reference ID.
6. Verify the HMAC locally, atomically mark success and consume the challenge
   during direct login or membership selection.

SMS123 never approves or rejects an OTP. A new production challenge invalidates
older active challenges for that phone. Existing phone/IP/device/provider limits
and the resend cooldown remain server-side.

## Environment

```env
SMS_PROVIDER=sms123
OTP_CHANNEL=sms
SMS123_ENABLED=true
SMS123_API_KEY=
SMS123_API_BASE_URL=https://www.sms123.net/api
SMS123_MESSAGE_PREFIX=RM0
OTP_LENGTH=6
OTP_TTL_SECONDS=300
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_VERIFY_ATTEMPTS=5
```

All SMS123 variables are server-only. Never add a `NEXT_PUBLIC_` SMS123 key.
`000000` remains available only in explicit non-production mock mode.

## One-message developer check

```text
npm run sms:test -- --to=6011XXXXXXXX
```

The target is mandatory, the script sends exactly one non-OTP connection-test
message and does not retry. Do not run it without approved credentials and an
explicitly approved receiving number.
