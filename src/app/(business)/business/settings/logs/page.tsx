import Link from "next/link";
import { buildAuditLogWhere } from "@/lib/audit/query";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";

type AuditLogsPageProps = {
  searchParams: Promise<{
    action?: string;
    staffId?: string;
  }>;
};

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const context = await requireBusinessContext();
  assertRole(context.user, ["BUSINESS_OWNER"]);

  const params = await searchParams;
  const businessId = context.businessId;
  const [staffUsers, actionRows] = await Promise.all([
    prisma.user.findMany({
      where: {
        businessId,
        role: { in: ["BUSINESS_OWNER", "STAFF"] },
      },
      include: { branch: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.auditLog.findMany({
      where: { businessId },
      distinct: ["action"],
      orderBy: { action: "asc" },
      select: { action: true },
    }),
  ]);

  const selectedStaffId = staffUsers.some((staff) => staff.id === params.staffId)
    ? params.staffId
    : null;
  const availableActions = actionRows.map((row) => row.action);
  const selectedAction = availableActions.includes(params.action ?? "")
    ? params.action
    : null;
  const where = buildAuditLogWhere(businessId, {
    actorUserId: selectedStaffId,
    action: selectedAction,
  });

  const [logs, actorCounts] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: { select: { name: true, email: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.auditLog.groupBy({
      by: ["actorUserId"],
      where: { businessId, actorUserId: { not: null } },
      _count: true,
    }),
  ]);
  const countByUser = new Map(
    actorCounts.flatMap((row) =>
      row.actorUserId ? [[row.actorUserId, row._count] as const] : [],
    ),
  );

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Audit log</h1>
            <p>Review protected records of important staff and system actions.</p>
          </div>
          <Link className="secondary-link-button" href="/business/settings">
            Back
          </Link>
        </div>

        <div className="panel">
          <form action="/business/settings/logs" className="staff-log-filter">
            <label>
              <span>Staff</span>
              <select name="staffId" defaultValue={selectedStaffId ?? ""}>
                <option value="">All staff</option>
                {staffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Action</span>
              <select name="action" defaultValue={selectedAction ?? ""}>
                <option value="">All actions</option>
                {availableActions.map((action) => (
                  <option key={action} value={action}>
                    {formatAction(action)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Filter</button>
            {selectedStaffId || selectedAction ? (
              <Link className="clear-filter-link" href="/business/settings/logs">
                Clear
              </Link>
            ) : null}
          </form>

          <div className="staff-log-summary-grid">
            {staffUsers.map((staff) => (
              <div className="staff-log-card" key={staff.id}>
                <div>
                  <strong>{staff.name}</strong>
                  <span>{staff.email}</span>
                </div>
                <small>{staff.branch?.name ?? "All branches"}</small>
                <div className="staff-log-stats">
                  <span>{countByUser.get(staff.id) ?? 0} audited actions</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Recent activity</h2>
            <span className="status">{logs.length} records</span>
          </div>
          {logs.length ? (
            <div className="table-scroll">
              <table className="table compact-table staff-log-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Staff</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        <strong>{log.actor?.name ?? log.actorName ?? "System"}</strong>
                        <small>{log.actor?.email ?? log.actorEmail}</small>
                      </td>
                      <td>{formatAction(log.action)}</td>
                      <td>
                        {log.entityType}
                        {log.entityId ? <small>{shortId(log.entityId)}</small> : null}
                      </td>
                      <td>{log.summary}</td>
                      <td>
                        <span className={`status ${log.status.toLowerCase()}`}>
                          {log.status.toLowerCase()}
                        </span>
                      </td>
                      <td>{log.branch?.name ?? "All branches"}</td>
                      <td>
                        {log.before || log.after || log.metadata ? (
                          <details className="audit-details">
                            <summary>View</summary>
                            <pre>{formatDetails(log.before, log.after, log.metadata)}</pre>
                          </details>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">No audited activity yet.</p>
          )}
        </div>
      </section>
    </>
  );
}

function formatDateTime(date: Date) {
  return date.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAction(action: string) {
  return action
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatDetails(before: unknown, after: unknown, metadata: unknown) {
  return JSON.stringify(
    {
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(metadata ? { metadata } : {}),
    },
    null,
    2,
  );
}
