import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { createWhatsAppDeepLink } from "@/lib/whatsapp/deep-link";
import { markWhatsAppMessageSentAction } from "./actions";

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
            <p>Message logs ready for manual WhatsApp sending.</p>
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
                        {message.status !== "SENT" ? (
                          <form action={markWhatsAppMessageSentAction}>
                            <input type="hidden" name="messageId" value={message.id} />
                            <button type="submit">Mark as Sent</button>
                          </form>
                        ) : null}
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
