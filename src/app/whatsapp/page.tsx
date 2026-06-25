import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { createWhatsAppDeepLink } from "@/lib/whatsapp/deep-link";
import {
  markWhatsAppMessageDeliveredAction,
  markWhatsAppMessageFailedAction,
  markWhatsAppMessageReadAction,
  markWhatsAppMessageSentAction,
  queueWhatsAppMessageAction,
} from "./actions";

export default async function WhatsAppPage() {
  const { user, businessId } = await requireBusinessUser();
  const messages = await prisma.whatsAppMessage.findMany({
    where: { businessId },
    include: {
      customer: true,
      workOrder: true,
      invoice: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp</h1>
            <p>Log, queue, provider handoff, delivery status, and read status.</p>
          </div>
        </div>

        <div className="panel">
          {messages.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Related</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td>{formatStatus(message.messageType)}</td>
                    <td>{message.customer?.name ?? "No customer"}</td>
                    <td>{message.phone}</td>
                    <td>{relatedLabel(message)}</td>
                    <td>
                      <span className={`status ${message.status.toLowerCase()}`}>
                        {formatStatus(message.status)}
                      </span>
                    </td>
                    <td>{message.provider ?? "Not sent"}</td>
                    <td>{message.createdAt.toLocaleString()}</td>
                    <td>
                      <div className="inline-actions">
                        <a
                          href={createWhatsAppDeepLink(
                            message.phone,
                            message.messageBody,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open WhatsApp
                        </a>
                        <Link href={`/whatsapp/${message.id}`}>View</Link>
                        <MessageActions message={message} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No WhatsApp messages yet.</p>
          )}
        </div>
      </section>
    </AppShell>
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
      {["DRAFT", "READY", "FAILED"].includes(message.status) ? (
        <MessageAction
          action={queueWhatsAppMessageAction}
          messageId={message.id}
          label="Queue"
        />
      ) : null}
      {!["READ", "FAILED"].includes(message.status) ? (
        <MessageAction
          action={markWhatsAppMessageSentAction}
          messageId={message.id}
          label="Mark Sent"
        />
      ) : null}
      {["SENT", "DELIVERED"].includes(message.status) ? (
        <MessageAction
          action={markWhatsAppMessageDeliveredAction}
          messageId={message.id}
          label="Delivered"
        />
      ) : null}
      {["SENT", "DELIVERED"].includes(message.status) ? (
        <MessageAction
          action={markWhatsAppMessageReadAction}
          messageId={message.id}
          label="Read"
        />
      ) : null}
      {message.status !== "READ" && message.status !== "FAILED" ? (
        <form action={markWhatsAppMessageFailedAction}>
          <input type="hidden" name="messageId" value={message.id} />
          <input type="hidden" name="errorMessage" value="Manual failure mark." />
          <button className="secondary-light-button" type="submit">
            Failed
          </button>
        </form>
      ) : null}
    </>
  );
}

function MessageAction({
  action,
  messageId,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  messageId: string;
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="messageId" value={messageId} />
      <button type="submit">{label}</button>
    </form>
  );
}

function relatedLabel(message: {
  workOrder: { orderNumber: string } | null;
  invoice: { invoiceNumber: string } | null;
}) {
  if (message.invoice) {
    return message.invoice.invoiceNumber;
  }

  if (message.workOrder) {
    return message.workOrder.orderNumber;
  }

  return "Customer";
}
