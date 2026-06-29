# WashFlow WhatsApp Development Process

本文档记录 WashFlow Car Wash CRM + POS SaaS 的 WhatsApp 模块开发过程、当前实现方式、关键文件、数据结构、使用流程、已知限制和后续优化方向。

当前 WhatsApp 模块经历了两个阶段：

1. Manual deep link 阶段：系统生成 WhatsApp 文案和 `wa.me` 链接，由员工手动打开 WhatsApp 发送。
2. In-system inbox 阶段：系统使用 WhatsApp Web 连接器扫码登录店铺 WhatsApp，在系统内显示聊天列表和对话。

重要说明：当前实现不是 Meta Cloud API，也不是官方 WhatsApp Business API。扫码 Inbox 使用 WhatsApp Web 方式，适合本地 demo 和早期验证，正式生产前需要评估稳定性、合规性和维护成本。

## 目标

WhatsApp 模块的目标是让洗车店可以在关键业务节点跟客户沟通：

- 新客户欢迎消息
- 服务确认消息
- Ready for Pickup 通知
- Invoice / 收据通知
- 客户日常咨询和回复
- 保留聊天记录，方便老板和员工查看客户沟通历史

## 阶段一：Deep Link 模式

最早版本不接 WhatsApp API，只做 message log 和 deep link。

### 设计原因

Deep Link 模式最简单，也最接近小店实际操作：

1. 系统生成消息内容。
2. 系统生成 `https://wa.me/{phone}?text={message}`。
3. 员工点击按钮打开 WhatsApp。
4. 员工检查内容后手动发送。
5. 系统记录这条消息的状态。

这个阶段不需要：

- Meta Cloud API
- WhatsApp Business API
- Template 审核
- Webhook
- 自动发送
- 平台固定电话号码

### 关键 helper

主要文件：

- `src/lib/whatsappDeepLink.ts`
- `src/lib/whatsapp/deep-link.ts`
- `src/lib/whatsapp/templates.ts`
- `src/components/send-whatsapp-button.tsx`
- `src/app/whatsapp/actions.ts`

核心能力：

- normalize Malaysia phone number
- 生成 `wa.me` deep link
- 根据业务场景生成文案
- 点击按钮后记录 `WhatsAppMessage`
- 打开 WhatsApp
- 手动 Mark as Sent

### Deep Link 状态

`WhatsAppMessageStatus`：

- `DRAFT`
- `OPENED`
- `SENT_MANUALLY`
- `CANCELLED`

状态含义：

- `DRAFT`：消息已生成，但还没打开 WhatsApp。
- `OPENED`：用户点击按钮，系统已经打开 WhatsApp deep link。
- `SENT_MANUALLY`：员工确认已经手动发送。
- `CANCELLED`：消息取消或不需要发送。

### Deep Link 触发点

系统在以下业务节点生成 WhatsApp 消息：

- 新客户创建成功：`NEW_CUSTOMER_WELCOME`
- Job 创建成功：`SERVICE_CONFIRMATION`
- Job 状态变成 Ready for Pickup：`READY_FOR_PICKUP`
- Invoice 生成或付清：`INVOICE_SENT`

### 发送者号码逻辑

Deep Link 阶段增加了用户 WhatsApp 号码：

- `User.whatsappPhone`

发送者逻辑：

1. 优先使用当前登录员工 / owner 的 `whatsappPhone`。
2. 如果员工没有填写，fallback 到 business owner 的 `whatsappPhone`。
3. 如果都没有，提示先填写 WhatsApp Number。

注意：Deep Link 实际发送者仍然是员工手机里登录的 WhatsApp。系统只记录 senderPhone，不能强制 WhatsApp 使用某个号码发送。

## 阶段二：In-System WhatsApp Inbox

后来需求变成：希望系统里有一个类似 WhatsApp 的界面，可以扫码登录店铺 WhatsApp，并在系统内聊天。

因此新增了 WhatsApp Web connector。

### 技术选择

当前使用：

- `@whiskeysockets/baileys`
- `qrcode`

主要文件：

- `src/lib/whatsapp/connector.ts`
- `src/app/whatsapp/settings/page.tsx`
- `src/app/whatsapp/settings/actions.ts`
- `src/app/whatsapp/inbox/page.tsx`
- `src/app/whatsapp/inbox/actions.ts`
- `src/app/api/whatsapp/send/route.ts`
- `src/app/api/whatsapp/unread/route.ts`
- `src/components/whatsapp-reply-form.tsx`
- `src/components/whatsapp-inbox-auto-refresh.tsx`
- `src/components/whatsapp-message-auto-scroll.tsx`

### 连接方式

流程：

1. Owner / Staff 打开 `/whatsapp/settings`。
2. 点击 Generate QR。
3. 系统用 Baileys 建立 WhatsApp Web session。
4. 系统生成 QR。
5. 店铺手机打开 WhatsApp。
6. 进入 Linked devices。
7. 扫描系统 QR。
8. 成功后进入 `/whatsapp/inbox`。

Session 存放在本地：

- `.whatsapp-sessions`

每个 business 单独 session，不能跨 business 共用。

### Connection 状态

`WhatsAppConnectionStatus`：

- `DISCONNECTED`
- `QR_REQUIRED`
- `CONNECTED`
- `ERROR`

`WhatsAppConnection` 记录：

- `businessId`
- `phoneNumber`
- `status`
- `qrCodeText`
- `sessionName`
- `connectedAt`
- `disconnectedAt`
- `lastSeenAt`
- `errorMessage`

说明：

- `phoneNumber` 是最后一次连接到的 WhatsApp 号码。
- 如果 status 是 `DISCONNECTED`，即使还显示旧号码，也代表当前不可发送。
- QR 如果过期或扫不了，需要重新 Generate QR。

## 数据模型

### WhatsAppMessage

用途：记录系统业务通知消息，例如 Ready for Pickup、Invoice Sent。

表名：

- `whatsapp_messages`

重要字段：

- `businessId`
- `branchId`
- `customerId`
- `vehicleId`
- `workOrderId`
- `invoiceId`
- `sentByUserId`
- `phone`
- `senderPhone`
- `recipientPhone`
- `messageType`
- `messageBody`
- `status`
- `openedAt`
- `sentAt`

这个表偏向业务通知 log，不是实时聊天主表。

### WhatsAppConnection

用途：记录某个 business 的 WhatsApp Web 连接状态。

表名：

- `whatsapp_connections`

每个 business 只有一条 connection。

### WhatsAppConversation

用途：系统 Inbox 的聊天列表。

表名：

- `whatsapp_conversations`

重要字段：

- `businessId`
- `customerId`
- `phone`
- `remoteJid`
- `displayName`
- `lastMessageBody`
- `lastMessageAt`
- `unreadCount`

说明：

- `phone` 是系统能解析出的号码或 fallback identifier。
- `remoteJid` 是 WhatsApp 内部 JID，例如 `601xxxxxxxx@s.whatsapp.net`。
- 群组一般是 `@g.us`。
- Newsletter / channel / broadcast 可能不是普通手机号，所以会出现很长的数字或特殊 JID。

### WhatsAppChatMessage

用途：Inbox 里的每一条聊天消息。

表名：

- `whatsapp_chat_messages`

重要字段：

- `businessId`
- `conversationId`
- `customerId`
- `sentByUserId`
- `direction`
- `messageType`
- `body`
- `mediaUrl`
- `mediaMimeType`
- `mediaFileName`
- `status`
- `externalMessageId`
- `createdAt`

`direction`：

- `INBOUND`
- `OUTBOUND`

`messageType`：

- `TEXT`
- `AUDIO`

`status`：

- `RECEIVED`
- `SENT`
- `FAILED`

## Inbox 使用流程

页面：

- `/whatsapp/inbox`

主要功能：

- 左侧聊天名单
- 搜索客户名、电话、消息
- 显示头像 initials
- 显示最后一条消息
- 显示最后消息时间
- 显示未读数量
- 选中聊天后显示消息
- 输入框按 Enter 发送
- 新消息自动刷新
- 新消息自动滚到底部
- 侧边栏 WhatsApp 有未读 badge
- 右侧显示关联 Customer 信息

### 聊天列表排序

聊天列表应该按：

1. `lastMessageAt` 最新优先
2. 如果没有 message，则用 `updatedAt`

新消息进来后，对话应该自动排到顶部。

### 未读数量

逻辑：

- 收到 inbound message 时增加 unread count。
- 打开对话后应该清除该 conversation 的 unread count。
- 侧边栏 WhatsApp badge 显示当前 business 的总未读数。

### 名字显示逻辑

优先级：

1. WhatsApp push name / contact name
2. 已关联 customer name
3. phone
4. remoteJid fallback

注意：

- 如果有名字，不要再显示 `no phone linked` 或很长的内部 id。
- 如果没有名字，必须保留号码或 identifier，不然员工不知道是谁。
- 系统发送消息后不能把 conversation name 覆盖成当前登录用户名字，例如 OSCAR。对话名称必须继续代表客户或 WhatsApp contact。

## 发送消息流程

页面：

- `/whatsapp/inbox`

流程：

1. 员工选择一个 conversation。
2. 输入文字。
3. 按 Enter 或 Send。
4. 前端调用 `/api/whatsapp/send`。
5. API 检查当前登录用户和 business。
6. API 找到 conversation。
7. `sendWhatsAppTextMessage` 通过 Baileys 发送。
8. 成功后创建 OUTBOUND `WhatsAppChatMessage`。
9. 更新 conversation 的 last message。
10. 页面刷新或自动刷新后显示新消息。

相关文件：

- `src/components/whatsapp-reply-form.tsx`
- `src/app/api/whatsapp/send/route.ts`
- `src/lib/whatsapp/connector.ts`

## 接收消息流程

Baileys session 收到 WhatsApp 事件后：

1. 读取 remoteJid。
2. 过滤不支持或不需要的 JID。
3. 解析 sender phone。
4. 解析 display name。
5. 读取 message text。
6. 如果是 audio message，下载 media。
7. upsert `WhatsAppConversation`。
8. 创建 `WhatsAppChatMessage`。
9. 更新 `lastMessageBody`、`lastMessageAt`、`unreadCount`。
10. 尝试用 phone 关联 CRM Customer。

相关文件：

- `src/lib/whatsapp/connector.ts`

## Audio Message 流程

用户要求：

```text
WhatsApp audioMessage
↓
download media
↓
save local file
↓
create chat message: type=AUDIO
↓
inbox shows audio player
```

当前设计：

1. Baileys 收到 `audioMessage`。
2. 使用 `downloadContentFromMessage` 下载音频。
3. 保存到本地 public uploads。
4. 创建 `WhatsAppChatMessage`：
   - `messageType = AUDIO`
   - `mediaUrl = /uploads/whatsapp-audio/{businessId}/{file}`
   - `mediaMimeType`
   - `mediaFileName`
5. Inbox 判断 `messageType === AUDIO`。
6. 显示 HTML audio player。

本地文件路径：

- `public/uploads/whatsapp-audio/{businessId}/...`

注意：正式生产需要改为对象存储，例如 S3 / R2 / Supabase Storage，避免部署后文件丢失。

## 中文和 Emoji 编码问题

开发过程中遇到 Windows 本地 Postgres encoding 问题：

错误类似：

```text
character with byte sequence ... in encoding "UTF8" has no equivalent in encoding "WIN1252"
```

原因：

- 本地 embedded Postgres 可能不是完整 UTF-8 环境。
- 中文、emoji、特殊字符写入时可能失败。

处理方式：

- 增加 `src/lib/whatsapp/message-codec.ts`
- 写入 DB 前 encode
- 页面读取时 decode

相关函数：

- `encodeWhatsAppStoredText`
- `decodeWhatsAppStoredText`

这样可以让中文消息在系统里正常保存和显示。

## 群组问题

用户发现手机 WhatsApp 有群组，但系统 Inbox 没有完整显示。

原因：

- 当前第一版主要支持普通 1-to-1 chat。
- 普通联系人 JID 通常是 `@s.whatsapp.net`。
- 群组 JID 通常是 `@g.us`。
- 群组需要额外处理 group metadata、group name、participant sender、群消息显示。

后续如果要支持群组，需要新增：

- `isGroup` 字段
- group JID 支持
- group display name
- group participants
- inbound message sender participant
- 群组搜索和显示

## 为什么有很长的数字

有时列表出现类似：

```text
174663485366335
81896671322257
33178706280572
```

可能原因：

- WhatsApp 内部 JID
- Newsletter / channel / broadcast id
- 群组或特殊 conversation id
- 无法解析成普通手机号的 remote identifier
- contact name 暂时还没同步到

处理原则：

- 有 display name 时显示名字。
- 没 display name 但能解析手机号时显示手机号。
- 都没有时才显示 remote identifier。
- 不要用当前登录 user 名字覆盖客户 conversation 名字。

## 与 CRM Customer 的关系

WhatsApp conversation 可以关联 Customer：

- 如果 conversation phone 匹配 customer phone，则自动关联。
- 右侧 Customer panel 显示客户资料和车辆。
- 如果没有匹配，则显示 No linked customer。

后续建议增加：

- 手动 Link customer
- 创建新 customer from WhatsApp
- 将 WhatsApp conversation merge 到客户 timeline

## Dashboard 和通知

Dashboard 的 WhatsApp 指标从早期的 delivered/read 改为更符合当前能力的指标：

- Manual WhatsApp opened
- Manual WhatsApp sent
- Inbox unread count

因为 Deep Link 无法追踪 delivered/read。
Baileys 可能可以收到部分 receipt，但稳定性和准确性不能按官方 API 保证。

侧边栏 WhatsApp badge：

- 使用 `/api/whatsapp/unread`
- 定期 polling
- 显示当前 business 未读总数

## 多租户隔离

所有 WhatsApp 相关数据都必须按 `businessId` 隔离。

原则：

- 查询必须带 `businessId`
- mutation 必须带 `businessId`
- WhatsApp session 以 business 为单位
- 不允许 staff / owner 访问其他 business 的 WhatsApp logs 或 inbox
- conversation、message、connection 全部属于当前 business

关键字段：

- `WhatsAppMessage.businessId`
- `WhatsAppConnection.businessId`
- `WhatsAppConversation.businessId`
- `WhatsAppChatMessage.businessId`

## 当前页面

### Message Log

```text
/whatsapp
```

用于查看业务通知 log，例如 service confirmation、ready pickup、invoice sent。

### Message Detail

```text
/whatsapp/[messageId]
```

用于查看单条 deep link/manual message 内容。

### Settings

```text
/whatsapp/settings
```

用于：

- Generate QR
- Refresh status
- Disconnect
- 查看当前连接状态

### Inbox

```text
/whatsapp/inbox
```

用于：

- 查看聊天列表
- 搜索聊天
- 查看消息
- 发送消息
- 查看右侧 customer 信息

### API

```text
/api/whatsapp/send
/api/whatsapp/unread
```

## 本地运行

常用命令：

```powershell
npm.cmd run prisma:migrate
npm.cmd run prisma:seed
npm.cmd run dev
```

项目使用 embedded postgres 包装脚本：

```json
"dev": "node scripts/with-embedded-postgres.mjs next dev",
"prisma:migrate": "node scripts/with-embedded-postgres.mjs prisma migrate dev",
"prisma:seed": "node scripts/with-embedded-postgres.mjs tsx prisma/seed.ts"
```

本地数据库默认端口：

```text
localhost:5432
```

如果页面出现：

```text
Can't reach database server at localhost:5432
```

代表 embedded postgres 没有启动或 dev server 没有通过项目脚本启动。

## 已知限制

当前 WhatsApp Inbox 是本地 demo 级别，限制如下：

- 使用 WhatsApp Web unofficial connector，不是官方 Meta API。
- WhatsApp Web 协议变化可能导致连接失效。
- QR 可能过期，需要重新生成。
- app 重启后 session 需要重新启动。
- 群组支持还不完整。
- 图片、文件、贴纸、联系人卡片等 media 还没有完整支持。
- 音频已做基础保存和播放，但正式环境需要云端 storage。
- 实时性目前主要依赖 Baileys event + 页面 polling / refresh，不是完整 WebSocket UI。
- 多设备、多人同时操作同一个 WhatsApp 号码时，需要更严格的锁和状态管理。

## 后续建议

### 1. 群组支持

新增 group conversation：

- `isGroup`
- `groupName`
- `participantJid`
- `participantName`

### 2. Media 支持

扩展 message type：

- `IMAGE`
- `VIDEO`
- `DOCUMENT`
- `STICKER`
- `LOCATION`

### 3. 更实时的 Inbox

把 polling 改成：

- WebSocket
- Server-Sent Events
- Pusher / Ably / Supabase Realtime

### 4. 更好的 Contact Sync

增强：

- 获取 WhatsApp contact name
- 避免显示内部 JID
- 手动修正 conversation display name
- 手动 link / unlink customer

### 5. Message Delivery 状态

如果继续使用 Baileys，可以研究 receipt event：

- sent
- delivered
- read

但不要把它当作官方稳定能力。

### 6. 官方 WhatsApp Business API 版本

如果未来要正式自动发送，应该另外做 Meta Cloud API 版本：

- Business phone number
- WABA
- Access token
- Webhook
- Template approval
- Delivery / read status webhook
- Production queue

这会和当前 WhatsApp Web Inbox 是不同路线。

## 推荐路线

当前 WashFlow 可以先保留两种 WhatsApp 能力：

### A. Manual Deep Link

适合：

- Ready for Pickup
- Invoice summary
- 简单提醒
- 不需要后台自动发送

优点：

- 稳定
- 简单
- 不依赖 unofficial connector
- 不需要 Meta 审核

### B. In-System Inbox

适合：

- 客服聊天
- 老板/员工在系统里查看客户回复
- 客户沟通记录沉淀到 CRM

优点：

- 用户体验像 WhatsApp
- 可以从系统回复
- 可以配合 Customer 资料

风险：

- WhatsApp Web connector 不一定适合正式 SaaS 大规模生产
- 需要持续维护连接稳定性

## 当前验收重点

开发和测试 WhatsApp 模块时，重点检查：

- `/whatsapp/settings` 可以生成 QR。
- 手机 WhatsApp Linked devices 可以扫码。
- 连接成功后 `/whatsapp/inbox` 显示 connected。
- 聊天列表有头像、名字、最后消息、时间。
- 有新消息时 conversation 排到顶部。
- 打开 conversation 后 unread badge 清除。
- 输入文字按 Enter 可以发送。
- 中文可以发送和显示。
- inbound 中文不显示 `[Message]`。
- outbound 发送后 conversation 名字不会变成当前 user 名字。
- 语音消息会下载并显示 audio player。
- 所有数据只属于当前 business。

