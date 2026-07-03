# WhatsApp Connector V3 Acceptance

## V3 Architecture

WashFlow

↓

Notification Queue

↓

Queue Worker

↓

WhatsApp Connector

↓

Baileys

↓

WhatsApp

## Queue DB

V3 adds `NotificationQueue` as the persistent queue layer for WhatsApp notifications.

It stores:

- Business ID
- Branch ID
- Phone
- Message
- Message Type
- Priority
- Status
- Retry Count
- Provider Message ID
- Error Message
- Created At
- Queued At
- Sent At
- Failed At
- Next Attempt At

Supported status:

- QUEUED
- SENDING
- SENT
- FAILED

Supported priority:

- HIGH
- NORMAL
- LOW

## Worker

The queue worker checks queued notifications every second.

It:

- Finds queued messages
- Sends up to 10 messages per cycle
- Marks messages as SENDING before send
- Calls WhatsApp Connector `POST /send`
- Marks messages as SENT when the connector returns success
- Saves `providerMessageId`
- Marks failed sends through repository failure handling

## Retry Policy

Failed queue items retry through `nextAttemptAt`.

Retry delay:

- 1st failure: 30 seconds
- 2nd failure: 1 minute
- 3rd failure: 5 minutes
- 4th failure: 15 minutes
- 5th failure: FAILED

Connector `409 WHATSAPP_NOT_CONNECTED` is treated as retryable.

## Monitoring Page

WashFlow includes:

`/whatsapp/queue`

The page shows:

- Total queued
- Sending
- Sent
- Failed
- Retrying
- Next Attempt At
- Retry Count
- Recent 100 queue records
- Status filter

Manual resend/delete is not included in V3.

## Verified

✓ Queue database migration

✓ Repository methods

✓ Enqueue

✓ Find queued

✓ Mark sending

✓ Mark sent

✓ Mark failed

✓ Retry count increment

✓ Next attempt scheduling

✓ Worker can start

✓ Worker processes queued message

✓ Connector `/send` integration from worker

✓ Provider message ID saved

✓ Monitoring page created

✓ Status filter works

✓ Build passed

## Manual Test

1. Start WhatsApp Connector.

2. Confirm Connector `/status = connected`.

3. Start WashFlow.

4. Create a notification queue item.

5. Start queue worker with:

   `npm run notification:worker`

6. Confirm queue item changes from QUEUED to SENDING.

7. Confirm queue item changes to SENT after connector send success.

8. Confirm `providerMessageId` is saved.

9. Open:

   `/whatsapp/queue`

10. Confirm the queue appears in the recent 100 list.

11. Filter by status and confirm the list updates.

12. Stop or disconnect Connector, create a queue item, and confirm retry behavior sets `nextAttemptAt`.

## Current Limitations

- No Delivery Status
- No Read Status
- No Webhook
- No Multi Session
- No Manual Resend/Delete
