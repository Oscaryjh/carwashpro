import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { WhatsAppSettingsAutoRefresh } from "@/components/whatsapp-settings-auto-refresh";
import { WhatsAppSessionRecovery } from "@/components/whatsapp-settings-session-recovery";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";
import {
  getConnectorStatus,
  getConnectorQrProxyPath,
  type ConnectorStatus,
} from "@/lib/whatsapp/connector-client";
import {
  logoutWhatsAppAction,
  reconnectWhatsAppAction,
  refreshWhatsAppConnectionAction,
  saveAppointmentReminderSettingsAction,
  saveClosingWhatsAppAutomationSettingsAction,
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
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const params = await searchParams;
  const [
    appointmentReminderSetting,
    business,
    closingSetting,
    branches,
    businessRecipients,
  ] = await Promise.all([
    prisma.appointmentReminderSetting.findUnique({
      where: { businessId },
    }),
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { language: true },
    }),
    prisma.closingWhatsAppSetting.findUnique({
      where: { businessId },
    }),
    prisma.branch.findMany({
      where: { businessId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        closingWhatsAppRecipients: {
          where: { isActive: true, scope: "BRANCH" },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        closingWhatsAppSetting: true,
      },
    }),
    prisma.closingWhatsAppRecipient.findMany({
      where: {
        businessId,
        isActive: true,
        scope: "BUSINESS",
        scopeKey: "BUSINESS",
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
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
    <>
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

        <div className="panel whatsapp-automation-card" id="automation">
          <div className="section-header whatsapp-automation-header">
            <div>
              <span className="company-settings-eyebrow">Automation</span>
              <h2>Appointment reminders</h2>
              <p className="muted">
                Schedule WhatsApp reminders before booked appointments.
              </p>
            </div>
            <Link className="secondary-link-button" href="/whatsapp/queue">
              Send logs
            </Link>
          </div>

          <div
            className={`whatsapp-automation-notice ${
              isConnected ? "is-connected" : "is-disconnected"
            }`}
          >
            <strong>
              {isConnected ? "WhatsApp is connected" : "WhatsApp is not connected"}
            </strong>
            <span>
              {isConnected
                ? "Enabled reminders will enter the existing send queue."
                : "You can save these settings now. Reminders will only send after WhatsApp is connected."}
            </span>
          </div>

          <form
            action={saveAppointmentReminderSettingsAction}
            className="whatsapp-automation-form"
          >
            <label className="whatsapp-automation-toggle">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={appointmentReminderSetting?.enabled ?? false}
              />
              <span>
                <strong>Send appointment reminders</strong>
                <small>
                  Customers receive a WhatsApp reminder before scheduled
                  appointments.
                </small>
              </span>
            </label>

            <label className="whatsapp-automation-lead-time">
              <span>Send reminder</span>
              <select
                name="leadTimeMinutes"
                defaultValue={String(
                  appointmentReminderSetting?.leadTimeMinutes ?? 1440,
                )}
              >
                <option value="30">30 minutes before</option>
                <option value="60">1 hour before</option>
                <option value="120">2 hours before</option>
                <option value="360">6 hours before</option>
                <option value="720">12 hours before</option>
                <option value="1440">24 hours before</option>
                <option value="2880">48 hours before</option>
              </select>
            </label>

            <div className="whatsapp-automation-footer">
              <p className="muted">
                Failed reminders use the existing retry policy. Delivery status
                remains available in send logs.
              </p>
              <button type="submit">Save automation</button>
            </div>
          </form>
        </div>

        <div className="panel whatsapp-automation-card" id="closing-automation">
          <div className="section-header whatsapp-automation-header">
            <div>
              <span className="company-settings-eyebrow">Automation</span>
              <h2>Daily closing reports</h2>
              <p className="muted">
                Send frozen Closing Snapshot summaries to owners after formal
                closing, and send one reminder when a branch misses its deadline.
              </p>
            </div>
            <Link className="secondary-link-button" href="/closing/history">
              Closing history
            </Link>
          </div>

          <div
            className={`whatsapp-automation-notice ${
              isConnected ? "is-connected" : "is-disconnected"
            }`}
          >
            <strong>
              {isConnected ? "WhatsApp is connected" : "WhatsApp is not connected"}
            </strong>
            <span>
              {isConnected
                ? "Closing reports and reminders will be queued after the snapshot is frozen."
                : "You can save recipients now. Queue items will wait until WhatsApp is connected."}
            </span>
          </div>

          <form
            action={saveClosingWhatsAppAutomationSettingsAction}
            className="whatsapp-closing-automation-form"
          >
            <div className="whatsapp-closing-settings-grid">
              <label className="whatsapp-automation-toggle">
                <input
                  type="checkbox"
                  name="closingEnabled"
                  defaultChecked={closingSetting?.enabled ?? false}
                />
                <span>
                  <strong>Enable daily closing WhatsApp</strong>
                  <small>
                    Only frozen Snapshot reports are sent. Live daily report data
                    is never sent as the official owner report.
                  </small>
                </span>
              </label>

              <label>
                <span>Template language</span>
                <select name="language" defaultValue={business.language ?? "EN"}>
                  <option value="EN">English</option>
                  <option value="ZH">中文</option>
                </select>
              </label>

              <label>
                <span>Daily closing deadline</span>
                <input
                  type="time"
                  name="deadlineTime"
                  defaultValue={closingSetting?.deadlineTime ?? "22:00"}
                />
              </label>

              <label className="whatsapp-automation-toggle">
                <input
                  type="checkbox"
                  name="sendClosingReport"
                  defaultChecked={closingSetting?.sendClosingReport ?? true}
                />
                <span>
                  <strong>Send frozen report after closing</strong>
                  <small>Uses DailyClosingSnapshot.whatsappText.</small>
                </span>
              </label>

              <label className="whatsapp-automation-toggle">
                <input
                  type="checkbox"
                  name="sendUnclosedReminder"
                  defaultChecked={closingSetting?.sendUnclosedReminder ?? true}
                />
                <span>
                  <strong>Send one unclosed reminder</strong>
                  <small>
                    Created once after the deadline when no Snapshot exists.
                  </small>
                </span>
              </label>
            </div>

            <div className="closing-recipient-section">
              <div>
                <h3>Business default recipients</h3>
                <p className="muted">
                  Branches inherit these recipients unless a branch override is
                  configured. Duplicate normalized phone numbers are skipped.
                </p>
              </div>
              <div className="closing-recipient-rows">
                {[0, 1, 2].map((index) => (
                  <RecipientRow
                    key={`business-recipient-${index}`}
                    prefix="businessRecipient"
                    recipient={businessRecipients[index]}
                  />
                ))}
              </div>
            </div>

            <div className="closing-branch-automation-list">
              {branches.map((branch) => {
                const useBusinessRecipients =
                  branch.closingWhatsAppSetting?.useBusinessRecipients ?? true;

                return (
                  <div className="closing-branch-automation-card" key={branch.id}>
                    <input type="hidden" name="branchId" value={branch.id} />
                    <div className="closing-branch-automation-header">
                      <div>
                        <h3>{branch.name}</h3>
                        <p className="muted">
                          Inherit the business recipients or override for this
                          branch.
                        </p>
                      </div>
                      <label className="whatsapp-automation-toggle compact">
                        <input
                          type="checkbox"
                          name={`branchUseBusinessRecipients:${branch.id}`}
                          defaultChecked={useBusinessRecipients}
                        />
                        <span>
                          <strong>Use business default</strong>
                          <small>Uncheck to use branch recipients.</small>
                        </span>
                      </label>
                    </div>

                    <label className="closing-branch-deadline">
                      <span>Branch deadline override</span>
                      <input
                        type="time"
                        name={`branchDeadlineTime:${branch.id}`}
                        defaultValue={
                          branch.closingWhatsAppSetting?.deadlineTimeOverride ??
                          ""
                        }
                      />
                    </label>

                    <div className="closing-recipient-rows">
                      {[0, 1, 2].map((index) => (
                        <RecipientRow
                          key={`${branch.id}-recipient-${index}`}
                          prefix={`branchRecipient:${branch.id}`}
                          recipient={branch.closingWhatsAppRecipients[index]}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="whatsapp-automation-footer">
              <p className="muted">
                Manual Retry and Resend will be audited separately from the
                original send record.
              </p>
              <button type="submit">Save closing automation</button>
            </div>
          </form>
        </div>
      </section>
    </>
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

function RecipientRow({
  prefix,
  recipient,
}: {
  prefix: string;
  recipient?: {
    label: string;
    phone: string;
    role: "OWNER" | "BRANCH_MANAGER" | "FINANCE";
  };
}) {
  return (
    <div className="closing-recipient-row">
      <label>
        <span>Role</span>
        <select name={`${prefix}Role`} defaultValue={recipient?.role ?? "OWNER"}>
          <option value="OWNER">Owner</option>
          <option value="BRANCH_MANAGER">Branch Manager</option>
          <option value="FINANCE">Finance</option>
        </select>
      </label>
      <label>
        <span>Name</span>
        <input
          name={`${prefix}Label`}
          placeholder="e.g. Owner"
          defaultValue={recipient?.label ?? ""}
        />
      </label>
      <label>
        <span>WhatsApp phone</span>
        <input
          name={`${prefix}Phone`}
          inputMode="tel"
          placeholder="QA phone only"
          defaultValue={recipient?.phone ?? ""}
        />
      </label>
    </div>
  );
}
