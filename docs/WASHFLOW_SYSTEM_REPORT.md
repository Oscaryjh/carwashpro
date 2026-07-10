# WashFlow SaaS System Report

## Overview

WashFlow is a SaaS-style car wash CRM and POS system built for daily car wash operations. It manages customers, vehicles, work orders, POS checkout, invoices, payments, WhatsApp messaging, staff access, shift closing, reports, packages, services, branches, and company settings.

The system is designed around a business workspace model. Each business can manage its own customers, jobs, invoices, WhatsApp conversations, services, packages, and staff.

## Main Features

### Dashboard

- Shows business summary and daily operation overview.
- Provides quick access to POS, CRM, invoices, WhatsApp, reports, services, packages, branches, and settings.

### POS / Jobs / Work Orders

- Create car wash jobs.
- Link customer and vehicle information.
- Add service items.
- Track job status:
  - In progress
  - Ready for pickup
  - Completed
  - Cancelled
- Ready for pickup can trigger WhatsApp notification.
- Checkout creates invoice and records payment.
- Jobs remain active until the correct completion and payment flow is finished.

### CRM

- Manage customer records.
- Store customer name, phone, email, notes, and vehicles.
- Add customer manually.
- Create customer from WhatsApp conversation.
- Prevent duplicate customer creation based on normalized phone numbers.
- View customer vehicle history.

### Vehicles

- Store plate number, brand, model, and color.
- Link vehicles to customers.
- Use vehicle details in jobs and invoices.

### Invoices

- Generate invoice from checkout.
- View invoice details.
- Download invoice PDF.
- Invoice PDF includes company information and logo.
- Invoice page supports manual WhatsApp sending.
- Invoice list supports pagination.
- Invoice status includes paid, unpaid, and void.

### Payments

- Support cash and non-cash payment records.
- Support package/voucher usage.
- Payment history is shown on invoices.
- Checkout can redirect back to the jobs list after completion.

### Packages

- Create package products.
- Sell packages to customers.
- Use package vouchers as payment for future services.
- Track remaining package balance.

### WhatsApp Connector

- Independent WhatsApp connector service.
- Uses Baileys for WhatsApp Linked Device connection.
- Supports QR login.
- Supports disconnect/logout and reconnect by QR.
- Provides connector APIs:
  - `/health`
  - `/status`
  - `/session`
  - `/qr/image`
  - `/send`
  - `/logout`
  - `/reconnect`
- WhatsApp session can expire and require reconnect.

### WhatsApp Inbox

- Shows WhatsApp conversations.
- Supports sending replies from the system.
- Supports receiving incoming WhatsApp messages.
- Conversations can be linked to CRM customers.
- Unknown WhatsApp numbers can be added as new CRM customers.
- Supports invoice attachment preview/download in inbox.
- Redirects away from inbox when WhatsApp is disconnected.

### Notification Queue

- WhatsApp messages are queued before sending.
- Queue worker sends messages through the connector.
- Retry policy exists for failed messages.
- Message logs store send status, provider message ID, error message, and timestamps.

### Business Automation

Automated WhatsApp messages can be created for:

- Customer created: welcome message
- Work order created: service confirmation
- Ready for pickup: pickup notification
- Invoice paid: invoice notification

### Shift Closing

- Cashier can start a shift.
- Cashier can end a shift.
- Tracks opening float.
- Tracks payments during the shift.
- Calculates expected cash.
- Records counted cash and cash difference.
- Owner can view daily shift closing records.
- Useful for two-shift cashier operation.

### Reports

- Shows business performance metrics.
- Includes jobs and invoice counts.
- Supports date ranges such as last 7 days.

### Staff / Permissions

- Staff access can be controlled with permissions.
- Owner-only areas can be separated from cashier/staff areas.
- Suggested staff access:
  - POS
  - CRM
  - Invoices
  - WhatsApp
  - Shift Closing
- Suggested owner-only access:
  - Reports
  - Team
  - Services
  - Packages
  - Branches
  - Company settings

## Architecture

### High-Level Flow

```text
WashFlow Web App
  |
  |-- CRM
  |-- POS / Work Orders
  |-- Invoices
  |-- Payments
  |-- Packages
  |-- Shift Closing
  |-- WhatsApp Inbox
  |
  |-- NotificationQueue
        |
        v
     Queue Worker
        |
        v
WhatsApp Connector
        |
        v
Baileys Linked Device
        |
        v
WhatsApp
```

### WhatsApp Message Flow

```text
Business event or inbox reply
  |
  v
Create WhatsAppMessage log
  |
  v
Enqueue NotificationQueue with messageLogId
  |
  v
Queue Worker sends to WhatsApp Connector
  |
  v
Connector sends through Baileys
  |
  v
Update message log with providerMessageId / errorMessage / sentAt
```

## Strengths

- Covers the main workflow of a car wash business from customer creation to checkout.
- Combines CRM, POS, invoice, payment, WhatsApp, and shift closing in one system.
- WhatsApp connector is separated from the main app, which makes the architecture cleaner.
- Queue-based messaging prevents business actions from depending directly on WhatsApp availability.
- Message logs help trace whether WhatsApp messages were sent or failed.
- PDF invoice download gives a manual fallback when automated WhatsApp sending is unavailable.
- Shift closing supports cashier accountability and multi-shift operation.
- Customer phone normalization reduces duplicate CRM records.
- The system is already practical for real daily use.

## Weaknesses / Limitations

- WhatsApp integration depends on Baileys and WhatsApp Linked Device behavior, which can be unstable.
- Some WhatsApp sessions can become stale or corrupted and require logout plus QR reconnect.
- A WhatsApp `sendMessage` provider ID does not always guarantee the customer actually received the message.
- Delivery/read status is limited unless receipt handling is fully tracked.
- Some contacts may fail with ACK errors until the customer messages the business first.
- `@lid` WhatsApp conversations may not always map cleanly to real phone numbers.
- Queue worker must be running for queued WhatsApp messages to send.
- Connector must be running separately for WhatsApp features to work.
- Local development can break if `npm run build` is run while `npm run dev` is active.
- Database encoding must remain UTF8 to support Chinese and other Unicode text.
- More production hardening is needed for process supervision, monitoring, backups, and deployment.

## Operational Risks

- If the connector is offline, WhatsApp messages stay queued or fail.
- If the queue worker is not running, messages will not be processed.
- If WhatsApp logs out the linked device, inbox and sending will stop until reconnect.
- If the database is reset, old browser sessions may point to invalid business IDs.
- Duplicate test data can appear if phone normalization is bypassed.

## Recommended Next Improvements

### Short Term

- Add clearer WhatsApp diagnostics for:
  - Connected / disconnected
  - Session expired
  - Last successful send
  - Last successful receive
  - Last ACK error
- Improve contact diagnostics for WhatsApp conversations:
  - CRM linked
  - Not synced
  - LID conversation
  - Last send status
- Add a safe manual resend option for failed WhatsApp messages.
- Add a visible queue monitor for pending and failed messages.

### Medium Term

- Add delivery and read receipt tracking.
- Add webhook support for incoming and status updates.
- Add better staff roles and cashier permissions.
- Add package management improvements.
- Add appointment scheduling.
- Improve dashboard analytics.

### Production Readiness

- Run the web app, connector, queue worker, and database under a process manager.
- Add automated backups.
- Add structured logs.
- Add health checks for all services.
- Add alerting when connector or queue worker is down.
- Add deployment documentation.

## Current Conclusion

WashFlow is already a strong operational system for a car wash business. It supports CRM, jobs, checkout, invoices, payments, WhatsApp communication, queue-based messaging, and cashier shift closing.

The biggest remaining risks are not the core CRM/POS flow. The main risks are WhatsApp session reliability, queue worker uptime, deployment stability, and production monitoring.

The system is suitable for continued development toward a production SaaS platform, especially if the next milestone focuses on reliability, staff permissions, reporting, package management, and appointment scheduling.
