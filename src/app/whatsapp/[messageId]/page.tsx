import Link from "next/link";
import { notFound } from "next/navigation";
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
    },
  });

  if (!message) {
    notFound();
  }

  const deepLink = createWhatsAppDeepLink(message.phone, message.messageBody);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{formatStatus(message.messageType)}</h1>
            <p>{message.phone}</p>
          </div>
          <Link href="/whatsapp">Back to WhatsApp</Link>
        </div>

        <div className="grid">
          <Info label="Status" value={formatStatus(message.status)} />
          <Info label="Provider" value={message.provider ?? "Not sent"} />
          <Info
            label="Provider Message ID"
            value={message.providerMessageId ?? "No provider id"}
          />
          <Info label="Customer" value={message.customer?.name ?? "No customer"} />
          <Info label="Vehicle" value={message.vehicle?.plateNumber ?? "No vehicle"} />
          <Info
            label="Related"
            value={message.invoice?.invoiceNumber ?? message.workOrder?.orderNumber ?? "Customer"}
          />
        </div>

        <div className="panel">
          <h2>Pipeline</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <PipelineRow label="Log" active timestamp={message.createdAt} />
              <PipelineRow label="Queue" active={!!message.queuedAt} timestamp={message.queuedAt} />
              <PipelineRow label="Twilio / Meta API" active={!!message.sentAt} timestamp={message.sentAt} />
              <PipelineRow
                label="Delivery Status"
                active={!!message.deliveredAt}
                timestamp={message.deliveredAt}
              />
              <PipelineRow label="Read Status" active={!!message.readAt} timestamp={message.readAt} />
              {message.failedAt ? (
                <PipelineRow label="Failed" active timestamp={message.failedAt} />
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
            {deepLink}
          </p>
          <div className="inline-actions">
            <a href={deepLink} target="_blank" rel="noreferrer">
              Open WhatsApp
            </a>
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
