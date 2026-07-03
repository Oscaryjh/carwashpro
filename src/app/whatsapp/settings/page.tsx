import Link from "next/link";
import QRCode from "qrcode";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { WhatsAppSendTestForm } from "@/components/whatsapp-send-test-form";
import { WhatsAppSettingsAutoRefresh } from "@/components/whatsapp-settings-auto-refresh";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import {
  disconnectWhatsAppAction,
  refreshWhatsAppConnectionAction,
  requestWhatsAppPairingCodeAction,
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
    !isConnected && connection?.qrCodeText ? connection.qrCodeText : null;
  const activePairingPhone =
    !isConnected && connection?.pairingPhone ? connection.pairingPhone : null;
  const activePairingCodeText =
    !isConnected && connection?.pairingCodeText
      ? connection.pairingCodeText
      : null;
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
  const isWaitingForQr =
    !isConnected &&
    status === "QR_REQUIRED" &&
    !activePairingPhone &&
    !qrCodeDataUrl;
  const isWaitingForPairing =
    !isConnected &&
    status === "QR_REQUIRED" &&
    Boolean(activePairingPhone) &&
    !activePairingCodeText &&
    !qrCodeDataUrl;
  const shouldAutoRefresh = isWaitingForQr || isWaitingForPairing;
  const messageSaysQrReady =
    message?.toLowerCase().includes("qr") &&
    message.toLowerCase().includes("ready");
  const messageSaysPairingReady =
    message?.toLowerCase().includes("pairing") &&
    message.toLowerCase().includes("ready");
  const staleQrReadyMessage =
    Boolean(messageSaysQrReady) &&
    !qrCodeDataUrl &&
    !isConnected &&
    status !== "QR_REQUIRED";
  const stalePairingReadyMessage =
    Boolean(messageSaysPairingReady) &&
    !activePairingCodeText &&
    !isConnected &&
    status !== "QR_REQUIRED";
  let displayMessage = message;
  if (messageSaysPairingReady && !activePairingCodeText && !isConnected) {
    displayMessage =
      status === "QR_REQUIRED"
        ? "WhatsApp pairing code is being prepared. This page will refresh automatically."
        : "WhatsApp pairing code is no longer available. Request a fresh code.";
  } else if (messageSaysQrReady && !qrCodeDataUrl && !isConnected) {
    displayMessage =
      status === "QR_REQUIRED"
        ? "WhatsApp QR is being prepared. This page will refresh automatically."
        : "WhatsApp QR is no longer available. Click Generate QR to create a fresh code.";
  }
  const displayMessageType =
    staleQrReadyMessage || stalePairingReadyMessage ? "error" : messageType;

  return (
    <AppShell user={user}>
      <WhatsAppSettingsAutoRefresh enabled={shouldAutoRefresh} />
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

        {displayMessage ? (
          <div className={displayMessageType}>{displayMessage}</div>
        ) : null}

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
              ) : activePairingCodeText ? (
                <div className="whatsapp-pairing-code-card">
                  <span>Phone pairing code</span>
                  <strong>{formatPairingCode(activePairingCodeText)}</strong>
                  <p>
                    This code only works for {activePairingPhone}. On that exact
                    shop phone, open WhatsApp Linked devices, choose Link with
                    phone number instead, then enter this code within 60 seconds.
                  </p>
                </div>
              ) : qrCodeDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeDataUrl}
                    alt="WhatsApp login QR code"
                    width={360}
                    height={360}
                    className="whatsapp-qr-image"
                  />
                  <p>
                    Use WhatsApp Linked devices scanner, not the normal camera.
                    If it still cannot scan, click Generate QR again and scan the
                    fresh code within one minute.
                  </p>
                </>
              ) : isWaitingForPairing ? (
                <div className="empty-state">
                  <h3>Preparing phone pairing code</h3>
                  <p>
                    Keep this page open. The code will appear here automatically
                    when WhatsApp returns it.
                  </p>
                </div>
              ) : isWaitingForQr ? (
                <div className="empty-state">
                  <h3>Preparing WhatsApp QR</h3>
                  <p>
                    Keep this page open. A fresh QR code will appear here
                    automatically when the worker receives it.
                  </p>
                </div>
              ) : (
                <p>Generate a QR code to connect this company WhatsApp number.</p>
              )}
            </div>

            {!isConnected ? (
              <form
                action={requestWhatsAppPairingCodeAction}
                className="whatsapp-pairing-form"
              >
                <label htmlFor="pairingPhone">Use phone pairing code</label>
                <div className="whatsapp-pairing-row">
                  <input
                    id="pairingPhone"
                    name="pairingPhone"
                    defaultValue={activePairingPhone ?? ""}
                    inputMode="numeric"
                    pattern="[0-9+ ]*"
                    placeholder="601112212259"
                  />
                  <button className="secondary-light-button" type="submit">
                    Get pairing code
                  </button>
                </div>
                <p>
                  Enter the shop WhatsApp number currently logged in on the phone,
                  not a customer number. Then open WhatsApp Linked devices and
                  choose Link with phone number instead.
                </p>
              </form>
            ) : null}

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

        <WhatsAppSendTestForm />
      </section>
    </AppShell>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatPairingCode(code: string) {
  return code.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}
