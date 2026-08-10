import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  getConnectorDiagnostics,
  type ConnectorDiagnostics,
} from "@/lib/whatsapp/connector-client";

export default async function WhatsAppDiagnosticsPage() {
  const { user, businessId } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const [connector, database] = await Promise.all([
    readConnectorDiagnostics(businessId),
    readDatabaseDiagnostics(businessId),
  ]);

  const sessionWarning =
    connector.data?.sessionHealth.ok === false
      ? connector.data.sessionHealth.message ??
        "Your WhatsApp session may have expired. Please reconnect your WhatsApp."
      : database.lastAckError
        ? "A recent WhatsApp ACK error was recorded. Reconnect if send/receive is unstable."
        : null;

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Diagnostics</h1>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp/settings">
              Settings
            </Link>
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            <BackButton fallbackHref="/whatsapp/settings" />
          </div>
        </div>

        {connector.error ? <div className="error">{connector.error}</div> : null}
        {sessionWarning ? <div className="error">{sessionWarning}</div> : null}

        <div className="whatsapp-settings-grid">
          <div className="panel whatsapp-connection-card">
            <div className="section-header">
              <h2>Connector Runtime</h2>
              <span className={`status ${connector.data?.connectionState ?? "error"}`}>
                {formatStatus(connector.data?.connectionState ?? "error")}
              </span>
            </div>

            <div className="whatsapp-connection-meta">
              <Info label="WhatsApp number" value={connector.data?.whatsappNumber} />
              <Info
                label="Linked Device"
                value={connector.data?.linkedDeviceStatus}
              />
              <Info
                label="Socket"
                value={connector.data?.hasSocket ? "Active" : "Inactive"}
              />
              <Info
                label="Session"
                value={connector.data?.hasSession ? "Present" : "Missing"}
              />
              <Info
                label="Last successful send"
                value={formatDateTime(
                  connector.data?.lastSuccessfulSend ??
                    database.lastSuccessfulSend?.sentAt?.toISOString() ??
                    null,
                )}
              />
              <Info
                label="Last successful receive"
                value={formatDateTime(
                  connector.data?.lastSuccessfulReceive ??
                    database.lastSuccessfulReceive?.createdAt.toISOString() ??
                    null,
                )}
              />
              <Info
                label="Reconnect attempts"
                value={connector.data?.reconnectAttempts}
              />
              <Info
                label="Last ACK error"
                value={
                  connector.data?.lastAckError?.code ??
                  database.lastAckError?.errorMessage
                }
              />
            </div>
          </div>

          <div className="panel whatsapp-connection-card">
            <div className="section-header">
              <h2>Versions</h2>
            </div>
            <div className="whatsapp-connection-meta">
              <Info
                label="Connector version"
                value={connector.data?.connectorVersion}
              />
              <Info label="Baileys version" value={connector.data?.baileysVersion} />
              <Info label="Node version" value={connector.data?.nodeVersion} />
              <Info
                label="Started at"
                value={formatDateTime(connector.data?.startedAt ?? null)}
              />
              <Info
                label="Last connected"
                value={formatDateTime(connector.data?.lastConnectedAt ?? null)}
              />
              <Info
                label="Last disconnected"
                value={formatDateTime(connector.data?.lastDisconnectedAt ?? null)}
              />
            </div>
          </div>
        </div>

        <div className="panel whatsapp-connection-card">
          <div className="section-header">
            <h2>Message Evidence</h2>
          </div>
          <div className="whatsapp-connection-meta">
            <Info
              label="Last sent message"
              value={database.lastSuccessfulSend?.providerMessageId}
            />
            <Info
              label="Last received message"
              value={database.lastSuccessfulReceive?.externalMessageId}
            />
            <Info
              label="Last ACK message"
              value={database.lastAckError?.providerMessageId}
            />
            <Info
              label="Last ACK time"
              value={formatDateTime(
                database.lastAckError?.failedAt?.toISOString() ??
                  database.lastAckError?.createdAt.toISOString() ??
                  null,
              )}
            />
          </div>
        </div>
      </section>
    </>
  );
}

async function readConnectorDiagnostics(businessId: string): Promise<{
  data: ConnectorDiagnostics | null;
  error: string | null;
}> {
  try {
    return {
      data: await getConnectorDiagnostics(businessId),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to read WhatsApp diagnostics.",
    };
  }
}

async function readDatabaseDiagnostics(businessId: string) {
  const [lastSuccessfulSend, lastSuccessfulReceive, lastAckError] =
    await Promise.all([
      prisma.whatsAppMessage.findFirst({
        where: {
          businessId,
          providerMessageId: { not: null },
          sentAt: { not: null },
          errorMessage: null,
        },
        orderBy: { sentAt: "desc" },
        select: {
          providerMessageId: true,
          sentAt: true,
        },
      }),
      prisma.whatsAppChatMessage.findFirst({
        where: {
          businessId,
          direction: "INBOUND",
        },
        orderBy: { createdAt: "desc" },
        select: {
          externalMessageId: true,
          createdAt: true,
        },
      }),
      prisma.whatsAppMessage.findFirst({
        where: {
          businessId,
          errorMessage: {
            contains: "WHATSAPP_ACK_ERROR",
          },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          providerMessageId: true,
          errorMessage: true,
          failedAt: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    lastSuccessfulSend,
    lastSuccessfulReceive,
    lastAckError,
  };
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function formatStatus(status: string) {
  if (status === "qr") {
    return "QR Required";
  }

  if (status === "session_expired") {
    return "Session Expired";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
