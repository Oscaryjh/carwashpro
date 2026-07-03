# WashFlow WhatsApp Manual Acceptance

## Environment

Connector

Running

Queue Worker

Running

WashFlow

Running

------------------------------------

Scenario 1

Create Customer

Expected：

Queue Created

Worker Sent

providerMessageId exists

WhatsAppMessage = SENT

Phone received Welcome

□ PASS

□ FAIL

------------------------------------

Scenario 2

Create Work Order

Expected：

SERVICE_CONFIRMATION queued

Worker sent

providerMessageId exists

Phone received message

□ PASS

□ FAIL

------------------------------------

Scenario 3

Ready For Pickup

Expected：

READY_FOR_PICKUP queued

Worker sent

providerMessageId exists

Phone received message

□ PASS

□ FAIL

------------------------------------

Scenario 4

Invoice Paid

Expected：

Invoice Notification queued

Worker sent

providerMessageId exists

Phone received message

□ PASS

□ FAIL

------------------------------------

Acceptance

如果四个 Scenario 全部 PASS：

新增：

docs/V3_ACCEPTANCE_RESULT.md

写：

V3 PASSED

Date

Build

Migration

Queue

Worker

Retry

Monitoring

Business Automation
