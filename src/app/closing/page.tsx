import Link from "next/link";
import type { PaymentMethod, PaymentRecordStatus } from "@prisma/client";
import { AppShell } from "@/components/app-shell";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { fromCents, toCents } from "@/lib/validation/pos";
import { endShiftAction, startShiftAction } from "./actions";

type ClosingPageProps = {
  searchParams: Promise<{
    activityPage?: string;
    message?: string;
    shiftPage?: string;
    type?: string;
  }>;
};

const ACTIVITY_PAGE_SIZE = 10;
const SHIFT_PAGE_SIZE = 10;

const paymentMethodLabels: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CASH: "Cash",
  DUITNOW: "DuitNow",
  EWALLET: "E-wallet",
  PACKAGE: "Package use",
};

export default async function ClosingPage({ searchParams }: ClosingPageProps) {
  const context = await requireBusinessContext();
  const params = await searchParams;
  const message = params.message?.trim();
  const messageType = params.type === "error" ? "error" : "success";
  const requestedActivityPage = Math.max(
    1,
    Number.parseInt(params.activityPage ?? "1", 10) || 1,
  );
  const requestedShiftPage = Math.max(
    1,
    Number.parseInt(params.shiftPage ?? "1", 10) || 1,
  );

  if (!context.businessId) {
    return (
      <AppShell user={context.user}>
        <section className="content">
          <div className="panel">
            <h1>Business not found, please login again</h1>
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </AppShell>
    );
  }

  const businessId = context.businessId;
  const { fromDate, toDateExclusive } = getTodayRange();
  const isOwner = context.user.role === "BUSINESS_OWNER";
  const [branches, openShift, shifts] = await Promise.all([
    getOperationalBranches(businessId, context.user),
    prisma.cashierShift.findFirst({
      where: {
        businessId,
        cashierId: context.user.userId,
        status: "OPEN",
      },
      include: {
        branch: true,
        cashier: {
          select: { name: true },
        },
        payments: {
          where: { status: "ACTIVE" },
          orderBy: { paidAt: "desc" },
        },
        refunds: {
          orderBy: { refundedAt: "desc" },
        },
      },
    }),
    prisma.cashierShift.findMany({
      where: {
        businessId,
        ...(isOwner ? {} : { cashierId: context.user.userId }),
        OR: [
          { startedAt: { gte: fromDate, lt: toDateExclusive } },
          { endedAt: { gte: fromDate, lt: toDateExclusive } },
          { status: "OPEN" },
        ],
      },
      include: {
        branch: true,
        cashier: {
          select: { name: true },
        },
        payments: {
          where: { status: "ACTIVE" },
          orderBy: { paidAt: "desc" },
        },
        refunds: {
          orderBy: { refundedAt: "desc" },
        },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const currentShiftSummary = openShift
    ? summarizePayments(openShift.payments, openShift.refunds)
    : null;
  const allActivities = buildShiftActivities(openShift ? [openShift] : shifts);
  const activityPageCount = Math.max(1, Math.ceil(allActivities.length / ACTIVITY_PAGE_SIZE));
  const activityPage = Math.min(requestedActivityPage, activityPageCount);
  const activityStart = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const visibleActivities = allActivities.slice(
    activityStart,
    activityStart + ACTIVITY_PAGE_SIZE,
  );
  const shiftPageCount = Math.max(1, Math.ceil(shifts.length / SHIFT_PAGE_SIZE));
  const shiftPage = Math.min(requestedShiftPage, shiftPageCount);
  const shiftStart = (shiftPage - 1) * SHIFT_PAGE_SIZE;
  const visibleShifts = shifts.slice(shiftStart, shiftStart + SHIFT_PAGE_SIZE);
  const canStartShift = isOwner || branches.length > 0;

  return (
    <AppShell user={context.user}>
      <section className="content report-content closing-content">
        <div className="page-header report-header closing-page-header">
          <div>
            <h1>Shift Closing</h1>
            <p>Cashier shift closing for {formatDisplayDate(fromDate)}.</p>
          </div>
          <div className="report-period closing-period">
            <span>Today</span>
            <strong>
              {formatDisplayDate(fromDate)} - {formatDisplayDate(addDays(toDateExclusive, -1))}
            </strong>
          </div>
        </div>

        {message ? <div className={messageType}>{message}</div> : null}

        <section className="report-grid closing-overview-grid">
          <div className="panel report-card closing-shift-card">
            <div className="section-header">
              <h2>{openShift ? "Current shift" : "Start shift"}</h2>
              {openShift ? <span className="status">open</span> : null}
            </div>
            {openShift ? (
              <div className="closing-shift-panel">
                <div className="report-kpis compact-kpis closing-shift-kpis">
                  <Metric label="Cashier" value={openShift.cashier.name} />
                  <Metric label="Branch" value={openShift.branch?.name ?? "All branches"} />
                  <Metric label="Started" value={formatDateTime(openShift.startedAt)} />
                  <Metric label="Opening Float" value={money(openShift.openingFloat)} />
                  <Metric
                    label="Net Cash Sales"
                    value={money(currentShiftSummary?.cashAmount ?? 0)}
                  />
                  <Metric
                    label="Expected Cash"
                    value={money(
                      Number(openShift.openingFloat) +
                        Number(currentShiftSummary?.cashAmount ?? 0),
                    )}
                  />
                </div>
                <form action={endShiftAction} className="form closing-form closing-end-form">
                  <input type="hidden" name="shiftId" value={openShift.id} />
                  <div className="field-grid closing-field-grid">
                    <label>
                      <span>Cash counted</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        name="closingCash"
                        placeholder="0.00"
                        required
                        step="0.01"
                        type="number"
                      />
                    </label>
                    <label>
                      <span>Notes required if cash is short or over</span>
                      <input name="notes" placeholder="Reason for any difference" />
                    </label>
                  </div>
                  <div className="form-actions closing-form-actions">
                    <button type="submit">End shift</button>
                  </div>
                </form>
              </div>
            ) : (
              <form action={startShiftAction} className="form closing-form">
                {canStartShift ? (
                  <>
                    <div className="field-grid">
                      <label>
                        <span>Branch</span>
                        {isOwner && branches.length ? (
                          <select
                            name="branchId"
                            defaultValue={branches.length === 1 ? branches[0].id : ""}
                            required
                          >
                            <option value="" disabled>
                              Select branch
                            </option>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        ) : isOwner ? (
                          <>
                            <input type="hidden" name="branchId" value="" />
                            <input value="All branches" readOnly className="read-only-field" />
                          </>
                        ) : (
                          <>
                            <input type="hidden" name="branchId" value={branches[0].id} />
                            <input value={branches[0].name} readOnly className="read-only-field" />
                          </>
                        )}
                      </label>
                      <label>
                        <span>Opening cash float</span>
                        <input
                          defaultValue="0.00"
                          inputMode="decimal"
                          min="0"
                          name="openingFloat"
                          required
                          step="0.01"
                          type="number"
                        />
                      </label>
                    </div>
                    <div className="form-actions">
                      <button type="submit">Start shift</button>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">
                    This staff account is not assigned to an active branch.
                  </p>
                )}
              </form>
            )}
          </div>

          <ReportCard title="Current Shift Totals" className="closing-total-card">
            {currentShiftSummary ? (
              <div className="report-kpis compact-kpis closing-total-kpis">
                <Metric
                  label="Gross Collected"
                  value={money(currentShiftSummary.grossCollected)}
                />
                <Metric label="Refunds" value={money(currentShiftSummary.refunded)} />
                <Metric label="Net Collected" value={money(currentShiftSummary.collected)} />
                <Metric label="Payments" value={currentShiftSummary.paymentCount} />
                <Metric label="Net Cash" value={money(currentShiftSummary.cashAmount)} />
                <Metric label="Package Uses" value={`${currentShiftSummary.packageUses} uses`} />
              </div>
            ) : (
              <p className="empty-state">Start a shift to begin closing tracking.</p>
            )}
          </ReportCard>
        </section>

        <section className="report-grid closing-activity-grid">
          <ReportCard title={isOwner ? "Today's Shifts" : "My Shifts"} className="closing-table-card">
            {shifts.length ? (
              <div className="table-scroll">
                <table className="table compact-table closing-shifts-table">
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Gross</th>
                      <th>Refunds</th>
                      <th>Net</th>
                      <th>Expected Cash</th>
                      <th>Counted</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShifts.map((shift) => {
                      const summary = summarizePayments(shift.payments, shift.refunds);
                      const expectedCash =
                        shift.expectedCash ??
                        Number(shift.openingFloat) + summary.cashAmount;

                      return (
                        <tr key={shift.id}>
                          <td>{shift.cashier.name}</td>
                          <td>{shift.branch?.name ?? "All branches"}</td>
                          <td>{formatStatus(shift.status)}</td>
                          <td>{formatDateTime(shift.startedAt)}</td>
                          <td>{shift.endedAt ? formatDateTime(shift.endedAt) : "-"}</td>
                          <td>{money(summary.grossCollected)}</td>
                          <td>{money(summary.refunded)}</td>
                          <td>{money(summary.collected)}</td>
                          <td>{money(expectedCash)}</td>
                          <td>{shift.closingCash == null ? "-" : money(shift.closingCash)}</td>
                          <td>{formatDifference(shift.cashDifference)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No shifts today.</p>
            )}
            {shifts.length > SHIFT_PAGE_SIZE ? (
              <div className="pagination">
                <Link
                  className={shiftPage <= 1 ? "disabled" : ""}
                  href={makeClosingHref(params, { shiftPage: Math.max(1, shiftPage - 1) })}
                >
                  Previous
                </Link>
                <span>
                  {shiftStart + 1}-
                  {Math.min(shiftStart + SHIFT_PAGE_SIZE, shifts.length)} of {shifts.length}
                </span>
                <Link
                  className={shiftPage >= shiftPageCount ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    shiftPage: Math.min(shiftPageCount, shiftPage + 1),
                  })}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </ReportCard>

          <ReportCard
            title={openShift ? "Current Shift Activity" : "Recent Shift Activity"}
            className="closing-table-card"
          >
            {visibleActivities.length ? (
              <div className="table-scroll">
                <table className="table compact-table closing-payments-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleActivities.map((activity) => (
                      <tr key={activity.id}>
                        <td>{formatTime(activity.occurredAt)}</td>
                        <td>{paymentMethodLabels[activity.method]}</td>
                        <td>
                          {activity.method === "PACKAGE"
                            ? `${activity.packageUses} use${activity.packageUses === 1 ? "" : "s"}`
                            : activity.type === "refund"
                              ? `-${money(activity.amount)}`
                              : money(activity.amount)}
                        </td>
                        <td>{activity.status}</td>
                        <td>{activity.reference || activity.detail || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">No payment or refund records for this shift.</p>
            )}
            {allActivities.length > ACTIVITY_PAGE_SIZE ? (
              <div className="pagination">
                <Link
                  className={activityPage <= 1 ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    activityPage: Math.max(1, activityPage - 1),
                  })}
                >
                  Previous
                </Link>
                <span>
                  {activityStart + 1}-
                  {Math.min(activityStart + ACTIVITY_PAGE_SIZE, allActivities.length)} of{" "}
                  {allActivities.length}
                </span>
                <Link
                  className={activityPage >= activityPageCount ? "disabled" : ""}
                  href={makeClosingHref(params, {
                    activityPage: Math.min(activityPageCount, activityPage + 1),
                  })}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </ReportCard>
        </section>
      </section>
    </AppShell>
  );
}

function makeClosingHref(
  params: Awaited<ClosingPageProps["searchParams"]>,
  pages: {
    activityPage?: number;
    shiftPage?: number;
  },
) {
  const query = new URLSearchParams();
  const activityPage =
    pages.activityPage ??
    Math.max(1, Number.parseInt(params.activityPage ?? "1", 10) || 1);
  const shiftPage =
    pages.shiftPage ??
    Math.max(1, Number.parseInt(params.shiftPage ?? "1", 10) || 1);

  if (params.message) query.set("message", params.message);
  if (params.type) query.set("type", params.type);
  if (activityPage > 1) query.set("activityPage", String(activityPage));
  if (shiftPage > 1) query.set("shiftPage", String(shiftPage));

  const search = query.toString();
  return search ? `/closing?${search}` : "/closing";
}

type ShiftActivity = {
  amount: number;
  detail: string | null;
  id: string;
  method: PaymentMethod;
  occurredAt: Date;
  packageUses: number;
  reference: string | null;
  status: string;
  type: "payment" | "refund";
};

function buildShiftActivities(
  shifts: {
    payments: {
      amount: unknown;
      id: string;
      method: PaymentMethod;
      packageUses: number;
      paidAt: Date;
      reference: string | null;
      status: PaymentRecordStatus;
    }[];
    refunds: {
      amount: unknown;
      id: string;
      method: PaymentMethod;
      packageUsesRestored: number;
      reason: string;
      reference: string | null;
      refundedAt: Date;
    }[];
  }[],
) {
  const activities: ShiftActivity[] = [];

  for (const shift of shifts) {
    for (const payment of shift.payments) {
      activities.push({
        amount: Number(payment.amount ?? 0),
        detail: null,
        id: `payment-${payment.id}`,
        method: payment.method,
        occurredAt: payment.paidAt,
        packageUses: payment.packageUses,
        reference: payment.reference,
        status: formatPaymentStatus(payment.status),
        type: "payment",
      });
    }

    for (const refund of shift.refunds) {
      activities.push({
        amount: Number(refund.amount ?? 0),
        detail: refund.reason,
        id: `refund-${refund.id}`,
        method: refund.method,
        occurredAt: refund.refundedAt,
        packageUses: refund.packageUsesRestored,
        reference: refund.reference,
        status: "refund",
        type: "refund",
      });
    }
  }

  return activities.sort(
    (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
  );
}

function summarizePayments(
  payments: {
    amount: unknown;
    method: PaymentMethod;
    packageUses: number;
  }[],
  refunds: {
    amount: unknown;
    method: PaymentMethod;
    packageUsesRestored: number;
  }[],
) {
  let grossCollectedCents = 0;
  let refundedCents = 0;
  let grossCashCents = 0;
  let refundedCashCents = 0;
  let packageUses = 0;
  let packageUsesRestored = 0;
  let paymentCount = 0;

  for (const payment of payments) {
    if (payment.method === "PACKAGE") {
      packageUses += payment.packageUses;
      continue;
    }

    const amountCents = toCents(payment.amount ?? 0);
    grossCollectedCents += amountCents;
    paymentCount += 1;

    if (payment.method === "CASH") {
      grossCashCents += amountCents;
    }
  }

  for (const refund of refunds) {
    if (refund.method === "PACKAGE") {
      packageUsesRestored += refund.packageUsesRestored;
      continue;
    }

    const amountCents = toCents(refund.amount ?? 0);
    refundedCents += amountCents;

    if (refund.method === "CASH") {
      refundedCashCents += amountCents;
    }
  }

  return {
    cashAmount: fromCents(grossCashCents - refundedCashCents),
    collected: fromCents(grossCollectedCents - refundedCents),
    grossCollected: fromCents(grossCollectedCents),
    packageUses: Math.max(0, packageUses - packageUsesRestored),
    paymentCount,
    refunded: fromCents(refundedCents),
  };
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="report-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel report-card${className ? ` ${className}` : ""}`}>
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function getTodayRange() {
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toDateExclusive = addDays(fromDate, 1);

  return { fromDate, toDateExclusive };
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function money(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

function formatDifference(value: unknown) {
  if (value == null) {
    return "-";
  }

  const amount = Number(value);

  if (amount === 0) {
    return <span className="closing-difference balanced">Balanced</span>;
  }

  return amount < 0 ? (
    <span className="closing-difference short">Short {money(Math.abs(amount))}</span>
  ) : (
    <span className="closing-difference over">Over {money(amount)}</span>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatPaymentStatus(status: PaymentRecordStatus) {
  return status.toLowerCase();
}

function formatDisplayDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
