import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { WhatsAppInboxAutoRefresh } from "@/components/whatsapp-inbox-auto-refresh";
import { WhatsAppMessageAutoScroll } from "@/components/whatsapp-message-auto-scroll";
import { WhatsAppReplyForm } from "@/components/whatsapp-reply-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { mergeDuplicateWhatsAppConversations } from "@/lib/whatsapp/conversation-merge";
import { decodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";
import {
  refreshWhatsAppInboxConnectionAction,
  syncCrmCustomersToWhatsAppAction,
} from "./actions";

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
  const { user, businessId } = await requireBusinessUser();
  const params = await searchParams;
  const message = params.message;
  const query = params.q?.trim() ?? "";
  const messageType = params.type === "error" ? "error" : "success";
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
  });

  await mergeDuplicateWhatsAppConversations(businessId);

  const rawConversations = await prisma.whatsAppConversation.findMany({
    where: { businessId },
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
    .sort(compareConversationsByLatestActivity)
    .slice(0, 50);
  const filteredConversations = conversations.filter((conversation) =>
    matchesConversationSearch(conversation, query),
  );

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
    <AppShell user={user}>
      <WhatsAppInboxAutoRefresh enabled={connection?.status === "CONNECTED"} />
      <section className="content whatsapp-inbox-page">
        <div className="page-header">
          <div>
            <h1>WhatsApp Inbox</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp">
              Logs
            </Link>
            <Link className="secondary-link-button" href="/whatsapp/settings">
              Settings
            </Link>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="whatsapp-connection-strip">
          <span className={`status ${(connection?.status ?? "DISCONNECTED").toLowerCase()}`}>
            {formatStatus(connection?.status ?? "DISCONNECTED")}
          </span>
          <strong>{connection?.phoneNumber ?? "No shop WhatsApp connected"}</strong>
          <div className="inline-actions">
            <form action={refreshWhatsAppInboxConnectionAction}>
              {selectedConversation ? (
                <input
                  type="hidden"
                  name="conversationId"
                  value={selectedConversation.id}
                />
              ) : null}
              <button className="secondary-light-button compact-link-button" type="submit">
                Refresh
              </button>
            </form>
            <form action={syncCrmCustomersToWhatsAppAction}>
              <button className="secondary-light-button compact-link-button" type="submit">
                Sync customers
              </button>
            </form>
            <Link href="/whatsapp/settings">Connection settings</Link>
          </div>
        </div>

        <div className="whatsapp-inbox-layout">
          <aside className="panel whatsapp-chat-list">
            <div className="section-header">
              <h2>Chats</h2>
              <span className="muted">
                {query
                  ? `${filteredConversations.length}/${conversations.length}`
                  : conversations.length}
              </span>
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
                <Link className="secondary-light-button compact-link-button" href="/whatsapp/inbox">
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
                  : "No WhatsApp conversations yet. Click Sync customers to bring CRM contacts here, or wait for WhatsApp history/new messages to sync."}
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
                    </div>
                  </div>
                  {selectedConversation.customer ? (
                    <Link href={`/crm/customers/${selectedConversation.customer.id}`}>
                      Open customer
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
                        {chatMessage.messageType === "AUDIO" ? (
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
                              <a
                                href={chatMessage.mediaUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {chatMessage.mediaFileName ?? "Open document"}
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <p>{decodeWhatsAppStoredText(chatMessage.body)}</p>
                        )}
                        <span>
                          {chatMessage.createdAt.toLocaleString()}
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
                  conversationId={selectedConversation.id}
                  disabled={connection?.status !== "CONNECTED"}
                />
              </>
            ) : (
              <p className="empty-state">Select a chat to view messages.</p>
            )}
          </main>

          <aside className="panel whatsapp-customer-side">
            <div className="section-header">
              <h2>Customer</h2>
            </div>
            {selectedConversation?.customer ? (
              <>
                <strong>{selectedConversation.customer.name}</strong>
                <span>{selectedConversation.customer.phone}</span>
                <span>{selectedConversation.customer.email ?? "No email"}</span>

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
              <p className="empty-state">No linked customer.</p>
            )}
          </aside>
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
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

  if (isInternalWhatsAppIdentifier(displayName, conversation.remoteJid)) {
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

  if (storedPhone && !isLikelyWhatsAppInternalId(conversation.phone, conversation.remoteJid)) {
    return storedPhone;
  }

  return "";
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

function isInternalWhatsAppIdentifier(value: string, remoteJid: string | null) {
  return isLikelyWhatsAppInternalId(value, remoteJid);
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

function isSameDate(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}
