# V3 Manual Acceptance

## Steps

1. Start Connector

   `npm run dev`

2. Start Queue Worker

   `npm run notification:worker`

3. Create Customer

   Confirm:

   NotificationQueue

   ↓

   SENT

   ↓

   providerMessageId

   ↓

   Phone received Welcome

4. Create Work Order

   Confirm:

   Service Confirmation

5. Ready For Pickup

   Confirm:

   Ready Message

6. Invoice Paid

   Confirm:

   Invoice Notification

## Acceptance Checklist

- Connector started
- Queue Worker started manually
- Create Customer enqueues Welcome Message
- Welcome Message reaches SENT
- Welcome Message has providerMessageId
- Phone receives Welcome Message
- Create Work Order enqueues Service Confirmation
- Service Confirmation reaches SENT
- Ready For Pickup enqueues Ready Message
- Ready Message reaches SENT
- Invoice Paid enqueues Invoice Notification
- Invoice Notification reaches SENT
- WhatsAppMessage log is updated
- errorMessage is null for successful sends
