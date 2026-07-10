# Messaging Platform V2 - Product Decision

## Context

Messaging Platform V2 needs to support multiple WhatsApp numbers under one Business without mixing conversations, messages, inbox views, or sending sessions.

This document compares three product architecture options:

- Option A: Single Active Session + Archive
- Option B: Branch Session
- Option C: Department Session

## Option A: Single Active Session + Archive

Business can have multiple WhatsApp sessions, but only one session is active by default for the main Inbox.

Old sessions are not deleted. They are archived or marked inactive. Users can switch back to view old session history when needed.

### Pros

- Solves the immediate problem of conversations from different WhatsApp numbers mixing together.
- Keeps the product behavior simple: one Business, one current WhatsApp number, one active Inbox.
- Lowest migration risk because existing data can be attached to one default session.
- Easy for operators to understand when changing WhatsApp numbers.
- Preserves old conversations without forcing deletion or complex reassignment.
- Provides a clean foundation for future multi-session features.

### Cons

- Does not fully support simultaneous operational use of multiple numbers.
- Branches and departments cannot have their own independent Inbox behavior yet.
- Users may need to manually switch sessions to view archived number history.
- The active session concept must be clearly shown in the UI to avoid confusion.

### Migration Cost

Low.

Existing conversations, messages, and queue records can be linked to a default WhatsApp session. New sessions can be created only when a new number is connected.

### Development Cost

Low to medium.

Requires adding session identity across data model, Inbox filtering, Connector session routing, and Queue sending. Product behavior remains straightforward because only one session is active by default.

### Maintenance Cost

Low.

The system has one primary active session path and archived sessions for history. Support and debugging are simpler than branch-level or department-level routing.

## Option B: Branch Session

Each branch can have its own WhatsApp session. A Business may have multiple branches, and each branch can connect and operate its own WhatsApp number.

### Pros

- Fits businesses where each physical branch has its own WhatsApp number.
- Allows branch-level ownership of conversations and messages.
- Makes future branch reporting, permissions, and assignment cleaner.
- Reduces confusion for multi-location operations.

### Cons

- Requires branch context to be present in WhatsApp Inbox, Queue, sending, and conversation creation.
- Existing conversations may not have enough information to map cleanly to a branch.
- Operators must understand both branch selection and WhatsApp session selection.
- More edge cases when customers interact with the wrong branch number.

### Migration Cost

Medium to high.

Existing data must be assigned to a default branch session or manually mapped. If branch ownership is missing or inconsistent, migration rules may be approximate.

### Development Cost

Medium to high.

Requires session support plus branch-aware Inbox filtering, Queue routing, permissions, reporting, and UI selection behavior.

### Maintenance Cost

Medium.

More moving parts exist because session issues may be tied to branch configuration, permissions, or data ownership.

## Option C: Department Session

Each department can have its own WhatsApp session, such as Service, Marketing, Pickup Reminder, Sales, or Support.

### Pros

- Best long-term fit for businesses that separate customer communication by function.
- Supports specialized numbers for marketing, service, reminders, and support.
- Can improve routing, automation, and customer experience.
- Allows department-level templates, queues, and ownership rules in the future.

### Cons

- Highest product complexity.
- Requires a department model or stable department concept across the app.
- Queue and automation rules must decide which department session to use.
- Inbox needs more advanced filtering, permissions, and assignment behavior.
- More difficult for small businesses that only need one WhatsApp number.

### Migration Cost

High.

Existing conversations and messages usually do not contain reliable department ownership. Most historical data would need to go into a default department session until future rules are configured.

### Development Cost

High.

Requires session support plus department-aware routing, queue selection rules, Inbox filtering, permissions, automation mapping, and UI controls.

### Maintenance Cost

High.

More configuration creates more support cases. Message routing bugs become harder to diagnose because they may involve department rules, templates, queue source, and session state.

## Recommendation

Recommend Option A: Single Active Session + Archive.

Reason:

- It directly fixes the current production problem: old WhatsApp number conversations appearing after switching to a new number.
- It keeps V2 focused on session isolation instead of expanding into branch or department routing too early.
- It has the lowest migration cost and the smallest operational risk.
- It preserves historical chats while preventing new and old numbers from mixing.
- It creates the correct foundation for Option B and Option C later.

## Decision

Use Option A for Messaging Platform V2.

Implement the core model as:

```text
Business
  ↓
WhatsAppSession
  ↓
WhatsAppConversation
  ↓
WhatsAppMessage
```

Product behavior:

- One Business can have multiple WhatsApp sessions.
- One session is active by default.
- Archived or inactive sessions keep historical conversations.
- Inbox filters by the selected session.
- Queue records include session identity.

Branch Session and Department Session should remain future extensions after the core session boundary is stable.

## Future Extensions

Option B can be added later by attaching `branchId` to `WhatsAppSession`.

Option C can be added later by attaching a department concept to `WhatsAppSession` and queue routing rules.

The V2 decision should avoid blocking these future paths while keeping the first implementation focused and safe.
