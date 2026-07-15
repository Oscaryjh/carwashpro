import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  getConnectorJidLookup,
  type ConnectorJidLookup,
} from "@/lib/whatsapp/connector-client";
import { decodeWhatsAppStoredText } from "@/lib/whatsapp/message-codec";

type ConversationDiagnostic = {
  id: string;
  displayName: string;
  phone: string;
  remoteJid: string | null;
  customer: {
    name: string;
    phone: string;
  } | null;
  lastMessageBody: string | null;
  lastMessageAt: Date | null;
  contactState: "READY" | "ACK_463" | "LID" | "NOT_SYNCED" | "UNKNOWN";
  jidType: "PHONE_JID" | "LID" | "MISSING";
  visiblePhone: string;
  lastSendStatus: string | null;
  lastAckError: string | null;
  lookup: ConnectorJidLookup | null;
  lookupError: string | null;
};

export default async function WhatsAppContactDiagnosticsPage() {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { businessId },
    include: {
      customer: {
        select: {
          name: true,
          phone: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const recentMessages = await prisma.whatsAppMessage.findMany({
    where: {
      businessId,
      messageType: "INBOX_REPLY",
    },
    include: {
      queueItems: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const diagnostics = await buildDiagnostics(businessId, conversations, recentMessages);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Contact Diagnostics</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            <Link className="secondary-link-button" href="/whatsapp/settings">
              Settings
            </Link>
            <BackButton fallbackHref="/whatsapp/inbox" />
          </div>
        </div>

        <div className="panel">
          <table className="table whatsapp-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>JID</th>
                <th>Customer</th>
                <th>Lookup</th>
                <th>Last Send</th>
                <th>Diagnosis</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.displayName}</strong>
                    <div className="muted">{item.visiblePhone || item.phone}</div>
                    <div className="muted message-line">
                      {decodeWhatsAppStoredText(item.lastMessageBody) || "-"}
                    </div>
                  </td>
                  <td>
                    <span className={`status ${statusClass(item.jidType)}`}>
                      {formatJidType(item.jidType)}
                    </span>
                    <div className="muted message-line">
                      {item.remoteJid || "No remote JID"}
                    </div>
                  </td>
                  <td>
                    <strong>{item.customer?.name ?? "Not linked"}</strong>
                    <div className="muted">{item.customer?.phone ?? "-"}</div>
                  </td>
                  <td>
                    {item.lookup ? (
                      <>
                        <span
                          className={`status ${
                            item.lookup.exists ? "connected" : "error"
                          }`}
                        >
                          {item.lookup.exists ? "Exists" : "Not found"}
                        </span>
                        <div className="muted message-line">
                          {item.lookup.jid ?? item.lookup.fallbackJid}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="status inactive">
                          {item.lookupError ? "Lookup failed" : "Not checked"}
                        </span>
                        <div className="muted message-line">
                          {item.lookupError ?? "LID conversations cannot use phone lookup."}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={`status ${statusClass(item.lastSendStatus)}`}>
                      {item.lastSendStatus ?? "No send"}
                    </span>
                    <div className="muted message-line">
                      {item.lastAckError ?? "No ACK error"}
                    </div>
                  </td>
                  <td>
                    <strong>{formatContactState(item.contactState)}</strong>
                    <div className="muted message-line">
                      {getRecommendation(item)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

async function buildDiagnostics(
  businessId: string,
  conversations: Array<{
    id: string;
    displayName: string;
    phone: string;
    remoteJid: string | null;
    lastMessageBody: string | null;
    lastMessageAt: Date | null;
    customer: { name: string; phone: string } | null;
  }>,
  recentMessages: Array<{
    phone: string;
    recipientPhone: string | null;
    status: string;
    errorMessage: string | null;
    queueItems: Array<{
      status: string;
      errorMessage: string | null;
    }>;
  }>,
): Promise<ConversationDiagnostic[]> {
  return Promise.all(
    conversations.map(async (conversation) => {
      const visiblePhone = getVisibleConversationPhone(conversation);
      const jidType = getJidType(conversation.remoteJid);
      const lastSend = findLastSend(conversation, recentMessages);
      const lookup = await lookupPhoneJid(businessId, jidType, visiblePhone);
      const lastSendStatus = lastSend?.queueItems[0]?.status ?? lastSend?.status ?? null;
      const lastAckError =
        lastSend?.queueItems[0]?.errorMessage ?? lastSend?.errorMessage ?? null;

      return {
        id: conversation.id,
        displayName: formatConversationName(conversation),
        phone: conversation.phone,
        remoteJid: conversation.remoteJid,
        customer: conversation.customer,
        lastMessageBody: conversation.lastMessageBody,
        lastMessageAt: conversation.lastMessageAt,
        jidType,
        visiblePhone,
        lastSendStatus,
        lastAckError,
        lookup: lookup.data,
        lookupError: lookup.error,
        contactState: getContactState({
          customer: conversation.customer,
          jidType,
          lastAckError,
          lookup: lookup.data,
        }),
      };
    }),
  );
}

async function lookupPhoneJid(
  businessId: string,
  jidType: ConversationDiagnostic["jidType"],
  phone: string,
) {
  if (jidType !== "PHONE_JID" || !phone) {
    return { data: null, error: null };
  }

  try {
    return {
      data: await getConnectorJidLookup(businessId, phone),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to verify JID.",
    };
  }
}

function findLastSend(
  conversation: {
    phone: string;
    remoteJid: string | null;
    customer: { phone: string } | null;
  },
  messages: Array<{
    phone: string;
    recipientPhone: string | null;
    status: string;
    errorMessage: string | null;
    queueItems: Array<{
      status: string;
      errorMessage: string | null;
    }>;
  }>,
) {
  const candidates = new Set(
    [
      conversation.phone,
      conversation.remoteJid,
      getPhoneFromRemoteJid(conversation.remoteJid),
      normalizeMalaysiaPhone(conversation.customer?.phone),
    ].filter((value): value is string => Boolean(value)),
  );

  return messages.find(
    (message) =>
      candidates.has(message.phone) ||
      (message.recipientPhone ? candidates.has(message.recipientPhone) : false),
  );
}

function getContactState(input: {
  customer: { name: string; phone: string } | null;
  jidType: ConversationDiagnostic["jidType"];
  lastAckError: string | null;
  lookup: ConnectorJidLookup | null;
}): ConversationDiagnostic["contactState"] {
  if (input.lastAckError?.includes("WHATSAPP_ACK_ERROR_463")) {
    return "ACK_463";
  }

  if (input.jidType === "LID") {
    return input.customer ? "READY" : "LID";
  }

  if (!input.customer) {
    return "NOT_SYNCED";
  }

  if (input.lookup && !input.lookup.exists) {
    return "NOT_SYNCED";
  }

  return "READY";
}

function getJidType(remoteJid: string | null): ConversationDiagnostic["jidType"] {
  if (remoteJid?.endsWith("@s.whatsapp.net")) {
    return "PHONE_JID";
  }

  if (remoteJid?.endsWith("@lid")) {
    return "LID";
  }

  return "MISSING";
}

function getRecommendation(item: ConversationDiagnostic) {
  if (item.contactState === "ACK_463") {
    return "Ask customer to message first, then reply from Inbox.";
  }

  if (item.contactState === "LID") {
    return "LID chat is received, but not linked to a CRM customer.";
  }

  if (item.contactState === "NOT_SYNCED") {
    return "Link this chat to a CRM customer or verify the phone number.";
  }

  if (item.contactState === "READY") {
    return "Ready for normal two-way messaging.";
  }

  return "Needs more WhatsApp activity before sending.";
}

function formatContactState(state: ConversationDiagnostic["contactState"]) {
  if (state === "ACK_463") {
    return "Needs first message";
  }

  if (state === "LID") {
    return "LID not linked";
  }

  if (state === "NOT_SYNCED") {
    return "Not synced";
  }

  if (state === "READY") {
    return "Ready";
  }

  return "Unknown";
}

function formatJidType(type: ConversationDiagnostic["jidType"]) {
  if (type === "PHONE_JID") {
    return "Phone JID";
  }

  if (type === "LID") {
    return "LID";
  }

  return "Missing";
}

function statusClass(value: string | null) {
  const normalized = value?.toLowerCase() ?? "";

  if (
    normalized.includes("read") ||
    normalized.includes("delivered") ||
    normalized.includes("sent") ||
    normalized === "phone_jid"
  ) {
    return "connected";
  }

  if (normalized.includes("failed") || normalized === "missing") {
    return "error";
  }

  if (normalized === "lid") {
    return "qr_required";
  }

  return "inactive";
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

  if (isLikelyWhatsAppInternalId(displayName, conversation.remoteJid)) {
    return visiblePhone || "Phone not synced";
  }

  return displayName || visiblePhone || "Phone not synced";
}

function getVisibleConversationPhone(conversation: {
  phone: string;
  remoteJid: string | null;
  customer?: { phone?: string | null } | null;
}) {
  return (
    normalizeMalaysiaPhone(conversation.customer?.phone) ||
    getPhoneFromRemoteJid(conversation.remoteJid) ||
    (!isLikelyWhatsAppInternalId(conversation.phone, conversation.remoteJid)
      ? normalizeMalaysiaPhone(conversation.phone)
      : "")
  );
}

function getPhoneFromRemoteJid(remoteJid: string | null) {
  if (!remoteJid?.endsWith("@s.whatsapp.net")) {
    return "";
  }

  const digits = remoteJid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";

  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function normalizeMalaysiaPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (!digits) {
    return "";
  }

  if (digits.startsWith("0")) {
    return `60${digits.slice(1)}`;
  }

  if (/^60\d{8,11}$/.test(digits)) {
    return digits;
  }

  return "";
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
