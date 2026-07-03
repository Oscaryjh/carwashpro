# WhatsApp Connector V2 Acceptance

## Architecture

WashFlow
    ↓ HTTP
WhatsApp Connector
    ↓
Baileys
    ↓
WhatsApp

## Verified

✓ Connector independent
✓ Health
✓ Status
✓ Session
✓ QR lifecycle
✓ QR image
✓ Logout
✓ Reconnect
✓ Send API
✓ WashFlow integration
✓ providerMessageId saved
✓ errorMessage handling
✓ Build passed

## Manual Test

1.
Start Connector

2.
Scan QR

3.
Confirm /status = connected

4.
Trigger WashFlow notification

5.
Verify providerMessageId saved

6.
Verify errorMessage = null

## Next Version

V3

Message Queue
