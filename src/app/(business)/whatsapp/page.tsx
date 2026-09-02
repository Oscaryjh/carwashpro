import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import {
  assertStaffPermission,
  hasStaffPermission,
} from "@/lib/auth/staff-permissions";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";
import { createWhatsAppDeepLink, normalizeWhatsAppPhone } from "@/lib/whatsapp/deep-link";
import {
  cancelWhatsAppMessageAction,
  markWhatsAppMessageSentAction,
} from "./actions";

export default async function WhatsAppPage() {
  const { user, businessId } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP");
  const canManageWhatsAppSession = hasStaffPermission(user, "WHATSAPP_SESSION");
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
  const messages = await prisma.whatsAppMessage.findMany({
    where: { businessId, ...operationalBranchWhere },
    include: {
      customer: true,
      workOrder: true,
      invoice: true,
      sentByUser: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            {canManageWhatsAppSession ? (
              <Link className="secondary-link-button" href="/whatsapp/settings">
                Settings
              </Link>
            ) : null}
          </div>
        </div>

        <div className="panel">
          {messages.length ? (
            <table className="table whatsapp-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Message</th>
                  <th>Contact</th>
                  <th>Related</th>
                  <th>Status</th>
                  <th>Timeline</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message, index) => (
                  <tr key={message.id}>
                    {(() => {
                      const recipientPhone = message.recipientPhone ?? message.phone;
                      const normalizedRecipientPhone = normalizeWhatsAppPhone(recipientPhone ?? "");
                      const deepLink = normalizedRecipientPhone
                        ? createWhatsAppDeepLink(normalizedRecipientPhone, message.messageBody)
                        : null;

                      return (
                        <>
                    <td>
                      <span className="table-number">{index + 1}</span>
                    </td>
                    <td>
                      <strong>{formatStatus(message.messageType)}</strong>
                      <div className="muted message-line">
                        {message.messageBody.slice(0, 86)}
                        {message.messageBody.length > 86 ? "..." : ""}
                      </div>
                    </td>
                    <td>
                      <strong>{message.customer?.name ?? "No customer"}</strong>
                      <div className="muted">
                        {recipientPhone || "No phone"}
                      </div>
                    </td>
                    <td>
                      <RelatedLink message={message} />
                    </td>
                    <td>
                      <span className={`status ${message.status.toLowerCase()}`}>
                        {formatStatus(message.status)}
                      </span>
                      <div className="muted">
                        {message.sentByUser?.name ?? "Manual user"}
                      </div>
                    </td>
                    <td>
                      <div>{message.createdAt.toLocaleString("en-MY")}</div>
                      <div className="muted">{latestEventLabel(message)}</div>
                    </td>
                    <td>
                      <div className="whatsapp-actions">
                        {deepLink ? (
                          <a
                            className="button-link compact-action"
                            href={deepLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open WA
                          </a>
                        ) : (
                          <span className="secondary-light-button compact-action disabled-link">
                            No phone
                          </span>
                        )}
                        <Link
                          className="secondary-link-button compact-action"
                          href={`/whatsapp/${message.id}`}
                        >
                          View
                        </Link>
                        <MessageActions message={message} />
                      </div>
                    </td>
                        </>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No WhatsApp messages yet.</p>
          )}
        </div>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function MessageActions({
  message,
}: {
  message: {
    id: string;
    status: string;
  };
}) {
  return (
    <>
      {["OPENED", "DRAFT"].includes(message.status) ? (
        <MessageAction
          action={markWhatsAppMessageSentAction}
          messageId={message.id}
          label="Mark Sent"
        />
      ) : null}
      {["OPENED", "DRAFT"].includes(message.status) ? (
        <MessageAction
          action={cancelWhatsAppMessageAction}
          messageId={message.id}
          label="Cancel"
          secondary
        />
      ) : null}
    </>
  );
}

function MessageAction({
  action,
  messageId,
  label,
  secondary = false,
}: {
  action: (formData: FormData) => Promise<void>;
  messageId: string;
  label: string;
  secondary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="messageId" value={messageId} />
      <button
        className={secondary ? "secondary-light-button compact-action" : "compact-action"}
        type="submit"
      >
        {label}
      </button>
    </form>
  );
}

function RelatedLink({
  message,
}: {
  message: {
    workOrder: { id: string; orderNumber: string } | null;
    invoice: { id: string; invoiceNumber: string } | null;
  };
}) {
  if (message.invoice) {
    return (
      <Link href={`/invoices/${message.invoice.id}`}>
        {formatInvoiceNumber(message.invoice.invoiceNumber)}
      </Link>
    );
  }

  if (message.workOrder) {
    return (
      <Link href={`/work-orders/${message.workOrder.id}`}>
        {message.workOrder.orderNumber}
      </Link>
    );
  }

  return <span className="muted">Customer</span>;
}

function latestEventLabel(message: {
  deliveredAt: Date | null;
  readAt: Date | null;
  openedAt: Date | null;
  sentAt: Date | null;
}) {
  if (message.readAt) {
    return `Read ${message.readAt.toLocaleString("en-MY")}`;
  }

  if (message.deliveredAt) {
    return `Delivered ${message.deliveredAt.toLocaleString("en-MY")}`;
  }

  if (message.sentAt) {
    return `Sent to WhatsApp ${message.sentAt.toLocaleString("en-MY")}`;
  }

  if (message.openedAt) {
    return `Opened ${message.openedAt.toLocaleString("en-MY")}`;
  }

  return "Manual deep link";
}
