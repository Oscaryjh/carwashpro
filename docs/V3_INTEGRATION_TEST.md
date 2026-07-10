# WhatsApp Connector V3 Integration Test

## Scope

Validated WashFlow Business Automation through NotificationQueue.

No Connector code was changed.

No Queue Worker code was changed.

## Test Run

Token:

`V3IT-1783010740044`

Connector status before test:

`connected`

Build:

`npm.cmd run build` passed.

## Scenario 1

Create Customer

↓

Welcome Message

↓

NotificationQueue

↓

Worker

↓

Connector

↓

WhatsApp

↓

WhatsAppMessage

Result:

- Queue ID: `f346eee8-0a7e-4344-86e0-a64542b6d96d`
- Message Log ID: `639ab9d3-5657-4584-8d02-aad9f5429bb3`
- Queue Status: `SENT`
- Provider Message ID: `3EB04F9C8BDD37C824FF26`
- Message Log Status: `SENT_MANUALLY`
- Error Message: `null`
- Retry Count: `0`

## Scenario 2

Create Work Order

↓

Service Confirmation

↓

NotificationQueue

↓

Worker

↓

Connector

↓

Message Log

Result:

- Queue ID: `8fed063e-56c2-4ab7-80c8-170114b13d41`
- Message Log ID: `632330fd-b217-4724-9552-cffea12b1a2f`
- Queue Status: `SENT`
- Provider Message ID: `3EB0DC47F255A4CA6B031A`
- Message Log Status: `SENT_MANUALLY`
- Error Message: `null`
- Retry Count: `0`

## Scenario 3

Ready For Pickup

↓

NotificationQueue

↓

Worker

↓

Connector

↓

Message Log

Result:

- Queue ID: `b6998c9a-9511-42b3-a498-b04966ef3c34`
- Message Log ID: `cf97686b-6637-4894-9e0a-89bca545e168`
- Queue Status: `SENT`
- Provider Message ID: `3EB05D1EAF1F85D0FD5211`
- Message Log Status: `SENT_MANUALLY`
- Error Message: `null`
- Retry Count: `0`

## Scenario 4

Invoice Paid

↓

Invoice Notification

↓

NotificationQueue

↓

Worker

↓

Connector

↓

Message Log

Result:

- Queue ID: `99a82bd9-6f50-4cc2-bd41-fadff9e6ba66`
- Message Log ID: `0b18c169-6d15-4822-a266-249c574a7d41`
- Queue Status: `SENT`
- Provider Message ID: `3EB008D76A5B26BC7A4A14`
- Message Log Status: `SENT_MANUALLY`
- Error Message: `null`
- Retry Count: `0`

## Verified

✓ Customer Created enqueues Welcome Message

✓ Work Order Created enqueues Service Confirmation

✓ Ready For Pickup enqueues Ready For Pickup Message

✓ Invoice Paid enqueues Invoice Notification

✓ NotificationQueue records created

✓ `messageLogId` saved on every queue item

✓ Worker processed queued messages

✓ Connector returned `providerMessageId`

✓ NotificationQueue `sentAt` saved

✓ WhatsAppMessage `providerMessageId` saved

✓ WhatsAppMessage `sentAt` saved

✓ `errorMessage = null`

✓ `retryCount = 0`

✓ Build passed

## Notes

Invoice notification is sent through the V3 text queue path.

Delivery status, read status, webhook, multi session, and manual resend/delete are outside V3.
