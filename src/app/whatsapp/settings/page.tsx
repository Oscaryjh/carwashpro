import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import {
  disconnectWhatsAppAction,
  refreshWhatsAppConnectionAction,
  requestWhatsAppQrAction,
} from "./actions";

type WhatsAppSettingsPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function WhatsAppSettingsPage({
  searchParams,
}: WhatsAppSettingsPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
  });
  const status = connection?.status ?? "DISCONNECTED";
  const isConnected = status === "CONNECTED";
  const displayPhoneNumber = isConnected ? connection?.phoneNumber : null;
  const displayLastSeenAt = isConnected ? connection?.lastSeenAt : null;
  const activeQrCodeText =
    status === "QR_REQUIRED" ? connection?.qrCodeText : null;
  const qrCodeDataUrl = activeQrCodeText
    ? await QRCode.toDataURL(activeQrCodeText, {
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
        errorCorrectionLevel: "M",
        margin: 4,
        width: 360,
      })
    : null;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Settings</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            <Link className="secondary-link-button" href="/whatsapp">
              Logs
            </Link>
            <BackButton fallbackHref="/whatsapp" />
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <div className="whatsapp-settings-grid">
          <div className="panel whatsapp-connection-card">
            <div className="section-header">
              <h2>Connection</h2>
              <span className={`status ${status.toLowerCase()}`}>
                {formatStatus(status)}
              </span>
            </div>

            <div className="whatsapp-connection-meta">
              <div>
                <span>Phone number</span>
                <strong>{displayPhoneNumber ?? "Not connected"}</strong>
              </div>
              <div>
                <span>Last seen</span>
                <strong>
                  {displayLastSeenAt ? displayLastSeenAt.toLocaleString() : "-"}
                </strong>
              </div>
            </div>

            <div className="whatsapp-qr-preview" aria-label="WhatsApp QR code">
              {isConnected ? (
                <div className="empty-state">
                  <h3>WhatsApp is connected</h3>
                  <p>You can now open the inbox and chat with customers.</p>
                  <Link className="primary-link-button" href="/whatsapp/inbox">
                    Open Inbox
                  </Link>
                </div>
              ) : qrCodeDataUrl ? (
                <>
                  <Image
                    src={qrCodeDataUrl}
                    alt="WhatsApp login QR code"
                    width={360}
                    height={360}
                    unoptimized
                  />
                  <p>
                    Use WhatsApp Linked devices scanner, not the normal camera.
                    If it still cannot scan, click Generate QR again and scan the
                    fresh code within one minute.
                  </p>
                </>
              ) : (
                <p>Generate a QR code to connect this company WhatsApp number.</p>
              )}
            </div>

            <div className="inline-actions">
              <form action={requestWhatsAppQrAction}>
                <button type="submit">Generate QR</button>
              </form>
              <form action={refreshWhatsAppConnectionAction}>
                <button className="secondary-light-button" type="submit">
                  Refresh status
                </button>
              </form>
              <form action={disconnectWhatsAppAction}>
                <button className="secondary-light-button" type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="section-header">
              <h2>How this works</h2>
            </div>
            <ol className="whatsapp-setup-steps">
              <li>Click Generate QR.</li>
              <li>Use the shop phone WhatsApp to scan the QR.</li>
              <li>Keep this local server running while using the inbox.</li>
              <li>Open WhatsApp Inbox to chat with customers from the system.</li>
            </ol>
            <p className="muted">
              This uses WhatsApp Web login for this local demo. It does not use Meta
              Cloud API, templates, webhooks, or platform-owned phone numbers.
            </p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
