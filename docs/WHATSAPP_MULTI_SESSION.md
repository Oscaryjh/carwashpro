# WhatsApp Multi Session

## Architecture

The WhatsApp Connector runs as one service with an isolated runtime for every
WashFlow business. The runtime key is `businessId`.

Each runtime owns its own:

- Baileys socket
- QR code and linked-device state
- reconnect timer and health state
- phone number and diagnostics
- authentication files

WashFlow sends `businessId` on status, session, QR, reconnect, logout, JID and
send requests. Incoming messages, history sync and delivery receipts send the
same `businessId` back to WashFlow.

## Authentication Storage

New sessions are stored below:

```text
AUTH_INFO_PATH/sessions/<businessId>
```

For an existing single-session installation, set
`WHATSAPP_DEFAULT_BUSINESS_ID` to that business UUID. Its current auth files
remain in `AUTH_INFO_PATH`, while every other business uses an isolated child
directory.

## API Security

Set the same random value in both services:

```text
WashFlow: WHATSAPP_CONNECTOR_API_SECRET
Connector: CONNECTOR_API_SECRET
```

WashFlow sends this value in `x-connector-api-secret`. The QR image is loaded
through an authenticated WashFlow proxy and is not linked directly from the
browser to the Connector.

The existing `WHATSAPP_WEBHOOK_SECRET` continues to protect callbacks from the
Connector to WashFlow.

## Session Lifecycle

1. A business opens WhatsApp Settings.
2. WashFlow requests Connector status with that business ID.
3. The Connector creates or reuses only that business runtime.
4. The business scans its own QR code.
5. Queue messages are routed using the queue item's business ID.
6. Incoming messages and receipts are written only under that business ID.

Disconnecting one business clears only that business session. It does not stop
or log out any other business.

## Deployment Notes

1. Configure both API secrets.
2. Configure `WHATSAPP_DEFAULT_BUSINESS_ID` for the currently linked legacy
   session before the first Testing Server deployment.
3. Apply the Prisma migration.
4. Verify the existing business stays connected.
5. Link a second test business and confirm both QR/status/send/receive paths are
   isolated.
