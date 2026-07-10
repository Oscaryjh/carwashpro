# WhatsApp Session Management

WashFlow uses an independent WhatsApp Connector to manage the Baileys linked device session.

## How Session Works

WashFlow talks to the Connector over HTTP.

The Connector owns:

- Baileys socket
- `auth_info/` session files
- QR generation
- Linked Device lifecycle
- send / receive runtime status

WashFlow owns:

- Message history
- Notification Queue
- Worker
- Business automation
- Inbox display

Disconnecting WhatsApp must never delete message history.

## Status

The Connector can report:

- Connected
- Connecting
- Disconnected
- QR Required
- Session Expired
- Error

`Session Expired` means the linked device may be stale, logged out, or rejected by WhatsApp. The owner should reconnect with a fresh QR.

## When To Reconnect

Reconnect WhatsApp when:

- send fails with ACK 463
- Connector reports logged out
- QR expires before scanning
- connection repeatedly drops
- send / receive works inconsistently after a long-running session

## Common Errors

### ACK 463

ACK 463 means WhatsApp accepted the send request at first, then returned an acknowledgement error. A `providerMessageId` may exist, but it does not prove delivery.

Recovery:

1. Disconnect WhatsApp.
2. Clear the current session.
3. Scan a fresh QR.
4. Test send and receive again.

If send / receive works after reconnect, the old Linked Device session was stale or corrupted.

### Logged Out

The phone or WhatsApp may revoke the linked device.

Recovery:

1. Open WhatsApp Settings.
2. Click Disconnect WhatsApp.
3. Scan a new QR.

### QR Expired

QR codes expire if they are not scanned quickly enough.

Recovery:

1. Click Reconnect by QR.
2. Refresh the QR image.
3. Scan again from WhatsApp Linked Devices.

## Recovery Procedure

Use this when WhatsApp send / receive becomes unstable.

1. Open WhatsApp Settings.
2. Click Disconnect WhatsApp.
3. Confirm the Connector returns QR Required.
4. Scan the QR from WhatsApp Linked Devices.
5. Confirm status becomes Connected.
6. Send a test message from WashFlow.
7. Reply from the phone.
8. Check WhatsApp Diagnostics.

## Diagnostics

Open:

`/whatsapp/diagnostics`

The page shows:

- WhatsApp number
- Connection state
- Linked Device status
- Last successful send
- Last successful receive
- Last ACK error
- Connector version
- Baileys version
- Node version

## Operational Rule

Do not patch business logic for ACK 463 first.

Reset the WhatsApp session first. Only investigate code if a fresh Linked Device session still fails.
