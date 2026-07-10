# WashFlow WhatsApp Development Playbook

这份文档记录 WashFlow WhatsApp 模块从 0 到可用版本的开发过程、架构选择、踩过的坑、正确做法和后续平台复用建议。

目标不是只记录代码怎么写，而是让以后在其他平台重新开发 WhatsApp 功能时，可以少走弯路。

## 1. 最终目标

WashFlow 的 WhatsApp 模块最终要做到：

- 店家用自己的 WhatsApp 扫码连接系统。
- 系统可以自动发送业务通知。
- 系统可以在 Inbox 内收发客户消息。
- 消息不因为 Connector 暂时断线而丢失。
- 发送状态可以追踪到 sent / delivered / read / failed。
- 客户聊天记录可以保存在系统里。
- Invoice PDF、图片、文件、语音可以在 Inbox 内查看或下载。
- WhatsApp 断线或 session 失效时，老板可以自己重新连接。

## 2. 重要结论

### 2.1 不要一开始就把 WhatsApp 写进主系统

正确做法是：

```text
WashFlow
  -> HTTP
WhatsApp Connector
  -> Baileys
  -> WhatsApp
```

原因：

- Baileys session 不稳定时，不应该拖垮主系统。
- WhatsApp QR、logout、reconnect、session 清理应该独立管理。
- 主系统只需要知道 Connector 是否 connected，以及调用 `/send`。
- 以后要换成 Meta Cloud API，也可以替换 Connector，而不是重写 CRM/POS。

### 2.2 不要把 sendMessage 返回 messageId 当作 delivered

Baileys `sendMessage()` 返回 messageId 只能代表消息已经交给 WhatsApp client/server。

它不代表：

- 客户手机已收到
- 客户已读
- 消息一定成功

正确状态应该分层：

```text
QUEUED
SENDING
SENT_TO_SERVER
DELIVERED
READ
FAILED
```

### 2.3 Queue 是必须的

业务系统不要直接调用 WhatsApp 发送。

正确流程：

```text
Business Event
  -> Create WhatsAppMessage log
  -> Enqueue NotificationQueue
  -> Queue Worker
  -> Connector /send
  -> Baileys
  -> WhatsApp
```

原因：

- Connector 可能离线。
- WhatsApp session 可能过期。
- 客户可能很多。
- 自动化通知不能因为一次失败就丢失。
- Worker 可以统一 retry、失败记录、message log 回写。

### 2.4 NotificationQueue 必须有 messageLogId

不要用 phone、messageType、createdAt、businessId 去反查 WhatsAppMessage。

这是不可靠的。

正确做法：

```text
NotificationQueue.messageLogId -> WhatsAppMessage.id
```

这样 Worker 成功或失败时，才能准确更新对应 message log：

- providerMessageId
- errorMessage
- sentAt
- failedAt
- status

### 2.5 本地 PostgreSQL 必须是 UTF8

我们踩过 WIN1252 编码问题：

```text
Postgres 220P05
character with byte sequence 0xe4 0xbd 0xa0
has no equivalent in WIN1252
```

原因是本地 database 用了 WIN1252，中文写入失败。

正确要求：

```sql
SHOW server_encoding;
SHOW client_encoding;
```

必须是：

```text
UTF8
UTF8
```

不要靠业务代码 encode 中文来绕过数据库编码问题。数据库必须从根上改成 UTF8。

## 3. 开发阶段回顾

## Phase 1: Manual Deep Link

最早的方案只是生成 WhatsApp 链接：

```text
https://wa.me/{phone}?text={message}
```

优点：

- 最快可用。
- 不需要 Baileys。
- 不需要 QR。
- 不需要 Webhook。
- 适合早期 demo。

缺点：

- 员工必须手动发送。
- 系统不知道客户是否收到。
- 不能自动收消息。
- 不能做真正 Inbox。

适合场景：

- 最小 MVP。
- 临时 fallback。
- 当 Connector 断线时，仍然可以让员工手动打开 WhatsApp 发送。

保留建议：

即使有自动 Connector，也应该保留 manual fallback，比如 Invoice 页面：

```text
Download PDF
Send Invoice WhatsApp
```

`Send Invoice WhatsApp` 可以打开 WhatsApp app / web，让员工手动发送。

## Phase 2: Independent WhatsApp Connector

后来我们把 WhatsApp 独立成 `whatsapp-connector`。

核心 API：

```text
GET  /health
GET  /status
GET  /session
GET  /qr/image
POST /send
POST /reconnect
POST /logout
```

### /status

返回当前连接状态：

```json
{
  "ok": true,
  "data": {
    "status": "connected",
    "phone": "601112212259",
    "hasSocket": true,
    "hasSession": true
  }
}
```

### /qr/image

直接返回 PNG QR。

Settings 页面不要等待旧 Worker 推送 QR，也不要用旧 websocket。

正确方式：

```text
Settings UI -> GET /status
Settings UI -> GET /qr/image
```

### /logout

必须做到：

1. logout Baileys socket
2. 删除 `auth_info/`
3. 重置 connector state
4. 重新生成 QR

### /reconnect

如果 socket 坏了，不要无限 retry。

更稳的做法是：

- session expired 时提示用户重新扫码
- reconnect by QR
- 需要时 logout + clear session

## Phase 3: Send API

`POST /send` 接收：

```json
{
  "phone": "601112212259",
  "message": "Hello from connector"
}
```

要求：

- phone 必填
- message 必填
- message 不可为空
- 清理 `+`、空格、`-`、括号
- 变成 WhatsApp JID：

```text
601112212259@s.whatsapp.net
```

如果 WhatsApp 未 connected：

```json
{
  "ok": false,
  "error": {
    "code": "WHATSAPP_NOT_CONNECTED",
    "message": "WhatsApp is not connected. Check /status or reconnect."
  }
}
```

HTTP status 应该是 `409`。

## Phase 4: Queue Database Layer

新增 `NotificationQueue`。

核心字段：

- id
- businessId
- branchId
- phone
- message
- messageType
- priority
- status
- retryCount
- nextAttemptAt
- providerMessageId
- errorMessage
- messageLogId
- createdAt
- queuedAt
- sentAt
- failedAt

核心 repository：

- enqueue()
- findQueued()
- markSending()
- markSent()
- markFailed()
- markDeliveryStatus()

## Phase 5: Queue Worker

Worker 每秒检查 queue。

规则：

```text
findQueued()
  -> max 10
  -> markSending()
  -> POST Connector /send
  -> success markSent()
  -> failed markFailed()
```

注意：

- Worker 不应该知道业务流程。
- Worker 不应该写 CRM/POS 逻辑。
- Worker 只处理发送。
- Connector 409 也应该进入 retry，而不是永久失败。

## Phase 6: Retry Policy

Retry delay：

```text
1st: 30 seconds
2nd: 1 minute
3rd: 5 minutes
4th: 15 minutes
5th: FAILED
```

`markFailed()` 逻辑：

```text
retryCount + 1

if retryCount < 5:
  status = QUEUED
  nextAttemptAt = now + delay

if retryCount >= 5:
  status = FAILED
```

只有最终 FAILED 时，才把 WhatsAppMessage 标记为 FAILED。

## Phase 7: Business Automation

四个业务事件接入 Queue：

1. Customer Created
   - Welcome Message

2. Work Order Created
   - Service Confirmation

3. Work Order Ready for Pickup
   - Ready For Pickup Message

4. Invoice Paid / Checkout
   - Invoice Notification

正确流程：

```text
Business helper
  -> Create WhatsAppMessage log
  -> enqueue NotificationQueue with messageLogId
```

不要：

- 直接调用 Connector
- 直接 import Baileys
- 用旧 WhatsAppWorkerCommand
- 检查 WhatsApp connected 才决定要不要建 log

原因：

即使 WhatsApp 离线，业务通知也应该先进入 queue，等 Worker 之后 retry。

## Phase 8: Inbox Reply Migration

Inbox reply 也必须走 Queue。

旧架构：

```text
Inbox Send
  -> WhatsAppWorkerCommand
  -> SEND_TEXT
```

新架构：

```text
Inbox Send
  -> Create WhatsAppMessage / WhatsAppChatMessage
  -> enqueue NotificationQueue(messageLogId)
  -> Queue Worker
  -> Connector
```

好处：

- Inbox reply 和业务通知统一发送通道。
- 失败和 retry 统一。
- providerMessageId 回写统一。

## Phase 9: Incoming Messages

Connector 必须监听：

```text
messages.upsert
```

只处理：

```text
type === "notify"
message.key.fromMe === false
```

收到后调用 WashFlow：

```text
POST /api/whatsapp/incoming
```

WashFlow 负责写入：

- WhatsAppConversation
- WhatsAppChatMessage
- customer matching by phone
- inbox list refresh data

注意：

- 需要保存 `remoteJid`
- 需要保存 `externalMessageId`
- 需要保存 `rawMessageJson`
- 需要按 `instanceId` 和 `businessId` 隔离

## Phase 10: History Sync

Connector 应监听：

```text
messaging-history.set
```

用途：

- 扫码后同步已有 chats
- 同步 contacts
- 同步 historical messages

要求：

- conversation list 从 `whatsapp_conversations` 读取
- conversation detail 从 `whatsapp_chat_messages` 读取
- 使用 unique constraint 避免重复：

```text
(instanceId, messageId)
```

历史同步必须记录 log：

```text
chats count
contacts count
messages count
syncType
```

## Phase 11: Delivery / Read

Connector 要监听：

```text
messages.update
message-receipt.update
```

然后调用 WashFlow receipt API。

状态映射：

```text
Baileys ack/server -> SENT_TO_SERVER
delivered          -> DELIVERED
read               -> READ
error              -> FAILED
```

UI 显示：

- Sent: 一个勾
- Delivered: 两个灰勾
- Read: 两个绿色勾
- Failed: 红色失败

注意：

不要把 READ 降级成 DELIVERED。

如果一条消息已经 READ，之后收到 delivered receipt，不应该覆盖。

## Phase 12: Media Messages

已支持类型：

- Text
- Image
- Document
- PDF Invoice
- Audio receive
- Audio playback
- File preview/download
- Image preview/download

开发注意：

- 图片应该显示预览，不只是文件名。
- document 才显示文件卡片。
- image message 不应该把 filename 当正文显示给客户。
- PDF invoice 可以保存成 document attachment。
- raw media metadata 要保存，方便 debug。

## 4. JID / LID / Contact Sync 经验

### 4.1 普通手机号 JID

标准 JID：

```text
601112212259@s.whatsapp.net
```

系统主动发送一般用这个。

### 4.2 LID

WhatsApp 有时会出现：

```text
xxx@lid
```

这类 conversation 可能没有真实 phone。

表现：

- 列表显示 Phone not synced
- 无法直接匹配 CRM customer
- 可能需要对方先发消息
- 或需要 history/contact sync 后才能映射到真实手机号

### 4.3 为什么有些客户先发消息后才正常

我们观察到：

- 系统主动发给某些联系人时，可能出现 ACK 463。
- 但对方先发一条消息进来后，系统就可以正常回复。

可能原因：

- Linked Device 尚未初始化该 contact
- LID/PN 映射不完整
- session token stale
- WhatsApp Web context 未建立

产品建议：

对这类联系人显示提示：

```text
Contact not initialized. Ask customer to message first, or open WhatsApp manually.
```

## 5. ACK 463 经验

ACK 463 不一定是业务代码问题。

我们验证过：

- Queue 正常
- Worker 正常
- Connector `/send` 正常
- providerMessageId 有值
- 但客户收不到

最后发现：

重新 logout WhatsApp session、清理 auth_info、重新扫码后恢复。

结论：

ACK 463 很多时候是 stale/corrupted Linked Device session。

正确处理：

1. 不要先改业务逻辑。
2. 检查 Connector status。
3. logout current session。
4. clear auth_info。
5. 重新扫码。
6. 再测试 send / receive。

Settings 页面应该显示：

```text
Your WhatsApp session may have expired.
Please reconnect your WhatsApp.
```

不要无限 retry。

## 6. Session Management 最终设计

Settings 页面应该提供：

- Connected
- Connecting
- Disconnected
- QR Required
- Session Expired
- Error

按钮：

- Refresh
- Reconnect by QR
- Disconnect WhatsApp

Disconnect 要做：

- logout Baileys
- remove auth session
- stop socket safely
- clear connector state
- 不删除 message history

Reconnect 要做：

- 生成 fresh QR
- 用户扫码
- 自动更新 status
- 验证 send / receive

Diagnostics 页面建议显示：

- WhatsApp number
- Connection state
- Linked Device status
- Last successful send
- Last successful receive
- Last ACK error
- Connector version
- Baileys version
- Node version

## 7. UI 经验

### 7.1 Inbox

Inbox 应该像 WhatsApp：

- 左边 chats
- 中间 conversation
- 右边 customer detail
- bottom input
- emoji
- file upload
- voice recording
- send button / mic button 根据输入状态切换

### 7.2 Connection 状态

Inbox 必须读取同一套 Connector status。

不要使用：

- 旧 Worker state
- 旧 Baileys singleton
- 旧 connection table

统一用：

```text
GET Connector /status
```

规则：

```text
connected    -> allow send
qr           -> disable send, ask scan QR
disconnected -> disable send
session_expired -> ask reconnect
```

### 7.3 Settings

Settings 不应该展示太多内部字段给普通用户。

可以隐藏：

- socket
- reconnect attempts
- last seen
- last connected
- last disconnected

保留简单状态即可：

- Phone number
- Connected / Disconnected / QR
- QR image
- Reconnect by QR
- Disconnect WhatsApp

### 7.4 Customer Linking

陌生号码进来时：

- 不应该强制显示 CRM。
- 如果没有 linked customer，显示 Add customer。
- Add customer 应该跳到新客户页面，让员工输入资料。
- 不要自动把名字填成 `WhatsApp 601xxx`，最多预填 phone。

如果 link 错了：

- 应该可以 unlink customer。
- 但普通 UI 可以先隐藏高级按钮，只在必要时开放。

## 8. Invoice / WhatsApp

Invoice WhatsApp 有两种方式：

### 自动方式

通过 Queue + Connector 发送：

- invoice message
- PDF document attachment

### 手动 fallback

按钮：

- Download PDF
- Send Invoice WhatsApp

手动按钮不依赖 Connector connected。

用途：

- Connector 断线
- Session expired
- 客户收不到自动消息
- 员工需要手动确认再发

建议：

Invoice 页面永远保留 Download PDF。

## 9. 本地开发坑

### 9.1 不要在 npm run dev 运行时执行 npm run build

我们遇过：

- `.next` 被 production build 覆盖
- dev server 仍然引用 dev chunks
- browser 请求 layout.css / main-app.js 返回 404
- UI 全部走样

正确流程：

```text
Stop dev server
npm run build
Delete .next
npm run dev
```

### 9.2 不要开太多重复 terminal

正常只需要：

```text
1. Database / embedded postgres
2. Next.js dev server
3. WhatsApp Connector
4. Queue Worker
```

多余窗口会导致：

- port 被占用
- 老代码仍在运行
- 以为改了代码但实际跑旧进程
- Connector session 混乱

### 9.3 Connector 改代码后必须重启

Connector 是独立进程。

改了：

- socket.ts
- server.ts
- sender.ts

必须重启：

```cmd
cd /d "C:\Users\oscar\Documents\Car wash CRM Pos\whatsapp-connector"
npm run dev
```

否则还在跑旧代码。

## 10. 推荐开发顺序

如果以后别的平台要开发 WhatsApp，建议按这个顺序：

1. Manual deep link
2. Independent connector
3. QR / status / logout / reconnect
4. `/send` text only
5. Queue DB
6. Queue worker
7. Retry policy
8. Business automation
9. Inbox outgoing reply
10. Incoming messages
11. History sync
12. Delivery/read receipts
13. Media receive
14. Media send
15. Diagnostics
16. UI polish
17. Multi session
18. Webhook / external API
19. Auth / rate limit
20. Monitoring

不要一开始就做：

- Multi session
- Webhook
- Delivery/read
- Media
- Voice
- Dashboard monitoring

这些应该等核心收发稳定后再做。

## 11. Production Checklist

上线前检查：

- Connector 可以启动
- `/status` 返回 connected
- `/qr/image` 可以生成 QR
- `/logout` 可以清 session
- `/reconnect` 可以重新扫码
- `/send` 可以发文字
- Queue worker 正常
- NotificationQueue 可以 retry
- WhatsAppMessage 可以回写 providerMessageId
- Incoming message 可以写入 conversation
- Read receipt 可以更新 READ
- 图片可以预览/下载
- PDF 可以预览/下载
- 中文可以写入数据库
- PostgreSQL 是 UTF8
- 没有重复 dev server
- 没有旧 Connector 进程
- session expired 有用户提示

## 12. 当前已完成能力

WashFlow 当前 WhatsApp 已完成：

- Independent WhatsApp Connector
- QR login
- Logout / reconnect
- Session management
- Send API
- NotificationQueue
- Queue Worker
- Retry
- Business automation
- Inbox reply
- Incoming messages
- Conversation list
- Customer matching
- Add customer from WhatsApp
- Link/unlink customer
- Image receive/send
- File receive/send
- PDF invoice preview/download
- Audio receive/playback
- Voice record/send UI
- Delivery/read status
- Diagnostics
- Manual invoice WhatsApp fallback

## 13. 当前限制

仍需要继续稳定的地方：

- Baileys 本身不是官方 API。
- WhatsApp session 可能 stale。
- LID / PN mapping 不一定完整。
- 某些联系人可能需要先发消息进来，系统才能稳定回复。
- ACK 463 要优先当 session/contact sync 问题处理。
- 多 WhatsApp number / multi session 还需要更完整 instance design。
- 大量历史消息同步需要分页和限流。
- Media storage 后续应该统一到对象存储。
- 权限控制还可以更细，例如员工是否能看全部 WhatsApp。

## 14. 最重要的原则

开发 WhatsApp 时，最重要的是不要把所有东西混在一起。

正确分层：

```text
CRM / POS / Business Logic
  -> WhatsAppMessage log
  -> NotificationQueue
  -> Queue Worker
  -> WhatsApp Connector
  -> Baileys
  -> WhatsApp
```

每一层只做自己的事。

这样即使 WhatsApp 断线、session 坏掉、客户没收到、数据库失败，也能快速定位问题在哪一层：

- Business Trigger
- Queue
- Worker
- Connector
- Baileys
- WhatsApp Session
- Inbox UI
- Message Log

这就是 WashFlow WhatsApp 这次开发最重要的经验。
