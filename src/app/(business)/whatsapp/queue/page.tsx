import { NotificationQueueStatus } from "@prisma/client";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type WhatsAppQueuePageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

const statuses = Object.values(NotificationQueueStatus);

export default async function WhatsAppQueuePage({
  searchParams,
}: WhatsAppQueuePageProps) {
  const { user, businessId } = await requireBusinessUserForModule("WHATSAPP");
  assertStaffPermission(user, "WHATSAPP_SESSION");
  const params = await searchParams;
  const activeStatus = parseStatus(params.status);

  const where = {
    businessId,
    ...(activeStatus ? { status: activeStatus } : {}),
  };

  const [statusCounts, retrying, nextQueuedAttempt, retryCount, queues] =
    await Promise.all([
      prisma.notificationQueue.groupBy({
        by: ["status"],
        where: { businessId },
        _count: { _all: true },
      }),
      prisma.notificationQueue.count({
        where: {
          businessId,
          status: NotificationQueueStatus.QUEUED,
          retryCount: { gt: 0 },
        },
      }),
      prisma.notificationQueue.findFirst({
        where: {
          businessId,
          status: NotificationQueueStatus.QUEUED,
          nextAttemptAt: { not: null },
        },
        orderBy: { nextAttemptAt: "asc" },
        select: { nextAttemptAt: true },
      }),
      prisma.notificationQueue.aggregate({
        where: { businessId },
        _sum: { retryCount: true },
        _max: { retryCount: true },
      }),
      prisma.notificationQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          phone: true,
          messageType: true,
          status: true,
          retryCount: true,
          attemptCount: true,
          lastErrorCategory: true,
          providerMessageId: true,
          errorMessage: true,
          createdAt: true,
          sentAt: true,
          failedAt: true,
          nextAttemptAt: true,
        },
      }),
    ]);

  const counts = createStatusCountMap(statusCounts);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Queue</h1>
            <p>Showing the latest {queues.length} notification queue records.</p>
          </div>
          <div className="inline-actions">
            <Link className="secondary-link-button" href="/whatsapp">
              Logs
            </Link>
            <Link className="secondary-link-button" href="/whatsapp/inbox">
              Inbox
            </Link>
            <Link className="secondary-link-button" href="/whatsapp/settings">
              Settings
            </Link>
          </div>
        </div>

        <div className="dashboard-kpis">
          <Metric label="Total queued" value={counts.QUEUED} />
          <Metric label="Sending" value={counts.SENDING} />
          <Metric label="Sent to server" value={counts.SENT_TO_SERVER + counts.SENT} tone="sales" />
          <Metric label="Delivered" value={counts.DELIVERED} tone="sales" />
          <Metric label="Read" value={counts.READ} tone="sales" />
          <Metric label="Failed" value={counts.FAILED} tone="danger" />
          <Metric label="Cancelled" value={counts.CANCELLED} />
          <Metric label="Retrying" value={retrying} tone={retrying ? "warning" : "default"} />
          <Metric
            label="Next attempt"
            value={formatDate(nextQueuedAttempt?.nextAttemptAt ?? null)}
          />
          <Metric
            label="Retry count"
            value={retryCount._sum.retryCount ?? 0}
            subValue={`Max ${retryCount._max.retryCount ?? 0}`}
          />
        </div>

        <div className="panel">
          <div className="filter-tabs" aria-label="Notification queue status filters">
            <Link className={activeStatus ? "" : "active"} href="/whatsapp/queue">
              All
            </Link>
            {statuses.map((status) => (
              <Link
                className={activeStatus === status ? "active" : ""}
                href={`/whatsapp/queue?status=${status}`}
                key={status}
              >
                {formatStatus(status)}
              </Link>
            ))}
          </div>

          {queues.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Message Type</th>
                  <th>Status</th>
                  <th>Attempts / retries</th>
                  <th>Provider Message ID</th>
                  <th>Error</th>
                  <th>Error category</th>
                  <th>Created</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Next Attempt</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((queue) => (
                  <tr key={queue.id}>
                    <td>{queue.phone}</td>
                    <td>{queue.messageType}</td>
                    <td>
                      <span className={`status ${queue.status.toLowerCase()}`}>
                        {formatStatus(queue.status)}
                      </span>
                    </td>
                    <td>{queue.attemptCount} / {queue.retryCount}</td>
                    <td>{queue.providerMessageId ?? "-"}</td>
                    <td title={queue.errorMessage ?? undefined}>
                      {truncate(queue.errorMessage)}
                    </td>
                    <td>{queue.lastErrorCategory ?? "-"}</td>
                    <td>{formatDate(queue.createdAt)}</td>
                    <td>{formatDate(queue.sentAt)}</td>
                    <td>{formatDate(queue.failedAt)}</td>
                    <td>{formatDate(queue.nextAttemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-state">No notification queue records match this view.</p>
          )}
        </div>
      </section>
    </>
  );
}

function createStatusCountMap(
  statusCounts: Array<{
    status: NotificationQueueStatus;
    _count: { _all: number };
  }>,
) {
  return statusCounts.reduce(
    (counts, item) => ({
      ...counts,
      [item.status]: item._count._all,
    }),
    {
      QUEUED: 0,
      SENDING: 0,
      SENT: 0,
      SENT_TO_SERVER: 0,
      DELIVERED: 0,
      READ: 0,
      FAILED: 0,
      CANCELLED: 0,
    } satisfies Record<NotificationQueueStatus, number>,
  );
}

function parseStatus(value?: string) {
  return statuses.includes(value as NotificationQueueStatus)
    ? (value as NotificationQueueStatus)
    : undefined;
}

function Metric({
  label,
  value,
  subValue,
  tone = "default",
}: {
  label: string;
  value: string | number;
  subValue?: string;
  tone?: "default" | "sales" | "warning" | "danger";
}) {
  return (
    <div className={`dashboard-kpi-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function truncate(value: string | null) {
  if (!value) {
    return "-";
  }

  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}
