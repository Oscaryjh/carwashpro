# Messaging Platform V2 - Multi WhatsApp Session

## Problem

目前 WhatsApp conversation 只按 business 保存。
当从 `601112212259` 换成 `60128793848` 时，旧号码的聊天记录仍然显示在 Inbox。
这会造成不同 WhatsApp 号码的 conversation 混在一起。

现有结构的问题是：

- Business 和 WhatsApp conversation 之间缺少一个号码级别的边界。
- Inbox 只能按 business 拉取 conversation，无法判断 conversation 属于哪个 WhatsApp 号码。
- Connector 的 auth/session 状态没有被明确建模为业务数据。
- Queue 发送时无法表达“使用哪个 WhatsApp 号码发送”。

## Goal

实现以下层级：

```text
Business
  ↓
WhatsAppSession
  ↓
WhatsAppConversation
  ↓
WhatsAppMessage
```

每个 `WhatsAppSession` 独立拥有：

- `phoneNumber`
- `auth/session`
- `status`
- `conversations`
- `messages`
- `inbox`

目标是让一个 Business 可以绑定多个 WhatsApp 号码，同时保证不同号码之间的聊天记录、登录状态、发送队列和 Inbox 视图互相隔离。

## Data Model

### New Model: WhatsAppSession

新增 `WhatsAppSession`，作为 Business 下的 WhatsApp 号码和连接状态实体。

字段：

- `id`
- `businessId`
- `branchId` optional
- `phoneNumber`
- `displayName`
- `status`
- `authPath`
- `isActive`
- `connectedAt`
- `disconnectedAt`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

建议含义：

- `businessId`: 所属 Business。
- `branchId`: 可选，未来支持 branch-level WhatsApp。
- `phoneNumber`: WhatsApp 号码，例如 `601112212259`。
- `displayName`: UI 展示名称，例如 `Main Service Number`。
- `status`: session 状态，例如 `connected`, `disconnected`, `connecting`, `logged_out`, `error`。
- `authPath`: 当前 session 独立的 auth_info 路径。
- `isActive`: 当前 Business 默认或当前选中的 active session 标记。
- `connectedAt`: 最近一次连接成功时间。
- `disconnectedAt`: 最近一次断开时间。
- `lastSeenAt`: 最近一次 Connector 确认 session 存活时间。

### Modified Models

`WhatsAppConversation` 增加：

- `sessionId`

`WhatsAppMessage` 增加：

- `sessionId`

`NotificationQueue` 增加：

- `sessionId`

### Relationship Rules

- 一个 `Business` 可以有多个 `WhatsAppSession`。
- 一个 `WhatsAppSession` 只属于一个 `Business`。
- 一个 `WhatsAppConversation` 必须属于一个 `WhatsAppSession`。
- 一个 `WhatsAppMessage` 必须属于一个 `WhatsAppSession`。
- 一条 `NotificationQueue` 必须指定一个 `WhatsAppSession`。
- `sessionId` 是 Inbox、Message list、Queue worker 选择发送账号的核心过滤条件。

## Session Behavior

- 当前 active session 决定 Inbox 显示哪些 conversations。
- 新号码登录后，不显示旧号码 conversations。
- 旧 session 不删除，只 archive/inactive。
- 每个 session 独立 `auth_info`。
- Logout 只影响当前 session。
- Reconnect 只影响当前 session。

### Active Session

每个 Business 可以有一个当前 active WhatsApp session。

当用户在 Inbox 中选择某个 WhatsApp number：

- 前端记录当前 `sessionId`。
- Inbox conversation query 使用 `businessId + sessionId` 过滤。
- Message query 使用 `conversationId + sessionId` 过滤。
- Send message 使用当前 `sessionId`。

当新号码登录成功：

- 新建或激活对应的 `WhatsAppSession`。
- 将其设置为当前 active session。
- 旧 session 保留但设为 inactive 或 archived。
- Inbox 只显示新 session 的 conversations。

### Logout

Logout 当前号码时：

- 只清理当前 `sessionId` 对应的 auth/session。
- 只更新当前 `WhatsAppSession.status`。
- 不删除旧 conversations/messages。
- 不影响同一 Business 下其他 WhatsApp sessions。

### Reconnect

Reconnect 当前号码时：

- Connector 使用当前 `sessionId` 对应的 `authPath`。
- 只恢复当前 session。
- 不改变其他 sessions 的 status。

## Inbox UI

新增：

```text
Current WhatsApp Number selector
```

显示示例：

- `601112212259`
- `60128793848`

切换 session 后：

- Chat list 根据 `sessionId` filter。
- Message list 根据 `sessionId` filter。
- Send message 使用当前 `sessionId`。
- Inbox badge/count 只统计当前 session。
- Empty state 只代表当前 session 没有 conversation，不代表整个 Business 没有 conversation。

### UI Behavior

Inbox 顶部展示当前 WhatsApp number selector。

用户切换号码时：

1. 更新当前 selected `sessionId`。
2. 重新加载当前 session 的 conversation list。
3. 清空或重新加载 message panel。
4. 后续发送消息、读取消息、接收消息都绑定当前 `sessionId`。

### Expected Result

当 Business 从 `601112212259` 切换到 `60128793848`：

- `601112212259` 的旧 conversation 不再显示在当前 Inbox。
- `60128793848` 只显示自己 session 下的新 conversation。
- 用户仍可通过 selector 切回旧号码查看历史记录。

## Queue Behavior

每条 `NotificationQueue` 必须带 `sessionId`。

Worker 根据 `sessionId` 选择对应 Connector session 发送。

发送流程：

```text
NotificationQueue
  ↓ sessionId
WhatsAppSession
  ↓ authPath / connector session
Connector
  ↓
WhatsApp number
```

Queue 规则：

- 创建 queue item 时必须写入 `sessionId`。
- Worker 读取 queue item 后，根据 `sessionId` 找到对应 `WhatsAppSession`。
- Worker 将 `sessionId` 传给 Connector。
- Connector 使用该 session 的 auth path 和连接实例发送。
- 如果 session disconnected，queue item 应进入 retry 或 failed 状态。
- 不允许在缺少 `sessionId` 时发送 WhatsApp 消息。

## Connector Impact

V2 后 connector 要支持：

- `sessionId`
- auth path per session
- `GET /sessions`
- `POST /sessions/:id/connect`
- `POST /sessions/:id/logout`
- `POST /sessions/:id/send`

但这一步只设计，不实现。

### Connector Session Boundary

Connector 需要把 WhatsApp 登录状态从“单实例”升级为“多 session 实例”：

- 每个 `sessionId` 有独立 auth path。
- 每个 `sessionId` 有独立 connection lifecycle。
- 每个 `sessionId` 可以独立 connect/logout/reconnect/send。
- Connector 不应把不同 `sessionId` 的 incoming message 写入同一个 conversation 空间。

## Migration Strategy

旧数据处理：

- 创建 default `WhatsAppSession`。
- 把现有 conversations/messages/queue 关联到 default session。
- 保留历史记录。

建议迁移步骤：

1. 为每个已有 Business 创建一个 default `WhatsAppSession`。
2. default session 的 `phoneNumber` 使用当前已知 WhatsApp 号码；如果未知，先标记为 `unknown` 或从 connector/auth metadata 回填。
3. 将现有 `WhatsAppConversation.sessionId` 指向 default session。
4. 将现有 `WhatsAppMessage.sessionId` 指向 default session。
5. 将未发送完成的 `NotificationQueue.sessionId` 指向 default session。
6. 历史数据不删除。
7. 迁移完成后，所有新的 conversation/message/queue 都必须写入明确的 `sessionId`。

## Acceptance Criteria

- 切换 WhatsApp 号码不会混聊天。
- 旧号码聊天可保留。
- 新号码只显示新 session 聊天。
- Queue 发送知道用哪个 WhatsApp session。
- Business 可有多个 WhatsApp numbers。

## Future

- Branch-level WhatsApp
- Department-level WhatsApp
- Marketing number
- Service number
- Pickup reminder number

## Non-Goals For This Step

本步骤只完成设计文档。

不做以下事情：

- 不写代码。
- 不改 schema。
- 不修改数据库。
- 不修改 Connector。
- 不修改 Queue。
- 不修改 Worker。
- 不修改 Inbox。
- 不修改 CRM/POS。
