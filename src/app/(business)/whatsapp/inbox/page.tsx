import Link from "next/link";
import { redirect } from "next/navigation";
import { WhatsAppInboxAutoRefresh } from "@/components/whatsapp-inbox-auto-refresh";
import { WhatsAppCustomerPicker } from "@/components/whatsapp-customer-picker";
import { WhatsAppMessageAutoScroll } from "@/components/whatsapp-message-auto-scroll";
import { WhatsAppReplyForm } from "@/components/whatsapp-reply-form";
import { WhatsAppSessionRecovery } from "@/components/whatsapp-settings-session-recovery";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  getConnectorStatus,
  type ConnectorStatus,
} from "@/lib/whatsapp/connector-client";
import { mergeDuplicateWhatsAppConversations } from "@/lib/whatsapp/conversation-merge";
import {
  getDefaultWhatsAppInstanceId,
  normalizeWhatsAppInstanceId,
} from "@/lib/whatsapp/instance";
import { decodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import { refreshWhatsAppInboxConnectionAction } from "./actions";

type WhatsAppInboxPageProps = {
  searchParams: Promise<{
    conversation?: string;
    message?: string;
    q?: string;
    type?: string;
  }>;
};

export default async function WhatsAppInboxPage({
  searchParams,
}: WhatsAppInboxPageProps) {
  const { user, businessId, industryType } = await requireBusinessUser();
  const isSalonBusiness = industryType === "SALON_BEAUTY";
  const canManageWhatsAppSession = hasStaffPermission(user, "WHATSAPP_SESSION");
  const params = await searchParams;
  const message = params.message;
  const query = params.q?.trim() ?? "";
  const messageType = params.type === "error" ? "error" : "success";
  const connection = await readInboxConnectorStatus(businessId);
  const connectionStatus = connection.status;
  const instanceId = normalizeWhatsAppInstanceId(
    connection.phoneNumber ?? getDefaultWhatsAppInstanceId(),
  );

  if (connectionStatus !== "connected") {
    redirect(
      `/whatsapp/settings?type=error&message=${encodeURIComponent(
        "WhatsApp connection required. Please reconnect WhatsApp.",
      )}`,
    );
  }

  const canSend = connectionStatus === "connected";
  const sendDisabled = !canSend;

  await mergeDuplicateWhatsAppConversations(businessId);

  const rawConversations = await prisma.whatsAppConversation.findMany({
    where: { businessId, instanceId },
    include: {
      customer: {
        include: {
          vehicles: {
            orderBy: { updatedAt: "desc" },
            take: 3,
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const conversations = rawConversations
    .filter(
      (conversation) =>
        !isSelfInternalConversation(conversation, connection.phoneNumber),
    )
    .sort(compareConversationsByLatestActivity)
    .slice(0, 50);
  const filteredConversations = conversations.filter((conversation) =>
    matchesConversationSearch(conversation, query),
  );
  const customerPickerCustomers = await prisma.customer.findMany({
    where: { businessId },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      vehicles: {
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          plateNumber: true,
          brand: true,
          model: true,
          color: true,
        },
      },
    },
  });

  const requestedConversationId = params.conversation;
  const selectedConversationId = conversations.some(
    (conversation) => conversation.id === requestedConversationId,
  )
    ? requestedConversationId
    : conversations[0]?.id;
  if (selectedConversationId) {
    await prisma.whatsAppConversation.updateMany({
      where: {
        id: selectedConversationId,
        businessId,
        instanceId,
        unreadCount: { gt: 0 },
      },
      data: { unreadCount: 0 },
    });
  }

  const selectedConversation = selectedConversationId
    ? await prisma.whatsAppConversation.findFirst({
        where: {
          id: selectedConversationId,
          businessId,
          instanceId,
        },
        include: {
          customer: {
            include: {
              vehicles: {
                orderBy: { updatedAt: "desc" },
              },
              customerPackages: {
                where: { status: "ACTIVE" },
                orderBy: { purchasedAt: "desc" },
                take: 5,
                include: { package: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "asc" },
            take: 100,
          },
        },
      })
    : null;

  return (
    <>
      <WhatsAppInboxAutoRefresh enabled={canSend} />
      <section className="content whatsapp-inbox-page">
        <div className="page-header whatsapp-inbox-page-header">
          <div>
            <h1>WhatsApp Inbox</h1>
          </div>
          <div className="whatsapp-inbox-header-status">
            <span className={`status ${connectionStatus}`}>
              {formatConnectorStatus(connectionStatus)}
            </span>
            <span className="whatsapp-inbox-phone">
              {getConnectorStatusMessage(connection)}
            </span>
            <form action={refreshWhatsAppInboxConnectionAction}>
              {selectedConversation ? (
                <input
                  type="hidden"
                  name="conversationId"
                  value={selectedConversation.id}
                />
              ) : null}
              <button className="whatsapp-toolbar-button" type="submit">
                Refresh
              </button>
            </form>
            {canManageWhatsAppSession ? (
              <form action="/whatsapp/settings" method="get">
                <button className="whatsapp-toolbar-button" type="submit">
                  Settings
                </button>
              </form>
            ) : null}
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}
        <WhatsAppSessionRecovery
          lastAckErrorAt={connection.lastAckError?.at ?? null}
          lastDisconnectedAt={connection.lastDisconnectedAt}
          reconnectAttempts={connection.reconnectAttempts}
          status={connectionStatus}
        />

        <div className="whatsapp-inbox-layout">
          <aside className="panel whatsapp-chat-list">
            <div className="section-header whatsapp-chat-list-header">
              <h2>Chats</h2>
              <div className="whatsapp-chat-list-actions">
                <WhatsAppCustomerPicker
                  customers={customerPickerCustomers}
                  includeVehicleDetails={!isSalonBusiness}
                />
                <span className="whatsapp-chat-count">
                  {query
                    ? `${filteredConversations.length}/${conversations.length}`
                    : conversations.length}
                </span>
              </div>
            </div>
            <form className="whatsapp-chat-search" action="/whatsapp/inbox">
              {selectedConversation ? (
                <input
                  type="hidden"
                  name="conversation"
                  value={selectedConversation.id}
                />
              ) : null}
              <input
                aria-label="Search WhatsApp chats"
                defaultValue={query}
                name="q"
                placeholder="Search name, phone, or message"
                type="search"
              />
              {query ? (
                  <Link className="whatsapp-search-clear" href="/whatsapp/inbox">
                    Clear
                  </Link>
              ) : null}
            </form>
            {filteredConversations.length ? (
              <div className="whatsapp-conversation-list">
                {filteredConversations.map((conversation) => (
                  <Link
                    className={
                      conversation.id === selectedConversation?.id
                        ? "whatsapp-conversation active"
                        : "whatsapp-conversation"
                    }
                    href={getConversationHref(conversation.id, query)}
                    key={conversation.id}
                  >
                    <span className="whatsapp-avatar" aria-hidden="true">
                      {getConversationAvatarText(conversation)}
                    </span>
                    <span className="whatsapp-conversation-main">
                      <span className="whatsapp-conversation-top">
                        <strong>{formatConversationName(conversation)}</strong>
                        <time>
                          {formatConversationTime(
                            conversation.lastMessageAt ?? conversation.updatedAt,
                          )}
                        </time>
                      </span>
                      <span className="whatsapp-conversation-bottom">
                        <span className="muted">
                          {decodeWhatsAppStoredText(conversation.lastMessageBody) ||
                            (conversation.lastMessageAt
                              ? "Message content not synced yet"
                              : "No messages yet")}
                        </span>
                        {conversation.unreadCount ? (
                          <em>{conversation.unreadCount}</em>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                {conversations.length
                  ? "No chats match this search."
                  : "No WhatsApp chats yet. Wait for a customer message, or tap + to start a chat from CRM."}
              </p>
            )}
          </aside>

          <main className="panel whatsapp-chat-window">
            {selectedConversation ? (
              <>
                <div className="whatsapp-chat-header">
                  <div className="whatsapp-chat-title">
                    <span className="whatsapp-avatar whatsapp-avatar-large" aria-hidden="true">
                      {getConversationAvatarText(selectedConversation)}
                    </span>
                    <div>
                      <h2>{formatConversationName(selectedConversation)}</h2>
                      <div className="whatsapp-chat-contact-row">
                        <span>{getVisibleConversationPhone(selectedConversation) || "Phone not synced"}</span>
                      </div>
                    </div>
                  </div>
                  {selectedConversation.customer ? (
                    <Link
                      className="whatsapp-customer-action-button"
                      href={`/crm/customers/${selectedConversation.customer.id}`}
                    >
                      View customer
                    </Link>
                  ) : null}
                </div>

                <div className="whatsapp-message-thread">
                  {selectedConversation.messages.length ? (
                    selectedConversation.messages.map((chatMessage) => (
                      <div
                        className={
                          chatMessage.direction === "OUTBOUND"
                            ? "whatsapp-bubble outbound"
                            : "whatsapp-bubble inbound"
                        }
                        key={chatMessage.id}
                      >
                        {chatMessage.messageType === "IMAGE" ? (
                          <div className="whatsapp-image-message">
                            {chatMessage.mediaUrl ? (
                              <>
                                <a
                                  href={chatMessage.mediaUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <img
                                    alt={decodeWhatsAppStoredText(chatMessage.body) || "WhatsApp image"}
                                    src={chatMessage.mediaUrl}
                                  />
                                </a>
                                <div className="whatsapp-document-actions">
                                  <a
                                    href={chatMessage.mediaUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Preview
                                  </a>
                                  <a
                                    download={chatMessage.mediaFileName ?? true}
                                    href={chatMessage.mediaUrl}
                                  >
                                    Download
                                  </a>
                                </div>
                              </>
                            ) : (
                              <p className="muted">Image unavailable.</p>
                            )}
                            {decodeWhatsAppStoredText(chatMessage.body) &&
                            decodeWhatsAppStoredText(chatMessage.body) !== "Image" ? (
                              <p>{decodeWhatsAppStoredText(chatMessage.body)}</p>
                            ) : null}
                          </div>
                        ) : chatMessage.messageType === "AUDIO" ? (
                          <div className="whatsapp-audio-player">
                            {chatMessage.mediaUrl ? (
                              <audio
                                controls
                                preload="metadata"
                                src={chatMessage.mediaUrl}
                              >
                                Your browser does not support audio playback.
                              </audio>
                            ) : (
                              <p>{decodeWhatsAppStoredText(chatMessage.body)}</p>
                            )}
                          </div>
                        ) : chatMessage.messageType === "DOCUMENT" ? (
                          <div className="whatsapp-document-message">
                            <p>{decodeWhatsAppStoredText(chatMessage.body)}</p>
                            {chatMessage.mediaUrl ? (
                              <div className="whatsapp-document-card">
                                <strong>
                                  {chatMessage.mediaFileName ?? "WhatsApp document"}
                                </strong>
                                <div className="whatsapp-document-actions">
                                  <a
                                    href={chatMessage.mediaUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Preview
                                  </a>
                                  <a
                                    download={chatMessage.mediaFileName ?? true}
                                    href={chatMessage.mediaUrl}
                                  >
                                    Download
                                  </a>
                                </div>
                              </div>
                            ) : (
                              <span className="muted">Attachment unavailable.</span>
                            )}
                          </div>
                        ) : (
                          <p>{decodeWhatsAppStoredText(chatMessage.body)}</p>
                        )}
                        <span className="whatsapp-message-meta">
                          {formatChatMessageTime(chatMessage.createdAt)}
                          {chatMessage.direction === "OUTBOUND" ? (
                            <>
                              {" "}
                              <strong
                                aria-label={getChatMessageStatusLabel(chatMessage.status)}
                                className={getChatMessageStatusClass(chatMessage.status)}
                                title={getChatMessageStatusLabel(chatMessage.status)}
                              >
                                {renderChatMessageStatusIcon(chatMessage.status)}
                              </strong>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="empty-state">
                      {selectedConversation.lastMessageAt
                        ? "This WhatsApp chat is available, but older message content has not synced yet. New messages will appear here automatically."
                        : "No messages in this chat yet."}
                    </p>
                  )}
                </div>
                <WhatsAppMessageAutoScroll
                  scrollKey={`${selectedConversation.id}:${
                    selectedConversation.messages.at(-1)?.id ?? "empty"
                  }:${selectedConversation.messages.length}`}
                />

                <WhatsAppReplyForm
                  connectionStatus={connectionStatus}
                  conversationId={selectedConversation.id}
                  disabled={sendDisabled}
                />
              </>
            ) : (
              <div className="whatsapp-chat-empty">
                <strong>Select a chat</strong>
                <span>Choose a conversation from the left to view messages.</span>
              </div>
            )}
          </main>

          <aside className="panel whatsapp-customer-side">
            <div className="section-header whatsapp-customer-side-header">
              <h2>Customer</h2>
            </div>
            {selectedConversation?.customer ? (
              <>
                <div className="whatsapp-customer-profile">
                  <span className="whatsapp-avatar whatsapp-profile-avatar" aria-hidden="true">
                    {getAvatarText(selectedConversation.customer.name)}
                  </span>
                  <strong>{selectedConversation.customer.name}</strong>
                  <span>{selectedConversation.customer.phone}</span>
                  <span>{selectedConversation.customer.email ?? "No email"}</span>
                  <Link
                    className="whatsapp-customer-action-button"
                    href={`/crm/customers/${selectedConversation.customer.id}`}
                  >
                    Open customer profile
                  </Link>
                </div>

                {!isSalonBusiness ? (
                  <>
                    <h3>Vehicles</h3>
                    {selectedConversation.customer.vehicles.length ? (
                      <div className="mini-list">
                        {selectedConversation.customer.vehicles.map((vehicle) => (
                          <Link href={`/crm/vehicles/${vehicle.id}`} key={vehicle.id}>
                            <strong>{vehicle.plateNumber}</strong>
                            <span>
                              {[vehicle.brand, vehicle.model, vehicle.color]
                                .filter(Boolean)
                                .join(" ") || "No vehicle details"}
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No vehicles.</p>
                    )}
                  </>
                ) : null}

                <h3>Packages</h3>
                {selectedConversation.customer.customerPackages.length ? (
                  <div className="mini-list">
                    {selectedConversation.customer.customerPackages.map((customerPackage) => (
                      <div key={customerPackage.id}>
                        <strong>{customerPackage.package.name}</strong>
                        <span>
                          {customerPackage.remainingUses}/{customerPackage.totalUses} left
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No active packages.</p>
                )}
              </>
            ) : (
              <div className="whatsapp-customer-empty">
                <span className="whatsapp-avatar whatsapp-profile-avatar" aria-hidden="true">
                  {selectedConversation ? getConversationAvatarText(selectedConversation) : "WA"}
                </span>
                <strong>No linked customer</strong>
                <p>Save this WhatsApp contact to CRM to view customer details here.</p>
                {selectedConversation ? (
                  <Link
                    className="whatsapp-save-customer-button"
                    href={getSaveCustomerHref(selectedConversation)}
                  >
                    Add customer
                  </Link>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      </section>
    </>
  );
}

async function readInboxConnectorStatus(businessId: string): Promise<ConnectorStatus> {
  try {
    return await getConnectorStatus(businessId);
  } catch {
    return {
      status: "disconnected",
      phoneNumber: null,
      lastSeen: null,
      hasSocket: false,
      reconnectAttempts: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: null,
      lastAckError: null,
      sessionHealth: { ok: false },
    };
  }
}

function formatConnectorStatus(status: ConnectorStatus["status"]) {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "qr") {
    return "Scan QR";
  }

  if (status === "session_expired") {
    return "Session Expired";
  }

  if (status === "connecting" || status === "reconnecting") {
    return "Connecting";
  }

  return "Disconnected";
}

function getChatMessageStatusClass(status: string) {
  return `whatsapp-message-status ${status.toLowerCase()}`;
}

function renderChatMessageStatusIcon(status: string) {
  if (status === "FAILED") {
    return <span className="whatsapp-status-failed-icon">!</span>;
  }

  const tickCount = status === "DELIVERED" || status === "READ" ? 2 : 1;

  return (
    <span className="whatsapp-status-ticks" aria-hidden="true">
      <i />
      {tickCount === 2 ? <i /> : null}
    </span>
  );
}

function getChatMessageStatusLabel(status: string) {
  if (status === "SENT_TO_SERVER") {
    return "Sent";
  }

  if (status === "DELIVERED") {
    return "Delivered";
  }

  if (status === "READ") {
    return "Read";
  }

  if (status === "FAILED") {
    return "Failed";
  }

  return "Sent";
}

function getConnectorStatusMessage(status: ConnectorStatus) {
  if (status.status === "connected") {
    return status.phoneNumber ?? "Connected";
  }

  if (status.status === "qr") {
    return "Scan QR in WhatsApp Settings";
  }

  if (status.status === "session_expired") {
    return "Reconnect WhatsApp in Settings";
  }

  if (status.status === "connecting" || status.status === "reconnecting") {
    return "Connecting to WhatsApp";
  }

  return "Disconnected";
}

function isSelfInternalConversation(
  conversation: {
    customer?: { id?: string | null } | null;
    phone: string;
    remoteJid: string | null;
  },
  connectorPhone: string | null,
) {
  return Boolean(
    !conversation.customer?.id &&
      connectorPhone &&
      conversation.phone === connectorPhone &&
      conversation.remoteJid?.endsWith("@lid"),
  );
}

function formatConversationName(conversation: {
  displayName: string;
  phone: string;
  remoteJid: string | null;
  customer?: { name: string; phone?: string | null } | null;
}) {
  const customerName = conversation.customer?.name?.trim();

  if (customerName) {
    return customerName;
  }

  const displayName = conversation.displayName.trim();
  const visiblePhone = getVisibleConversationPhone(conversation);

  if (isInternalWhatsAppIdentifier(displayName)) {
    return visiblePhone || "Phone not synced";
  }

  if (displayName && displayName !== visiblePhone) {
    return displayName;
  }

  if (visiblePhone) {
    return visiblePhone;
  }

  return "Phone not synced";
}

function getVisibleConversationPhone(conversation: {
  phone: string;
  remoteJid: string | null;
  customer?: { phone?: string | null } | null;
}) {
  const customerPhone = normalizeDisplayPhone(conversation.customer?.phone);

  if (customerPhone) {
    return customerPhone;
  }

  const remoteJidPhone = getPhoneFromRemoteJid(conversation.remoteJid);

  if (remoteJidPhone) {
    return remoteJidPhone;
  }

  const storedPhone = normalizeDisplayPhone(conversation.phone);

  if (storedPhone) {
    return storedPhone;
  }

  return "";
}

function getSaveCustomerHref(conversation: {
  id: string;
  displayName: string;
  phone: string;
  remoteJid: string | null;
  customer?: { name: string; phone?: string | null } | null;
}) {
  const phone = getVisibleConversationPhone(conversation);
  const displayName = formatConversationName(conversation);
  const params = new URLSearchParams({
    whatsappConversationId: conversation.id,
  });

  if (displayName && displayName !== phone && displayName !== "Phone not synced") {
    params.set("name", displayName);
  }

  if (phone) {
    params.set("phone", phone);
  }

  params.set("notes", "Created from WhatsApp inbox.");

  return `/crm/customers/new?${params.toString()}`;
}

function getPhoneFromRemoteJid(remoteJid: string | null) {
  if (!remoteJid?.endsWith("@s.whatsapp.net")) {
    return "";
  }

  const digits = remoteJid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";

  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function normalizeDisplayPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (!digits) {
    return "";
  }

  if (/^60\d{8,11}$/.test(digits) || /^01\d{8,9}$/.test(digits)) {
    return digits;
  }

  return "";
}

function isInternalWhatsAppIdentifier(value: string) {
  return isLikelyWhatsAppInternalId(value, null);
}

function isLikelyWhatsAppInternalId(value: string | null | undefined, remoteJid: string | null) {
  const trimmedValue = value?.trim() ?? "";
  const normalizedValue = trimmedValue.replace(/\D/g, "");

  if (!trimmedValue) {
    return false;
  }

  return Boolean(
    remoteJid?.includes("@lid") ||
      trimmedValue.includes("@lid") ||
      trimmedValue.includes("@s.whatsapp.net") ||
      (/^\d+$/.test(normalizedValue) &&
        normalizedValue.length > 12 &&
        !/^60\d{8,11}$/.test(normalizedValue)),
  );
}

function matchesConversationSearch(
  conversation: {
    displayName: string;
    lastMessageBody: string | null;
    phone: string;
    remoteJid: string | null;
    customer: { email: string | null; name: string; phone: string } | null;
  },
  query: string,
) {
  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchText(query);
  const searchTarget = [
    formatConversationName(conversation),
    getVisibleConversationPhone(conversation),
    conversation.customer?.name,
    conversation.customer?.phone,
    conversation.customer?.email,
    decodeWhatsAppStoredText(conversation.lastMessageBody),
  ]
    .filter(Boolean)
    .join(" ");

  return normalizeSearchText(searchTarget).includes(normalizedQuery);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getConversationHref(conversationId: string, query: string) {
  const params = new URLSearchParams({ conversation: conversationId });

  if (query) {
    params.set("q", query);
  }

  return `/whatsapp/inbox?${params.toString()}`;
}

function compareConversationsByLatestActivity(
  firstConversation: { lastMessageAt: Date | null; updatedAt: Date },
  secondConversation: { lastMessageAt: Date | null; updatedAt: Date },
) {
  if (firstConversation.lastMessageAt && secondConversation.lastMessageAt) {
    return (
      secondConversation.lastMessageAt.getTime() -
      firstConversation.lastMessageAt.getTime()
    );
  }

  if (firstConversation.lastMessageAt) {
    return -1;
  }

  if (secondConversation.lastMessageAt) {
    return 1;
  }

  return secondConversation.updatedAt.getTime() - firstConversation.updatedAt.getTime();
}

function getAvatarText(name: string) {
  const trimmedName = name.trim();

  if (
    !trimmedName ||
    trimmedName.toLowerCase() === "unknown contact" ||
    trimmedName.toLowerCase() === "phone not synced"
  ) {
    return "?";
  }

  if (/^\d+$/.test(trimmedName)) {
    return trimmedName.slice(-2);
  }

  const words = trimmedName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length > 1) {
    return words.map((word) => word[0]).join("").toUpperCase();
  }

  return trimmedName.slice(0, 2).toUpperCase();
}

function getConversationAvatarText(conversation: {
  displayName: string;
  phone: string;
  remoteJid: string | null;
  customer?: { name: string; phone?: string | null } | null;
}) {
  const name = formatConversationName(conversation);

  if (name === "Phone not synced") {
    return "WA";
  }

  return getAvatarText(name);
}

function formatConversationTime(date: Date) {
  const now = new Date();

  if (isSameDate(date, now)) {
    return date.toLocaleTimeString("en-MY", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDate(date, yesterday)) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
  });
}

function formatChatMessageTime(date: Date) {
  return date.toLocaleTimeString("en-MY", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDate(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}
