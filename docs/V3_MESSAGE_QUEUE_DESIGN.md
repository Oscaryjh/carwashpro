# WhatsApp Connector V3

## Goal

解决：

- Connector 暂时离线
- WhatsApp reconnect
- 大量消息
- Retry
- 保证消息不会丢失

## Architecture

WashFlow

↓

POST /queue

↓

Notification Queue

↓

Queue Worker

↓

POST /send

↓

WhatsApp Connector

↓

WhatsApp

## Message Lifecycle

QUEUED

↓

SENDING

↓

SENT

↓

DELIVERED

↓

READ

失败：

FAILED

↓

RETRY

## Retry Policy

第一次失败：

30 秒

第二次：

1 分钟

第三次：

5 分钟

第四次：

15 分钟

第五次：

FAILED

## Queue Table

设计：

Queue ID

Business ID

Branch ID

Phone

Message

Message Type

Priority

Retry Count

Status

ProviderMessageId

CreatedAt

QueuedAt

SentAt

DeliveredAt

ReadAt

FailedAt

ErrorMessage

## Worker

说明：

Worker 每秒检查 Queue。

一次最多发送：

10 条。

Connector 如果：

409

重新排队。

Connector 如果：

500

Retry。

Connector 成功：

写 ProviderMessageId。

## Idempotency

同一 Queue ID

永远只能发送一次。

避免重复发送。

## Future

支持：

SMS

Email

Telegram

Push Notification

都可以共用 Queue。
