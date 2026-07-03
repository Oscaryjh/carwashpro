import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";
import { createWhatsAppDeepLink, normalizeWhatsAppPhone } from "@/lib/whatsapp/deep-link";
import {
  cancelWhatsAppMessageAction,
  markWhatsAppMessageSentAction,
} from "../actions";

type WhatsAppDetailsPageProps = {
  params: Promise<{
    messageId: string;
  }>;
};

export default async function WhatsAppDetailsPage({
  params,
}: WhatsAppDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { messageId } = await params;
  const message = await prisma.whatsAppMessage.findFirst({
    where: {
      id: messageId,
      businessId,
    },
    include: {
      customer: true,
      vehicle: true,
      workOrder: true,
      invoice: true,
      sentByUser: true,
    },
  });

  if (!message) {
    notFound();
  }

  const recipientPhone = message.recipientPhone ?? message.phone;
  const normalizedRecipientPhone = normalizeWhatsAppPhone(recipientPhone ?? "");
  const deepLink = normalizedRecipientPhone
    ? createWhatsAppDeepLink(normalizedRecipientPhone, message.messageBody)
    : null;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{formatStatus(message.messageType)}</h1>
            <p>{recipientPhone || "No recipient phone"}</p>
          </div>
          <BackButton fallbackHref="/whatsapp" />
        </div>

        <div className="grid">
          <Info label="Status" value={formatStatus(message.status)} />
          <Info label="Sender" value={message.sentByUser?.name ?? "Manual user"} />
          <Info label="Sender WhatsApp" value={message.senderPhone ?? "Not set"} />
          <Info label="Recipient" value={recipientPhone || "No phone"} />
          <Info label="Customer" value={message.customer?.name ?? "No customer"} />
          <Info label="Vehicle" value={message.vehicle?.plateNumber ?? "No vehicle"} />
          <Info
            label="Related"
            value={
              message.invoice
                ? formatInvoiceNumber(message.invoice.invoiceNumber)
                : message.workOrder?.orderNumber ?? "Customer"
            }
          />
        </div>

        <div className="panel">
          <h2>Manual WhatsApp timeline</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <PipelineRow label="Log created" active timestamp={message.createdAt} />
              <PipelineRow label="WhatsApp opened" active={!!message.openedAt} timestamp={message.openedAt} />
              <PipelineRow label="Sent manually" active={!!message.sentAt} timestamp={message.sentAt} />
              {message.status === "CANCELLED" ? (
                <PipelineRow label="Cancelled" active timestamp={message.updatedAt} />
              ) : null}
            </tbody>
          </table>
          {message.errorMessage ? (
            <p className="error">{message.errorMessage}</p>
          ) : null}
        </div>

        <div className="panel">
          <h2>Message body</h2>
          <pre className="message-preview">{message.messageBody}</pre>
        </div>

        <div className="panel">
          <h2>Deep link</h2>
          <p className="muted" style={{ overflowWrap: "anywhere" }}>
            {deepLink ?? "No recipient phone. Please update the customer phone before opening WhatsApp."}
          </p>
          <div className="inline-actions">
            {deepLink ? (
              <a href={deepLink} target="_blank" rel="noreferrer">
                Open WhatsApp
              </a>
            ) : null}
            <MessageActions message={message} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function PipelineRow({
  label,
  active,
  timestamp,
}: {
  label: string;
  active: boolean;
  timestamp: Date | null;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td>{active ? "Complete" : "Pending"}</td>
      <td>{timestamp ? timestamp.toLocaleString() : "-"}</td>
    </tr>
  );
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
      <button className={secondary ? "secondary-light-button" : ""} type="submit">
        {label}
      </button>
    </form>
  );
}
