import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { WhatsAppSettingsAutoRefresh } from "@/components/whatsapp-settings-auto-refresh";
import { WhatsAppSessionRecovery } from "@/components/whatsapp-settings-session-recovery";
import { requireBusinessUser } from "@/lib/auth/business-user";
import {
  getConnectorStatus,
  getConnectorQrProxyPath,
  type ConnectorStatus,
} from "@/lib/whatsapp/connector-client";
import {
  logoutWhatsAppAction,
  reconnectWhatsAppAction,
  refreshWhatsAppConnectionAction,
} from "./actions";
import { syncCrmCustomersToWhatsAppAction } from "../inbox/actions";

type WhatsAppSettingsPageProps = {
  searchParams: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function WhatsAppSettingsPage({
  searchParams,
}: WhatsAppSettingsPageProps) {
  const { businessId, user } = await requireBusinessUser();
  const params = await searchParams;
  const message = params.message;
  const messageType = params.type === "error" ? "error" : "success";
  const connectorState = await readConnectorState(businessId);
  const status = connectorState.status.status;
  const isConnected = status === "connected";
  const isQr = status === "qr";
  const shouldAutoRefresh =
    status === "qr" ||
    status === "connecting" ||
    status === "reconnecting" ||
    status === "starting";
  const qrImageUrl = `${getConnectorQrProxyPath()}?refresh=${Date.now()}`;
  const sessionWarning =
    connectorState.status.sessionHealth.ok === false
      ? connectorState.status.sessionHealth.message ??
        "Your WhatsApp session may have expired. Please reconnect your WhatsApp."
      : status === "session_expired"
        ? "Your WhatsApp session may have expired. Please reconnect your WhatsApp."
        : null;
  const statusMessage = connectorState.errorMessage
    ? connectorState.errorMessage
    : message;
  const statusMessageType = connectorState.errorMessage ? "error" : messageType;

  return (
    <AppShell user={user}>
      <WhatsAppSettingsAutoRefresh enabled={shouldAutoRefresh} status={status} />
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Settings</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            <BackButton fallbackHref="/whatsapp" />
          </div>
        </div>

        {statusMessage ? (
          <div className={statusMessageType}>{statusMessage}</div>
        ) : null}
        <WhatsAppSessionRecovery
          lastAckErrorAt={connectorState.status.lastAckError?.at ?? null}
          lastDisconnectedAt={connectorState.status.lastDisconnectedAt}
          reconnectAttempts={connectorState.status.reconnectAttempts}
          status={status}
        />
        {sessionWarning ? <div className="error">{sessionWarning}</div> : null}

        <div className="whatsapp-settings-grid">
          <div className="panel whatsapp-connection-card">
            <div className="section-header">
              <h2>Connection</h2>
              <span className={`status ${status}`}>{formatStatus(status)}</span>
            </div>

            <div className="whatsapp-connection-meta">
              <div>
                <span>Phone number</span>
                <strong>
                  {connectorState.status.phoneNumber ?? "Not connected"}
                </strong>
              </div>
            </div>

            <div className="whatsapp-qr-preview" aria-label="WhatsApp QR code">
              {isConnected ? (
                <div className="empty-state">
                  <h3>Connected</h3>
                  <p>You can now open the inbox and chat with customers.</p>
                  <Link className="primary-link-button" href="/whatsapp/inbox">
                    Open Inbox
                  </Link>
                </div>
              ) : isQr ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrImageUrl}
                    alt="WhatsApp login QR code"
                    width={360}
                    height={360}
                    className="whatsapp-qr-image"
                  />
                  <p>Use WhatsApp Linked devices to scan this QR code.</p>
                </>
              ) : status === "connecting" || status === "reconnecting" ? (
                <div className="empty-state">
                  <h3>{formatStatus(status)}</h3>
                  <p>Waiting for WhatsApp to establish the session.</p>
                </div>
              ) : status === "session_expired" ? (
                <div className="empty-state">
                  <h3>Session Expired</h3>
                  <p>
                    WashFlow will try to reconnect once. If QR appears, scan it
                    from WhatsApp Linked devices.
                  </p>
                </div>
              ) : (
                <div className="empty-state">
                  <h3>{formatStatus(status)}</h3>
                  <p>Reconnect WhatsApp to request a fresh QR code.</p>
                </div>
              )}
            </div>

            <div className="inline-actions">
              <form action={refreshWhatsAppConnectionAction}>
                <button className="secondary-light-button" type="submit">
                  Refresh
                </button>
              </form>
              <form action={reconnectWhatsAppAction}>
                <button type="submit">Reconnect by QR</button>
              </form>
              <form action={logoutWhatsAppAction}>
                <button className="secondary-light-button" type="submit">
                  Disconnect WhatsApp
                </button>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="section-header">
              <h2>Connector</h2>
            </div>
            <ol className="whatsapp-setup-steps">
              <li>Start the WhatsApp Connector.</li>
              <li>Scan the QR with WhatsApp Linked devices.</li>
              <li>Confirm the status changes to Connected.</li>
              <li>Open WhatsApp Inbox to chat with customers from the system.</li>
            </ol>
            <p className="muted">
              This page reads the independent connector directly through its HTTP API.
            </p>
            <div className="whatsapp-settings-tools">
              <Link className="secondary-light-button" href="/whatsapp">
                Logs
              </Link>
              <Link
                className="secondary-light-button"
                href="/whatsapp/contact-diagnostics"
              >
                Contact diagnostics
              </Link>
              <Link className="secondary-light-button" href="/whatsapp/diagnostics">
                Diagnostics
              </Link>
              <form action={syncCrmCustomersToWhatsAppAction}>
                <input type="hidden" name="returnTo" value="/whatsapp/settings" />
                <button className="secondary-light-button" type="submit">
                  Sync customers
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

async function readConnectorState(businessId: string): Promise<{
  status: ConnectorStatus;
  errorMessage: string | null;
}> {
  try {
    return {
      status: await getConnectorStatus(businessId),
      errorMessage: null,
    };
  } catch (error) {
    return {
      status: {
        status: "disconnected",
        phoneNumber: null,
        lastSeen: null,
        hasSocket: false,
        reconnectAttempts: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        lastAckError: null,
        sessionHealth: { ok: false, message: "Unable to read WhatsApp connector status." },
      },
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unable to read WhatsApp connector status.",
    };
  }
}

function formatStatus(status: ConnectorStatus["status"]) {
  if (status === "qr") {
    return "QR Required";
  }

  if (status === "session_expired") {
    return "Session Expired";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}
