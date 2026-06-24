import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { createWhatsAppDeepLink } from "@/lib/whatsapp/deep-link";
import { markWhatsAppMessageSentAction } from "../actions";

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
          <Info label="Customer" value={message.customer?.name ?? "No customer"} />
          <Info label="Vehicle" value={message.vehicle?.plateNumber ?? "No vehicle"} />
          <Info
            label="Related"
            value={message.invoice?.invoiceNumber ?? message.workOrder?.orderNumber ?? "Customer"}
          />
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
            {message.status !== "SENT" ? (
              <form action={markWhatsAppMessageSentAction}>
                <input type="hidden" name="messageId" value={message.id} />
                <button type="submit">Mark as Sent</button>
              </form>
            ) : null}
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
