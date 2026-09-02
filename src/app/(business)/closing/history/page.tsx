import Link from "next/link";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getOperationalBranches } from "@/lib/branches";
import {
  formatDateValue,
  isValidDateValue,
} from "@/lib/business-time";
import { formatMoneyFromCents } from "@/lib/daily-closing/format";
import { normalizeBusinessDate } from "@/lib/daily-closing/snapshot";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";

type ClosingHistoryPageProps = {
  searchParams: Promise<{
    branchId?: string;
    from?: string;
    page?: string;
    to?: string;
  }>;
};

const PAGE_SIZE = 10;
const EMPTY_BRANCH_ID = "00000000-0000-0000-0000-000000000000";

export default async function ClosingHistoryPage({
  searchParams,
}: ClosingHistoryPageProps) {
  const context = await requireBusinessContext({ capability: "RUN_CLOSING" });
  assertStaffPermission(context.user, "CLOSING");

  if (!context.businessId) {
    throw new Error("Business context is required.");
  }

  const params = await searchParams;
  const branches = await getOperationalBranches(
    context.businessId,
    context.user,
  );
  const allowedBranchIds = branches.map((branch) => branch.id);
  const selectedBranchId = allowedBranchIds.includes(params.branchId ?? "")
    ? params.branchId
    : undefined;
  const fromValue = params.from && isValidDateValue(params.from) ? params.from : "";
  const toValue = params.to && isValidDateValue(params.to) ? params.to : "";
  const requestedPage = Math.max(
    1,
    Number.parseInt(params.page ?? "1", 10) || 1,
  );
  const businessDate = {
    ...(fromValue ? { gte: normalizeBusinessDate(fromValue) } : {}),
    ...(toValue ? { lt: nextBusinessDate(toValue) } : {}),
  };
  const where = {
    businessId: context.businessId,
    branchId: selectedBranchId
      ? selectedBranchId
      : { in: allowedBranchIds.length ? allowedBranchIds : [EMPTY_BRANCH_ID] },
    ...(Object.keys(businessDate).length ? { businessDate } : {}),
  };
  const total = await prisma.dailyClosingSnapshot.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const snapshots = await prisma.dailyClosingSnapshot.findMany({
    where,
    include: {
      branch: {
        select: { name: true },
      },
      closingWhatsAppSends: {
        orderBy: { requestedAt: "desc" },
        select: {
          sendType: true,
          status: true,
        },
        take: 5,
      },
      closedBy: {
        select: { name: true },
      },
    },
    orderBy: [{ businessDate: "desc" }, { closedAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return (
    <section className="content closing-history-content">
      <div className="page-header closing-history-header">
        <div>
          <span className="daily-closing-eyebrow">FORMAL DAILY CLOSING</span>
          <h1>Closing history</h1>
          <p>Frozen, read-only reports for each branch and business date.</p>
        </div>
        <Link href="/closing" className="button secondary">
          Back to closing
        </Link>
      </div>

      <form method="get" className="panel closing-history-filters">
        <label>
          <span>Branch</span>
          <select name="branchId" defaultValue={selectedBranchId ?? ""}>
            <option value="">All accessible branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" name="from" defaultValue={fromValue} />
        </label>
        <label>
          <span>To</span>
          <input type="date" name="to" defaultValue={toValue} />
        </label>
        <button type="submit">Filter</button>
      </form>

      <section className="panel closing-history-panel">
        <div className="section-header">
          <div>
            <h2>Closed business days</h2>
            <p>
              {total} {total === 1 ? "snapshot" : "snapshots"}
            </p>
          </div>
        </div>

        {snapshots.length ? (
          <>
            <div className="closing-history-table-wrap">
              <table className="table closing-history-table">
                <thead>
                  <tr>
                    <th>Business date</th>
                    <th>Branch</th>
                    <th>Expected Net Cash Movement</th>
                    <th>Actual Net Cash Movement</th>
                    <th>Difference</th>
                    <th>WhatsApp</th>
                    <th>Closed by</th>
                    <th>Closed at</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => {
                    const dateValue = toDateValue(snapshot.businessDate);
                    return (
                      <tr key={snapshot.id}>
                        <td>
                          <strong>{formatBusinessDate(dateValue)}</strong>
                          <small>v{snapshot.reportVersion}</small>
                        </td>
                        <td>{snapshot.branch.name}</td>
                        <td>{formatMoneyFromCents(snapshot.expectedCashCents)}</td>
                        <td>{formatMoneyFromCents(snapshot.actualCashCents)}</td>
                        <td>
                          <span
                            className={`closing-difference ${differenceTone(
                              snapshot.cashDifferenceCents,
                            )}`}
                          >
                            {formatSignedMoney(snapshot.cashDifferenceCents)}
                          </span>
                        </td>
                        <td>{formatWhatsAppStatus(snapshot.closingWhatsAppSends)}</td>
                        <td>{snapshot.closedBy.name}</td>
                        <td>{formatDateTime(snapshot.closedAt, snapshot.timezone)}</td>
                        <td>
                          <Link
                            href={`/closing?branchId=${snapshot.branchId}&date=${dateValue}`}
                            className="button secondary compact"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination closing-history-pagination">
              <span>
                Page {page} of {pageCount}
              </span>
              {page <= 1 ? (
                <span className="button secondary disabled">Previous</span>
              ) : (
                <Link
                  className="button secondary"
                  href={makeHistoryHref(params, page - 1)}
                >
                  Previous
                </Link>
              )}
              {page >= pageCount ? (
                <span className="button secondary disabled">Next</span>
              ) : (
                <Link
                  className="button secondary"
                  href={makeHistoryHref(params, page + 1)}
                >
                  Next
                </Link>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state closing-history-empty">
            <strong>No formal closings found</strong>
            <span>Confirm a daily closing to create the first frozen report.</span>
          </div>
        )}
      </section>
    </section>
  );
}

function formatWhatsAppStatus(
  sends: {
    sendType: string;
    status: string;
  }[],
) {
  if (!sends.length) {
    return <span className="status neutral">Not queued</span>;
  }

  const hasFailed = sends.some((send) => send.status === "FAILED");
  const hasPending = sends.some((send) =>
    ["QUEUED", "SENDING", "RETRY_SCHEDULED"].includes(send.status),
  );
  const hasReport = sends.some((send) => send.sendType === "CLOSING_REPORT");
  const label = hasFailed
    ? "Failed"
    : hasPending
      ? "Pending"
      : hasReport
        ? "Sent"
        : "Reminder";
  const tone = hasFailed ? "failed" : hasPending ? "pending" : "sent";

  return <span className={`status ${tone}`}>{label}</span>;
}

function makeHistoryHref(
  params: Awaited<ClosingHistoryPageProps["searchParams"]>,
  page: number,
) {
  const query = new URLSearchParams();
  if (params.branchId) query.set("branchId", params.branchId);
  if (params.from && isValidDateValue(params.from)) query.set("from", params.from);
  if (params.to && isValidDateValue(params.to)) query.set("to", params.to);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `/closing/history?${search}` : "/closing/history";
}

function nextBusinessDate(dateValue: string) {
  const date = normalizeBusinessDate(dateValue);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function toDateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatBusinessDate(dateValue: string) {
  return formatDateValue(dateValue, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: Date, timeZone: string) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  });
}

function differenceTone(value: number) {
  if (value === 0) return "balanced";
  return value < 0 ? "short" : "over";
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoneyFromCents(0);
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatMoneyFromCents(Math.abs(value))}`;
}
